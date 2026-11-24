import { Router } from 'express';
import type { Response } from 'express';
import { getDb, getSecurityConfigValue, logAudit, logSecurityEvent } from '../db.ts';
import {
  clearSessionCookie,
  requireAuth,
  setSessionCookie,
  type AuthRequest,
} from '../middleware.ts';
import {
  checkRateLimit,
  createAdaptiveChallenge,
  decryptSecret,
  generateRandomToken,
  getApproxLocation,
  getClientIp,
  hashPassword,
  hashRecoveryCode,
  isValidEmail,
  isValidPhone,
  isValidUsername,
  recordAuthFailure,
  resetAuthFailures,
  sha256Hex,
  sleep,
  validatePasswordPolicy,
  verifyAdaptiveChallenge,
  verifyPassword,
  verifyTotpCode,
} from '../security.ts';

const router = Router();

// Pre-computed dummy Argon2id hash used to equalize timing when user does not exist
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('PinjamAlat_Timing_Equalizer_#99182');
  }
  return dummyHashPromise;
}

function createSessionRecord(params: {
  userId: number;
  ipAddress: string;
  userAgent: string;
  mfaVerified: boolean;
  lastReauthAt?: string | null;
}): { sessionId: string; maxAgeSeconds: number } {
  const db = getDb();
  const sessionId = generateRandomToken(32); // 256-bit cryptographically random session ID
  const maxHours = Number(getSecurityConfigValue('max_session_hours', '24')) || 24;
  const maxAgeSeconds = maxHours * 3600;
  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + maxAgeSeconds * 1000).toISOString();
  const approxLocation = getApproxLocation(params.ipAddress);

  db.prepare(`
    INSERT INTO sessions (id, user_id, ip_address, user_agent, approx_location, mfa_verified, last_reauth_at, last_activity_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    params.userId,
    params.ipAddress,
    params.userAgent.slice(0, 180),
    approxLocation,
    params.mfaVerified ? 1 : 0,
    params.lastReauthAt ?? null,
    nowIso,
    expiresIso
  );

  return { sessionId, maxAgeSeconds };
}

router.get('/bootstrap-status', (_req, res: Response) => {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'superadmin'").get() as { cnt: number };
  res.json({ needsBootstrap: row.cnt === 0 });
});

router.post('/bootstrap-superadmin', async (req: AuthRequest, res: Response) => {
  const ip = getClientIp(req);
  const db = getDb();
  const existing = db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'superadmin'").get() as { cnt: number };
  if (existing.cnt > 0) {
    res.status(403).json({ error: 'Akun Superadmin awal sudah dikonfigurasi.' });
    return;
  }

  const { username, email, fullName, phone, password } = req.body || {};
  if (!isValidUsername(username) || !isValidEmail(email) || typeof fullName !== 'string' || fullName.trim().length < 2 || !isValidPhone(phone)) {
    res.status(400).json({ error: 'Lengkapi username (3–32 karakter), email, nama lengkap, dan nomor telepon yang valid.' });
    return;
  }

  const pwCheck = validatePasswordPolicy(password, { username, email, minLength: 12 });
  if (!pwCheck.ok) {
    res.status(400).json({ error: pwCheck.error });
    return;
  }

  const cleanUsername = String(username).trim().toLowerCase();
  const cleanEmail = String(email).trim().toLowerCase();
  const pwHash = await hashPassword(password);

  db.exec('BEGIN IMMEDIATE;');
  try {
    const recheck = db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'superadmin'").get() as { cnt: number };
    if (recheck.cnt > 0) {
      db.exec('ROLLBACK;');
      res.status(403).json({ error: 'Akun Superadmin awal sudah dikonfigurasi.' });
      return;
    }

    const dup = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(cleanUsername, cleanEmail);
    if (dup) {
      db.exec('ROLLBACK;');
      res.status(409).json({ error: 'Username atau email sudah digunakan.' });
      return;
    }

    const insertResult = db.prepare(`
      INSERT INTO users (username, email, full_name, phone, role, password_hash, email_verified, is_active, mfa_enabled)
      VALUES (?, ?, ?, ?, 'superadmin', ?, 1, 1, 0)
    `).run(cleanUsername, cleanEmail, fullName.trim().slice(0, 80), String(phone).trim(), pwHash);

    const userId = Number(insertResult.lastInsertRowid);
    db.exec('COMMIT;');

    const { sessionId, maxAgeSeconds } = createSessionRecord({
      userId,
      ipAddress: ip,
      userAgent: String(req.headers['user-agent'] || ''),
      mfaVerified: false,
      lastReauthAt: null,
    });
    setSessionCookie(res, sessionId, maxAgeSeconds);

    logAudit({
      actorUserId: userId,
      actorRole: 'superadmin',
      action: 'BOOTSTRAP_SUPERADMIN',
      targetType: 'user',
      targetId: userId,
      details: { username: cleanUsername },
      ipAddress: ip,
    });

    res.status(201).json({
      message: 'Superadmin awal berhasil dibuat. Silakan aktifkan MFA Authenticator.',
      mfaSetupRequired: true,
      user: {
        id: userId,
        username: cleanUsername,
        email: cleanEmail,
        fullName: fullName.trim().slice(0, 80),
        phone: String(phone).trim(),
        role: 'superadmin',
        emailVerified: true,
        mfaEnabled: false,
      },
    });
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch {}
    console.error('[Bootstrap] Error:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Gagal memproses permintaan.' });
  }
});

router.get('/challenge', (_req, res: Response) => {
  res.json(createAdaptiveChallenge());
});

router.post('/register', async (req: AuthRequest, res: Response) => {
  const ip = getClientIp(req);
  const regRate = checkRateLimit(`register:${ip}`, 8, 60 * 60 * 1000);
  if (!regRate.allowed) {
    logSecurityEvent({
      eventType: 'REGISTER_RATE_LIMITED',
      severity: 'medium',
      ipAddress: ip,
      path: req.originalUrl,
      method: req.method,
      summary: 'Batas pembuatan akun per jam terlampaui.',
    });
    res.status(429).json({ error: `Terlalu banyak pendaftaran dari jaringan ini. Coba lagi dalam ${regRate.retryAfterSec} detik.` });
    return;
  }

  const { username, email, fullName, phone, password } = req.body || {};

  if (!isValidUsername(username)) {
    res.status(400).json({ error: 'Username harus 3–32 karakter (huruf, angka, titik, garis bawah, atau hubung).' });
    return;
  }
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Format email tidak valid.' });
    return;
  }
  if (typeof fullName !== 'string' || fullName.trim().length < 2 || fullName.trim().length > 80) {
    res.status(400).json({ error: 'Nama lengkap harus 2–80 karakter.' });
    return;
  }
  if (!isValidPhone(phone)) {
    res.status(400).json({ error: 'Nomor WhatsApp/telepon tidak valid.' });
    return;
  }

  const cleanUsername = String(username).trim().toLowerCase();
  const cleanEmail = String(email).trim().toLowerCase();
  const minLength = Number(getSecurityConfigValue('min_password_length', '12')) || 12;

  const pwCheck = validatePasswordPolicy(password, { username: cleanUsername, email: cleanEmail, minLength });
  if (!pwCheck.ok) {
    res.status(400).json({ error: pwCheck.error });
    return;
  }

  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1')
    .get(cleanUsername, cleanEmail);

  if (existing) {
    res.status(409).json({ error: 'Username atau email sudah terdaftar.' });
    return;
  }

  const pwHash = await hashPassword(password);
  const verifyToken = generateRandomToken(32);
  const verifyTokenHash = sha256Hex(verifyToken);
  const verifyExpiresIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  try {
    // Role is ALWAYS forced to 'customer' regardless of any client payload
    const insertRes = db
      .prepare(`
        INSERT INTO users (username, email, full_name, phone, role, password_hash, email_verified, email_verify_token_hash, email_verify_expires_at, is_active, mfa_enabled)
        VALUES (?, ?, ?, ?, 'customer', ?, 0, ?, ?, 1, 0)
      `)
      .run(
        cleanUsername,
        cleanEmail,
        fullName.trim(),
        String(phone).trim(),
        pwHash,
        verifyTokenHash,
        verifyExpiresIso
      );

    const userId = Number(insertRes.lastInsertRowid);
    logAudit({
      actorUserId: userId,
      actorRole: 'customer',
      action: 'USER_REGISTERED',
      targetType: 'user',
      targetId: userId,
      details: { username: cleanUsername },
      ipAddress: ip,
    });

    res.status(201).json({
      message: 'Registrasi berhasil. Silakan masuk dan selesaikan verifikasi email Anda di halaman Keamanan Akun.',
    });
  } catch (err) {
    console.error('[Register] Error:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Registrasi gagal diproses.' });
  }
});

router.post('/login', async (req: AuthRequest, res: Response) => {
  const ip = getClientIp(req);
  const ua = String(req.headers['user-agent'] || 'Unknown').slice(0, 180);
  const approxLocation = getApproxLocation(ip);
  const { identifier, password, challengeId, challengeAnswer } = req.body || {};

  if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier.trim() || !password) {
    res.status(400).json({ error: 'Username/email dan password wajib diisi.' });
    return;
  }

  const cleanIdent = identifier.trim().toLowerCase();
  const maskedIdent = cleanIdent.length > 3 ? `${cleanIdent.slice(0, 2)}***${cleanIdent.slice(-2)}` : '***';
  const maxAttempts = Number(getSecurityConfigValue('max_login_attempts', '5')) || 5;

  const ipRate = checkRateLimit(`login:ip:${ip}`, maxAttempts * 4, 15 * 60 * 1000);
  const ipAcctRate = checkRateLimit(`login:ipacct:${ip}:${cleanIdent}`, maxAttempts, 15 * 60 * 1000);
  const globalAcctRate = checkRateLimit(`login:globalacct:${cleanIdent}`, maxAttempts * 5, 15 * 60 * 1000);

  if (!ipRate.allowed || !ipAcctRate.allowed) {
    const retryAfter = Math.max(ipRate.retryAfterSec, ipAcctRate.retryAfterSec);
    logSecurityEvent({
      eventType: 'LOGIN_RATE_LIMIT_TRIGGERED',
      severity: 'high',
      ipAddress: ip,
      path: req.originalUrl,
      method: req.method,
      summary: `Percobaan login berulang dibatasi untuk ${maskedIdent}.`,
    });
    res.status(429).json({
      error: `Terlalu banyak percobaan login gagal. Coba lagi dalam ${retryAfter} detik.`,
      retryAfterSec: retryAfter,
    });
    return;
  }

  // Adaptive CAPTCHA challenge after >= 3 failures from same IP/account or distributed attempts
  if (ipRate.requiresChallenge || ipAcctRate.requiresChallenge || globalAcctRate.requiresChallenge) {
    if (!challengeId || !challengeAnswer || !verifyAdaptiveChallenge(String(challengeId), String(challengeAnswer))) {
      const nextChallenge = createAdaptiveChallenge();
      res.status(428).json({
        error: 'Verifikasi keamanan tambahan diperlukan karena percobaan login berulang.',
        requiresChallenge: true,
        challenge: nextChallenge,
      });
      return;
    }
  }

  const db = getDb();
  const userRow = db
    .prepare(`
      SELECT id, username, email, full_name, phone, role, password_hash, email_verified, is_active, mfa_enabled, last_login_at, last_login_ip
      FROM users
      WHERE username = ? OR email = ?
      LIMIT 1
    `)
    .get(cleanIdent, cleanIdent) as Record<string, unknown> | undefined;

  let passwordMatches = false;
  if (userRow) {
    passwordMatches = await verifyPassword(String(userRow.password_hash), password);
  } else {
    // Equalize Argon2id computation time even when user does not exist
    const dummy = await getDummyHash();
    await verifyPassword(dummy, password);
  }

  if (!userRow || !passwordMatches || Number(userRow.is_active) !== 1) {
    const failIp = recordAuthFailure(`login:ip:${ip}`);
    const failIpAcct = recordAuthFailure(`login:ipacct:${ip}:${cleanIdent}`);
    const failGlobal = recordAuthFailure(`login:globalacct:${cleanIdent}`);
    const failures = Math.max(failIp.failures, failIpAcct.failures);

    // Progressive delay
    await sleep(Math.min(1500, failures * 180));

    const failureReason = !userRow
      ? 'unknown_account'
      : Number(userRow.is_active) !== 1
      ? 'account_disabled'
      : 'invalid_password';

    db.prepare(`
      INSERT INTO login_history (user_id, identifier_masked, success, failure_reason, ip_address, user_agent, approx_location, suspicious)
      VALUES (?, ?, 0, ?, ?, ?, ?, ?)
    `).run(
      userRow ? Number(userRow.id) : null,
      maskedIdent,
      failureReason,
      ip,
      ua,
      approxLocation,
      failures >= 3 || failGlobal.failures >= 4 ? 1 : 0
    );

    if (failures >= 3 || failGlobal.failures >= 4) {
      logSecurityEvent({
        eventType: failGlobal.failures > failIpAcct.failures ? 'MULTI_IP_CREDENTIAL_STUFFING' : 'BRUTE_FORCE_SUSPECTED',
        severity: failures >= 5 ? 'high' : 'medium',
        userId: userRow ? Number(userRow.id) : null,
        ipAddress: ip,
        path: req.originalUrl,
        method: req.method,
        summary: `Login gagal berulang (${Math.max(failures, failGlobal.failures)} kali) untuk ${maskedIdent}.`,
      });
    }

    const needChallenge = failures >= 3 || failGlobal.failures >= 3;
    const nextChallenge = needChallenge ? createAdaptiveChallenge() : undefined;
    res.status(401).json({
      error: 'Username/email atau password tidak sesuai.',
      requiresChallenge: needChallenge,
      challenge: nextChallenge,
    });
    return;
  }

  const userId = Number(userRow.id);
  const role = String(userRow.role) as 'customer' | 'admin' | 'superadmin';
  const mfaEnabled = Number(userRow.mfa_enabled) === 1;
  const prevIp = userRow.last_login_ip ? String(userRow.last_login_ip) : null;
  const suspiciousLogin = Boolean(prevIp && prevIp !== ip);

  resetAuthFailures(`login:ip:${ip}`);
  resetAuthFailures(`login:ipacct:${ip}:${cleanIdent}`);
  resetAuthFailures(`login:globalacct:${cleanIdent}`);

  // Revoke previous cookie session if one existed (session regeneration on login)
  if (req.auth?.session.id) {
    db.prepare("UPDATE sessions SET revoked_at = datetime('now'), revoke_reason = 'regenerated_on_login' WHERE id = ?").run(
      req.auth.session.id
    );
  }

  db.prepare(`
    INSERT INTO login_history (user_id, identifier_masked, success, failure_reason, ip_address, user_agent, approx_location, suspicious)
    VALUES (?, ?, 1, NULL, ?, ?, ?, ?)
  `).run(userId, maskedIdent, ip, ua, approxLocation, suspiciousLogin ? 1 : 0);

  if (suspiciousLogin) {
    logSecurityEvent({
      eventType: 'NEW_IP_LOGIN_ALERT',
      severity: 'medium',
      userId,
      ipAddress: ip,
      path: req.originalUrl,
      method: req.method,
      summary: `Login berhasil dari alamat IP baru (${ip}) untuk akun ${String(userRow.username)}.`,
    });
  }

  const nowIso = new Date().toISOString();
  db.prepare('UPDATE users SET last_login_at = ?, last_login_ip = ?, updated_at = ? WHERE id = ?').run(
    nowIso,
    ip,
    nowIso,
    userId
  );

  // Create freshly regenerated session ID
  const { sessionId, maxAgeSeconds } = createSessionRecord({
    userId,
    ipAddress: ip,
    userAgent: ua,
    mfaVerified: !mfaEnabled,
    lastReauthAt: null,
  });
  setSessionCookie(res, sessionId, maxAgeSeconds);

  logAudit({
    actorUserId: userId,
    actorRole: role,
    action: mfaEnabled ? 'LOGIN_MFA_PENDING' : 'LOGIN_SUCCESS',
    targetType: 'session',
    targetId: sessionId.slice(0, 12),
    details: { ip, suspiciousLogin },
    ipAddress: ip,
  });

  if (mfaEnabled) {
    res.json({
      mfaRequired: true,
      message: 'Masukkan kode 6 digit dari Authenticator TOTP atau gunakan Recovery Code.',
      user: {
        id: userId,
        username: String(userRow.username),
        role,
        mfaEnabled: true,
      },
    });
    return;
  }

  const mfaSetupRequired = role === 'admin' || role === 'superadmin';
  res.json({
    mfaRequired: false,
    mfaSetupRequired,
    suspiciousAlert: suspiciousLogin ? 'Login terdeteksi dari alamat IP baru. Periksa halaman Keamanan Akun.' : null,
    user: {
      id: userId,
      username: String(userRow.username),
      email: String(userRow.email),
      fullName: String(userRow.full_name),
      phone: String(userRow.phone),
      role,
      emailVerified: Number(userRow.email_verified) === 1,
      mfaEnabled: false,
    },
  });
});

router.post('/mfa/verify', requireAuth, async (req: AuthRequest, res: Response) => {
  const ip = getClientIp(req);
  const { user, session } = req.auth!;
  const { code, isRecoveryCode } = req.body || {};

  if (typeof code !== 'string' || !code.trim()) {
    res.status(400).json({ error: 'Kode verifikasi MFA wajib diisi.' });
    return;
  }

  const mfaRate = checkRateLimit(`mfa:${user.id}:${ip}`, 8, 10 * 60 * 1000);
  if (!mfaRate.allowed) {
    res.status(429).json({ error: `Terlalu banyak percobaan MFA. Coba lagi dalam ${mfaRate.retryAfterSec} detik.` });
    return;
  }

  const db = getDb();
  let verified = false;

  if (isRecoveryCode) {
    const codeHash = hashRecoveryCode(code);
    const recRow = db
      .prepare('SELECT id FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL LIMIT 1')
      .get(user.id, codeHash) as { id: number } | undefined;
    if (recRow) {
      db.prepare('UPDATE recovery_codes SET used_at = ? WHERE id = ?').run(new Date().toISOString(), recRow.id);
      verified = true;
    }
  } else {
    const userRow = db
      .prepare('SELECT totp_secret_enc FROM users WHERE id = ?')
      .get(user.id) as { totp_secret_enc: string | null } | undefined;
    const secret = userRow?.totp_secret_enc ? decryptSecret(userRow.totp_secret_enc) : null;
    if (secret && verifyTotpCode(secret, code)) {
      verified = true;
    } else {
      // Also check any verified device in mfa_devices
      const devices = db
        .prepare('SELECT id, secret_enc FROM mfa_devices WHERE user_id = ? AND verified = 1')
        .all(user.id) as Array<{ id: number; secret_enc: string }>;
      for (const dev of devices) {
        const devSecret = decryptSecret(dev.secret_enc);
        if (devSecret && verifyTotpCode(devSecret, code)) {
          db.prepare('UPDATE mfa_devices SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), dev.id);
          verified = true;
          break;
        }
      }
    }
  }

  if (!verified) {
    logSecurityEvent({
      eventType: 'MFA_VERIFICATION_FAILED',
      severity: 'medium',
      userId: user.id,
      ipAddress: ip,
      path: req.originalUrl,
      method: req.method,
      summary: 'Verifikasi MFA gagal.',
    });
    res.status(401).json({ error: 'Kode Authenticator atau Recovery Code tidak valid.' });
    return;
  }

  // Regenerate Session ID upon MFA privilege elevation
  db.prepare("UPDATE sessions SET revoked_at = datetime('now'), revoke_reason = 'mfa_elevation_regenerated' WHERE id = ?").run(
    session.id
  );
  const nowIso = new Date().toISOString();
  const { sessionId: newSessionId, maxAgeSeconds } = createSessionRecord({
    userId: user.id,
    ipAddress: ip,
    userAgent: String(req.headers['user-agent'] || ''),
    mfaVerified: true,
    lastReauthAt: null,
  });
  setSessionCookie(res, newSessionId, maxAgeSeconds);

  logAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'MFA_VERIFIED',
    targetType: 'session',
    targetId: newSessionId.slice(0, 12),
    details: { viaRecoveryCode: Boolean(isRecoveryCode) },
    ipAddress: ip,
  });

  res.json({
    verified: true,
    user: {
      ...user,
      mfaVerified: true,
    },
  });
});

router.post('/forgot-password', async (req: AuthRequest, res: Response) => {
  const ip = getClientIp(req);
  const resetRate = checkRateLimit(`pwreset:${ip}`, 5, 15 * 60 * 1000);
  if (!resetRate.allowed) {
    res.status(429).json({ error: `Terlalu banyak permintaan reset password. Coba lagi dalam ${resetRate.retryAfterSec} detik.` });
    return;
  }

  const { email } = req.body || {};
  const uniformMessage =
    'Jika email terdaftar pada sistem PinjamAlat, instruksi reset password telah dikirim melalui kanal terverifikasi (berlaku 15 menit).';

  if (!isValidEmail(email)) {
    res.json({ message: uniformMessage });
    return;
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const db = getDb();
  const userRow = db
    .prepare('SELECT id, role FROM users WHERE email = ? AND is_active = 1 LIMIT 1')
    .get(cleanEmail) as { id: number; role: string } | undefined;

  if (userRow) {
    const rawToken = generateRandomToken(32); // 256-bit high-entropy token
    const tokenHash = sha256Hex(rawToken);
    const expiresIso = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // Invalidate any prior unused reset tokens for this user
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(
      new Date().toISOString(),
      userRow.id
    );

    db.prepare(`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
      VALUES (?, ?, ?, ?)
    `).run(userRow.id, tokenHash, expiresIso, ip);

    logAudit({
      actorUserId: userRow.id,
      actorRole: userRow.role,
      action: 'PASSWORD_RESET_REQUESTED',
      targetType: 'user',
      targetId: userRow.id,
      details: { ip },
      ipAddress: ip,
    });

    // Server log records only masked reference, never the token or password
    console.info(`[Auth] Password reset issued for user #${userRow.id} (token hash prefix: ${tokenHash.slice(0, 8)}...)`);
  }

  // Always return identical HTTP status & response body regardless of email existence
  res.json({ message: uniformMessage });
});

router.post('/reset-password', async (req: AuthRequest, res: Response) => {
  const ip = getClientIp(req);
  const { token, newPassword } = req.body || {};

  if (typeof token !== 'string' || token.length < 32 || typeof newPassword !== 'string') {
    res.status(400).json({ error: 'Token reset atau password baru tidak valid.' });
    return;
  }

  const tokenHash = sha256Hex(token.trim());
  const db = getDb();
  const tokenRow = db
    .prepare(`
      SELECT prt.id, prt.user_id, prt.expires_at, prt.used_at, u.username, u.email, u.role
      FROM password_reset_tokens prt
      INNER JOIN users u ON u.id = prt.user_id
      WHERE prt.token_hash = ?
      LIMIT 1
    `)
    .get(tokenHash) as
    | { id: number; user_id: number; expires_at: string; used_at: string | null; username: string; email: string; role: string }
    | undefined;

  if (!tokenRow || tokenRow.used_at !== null || Date.now() > Date.parse(tokenRow.expires_at)) {
    res.status(400).json({ error: 'Token reset password tidak valid, sudah digunakan, atau telah kedaluwarsa.' });
    return;
  }

  const minLength = Number(getSecurityConfigValue('min_password_length', '12')) || 12;
  const pwCheck = validatePasswordPolicy(newPassword, {
    username: tokenRow.username,
    email: tokenRow.email,
    minLength,
  });
  if (!pwCheck.ok) {
    res.status(400).json({ error: pwCheck.error });
    return;
  }

  const newHash = await hashPassword(newPassword);
  const nowIso = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE;');
  try {
    // Ensure single-use atomically
    const markUsed = db
      .prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL')
      .run(nowIso, tokenRow.id);
    if (markUsed.changes !== 1) {
      db.exec('ROLLBACK;');
      res.status(400).json({ error: 'Token reset sudah digunakan.' });
      return;
    }

    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(newHash, nowIso, tokenRow.user_id);

    // Revoke ALL existing sessions after password reset
    db.prepare("UPDATE sessions SET revoked_at = ?, revoke_reason = 'password_reset' WHERE user_id = ? AND revoked_at IS NULL").run(
      nowIso,
      tokenRow.user_id
    );
    db.exec('COMMIT;');

    logAudit({
      actorUserId: tokenRow.user_id,
      actorRole: tokenRow.role,
      action: 'PASSWORD_RESET_COMPLETED',
      targetType: 'user',
      targetId: tokenRow.user_id,
      details: { sessionsRevoked: true },
      ipAddress: ip,
    });

    res.json({ message: 'Password berhasil diperbarui dan semua sesi lama telah dicabut. Silakan masuk kembali.' });
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch {}
    console.error('[ResetPassword] Error:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Gagal memperbarui password.' });
  }
});

router.post('/verify-email', (req: AuthRequest, res: Response) => {
  const { token } = req.body || {};
  if (typeof token !== 'string' || token.length < 32) {
    res.status(400).json({ error: 'Token verifikasi email tidak valid.' });
    return;
  }
  const db = getDb();
  const tokenHash = sha256Hex(token.trim());
  const row = db
    .prepare('SELECT id, email_verify_expires_at FROM users WHERE email_verify_token_hash = ? LIMIT 1')
    .get(tokenHash) as { id: number; email_verify_expires_at: string | null } | undefined;

  if (!row || !row.email_verify_expires_at || Date.now() > Date.parse(row.email_verify_expires_at)) {
    res.status(400).json({ error: 'Token verifikasi tidak valid atau telah kedaluwarsa.' });
    return;
  }

  db.prepare(`
    UPDATE users
    SET email_verified = 1, email_verify_token_hash = NULL, email_verify_expires_at = NULL, updated_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), row.id);

  res.json({ message: 'Email berhasil diverifikasi.' });
});

router.post('/logout', (req: AuthRequest, res: Response) => {
  const db = getDb();
  if (req.auth?.session.id) {
    db.prepare("UPDATE sessions SET revoked_at = datetime('now'), revoke_reason = 'user_logout' WHERE id = ?").run(
      req.auth.session.id
    );
    logAudit({
      actorUserId: req.auth.user.id,
      actorRole: req.auth.user.role,
      action: 'LOGOUT',
      targetType: 'session',
      targetId: req.auth.session.id.slice(0, 12),
      ipAddress: getClientIp(req),
    });
  }
  clearSessionCookie(res);
  res.json({ message: 'Anda telah keluar.' });
});

router.get('/me', (req: AuthRequest, res: Response) => {
  const db = getDb();
  const superRow = db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'superadmin'").get() as { cnt: number };
  if (!req.auth) {
    res.json({ authenticated: false, needsBootstrap: superRow.cnt === 0, user: null });
    return;
  }
  const { user, session } = req.auth;
  const mfaPending = user.mfaEnabled && !session.mfaVerified;
  const mfaSetupRequired = (user.role === 'admin' || user.role === 'superadmin') && !user.mfaEnabled;

  res.json({
    authenticated: true,
    needsBootstrap: superRow.cnt === 0,
    mfaPending,
    mfaSetupRequired,
    user: {
      ...user,
      mfaVerified: session.mfaVerified,
      lastReauthAt: session.lastReauthAt,
    },
  });
});

export default router;
