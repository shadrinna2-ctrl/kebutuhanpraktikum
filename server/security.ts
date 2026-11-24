import crypto from 'node:crypto';
import { hash as argon2Hash, verify as argon2Verify, type Options as Argon2Options } from '@node-rs/argon2';
import QRCode from 'qrcode';
import type { Request } from 'express';

// Runtime-only signing/encryption key: uses process.env.SESSION_SECRET when configured,
// otherwise falls back to an in-memory CSPRNG key (never persisted in plaintext).
const RUNTIME_MASTER_KEY = (() => {
  const envKey = process.env.SESSION_SECRET;
  if (envKey && envKey.length >= 16) {
    return crypto.createHash('sha256').update(envKey).digest();
  }
  return crypto.randomBytes(32);
})();

const ARGON2_OPTIONS: Argon2Options = {
  algorithm: 2 as Argon2Options['algorithm'], // Argon2id
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(storedHash: string, candidatePassword: string): Promise<boolean> {
  try {
    return await argon2Verify(storedHash, candidatePassword);
  } catch {
    return false;
  }
}

// Common / breached password blocklist (lowercase normalized)
const COMMON_BREACHED_PASSWORDS = new Set([
  '123456789012',
  '1234567890123',
  'password1234',
  'password123456',
  'qwertyuiop12',
  'admin1234567',
  'pinjamalat12',
  'pinjamalat2026',
  'pinjamalat2026!',
  'letmein12345',
  'welcome12345',
  'iloveyou1234',
  '000000000000',
  '111111111111',
  'aaaaaaaaaaaa',
  'abc123456789',
  'passphrase12',
  'rahasia12345',
  'mahasiswa123',
  'universitas1',
]);

export function validatePasswordPolicy(
  password: string,
  context?: { username?: string; email?: string; minLength?: number }
): { ok: boolean; error?: string } {
  const minLen = context?.minLength ?? 12;
  if (typeof password !== 'string') {
    return { ok: false, error: 'Password tidak valid.' };
  }
  if (password.length < minLen) {
    return { ok: false, error: `Password minimal ${minLen} karakter.` };
  }
  if (password.length > 128) {
    return { ok: false, error: 'Password maksimal 128 karakter.' };
  }
  const normalized = password.trim().toLowerCase();
  if (COMMON_BREACHED_PASSWORDS.has(normalized)) {
    return { ok: false, error: 'Password terlalu umum atau pernah tercatat dalam kebocoran data. Gunakan kombinasi frasa sandi yang unik.' };
  }
  if (/^(.)\1+$/.test(password)) {
    return { ok: false, error: 'Password tidak boleh hanya berisi pengulangan satu karakter.' };
  }
  if (context?.username && context.username.length >= 3 && normalized.includes(context.username.toLowerCase())) {
    return { ok: false, error: 'Password tidak boleh mengandung username Anda.' };
  }
  if (context?.email) {
    const localPart = context.email.split('@')[0]?.toLowerCase();
    if (localPart && localPart.length >= 4 && normalized.includes(localPart)) {
      return { ok: false, error: 'Password tidak boleh mengandung bagian email Anda.' };
    }
  }
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^a-zA-Z0-9\s]/.test(password);
  const classCount = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;
  // Allow long passphrases (>=16 chars with spaces/words) or >=3 character classes for 12-15 chars
  if (password.length < 16 && classCount < 3) {
    return {
      ok: false,
      error: 'Untuk password 12–15 karakter, gunakan minimal 3 jenis karakter (huruf besar, huruf kecil, angka, simbol) atau gunakan frasa sandi minimal 16 karakter.',
    };
  }
  return { ok: true };
}

export function generateRandomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// AES-256-GCM encryption for TOTP secrets stored in database
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', RUNTIME_MASTER_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(payload: string): string | null {
  try {
    const parts = payload.split(':');
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, dataHex] = parts;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      RUNTIME_MASTER_KEY,
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

// RFC 4648 Base32 & RFC 6238 TOTP Implementation
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateBase32Secret(byteLength = 20): string {
  const buf = crypto.randomBytes(byteLength);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function decodeBase32(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpCode(secretBase32: string, timestampMs = Date.now(), stepSeconds = 30): string {
  const key = decodeBase32(secretBase32);
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(secretBase32: string, candidateCode: string, windowSteps = 1): boolean {
  const clean = String(candidateCode || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const now = Date.now();
  const candidateBuf = Buffer.from(clean, 'utf8');
  for (let offset = -windowSteps; offset <= windowSteps; offset++) {
    const expected = generateTotpCode(secretBase32, now + offset * 30_000);
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (expectedBuf.length === candidateBuf.length && crypto.timingSafeEqual(expectedBuf, candidateBuf)) {
      return true;
    }
  }
  return false;
}

export function buildOtpAuthUri(accountName: string, secretBase32: string, issuer = 'PinjamAlat'): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export async function generateQrDataUrl(otpAuthUri: string): Promise<string> {
  return QRCode.toDataURL(otpAuthUri, {
    width: 220,
    margin: 2,
    color: { dark: '#0f172a', light: '#ffffff' },
  });
}

export function generateRecoveryCodes(count = 8): Array<{ plain: string; hash: string }> {
  const codes: Array<{ plain: string; hash: string }> = [];
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < count; i++) {
    let raw = '';
    const bytes = crypto.randomBytes(8);
    for (let j = 0; j < 8; j++) {
      raw += chars[bytes[j] % chars.length];
    }
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    codes.push({
      plain: formatted,
      hash: sha256Hex(`recovery:${formatted}`),
    });
  }
  return codes;
}

export function hashRecoveryCode(code: string): string {
  const normalized = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const formatted = normalized.length === 8 ? `${normalized.slice(0, 4)}-${normalized.slice(4)}` : normalized;
  return sha256Hex(`recovery:${formatted}`);
}

// Allowlists for dynamic sorting / filtering / status / roles (SQLi prevention)
export const SORT_COLUMN_ALLOWLIST: Record<string, string> = {
  id: 'id',
  name: 'name',
  price: 'price',
  stock: 'stock',
  rating: 'rating',
  created_at: 'created_at',
};

export const SORT_DIR_ALLOWLIST: Record<string, 'ASC' | 'DESC'> = {
  asc: 'ASC',
  desc: 'DESC',
};

export const ORDER_STATUS_ALLOWLIST = new Set([
  'pending',
  'confirmed',
  'ongoing',
  'completed',
  'cancelled',
]);

export const ROLE_ALLOWLIST = new Set(['customer', 'admin', 'superadmin']);
export const CONDITION_ALLOWLIST = new Set(['Baik', 'Sangat Baik', 'Perlu Perawatan']);

// Input validators
export function isValidEmail(email: string): boolean {
  return typeof email === 'string' && email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export function isValidUsername(username: string): boolean {
  return typeof username === 'string' && /^[a-zA-Z0-9_.-]{3,32}$/.test(username.trim());
}

export function isValidPhone(phone: string): boolean {
  return typeof phone === 'string' && /^[0-9+\-\s]{8,20}$/.test(phone.trim());
}

export function isValidDateYmd(dateStr: string): boolean {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const parsed = new Date(`${dateStr}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === dateStr;
}

export function isValidSafeImageUrl(url: string): boolean {
  if (typeof url !== 'string' || !url.trim()) return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('/src/assets/images/') || trimmed.startsWith('/assets/')) {
    return !trimmed.includes('..');
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function parsePositiveInt(value: unknown, min = 1, max = 1_000_000): number | null {
  const num = Number(value);
  if (!Number.isInteger(num) || num < min || num > max) return null;
  return num;
}

// SQL Injection signal detection (defense-in-depth telemetry; never replaces prepared statements)
const SQLI_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'tautology_or', regex: /(?:'|"|`)\s*(?:or|and)\s+(?:'?\d+'?\s*=\s*'?\d+'?|true|false)/i },
  { name: 'or_numeric_tautology', regex: /\bor\s+1\s*=\s*1\b/i },
  { name: 'sql_comment_termination', regex: /(?:admin|root|user)?['"`]\s*(?:--|#|\/\*)/i },
  { name: 'union_select', regex: /\bunion\s+(?:all\s+)?select\b/i },
  { name: 'stacked_query', regex: /;\s*(?:drop|delete|insert|update|alter|create|exec|execute|truncate)\b/i },
  { name: 'time_blind_probe', regex: /\b(?:sleep|benchmark|pg_sleep|waitfor\s+delay|randomblob)\s*\(/i },
  { name: 'schema_probe', regex: /\b(?:information_schema|sqlite_master|sqlite_schema|sys\.tables|pg_catalog)\b/i },
  { name: 'error_extract_probe', regex: /\b(?:extractvalue|updatexml|cast\s*\(.+as\s+int)/i },
];

export function detectSqlInjectionSignal(input: unknown): { detected: boolean; matchedRule?: string; preview?: string } {
  if (typeof input !== 'string' || !input.trim()) return { detected: false };
  for (const pattern of SQLI_PATTERNS) {
    if (pattern.regex.test(input)) {
      return {
        detected: true,
        matchedRule: pattern.name,
        preview: input.slice(0, 120),
      };
    }
  }
  return { detected: false };
}

export function sanitizeForLog(obj: Record<string, unknown>): string {
  const REDACT_KEYS = new Set([
    'password',
    'currentPassword',
    'newPassword',
    'password_hash',
    'token',
    'resetToken',
    'totpCode',
    'secret',
    'recoveryCode',
    'authorization',
    'cookie',
  ]);
  const safeObj: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (REDACT_KEYS.has(key)) {
      safeObj[key] = '[REDACTED]';
    } else if (typeof val === 'string') {
      safeObj[key] = val.slice(0, 140);
    } else {
      safeObj[key] = val;
    }
  }
  return JSON.stringify(safeObj);
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim().slice(0, 64);
  }
  return (req.ip || req.socket?.remoteAddress || '127.0.0.1').slice(0, 64);
}

export function getApproxLocation(ip: string): string {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('::ffff:127.')) {
    return 'Banda Aceh / Lokal';
  }
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.16.')) {
    return 'Jaringan Kampus Internal';
  }
  return 'Indonesia (Jaringan Publik)';
}

// Sliding-window rate limiter + adaptive challenge state
interface RateBucket {
  timestamps: number[];
  failures: number;
  cooldownUntil: number;
}

const rateBuckets = new Map<string, RateBucket>();

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number; failures: number; requiresChallenge: boolean } {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [], failures: 0, cooldownUntil: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.timestamps = bucket.timestamps.filter((ts) => now - ts < windowMs);
  if (bucket.cooldownUntil > now) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((bucket.cooldownUntil - now) / 1000),
      failures: bucket.failures,
      requiresChallenge: bucket.failures >= 3,
    };
  }
  if (bucket.timestamps.length >= maxRequests) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil(windowMs / 1000),
      failures: bucket.failures,
      requiresChallenge: bucket.failures >= 3,
    };
  }
  bucket.timestamps.push(now);
  return {
    allowed: true,
    retryAfterSec: 0,
    failures: bucket.failures,
    requiresChallenge: bucket.failures >= 3,
  };
}

export function recordAuthFailure(key: string): { failures: number; delayMs: number; cooldownUntil: number } {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [now], failures: 0, cooldownUntil: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.failures += 1;
  // Temporary soft cooldown (no permanent lockout so attackers can't DoS victims)
  if (bucket.failures >= 8) {
    bucket.cooldownUntil = now + 5 * 60 * 1000;
  }
  const delayMs = Math.min(1500, bucket.failures * 180);
  return { failures: bucket.failures, delayMs, cooldownUntil: bucket.cooldownUntil };
}

export function resetAuthFailures(key: string): void {
  rateBuckets.delete(key);
}

// Adaptive challenge (HMAC-signed one-time puzzle, expires in 5 min)
const usedChallenges = new Set<string>();

export function createAdaptiveChallenge(): { challengeId: string; question: string; expiresAt: number } {
  const a = crypto.randomInt(4, 19);
  const b = crypto.randomInt(3, 17);
  const nonce = crypto.randomBytes(8).toString('hex');
  const expiresAt = Date.now() + 5 * 60 * 1000;
  const answer = String(a + b);
  const payload = `${nonce}.${expiresAt}.${answer}`;
  const sig = crypto.createHmac('sha256', RUNTIME_MASTER_KEY).update(payload).digest('hex');
  return {
    challengeId: `${nonce}.${expiresAt}.${sig}`,
    question: `Berapa hasil ${a} + ${b}?`,
    expiresAt,
  };
}

export function verifyAdaptiveChallenge(challengeId: string, userAnswer: string): boolean {
  if (!challengeId || typeof challengeId !== 'string') return false;
  if (usedChallenges.has(challengeId)) return false;
  const parts = challengeId.split('.');
  if (parts.length !== 3) return false;
  const [nonce, expiresStr, sig] = parts;
  const expiresAt = Number(expiresStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
  const cleanAns = String(userAnswer || '').trim();
  if (!/^\d{1,3}$/.test(cleanAns)) return false;
  const expectedSig = crypto
    .createHmac('sha256', RUNTIME_MASTER_KEY)
    .update(`${nonce}.${expiresStr}.${cleanAns}`)
    .digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return false;
  }
  usedChallenges.add(challengeId);
  if (usedChallenges.size > 5000) usedChallenges.clear();
  return true;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
