import { Router } from 'express';
import type { Response } from 'express';
import { getDb, logAudit } from '../db.ts';
import {
  requireAuth,
  requirePrivilegedMfa,
  requireReauth,
  requireRole,
  type AuthRequest,
} from '../middleware.ts';
import {
  getClientIp,
  hashPassword,
  isValidEmail,
  isValidPhone,
  isValidSafeImageUrl,
  isValidUsername,
  parsePositiveInt,
  ROLE_ALLOWLIST,
  validatePasswordPolicy,
} from '../security.ts';

const router = Router();
router.use(requireAuth, requireRole('superadmin'), requirePrivilegedMfa);

router.get('/users', (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const users = db
    .prepare(
      `SELECT id, username, email, full_name, phone, role, email_verified, is_active, mfa_enabled, last_login_at, last_login_ip, created_at
       FROM users
       ORDER BY CASE role WHEN 'superadmin' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, id ASC`
    )
    .all();
  res.json({ users });
});

router.post('/admins', requireReauth, async (req: AuthRequest, res: Response) => {
  const ip = getClientIp(req);
  const { user } = req.auth!;
  const { username, email, fullName, phone, password, role } = req.body || {};

  if (!isValidUsername(username) || !isValidEmail(email) || typeof fullName !== 'string' || fullName.trim().length < 2 || !isValidPhone(phone)) {
    res.status(400).json({ error: 'Data akun admin tidak valid.' });
    return;
  }
  const targetRole = role === 'superadmin' ? 'superadmin' : 'admin';
  const pwCheck = validatePasswordPolicy(password, { username, email, minLength: 12 });
  if (!pwCheck.ok) {
    res.status(400).json({ error: pwCheck.error });
    return;
  }

  const cleanUsername = String(username).trim().toLowerCase();
  const cleanEmail = String(email).trim().toLowerCase();
  const db = getDb();
  const dup = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(cleanUsername, cleanEmail);
  if (dup) {
    res.status(409).json({ error: 'Username atau email sudah digunakan.' });
    return;
  }

  const pwHash = await hashPassword(password);
  const ins = db
    .prepare(
      `INSERT INTO users (username, email, full_name, phone, role, password_hash, email_verified, is_active, mfa_enabled)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, 0)`
    )
    .run(cleanUsername, cleanEmail, fullName.trim().slice(0, 80), String(phone).trim(), targetRole, pwHash);

  const newId = Number(ins.lastInsertRowid);
  logAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'PRIVILEGED_ACCOUNT_CREATED',
    targetType: 'user',
    targetId: newId,
    details: { username: cleanUsername, role: targetRole },
    ipAddress: ip,
  });

  res.status(201).json({
    id: newId,
    message: `Akun ${targetRole} berhasil dibuat. Akun baru wajib mengaktifkan MFA saat login pertama.`,
  });
});

router.patch('/users/:id/role', requireReauth, (req: AuthRequest, res: Response) => {
  const ip = getClientIp(req);
  const { user } = req.auth!;
  const targetId = parsePositiveInt(req.params.id, 1, 1_000_000_000);
  const nextRole = typeof req.body?.role === 'string' ? req.body.role.trim() : '';

  if (!targetId || !ROLE_ALLOWLIST.has(nextRole)) {
    res.status(400).json({ error: 'ID pengguna atau role tidak valid.' });
    return;
  }
  if (targetId === user.id && nextRole !== 'superadmin') {
    res.status(400).json({ error: 'Anda tidak dapat menurunkan role akun superadmin Anda sendiri.' });
    return;
  }

  const db = getDb();
  const target = db.prepare('SELECT id, role FROM users WHERE id = ? LIMIT 1').get(targetId) as
    | { id: number; role: string }
    | undefined;
  if (!target) {
    res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    return;
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").run(nextRole, targetId);
    // Revoke target user's sessions upon privilege change so session ID regenerates on next auth
    db.prepare("UPDATE sessions SET revoked_at = datetime('now'), revoke_reason = 'privilege_changed' WHERE user_id = ? AND revoked_at IS NULL").run(
      targetId
    );
    db.exec('COMMIT;');

    logAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'USER_ROLE_CHANGED',
      targetType: 'user',
      targetId,
      details: { from: target.role, to: nextRole },
      ipAddress: ip,
    });

    res.json({ message: 'Role pengguna diperbarui dan sesi lama pengguna telah dicabut.' });
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch {}
    console.error('[SuperadminRole] Error:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Gagal mengubah role pengguna.' });
  }
});

router.patch('/users/:id/status', requireReauth, (req: AuthRequest, res: Response) => {
  const ip = getClientIp(req);
  const { user } = req.auth!;
  const targetId = parsePositiveInt(req.params.id, 1, 1_000_000_000);
  const isActive = Boolean(req.body?.isActive);

  if (!targetId) {
    res.status(400).json({ error: 'ID pengguna tidak valid.' });
    return;
  }
  if (targetId === user.id && !isActive) {
    res.status(400).json({ error: 'Anda tidak dapat menonaktifkan akun Anda sendiri.' });
    return;
  }

  const db = getDb();
  const upd = db
    .prepare("UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?")
    .run(isActive ? 1 : 0, targetId);

  if (upd.changes === 0) {
    res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    return;
  }

  if (!isActive) {
    db.prepare("UPDATE sessions SET revoked_at = datetime('now'), revoke_reason = 'account_deactivated' WHERE user_id = ? AND revoked_at IS NULL").run(
      targetId
    );
  }

  logAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
    targetType: 'user',
    targetId,
    ipAddress: ip,
  });

  res.json({ message: isActive ? 'Akun diaktifkan.' : 'Akun dinonaktifkan dan seluruh sesinya dicabut.' });
});

router.get('/security-config', (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const cfgRows = db.prepare('SELECT key, value FROM security_config').all() as Array<{ key: string; value: string }>;
  const siteRows = db.prepare('SELECT key, value FROM site_settings').all() as Array<{ key: string; value: string }>;
  const config: Record<string, string> = {};
  const site: Record<string, string> = {};
  for (const r of cfgRows) config[r.key] = r.value;
  for (const r of siteRows) site[r.key] = r.value;
  res.json({ securityConfig: config, siteSettings: site });
});

router.put('/security-config', requireReauth, (req: AuthRequest, res: Response) => {
  const ip = getClientIp(req);
  const { user } = req.auth!;
  const { idleTimeoutMinutes, maxSessionHours, minPasswordLength, maxLoginAttempts, adminWa, adminIg } = req.body || {};

  const idle = parsePositiveInt(idleTimeoutMinutes, 5, 240);
  const maxH = parsePositiveInt(maxSessionHours, 1, 168);
  const minPw = parsePositiveInt(minPasswordLength, 12, 32);
  const maxAttempt = parsePositiveInt(maxLoginAttempts, 3, 15);

  if (!idle || !maxH || !minPw || !maxAttempt) {
    res.status(400).json({ error: 'Parameter kebijakan keamanan berada di luar batas yang diizinkan.' });
    return;
  }
  if (typeof adminWa !== 'string' || !/^[0-9]{8,20}$/.test(adminWa.trim())) {
    res.status(400).json({ error: 'Nomor WhatsApp harus berupa angka 8–20 digit (contoh: 6282164462480).' });
    return;
  }
  if (typeof adminIg !== 'string' || !isValidSafeImageUrl(adminIg)) {
    res.status(400).json({ error: 'URL Instagram harus menggunakan HTTP/HTTPS yang valid.' });
    return;
  }

  const db = getDb();
  const upsertCfg = db.prepare(`
    INSERT INTO security_config (key, value, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `);
  const upsertSite = db.prepare(`
    INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `);

  db.exec('BEGIN IMMEDIATE;');
  try {
    upsertCfg.run('idle_timeout_minutes', String(idle), user.id);
    upsertCfg.run('max_session_hours', String(maxH), user.id);
    upsertCfg.run('min_password_length', String(minPw), user.id);
    upsertCfg.run('max_login_attempts', String(maxAttempt), user.id);
    upsertSite.run('admin_wa', adminWa.trim(), user.id);
    upsertSite.run('admin_ig', adminIg.trim(), user.id);
    db.exec('COMMIT;');

    logAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'SECURITY_AND_CONTACT_CONFIG_UPDATED',
      targetType: 'security_config',
      targetId: 'global',
      details: { idle, maxH, minPw, maxAttempt },
      ipAddress: ip,
    });

    res.json({ message: 'Konfigurasi keamanan dan kontak berhasil diperbarui.' });
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch {}
    console.error('[SecurityConfig] Error:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Gagal menyimpan konfigurasi keamanan.' });
  }
});

router.get('/audit-logs', (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const auditLogs = db
    .prepare(
      `SELECT a.id, a.actor_user_id, u.username AS actor_username, a.actor_role, a.action, a.target_type, a.target_id, a.details_json, a.ip_address, a.created_at
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_user_id
       ORDER BY a.id DESC
       LIMIT 100`
    )
    .all();

  const securityEvents = db
    .prepare(
      `SELECT id, event_type, severity, user_id, ip_address, path, method, summary, payload_preview, created_at
       FROM security_events
       ORDER BY id DESC
       LIMIT 100`
    )
    .all();

  res.json({ auditLogs, securityEvents });
});

export default router;
