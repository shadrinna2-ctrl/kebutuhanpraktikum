import type { Request, Response, NextFunction } from 'express';
import { getDb, getSecurityConfigValue, logSecurityEvent } from './db.ts';
import {
  decryptSecret,
  detectSqlInjectionSignal,
  getClientIp,
  sanitizeForLog,
  verifyPassword,
  verifyTotpCode,
} from './security.ts';

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  fullName: string;
  phone: string;
  role: 'customer' | 'admin' | 'superadmin';
  emailVerified: boolean;
  isActive: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
}

export interface AuthSession {
  id: string;
  userId: number;
  ipAddress: string;
  userAgent: string;
  approxLocation: string;
  mfaVerified: boolean;
  lastReauthAt: string | null;
  lastActivityAt: string;
  expiresAt: string;
}

export interface AuthRequest extends Request {
  auth?: {
    user: AuthUser;
    session: AuthSession;
  };
}

export const SESSION_COOKIE_NAME = 'pa_session';

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

export function setSessionCookie(res: Response, sessionId: string, maxAgeSeconds: number): void {
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'Secure',
    'SameSite=None',
    'Partitioned',
  ];
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

export function clearSessionCookie(res: Response): void {
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'Secure',
    'SameSite=None',
    'Partitioned',
  ];
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

export function extractSessionToken(req: Request): { token: string | null; viaCookie: boolean } {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer && /^[a-f0-9]{64}$/i.test(bearer)) {
      return { token: bearer, viaCookie: false };
    }
  }
  const cookies = parseCookies(req);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  if (cookieToken && /^[a-f0-9]{64}$/i.test(cookieToken)) {
    return { token: cookieToken, viaCookie: true };
  }
  return { token: null, viaCookie: false };
}

// Verify Origin / custom X-Requested-With header on cookie-authenticated mutations
export function csrfOriginGuard(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }

  const { viaCookie } = extractSessionToken(req);
  if (!viaCookie) {
    // Non-cookie (Bearer or unauthenticated login/register) still checks Origin if present
    const origin = req.headers.origin;
    const expectedHost = (req.headers['x-forwarded-host'] || req.headers.host || '') as string;
    if (origin && expectedHost) {
      try {
        const parsedOrigin = new URL(origin);
        if (parsedOrigin.host !== expectedHost.split(',')[0].trim()) {
          res.status(403).json({ error: 'Permintaan lintas origin ditolak.' });
          return;
        }
      } catch {
        res.status(403).json({ error: 'Header Origin tidak valid.' });
        return;
      }
    }
    next();
    return;
  }

  const hasCustomHeader = req.headers['x-requested-with'] === 'PinjamAlat';
  const origin = req.headers.origin;
  const expectedHost = (req.headers['x-forwarded-host'] || req.headers.host || '') as string;

  let originMatches = false;
  if (origin && expectedHost) {
    try {
      const parsedOrigin = new URL(origin);
      originMatches = parsedOrigin.host === expectedHost.split(',')[0].trim();
    } catch {
      originMatches = false;
    }
  }

  if (!hasCustomHeader && !originMatches) {
    logSecurityEvent({
      eventType: 'CSRF_ORIGIN_BLOCKED',
      severity: 'high',
      ipAddress: getClientIp(req),
      path: req.originalUrl,
      method: req.method,
      summary: 'Permintaan mutasi berbasis cookie ditolak karena tidak memenuhi validasi Origin/X-Requested-With.',
    });
    res.status(403).json({ error: 'Validasi keamanan permintaan gagal.' });
    return;
  }

  next();
}

// Defense-in-depth SQLi telemetry middleware (logs probes without replacing prepared statements)
export function sqliTelemetryMiddleware(req: AuthRequest, _res: Response, next: NextFunction): void {
  const ip = getClientIp(req);
  const candidates: Array<{ source: string; value: unknown }> = [];

  for (const [k, v] of Object.entries(req.query || {})) {
    candidates.push({ source: `query.${k}`, value: v });
  }
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    const PASSWORD_FIELDS = new Set(['password', 'currentPassword', 'newPassword']);
    for (const [k, v] of Object.entries(req.body as Record<string, unknown>)) {
      if (!PASSWORD_FIELDS.has(k)) {
        candidates.push({ source: `body.${k}`, value: v });
      }
    }
  }

  for (const item of candidates) {
    if (typeof item.value === 'string') {
      const signal = detectSqlInjectionSignal(item.value);
      if (signal.detected) {
        logSecurityEvent({
          eventType: 'SQLI_PROBE_DETECTED',
          severity: 'high',
          userId: req.auth?.user.id ?? null,
          ipAddress: ip,
          path: req.originalUrl,
          method: req.method,
          summary: `Terdeteksi pola percobaan SQL Injection (${signal.matchedRule}) pada ${item.source}.`,
          payloadPreview: sanitizeForLog({ [item.source]: signal.preview }),
        });
        break;
      }
    }
  }

  next();
}

export function resolveSessionMiddleware(req: AuthRequest, _res: Response, next: NextFunction): void {
  const { token } = extractSessionToken(req);
  if (!token) {
    next();
    return;
  }

  try {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT
          s.id AS s_id, s.user_id AS s_user_id, s.ip_address AS s_ip, s.user_agent AS s_ua,
          s.approx_location AS s_loc, s.mfa_verified AS s_mfa_verified,
          s.last_reauth_at AS s_last_reauth_at, s.last_activity_at AS s_last_activity_at,
          s.expires_at AS s_expires_at, s.revoked_at AS s_revoked_at,
          u.id AS u_id, u.username AS u_username, u.email AS u_email,
          u.full_name AS u_full_name, u.phone AS u_phone, u.role AS u_role,
          u.email_verified AS u_email_verified, u.is_active AS u_is_active,
          u.mfa_enabled AS u_mfa_enabled, u.last_login_at AS u_last_login_at,
          u.last_login_ip AS u_last_login_ip
        FROM sessions s
        INNER JOIN users u ON u.id = s.user_id
        WHERE s.id = ?
        LIMIT 1`
      )
      .get(token) as Record<string, unknown> | undefined;

    if (!row || row.s_revoked_at) {
      next();
      return;
    }

    const nowMs = Date.now();
    const expiresMs = Date.parse(String(row.s_expires_at));
    const lastActivityMs = Date.parse(String(row.s_last_activity_at));
    const idleMinutes = Number(getSecurityConfigValue('idle_timeout_minutes', '30')) || 30;
    const idleLimitMs = idleMinutes * 60 * 1000;

    if (Number.isNaN(expiresMs) || nowMs > expiresMs) {
      db.prepare("UPDATE sessions SET revoked_at = datetime('now'), revoke_reason = 'expired' WHERE id = ?").run(token);
      next();
      return;
    }

    if (Number.isNaN(lastActivityMs) || nowMs - lastActivityMs > idleLimitMs) {
      db.prepare("UPDATE sessions SET revoked_at = datetime('now'), revoke_reason = 'idle_timeout' WHERE id = ?").run(token);
      next();
      return;
    }

    if (Number(row.u_is_active) !== 1) {
      db.prepare("UPDATE sessions SET revoked_at = datetime('now'), revoke_reason = 'account_disabled' WHERE user_id = ? AND revoked_at IS NULL").run(
        Number(row.u_id)
      );
      next();
      return;
    }

    // Suspicious session User-Agent check
    const currentUa = String(req.headers['user-agent'] || '').slice(0, 180);
    const storedUa = String(row.s_ua || '');
    if (storedUa && currentUa && storedUa !== currentUa) {
      logSecurityEvent({
        eventType: 'SUSPICIOUS_SESSION_UA_CHANGE',
        severity: 'medium',
        userId: Number(row.u_id),
        ipAddress: getClientIp(req),
        path: req.originalUrl,
        method: req.method,
        summary: 'Perubahan User-Agent terdeteksi pada sesi aktif.',
      });
    }

    db.prepare('UPDATE sessions SET last_activity_at = ? WHERE id = ?').run(new Date(nowMs).toISOString(), token);

    req.auth = {
      user: {
        id: Number(row.u_id),
        username: String(row.u_username),
        email: String(row.u_email),
        fullName: String(row.u_full_name),
        phone: String(row.u_phone),
        role: String(row.u_role) as 'customer' | 'admin' | 'superadmin',
        emailVerified: Number(row.u_email_verified) === 1,
        isActive: Number(row.u_is_active) === 1,
        mfaEnabled: Number(row.u_mfa_enabled) === 1,
        lastLoginAt: row.u_last_login_at ? String(row.u_last_login_at) : null,
        lastLoginIp: row.u_last_login_ip ? String(row.u_last_login_ip) : null,
      },
      session: {
        id: String(row.s_id),
        userId: Number(row.s_user_id),
        ipAddress: String(row.s_ip),
        userAgent: storedUa,
        approxLocation: String(row.s_loc),
        mfaVerified: Number(row.s_mfa_verified) === 1,
        lastReauthAt: row.s_last_reauth_at ? String(row.s_last_reauth_at) : null,
        lastActivityAt: new Date(nowMs).toISOString(),
        expiresAt: String(row.s_expires_at),
      },
    };
  } catch (err) {
    console.error('[Session] Error resolving session:', err instanceof Error ? err.message : 'unknown');
  }

  next();
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'Autentikasi diperlukan. Silakan masuk terlebih dahulu.' });
    return;
  }
  next();
}

export function requireRole(...allowedRoles: Array<'customer' | 'admin' | 'superadmin'>) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Autentikasi diperlukan.' });
      return;
    }
    if (!allowedRoles.includes(req.auth.user.role)) {
      logSecurityEvent({
        eventType: 'UNAUTHORIZED_ROLE_ACCESS',
        severity: 'high',
        userId: req.auth.user.id,
        ipAddress: getClientIp(req),
        path: req.originalUrl,
        method: req.method,
        summary: `Peran "${req.auth.user.role}" mencoba mengakses endpoint khusus [${allowedRoles.join(', ')}].`,
      });
      res.status(403).json({ error: 'Anda tidak memiliki hak akses untuk fitur ini.' });
      return;
    }
    next();
  };
}

// Enforce mandatory MFA for Admin and Superadmin
export function requirePrivilegedMfa(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'Autentikasi diperlukan.' });
    return;
  }
  const { user, session } = req.auth;
  if (user.role === 'admin' || user.role === 'superadmin') {
    if (!user.mfaEnabled) {
      res.status(403).json({
        error: 'Admin dan Superadmin wajib mengaktifkan MFA (Authenticator TOTP) sebelum mengakses panel pengelola.',
        code: 'MFA_SETUP_REQUIRED',
      });
      return;
    }
    if (!session.mfaVerified) {
      res.status(403).json({
        error: 'Verifikasi MFA diperlukan untuk sesi ini.',
        code: 'MFA_VERIFICATION_REQUIRED',
      });
      return;
    }
  }
  next();
}

// Require recent re-authentication (<= 10 min) OR inline currentPassword + totpCode verification
export async function requireReauth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.auth) {
    res.status(401).json({ error: 'Autentikasi diperlukan.' });
    return;
  }

  const { user, session } = req.auth;
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const totpCode = typeof body.totpCode === 'string' ? body.totpCode : '';

  const db = getDb();
  const lastReauthMs = session.lastReauthAt ? Date.parse(session.lastReauthAt) : 0;
  const isRecentlyReauthed = lastReauthMs > 0 && Date.now() - lastReauthMs <= 10 * 60 * 1000;

  if (currentPassword) {
    const userRow = db
      .prepare('SELECT password_hash, mfa_enabled, totp_secret_enc FROM users WHERE id = ?')
      .get(user.id) as { password_hash: string; mfa_enabled: number; totp_secret_enc: string | null } | undefined;

    if (!userRow || !(await verifyPassword(userRow.password_hash, currentPassword))) {
      logSecurityEvent({
        eventType: 'REAUTH_FAILED',
        severity: 'medium',
        userId: user.id,
        ipAddress: getClientIp(req),
        path: req.originalUrl,
        method: req.method,
        summary: 'Verifikasi password untuk tindakan sensitif gagal.',
      });
      res.status(403).json({ error: 'Password konfirmasi tidak sesuai.', code: 'REAUTH_REQUIRED' });
      return;
    }

    if (userRow.mfa_enabled === 1) {
      const secret = userRow.totp_secret_enc ? decryptSecret(userRow.totp_secret_enc) : null;
      if (!secret || !totpCode || !verifyTotpCode(secret, totpCode)) {
        res.status(403).json({ error: 'Kode Authenticator TOTP wajib valid untuk tindakan sensitif.', code: 'REAUTH_REQUIRED' });
        return;
      }
    }

    db.prepare('UPDATE sessions SET last_reauth_at = ? WHERE id = ?').run(new Date().toISOString(), session.id);
    next();
    return;
  }

  if (isRecentlyReauthed) {
    if (user.mfaEnabled && !session.mfaVerified) {
      res.status(403).json({ error: 'Verifikasi MFA diperlukan.', code: 'REAUTH_REQUIRED' });
      return;
    }
    next();
    return;
  }

  res.status(403).json({
    error: 'Tindakan sensitif memerlukan autentikasi ulang. Masukkan password Anda saat ini.',
    code: 'REAUTH_REQUIRED',
  });
}
