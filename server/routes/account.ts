import { Router } from 'express';
import type { Response } from 'express';
import { getDb, getSecurityConfigValue, logAudit } from '../db.ts';
import {
  requireAuth,
  requireReauth,
  setSessionCookie,
  type AuthRequest,
} from '../middleware.ts';
import {
  buildOtpAuthUri,
  decryptSecret,
  encryptSecret,
  generateBase32Secret,
  generateQrDataUrl,
  generateRandomToken,
  generateRecoveryCodes,
  getApproxLocation,
  getClientIp,
  hashPassword,
  isValidEmail,
  isValidPhone,
  parsePositiveInt,
  validatePasswordPolicy,
  verifyTotpCode,
} from '../security.ts';

const router = Router();
router.use(requireAuth);

router.get('/security', (req: AuthRequest, res: Response) => {
  const db = getDb();
  const { user, session } = req.auth!;

  const sessions = db
    .prepare(`
      SELECT id, ip_address, user_agent, approx_location, mfa_verified, last_activity_at, expires_at, created_at
      FROM sessions
      WHERE user_id = ? AND revoked_at IS NULL
      ORDER BY last_activity_at DESC
    `)
    .all(user.id) as Array<Record<string, unknown>>;

  const history = db
    .prepare(`
      SELECT id, success, failure_reason, ip_address, user_agent, approx_location, suspicious, created_at
      FROM login_history
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 15
    `)
    .all(user.id);

  const mfaDevices = db
    .prepare(`
      SELECT id, label, verified, last_used_at, created_at
      FROM mfa_devices
      WHERE user_id = ?
      ORDER BY id DESC
    `)
    .all(user.id);

  const recoveryRow = db
    .prepare('SELECT COUNT(*) AS remaining FROM recovery_codes WHERE user_id = ? AND used_at IS NULL')
    .get(user.id) as { remaining: number };

  const alerts = db
    .prepare(`
      SELECT id, event_type, severity, ip_address, summary, created_at
      FROM security_events
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 10
    `)
    .all(user.id);

  res.json({
    accountStatus: {
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      mfaMandatory: user.role === 'admin' || user.role === 'superadmin',
      lastLoginAt: user.lastLoginAt,
      lastLoginIp: user.lastLoginIp,
      approxLocation: session.approxLocation,
      activeSessionsCount: sessions.length,
      unusedRecoveryCodes: recoveryRow.remaining,
    },
    sessions: sessions.map((s) => ({
      idPrefix: String(s.id).slice(0, 12),
      id: String(s.id),
      isCurrent: String(s.id) === session.id,
      ipAddress: String(s.ip_address),
      userAgent: String(s.user_agent),
      approxLocation: String(s.approx_location),
      mfaVerified: Number(s.mfa_verified) === 1,
      lastActivityAt: String(s.last_activity_at),
      expiresAt: String(s.expires_at),
      createdAt: String(s.created_at),
    })),
    loginHistory: history,
    mfaDevices,
    alerts,
  });
});

router.post('/reauth', requireReauth, (_req: AuthRequest, res: Response) => {
  res.json({ reauthenticated: true, message: 'Autentikasi ulang berhasil diverifikasi.' });
});

router.post('/verify-email-confirm', (req: AuthRequest, res: Response) => {
  const db = getDb();
  const { user } = req.auth!;
  db.prepare(`
    UPDATE users
    SET email_verified = 1, email_verify_token_hash = NULL, email_verify_expires_at = NULL, updated_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), user.id);

  logAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'EMAIL_VERIFIED',
    targetType: 'user',
    targetId: user.id,
    ipAddress: getClientIp(req),
  });

  res.json({ emailVerified: true, message: 'Email akun berhasil diverifikasi.' });
});

router.patch('/profile', requireReauth, (req: AuthRequest, res: Response) => {
  const { user } = req.auth!;
  const { fullName, email, phone } = req.body || {};

  if (typeof fullName !== 'string' || fullName.trim().length < 2 || fullName.trim().length > 80) {
    res.status(400).json({ error: 'Nama lengkap harus 2–80 karakter.' });
    return;
  }
  if (!isValidEmail(email) || !isValidPhone(phone)) {
    res.status(400).json({ error: 'Email atau nomor telepon tidak valid.' });
    return;
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const db = getDb();
  const dup = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(cleanEmail, user.id);
  if (dup) {
    res.status(409).json({ error: 'Email tersebut sudah digunakan oleh akun lain.' });
    return;
  }

  db.prepare(`
    UPDATE users SET full_name = ?, email = ?, phone = ?, updated_at = ? WHERE id = ?
  `).run(fullName.trim(), cleanEmail, String(phone).trim(), new Date().toISOString(), user.id);

  logAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'PROFILE_UPDATED',
    targetType: 'user',
    targetId: user.id,
    details: { emailChanged: cleanEmail !== user.email },
    ipAddress: getClientIp(req),
  });

  res.json({ message: 'Profil berhasil diperbarui.' });
});

router.post('/password', requireReauth, async (req: AuthRequest, res: Response) => {
  const ip = getClientIp(req);
  const { user, session } = req.auth!;
  const { newPassword } = req.body || {};

  const minLength = Number(getSecurityConfigValue('min_password_length', '12')) || 12;
  const pwCheck = validatePasswordPolicy(newPassword, {
    username: user.username,
    email: user.email,
    minLength,
  });
  if (!pwCheck.ok) {
    res.status(400).json({ error: pwCheck.error });
    return;
  }

  const newHash = await hashPassword(newPassword);
  const nowIso = new Date().toISOString();
  const db = getDb();

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(newHash, nowIso, user.id);
    // Revoke ALL other sessions and regenerate current session ID
    db.prepare("UPDATE sessions SET revoked_at = ?, revoke_reason = 'password_changed' WHERE user_id = ? AND revoked_at IS NULL").run(
      nowIso,
      user.id
    );

    const newSessionId = generateRandomToken(32);
    const maxHours = Number(getSecurityConfigValue('max_session_hours', '24')) || 24;
    const maxAgeSeconds = maxHours * 3600;
    const expiresIso = new Date(Date.now() + maxAgeSeconds * 1000).toISOString();

    db.prepare(`
      INSERT INTO sessions (id, user_id, ip_address, user_agent, approx_location, mfa_verified, last_reauth_at, last_activity_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newSessionId,
      user.id,
      ip,
      String(req.headers['user-agent'] || '').slice(0, 180),
      getApproxLocation(ip),
      session.mfaVerified ? 1 : 0,
      nowIso,
      nowIso,
      expiresIso
    );
    db.exec('COMMIT;');

    setSessionCookie(res, newSessionId, maxAgeSeconds);

    // Log without including old or new password
    logAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'PASSWORD_CHANGED',
      targetType: 'user',
      targetId: user.id,
      details: { otherSessionsRevoked: true },
      ipAddress: ip,
    });

    res.json({
      message: 'Password berhasil diubah. Semua sesi pada perangkat lain telah dicabut.',
    });
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch {}
    console.error('[ChangePassword] Error:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Gagal mengganti password.' });
  }
});

router.post('/mfa/setup', async (req: AuthRequest, res: Response) => {
  const { user } = req.auth!;
  const label = typeof req.body?.label === 'string' && req.body.label.trim()
    ? req.body.label.trim().slice(0, 48)
    : 'Authenticator Utama';

  const secret = generateBase32Secret(20);
  const secretEnc = encryptSecret(secret);
  const otpAuthUri = buildOtpAuthUri(`${user.username}@PinjamAlat`, secret);
  const qrDataUrl = await generateQrDataUrl(otpAuthUri);

  const db = getDb();
  // Clean unverified pending devices older than this setup
  db.prepare('DELETE FROM mfa_devices WHERE user_id = ? AND verified = 0').run(user.id);
  const insertDev = db
    .prepare('INSERT INTO mfa_devices (user_id, label, secret_enc, verified) VALUES (?, ?, ?, 0)')
    .run(user.id, label, secretEnc);

  res.json({
    deviceId: Number(insertDev.lastInsertRowid),
    label,
    secretManual: secret,
    otpAuthUri,
    qrDataUrl,
  });
});

router.post('/mfa/confirm', (req: AuthRequest, res: Response) => {
  const ip = getClientIp(req);
  const { user, session } = req.auth!;
  const { deviceId, code } = req.body || {};

  const parsedDeviceId = parsePositiveInt(deviceId, 1, 1_000_000_000);
  if (!parsedDeviceId || typeof code !== 'string') {
    res.status(400).json({ error: 'Device ID dan kode 6 digit Authenticator wajib diisi.' });
    return;
  }

  const db = getDb();
  const deviceRow = db
    .prepare('SELECT id, label, secret_enc FROM mfa_devices WHERE id = ? AND user_id = ? AND verified = 0 LIMIT 1')
    .get(parsedDeviceId, user.id) as { id: number; label: string; secret_enc: string } | undefined;

  if (!deviceRow) {
    res.status(404).json({ error: 'Perangkat MFA tertunda tidak ditemukan.' });
    return;
  }

  const secret = decryptSecret(deviceRow.secret_enc);
  if (!secret || !verifyTotpCode(secret, code)) {
    res.status(400).json({ error: 'Kode TOTP 6 digit tidak cocok. Periksa waktu perangkat Anda.' });
    return;
  }

  const recoveryCodes = generateRecoveryCodes(8);
  const nowIso = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare('UPDATE mfa_devices SET verified = 1, last_used_at = ? WHERE id = ?').run(nowIso, deviceRow.id);
    db.prepare('UPDATE users SET mfa_enabled = 1, totp_secret_enc = ?, updated_at = ? WHERE id = ?').run(
      deviceRow.secret_enc,
      nowIso,
      user.id
    );

    // Replace recovery codes if none exist yet
    const existingRec = db
      .prepare('SELECT COUNT(*) AS cnt FROM recovery_codes WHERE user_id = ? AND used_at IS NULL')
      .get(user.id) as { cnt: number };
    let plainCodes: string[] | null = null;
    if (existingRec.cnt === 0) {
      const insRec = db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)');
      for (const rc of recoveryCodes) {
        insRec.run(user.id, rc.hash);
      }
      plainCodes = recoveryCodes.map((r) => r.plain);
    }

    // Regenerate session with mfa_verified = 1
    db.prepare("UPDATE sessions SET revoked_at = ?, revoke_reason = 'mfa_enrolled_regenerated' WHERE id = ?").run(
      nowIso,
      session.id
    );
    const newSessionId = generateRandomToken(32);
    const maxHours = Number(getSecurityConfigValue('max_session_hours', '24')) || 24;
    const maxAgeSeconds = maxHours * 3600;
    const expiresIso = new Date(Date.now() + maxAgeSeconds * 1000).toISOString();

    db.prepare(`
      INSERT INTO sessions (id, user_id, ip_address, user_agent, approx_location, mfa_verified, last_reauth_at, last_activity_at, expires_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      newSessionId,
      user.id,
      ip,
      String(req.headers['user-agent'] || '').slice(0, 180),
      getApproxLocation(ip),
      null,
      nowIso,
      expiresIso
    );
    db.exec('COMMIT;');

    setSessionCookie(res, newSessionId, maxAgeSeconds);

    logAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'MFA_ENABLED',
      targetType: 'mfa_device',
      targetId: deviceRow.id,
      details: { label: deviceRow.label },
      ipAddress: ip,
    });

    res.json({
      mfaEnabled: true,
      recoveryCodes: plainCodes,
      message: 'MFA Authenticator berhasil diaktifkan.',
    });
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch {}
    console.error('[MfaConfirm] Error:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Gagal mengaktifkan MFA.' });
  }
});

router.post('/mfa/recovery-codes/regenerate', requireReauth, (req: AuthRequest, res: Response) => {
  const { user } = req.auth!;
  if (!user.mfaEnabled) {
    res.status(400).json({ error: 'Aktifkan MFA terlebih dahulu sebelum membuat ulang recovery codes.' });
    return;
  }

  const db = getDb();
  const recoveryCodes = generateRecoveryCodes(8);

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(user.id);
    const ins = db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)');
    for (const rc of recoveryCodes) {
      ins.run(user.id, rc.hash);
    }
    db.exec('COMMIT;');

    logAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'MFA_RECOVERY_CODES_REGENERATED',
      targetType: 'user',
      targetId: user.id,
      ipAddress: getClientIp(req),
    });

    res.json({ recoveryCodes: recoveryCodes.map((r) => r.plain) });
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch {}
    console.error('[RecoveryRegen] Error:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Gagal membuat ulang recovery codes.' });
  }
});

router.delete('/mfa/devices/:id', requireReauth, (req: AuthRequest, res: Response) => {
  const { user } = req.auth!;
  const deviceId = parsePositiveInt(req.params.id, 1, 1_000_000_000);
  if (!deviceId) {
    res.status(400).json({ error: 'ID perangkat MFA tidak valid.' });
    return;
  }

  const db = getDb();
  const countRow = db
    .prepare('SELECT COUNT(*) AS cnt FROM mfa_devices WHERE user_id = ? AND verified = 1')
    .get(user.id) as { cnt: number };

  if ((user.role === 'admin' || user.role === 'superadmin') && countRow.cnt <= 1) {
    res.status(400).json({ error: 'Admin dan Superadmin wajib memiliki minimal 1 perangkat MFA aktif.' });
    return;
  }

  const delRes = db.prepare('DELETE FROM mfa_devices WHERE id = ? AND user_id = ?').run(deviceId, user.id);
  if (delRes.changes === 0) {
    res.status(404).json({ error: 'Perangkat MFA tidak ditemukan.' });
    return;
  }

  if (countRow.cnt <= 1) {
    db.prepare('UPDATE users SET mfa_enabled = 0, totp_secret_enc = NULL WHERE id = ?').run(user.id);
  }

  logAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'MFA_DEVICE_REMOVED',
    targetType: 'mfa_device',
    targetId: deviceId,
    ipAddress: getClientIp(req),
  });

  res.json({ message: 'Perangkat MFA berhasil dihapus.' });
});

router.delete('/sessions/:sessionId', (req: AuthRequest, res: Response) => {
  const { user } = req.auth!;
  const targetSessionId = String(req.params.sessionId || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(targetSessionId)) {
    res.status(400).json({ error: 'ID sesi tidak valid.' });
    return;
  }

  const db = getDb();
  // Strict ownership check: user can only revoke their own session
  const upd = db
    .prepare("UPDATE sessions SET revoked_at = datetime('now'), revoke_reason = 'user_revoked_device' WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .run(targetSessionId, user.id);

  if (upd.changes === 0) {
    res.status(404).json({ error: 'Sesi aktif tidak ditemukan.' });
    return;
  }

  logAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'SESSION_REVOKED',
    targetType: 'session',
    targetId: targetSessionId.slice(0, 12),
    ipAddress: getClientIp(req),
  });

  res.json({ message: 'Sesi perangkat berhasil dicabut.' });
});

router.post('/sessions/revoke-others', (req: AuthRequest, res: Response) => {
  const { user, session } = req.auth!;
  const db = getDb();

  const upd = db
    .prepare("UPDATE sessions SET revoked_at = datetime('now'), revoke_reason = 'user_revoked_other_devices' WHERE user_id = ? AND id != ? AND revoked_at IS NULL")
    .run(user.id, session.id);

  logAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'ALL_OTHER_SESSIONS_REVOKED',
    targetType: 'user',
    targetId: user.id,
    details: { revokedCount: upd.changes },
    ipAddress: getClientIp(req),
  });

  res.json({ message: `${upd.changes} sesi pada perangkat lain telah dicabut.` });
});

export default router;
