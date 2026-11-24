import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Isolate test database and ephemeral runtime secret before importing server modules
const TEST_DB_REL = `data/test-security-${Date.now()}.db`;
const TEST_DB_ABS = path.resolve(process.cwd(), TEST_DB_REL);
process.env.PINJAMALAT_DB_PATH = TEST_DB_REL;
process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
process.env.NODE_ENV = 'production';

const { createServerApp } = await import('../server.ts');
const { getDb } = await import('../server/db.ts');
const { generateTotpCode } = await import('../server/security.ts');

function cleanupDbFiles() {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = TEST_DB_ABS + suffix;
    if (fs.existsSync(file)) {
      try { fs.unlinkSync(file); } catch {}
    }
  }
}

class HttpSession {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
    this.userAgent = 'PinjamAlat-TestRunner/1.0';
  }

  async request(urlPath, options = {}) {
    const headers = {
      'Origin': this.baseUrl,
      'X-Requested-With': 'PinjamAlat',
      'User-Agent': this.userAgent,
      ...(options.headers || {}),
    };
    if (this.cookie) {
      headers['Cookie'] = this.cookie;
    }
    if (options.body && typeof options.body !== 'string') {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    } else if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${this.baseUrl}${urlPath}`, {
      ...options,
      headers,
    });

    const setCookies = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);

    for (const sc of setCookies) {
      const pair = sc.split(';')[0];
      if (pair.startsWith('pa_session=')) {
        const val = pair.slice('pa_session='.length);
        this.cookie = val ? pair : '';
      }
    }

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: res.status, headers: res.headers, setCookies, json, text };
  }

  getSessionId() {
    if (!this.cookie) return '';
    return this.cookie.replace(/^pa_session=/, '');
  }
}

function assertNoSqlLeak(responseText) {
  const forbidden = ['SQLITE_ERROR', 'syntax error', 'near "', 'FROM users', 'password_hash', 'totp_secret_enc'];
  for (const term of forbidden) {
    assert.equal(
      responseText.includes(term),
      false,
      `SQL/schema leak detected in response body (${term}): ${responseText}`
    );
  }
}

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`PASS: ${name}`);
  } catch (err) {
    results.push({ name, passed: false, error: err instanceof Error ? err.message : String(err) });
    console.error(`FAIL: ${name}\n  ->`, err);
    throw err;
  }
}

const app = await createServerApp();
const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const addr = server.address();
const baseUrl = `http://127.0.0.1:${addr.port}`;

try {
  // Generate unique test passwords dynamically per run (no literal static admin password)
  const superPass = `LabSec!Super#${crypto.randomBytes(6).toString('hex')}`;
  const adminPass = `LabSec!Admin#${crypto.randomBytes(6).toString('hex')}`;
  const custAPass = `Campus!UserA#${crypto.randomBytes(6).toString('hex')}`;
  const custANewPass = `Campus!UserA2#${crypto.randomBytes(6).toString('hex')}`;
  const custBPass = `Campus!UserB#${crypto.randomBytes(6).toString('hex')}`;

  const superSession = new HttpSession(baseUrl);
  const adminSession = new HttpSession(baseUrl);
  const custASession = new HttpSession(baseUrl);
  const custBSession = new HttpSession(baseUrl);

  let superTotpSecret = '';
  let adminTotpSecret = '';
  let custAOrderId = 0;

  await test('01. Bootstrap Superadmin works once, sets HttpOnly/Secure/SameSite cookie, and blocks duplicate claim', async () => {
    const boot1 = await superSession.request('/api/auth/bootstrap-superadmin', {
      method: 'POST',
      body: {
        username: 'root_campus',
        email: 'superadmin@usk.ac.id',
        fullName: 'Superadmin Lab',
        phone: '081200000001',
        password: superPass,
      },
    });
    assert.equal(boot1.status, 201);
    assert.equal(boot1.json.user.role, 'superadmin');
    const sc = boot1.setCookies.join('; ');
    assert.ok(sc.includes('HttpOnly'), 'Missing HttpOnly flag on session cookie');
    assert.ok(sc.includes('Secure'), 'Missing Secure flag on session cookie');
    assert.ok(sc.includes('SameSite=None'), 'Missing SameSite=None flag');
    assert.ok(sc.includes('Partitioned'), 'Missing Partitioned flag');

    // Second bootstrap must fail
    const boot2 = await new HttpSession(baseUrl).request('/api/auth/bootstrap-superadmin', {
      method: 'POST',
      body: {
        username: 'attacker_root',
        email: 'att@example.com',
        fullName: 'Attacker',
        phone: '081299999999',
        password: superPass,
      },
    });
    assert.equal(boot2.status, 403);
  });

  await test('02. Privileged Superadmin without MFA is blocked from admin/superadmin APIs until TOTP activated', async () => {
    const blocked = await superSession.request('/api/superadmin/users');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.code, 'MFA_SETUP_REQUIRED');

    // Setup TOTP MFA
    const setupRes = await superSession.request('/api/account/mfa/setup', {
      method: 'POST',
      body: { label: 'Authenticator Uji' },
    });
    assert.equal(setupRes.status, 200);
    superTotpSecret = setupRes.json.secretManual;
    assert.ok(superTotpSecret && setupRes.json.qrDataUrl.startsWith('data:image/png;base64,'));

    const sessionBeforeMfa = superSession.getSessionId();
    const totpCode = generateTotpCode(superTotpSecret);
    const confirmRes = await superSession.request('/api/account/mfa/confirm', {
      method: 'POST',
      body: { deviceId: setupRes.json.deviceId, code: totpCode },
    });
    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.json.recoveryCodes.length, 8);
    assert.notEqual(superSession.getSessionId(), sessionBeforeMfa, 'Session ID must regenerate after MFA elevation');

    const allowed = await superSession.request('/api/superadmin/users');
    assert.equal(allowed.status, 200);
  });

  await test('03. Registration rejects weak/breached passwords, blocks privilege escalation, and hashes with Argon2id', async () => {
    const guest = new HttpSession(baseUrl);

    const weak = await guest.request('/api/auth/register', {
      method: 'POST',
      body: {
        username: 'lemah1',
        email: 'lemah1@usk.ac.id',
        fullName: 'Pengguna Lemah',
        phone: '081211112222',
        password: 'short',
      },
    });
    assert.equal(weak.status, 400);

    const breached = await guest.request('/api/auth/register', {
      method: 'POST',
      body: {
        username: 'breached1',
        email: 'breached1@usk.ac.id',
        fullName: 'Pengguna Breached',
        phone: '081211112223',
        password: 'pinjamalat2026!',
      },
    });
    assert.equal(breached.status, 400);

    // Attempt role escalation via registration payload
    const regA = await guest.request('/api/auth/register', {
      method: 'POST',
      body: {
        username: 'mahasiswa_a',
        email: 'mhs_a@usk.ac.id',
        fullName: 'Mahasiswa Satu',
        phone: '081234567890',
        password: custAPass,
        role: 'superadmin',
      },
    });
    assert.equal(regA.status, 201);

    const regB = await guest.request('/api/auth/register', {
      method: 'POST',
      body: {
        username: 'mahasiswa_b',
        email: 'mhs_b@usk.ac.id',
        fullName: 'Mahasiswa Dua',
        phone: '081234567891',
        password: custBPass,
      },
    });
    assert.equal(regB.status, 201);

    const db = getDb();
    const rowA = db.prepare('SELECT role, password_hash FROM users WHERE username = ?').get('mahasiswa_a');
    assert.equal(rowA.role, 'customer', 'Registration must force role to customer');
    assert.ok(String(rowA.password_hash).startsWith('$argon2id$'), 'Password must be hashed with Argon2id');
  });

  await test('04. SQL Injection vectors cannot bypass login or leak SQL error details', async () => {
    const attacker = new HttpSession(baseUrl);
    const sqliPayloads = [
      { identifier: "' OR '1'='1", password: "' OR '1'='1" },
      { identifier: "' OR 1=1 --", password: "anything1234" },
      { identifier: "root_campus'--", password: "wrongpassword" },
      { identifier: "1' UNION SELECT 1,username,password_hash FROM users--", password: "x" },
    ];

    for (const payload of sqliPayloads) {
      const res = await attacker.request('/api/auth/login', {
        method: 'POST',
        headers: { 'X-Forwarded-For': `10.10.0.${sqliPayloads.indexOf(payload) + 1}` },
        body: payload,
      });
      assert.equal(res.status, 401);
      assertNoSqlLeak(res.text);
      assert.equal(attacker.getSessionId(), '', 'Attacker must not receive session cookie');
    }
  });

  await test('05. SQL Injection rejected/contained on search, category, pagination, allowlisted sorting, and malformed JSON', async () => {
    const sqliSearch = await custASession.request(
      `/api/products?search=${encodeURIComponent("' UNION SELECT id,password_hash,email FROM users --")}`
    );
    assert.equal(sqliSearch.status, 200);
    assert.equal(sqliSearch.json.items.length, 0);
    assertNoSqlLeak(sqliSearch.text);

    const sqliSort = await custASession.request(
      `/api/products?sortBy=${encodeURIComponent('price; DROP TABLE users;--')}&sortDir=asc`
    );
    assert.equal(sqliSort.status, 400);
    assertNoSqlLeak(sqliSort.text);

    const badSortDir = await custASession.request('/api/products?sortBy=price&sortDir=DESC;SELECT%201');
    assert.equal(badSortDir.status, 400);

    const badPage = await custASession.request('/api/products?page=1%20OR%201=1');
    assert.equal(badPage.status, 400);

    const badJson = await custASession.request('/api/auth/login', {
      method: 'POST',
      body: '{"identifier": "broken"',
    });
    assert.equal(badJson.status, 400);
    assertNoSqlLeak(badJson.text);

    // Direct access to /data must be blocked
    const dataAccess = await custASession.request('/data/pinjamalat.db');
    assert.equal(dataAccess.status, 403);
  });

  await test('06. Login rate limiting, adaptive challenge, session regeneration, and normal auth succeed', async () => {
    const brute = new HttpSession(baseUrl);
    let sawChallenge = false;
    let sawRateLimit = false;

    for (let i = 0; i < 7; i++) {
      const res = await brute.request('/api/auth/login', {
        method: 'POST',
        headers: { 'X-Forwarded-For': '198.51.100.42' },
        body: { identifier: 'mahasiswa_a', password: `WrongPassword_${i}` },
      });
      if (res.status === 428 || res.json?.requiresChallenge) sawChallenge = true;
      if (res.status === 429) {
        sawRateLimit = true;
        break;
      }
    }
    assert.ok(sawChallenge, 'Adaptive challenge must trigger after repeated failures');
    assert.ok(sawRateLimit, 'Rate limiting (429) must trigger on brute force attempts');

    // Legitimate Customer A from clean IP is NOT permanently locked out, solves adaptive challenge, and logs in
    const chRes = await custASession.request('/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '203.0.113.10' },
      body: { identifier: 'mahasiswa_a', password: custAPass },
    });
    assert.equal(chRes.status, 428, 'Clean IP should receive adaptive challenge rather than permanent lockout');
    const match = String(chRes.json.challenge.question).match(/(\d+)\s*\+\s*(\d+)/);
    assert.ok(match);
    const answer = String(Number(match[1]) + Number(match[2]));

    const loginA = await custASession.request('/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '203.0.113.10' },
      body: {
        identifier: 'mahasiswa_a',
        password: custAPass,
        challengeId: chRes.json.challenge.challengeId,
        challengeAnswer: answer,
      },
    });
    assert.equal(loginA.status, 200);
    const sid1 = custASession.getSessionId();
    assert.ok(sid1.length >= 64);

    // Re-login regenerates into a brand-new session ID
    const loginA2 = await custASession.request('/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '203.0.113.10' },
      body: { identifier: 'mahasiswa_a', password: custAPass },
    });
    assert.equal(loginA2.status, 200);
    const sid2 = custASession.getSessionId();
    assert.notEqual(sid2, sid1, 'Session ID must regenerate on login');

    // Login Customer B
    const loginB = await custBSession.request('/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '203.0.113.11' },
      body: { identifier: 'mahasiswa_b', password: custBPass },
    });
    assert.equal(loginB.status, 200);
  });

  await test('07. Checkout validates stock atomically, ignores frontend price tampering, and enforces IDOR protection', async () => {
    // Attempt price tampering & fake status in checkout payload
    const orderRes = await custASession.request('/api/orders', {
      method: 'POST',
      body: {
        customerName: "Budi ' OR '1'='1", // Second-order SQLi string stored safely
        customerPhone: '081234567890',
        borrowDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        borrowDays: 2,
        note: 'Praktikum jaringan',
        items: [{ productId: 1, quantity: 2 }], // Kamera DSLR: Rp75.000/hari -> 2 * 2 * 75.000 = 300.000
        price: 1,
        totalAmount: 1,
        status: 'completed',
      },
    });
    assert.equal(orderRes.status, 201);
    assert.equal(orderRes.json.order.total_amount, 300000, 'Backend must ignore tampered price/total');
    assert.equal(orderRes.json.order.status, 'pending', 'Backend must enforce initial pending status');
    custAOrderId = orderRes.json.order.id;

    // Concurrent over-stock check on Product #22 (SMT Pick and Place Machine, stock = 1)
    const [c1, c2] = await Promise.all([
      custASession.request('/api/orders', {
        method: 'POST',
        body: {
          customerName: 'Mahasiswa A',
          customerPhone: '081234567890',
          borrowDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
          borrowDays: 1,
          items: [{ productId: 22, quantity: 1 }],
        },
      }),
      custBSession.request('/api/orders', {
        method: 'POST',
        body: {
          customerName: 'Mahasiswa B',
          customerPhone: '081234567891',
          borrowDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
          borrowDays: 1,
          items: [{ productId: 22, quantity: 1 }],
        },
      }),
    ]);
    const statuses = [c1.status, c2.status].sort();
    assert.deepEqual(statuses, [201, 409], 'Atomic stock lock must prevent double booking');

    // IDOR check: Customer B must NOT access Customer A's order
    const idorRead = await custBSession.request(`/api/orders/${custAOrderId}`);
    assert.equal(idorRead.status, 403);

    // RBAC check: Customer A cannot access Admin or Superadmin endpoints
    assert.equal((await custASession.request('/api/admin/overview')).status, 403);
    assert.equal((await custASession.request('/api/superadmin/users')).status, 403);
  });

  await test('08. Re-authentication required for sensitive Superadmin/Admin actions & Admin MFA flow verified', async () => {
    // Creating Admin without re-auth fails
    const noReauth = await superSession.request('/api/superadmin/admins', {
      method: 'POST',
      body: {
        username: 'admin_lab',
        email: 'admin_lab@usk.ac.id',
        fullName: 'Admin Lab',
        phone: '081200000002',
        password: adminPass,
        role: 'admin',
      },
    });
    assert.equal(noReauth.status, 403);
    assert.equal(noReauth.json.code, 'REAUTH_REQUIRED');

    // With valid password + TOTP re-auth succeeds
    const withReauth = await superSession.request('/api/superadmin/admins', {
      method: 'POST',
      body: {
        username: 'admin_lab',
        email: 'admin_lab@usk.ac.id',
        fullName: 'Admin Lab',
        phone: '081200000002',
        password: adminPass,
        role: 'admin',
        currentPassword: superPass,
        totpCode: generateTotpCode(superTotpSecret),
      },
    });
    assert.equal(withReauth.status, 201);

    // Admin logs in and sets up MFA
    const admLogin1 = await adminSession.request('/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '203.0.113.20' },
      body: { identifier: 'admin_lab', password: adminPass },
    });
    assert.equal(admLogin1.status, 200);
    assert.equal(admLogin1.json.mfaSetupRequired, true);

    const setupAdm = await adminSession.request('/api/account/mfa/setup', {
      method: 'POST',
      body: { label: 'HP Admin' },
    });
    adminTotpSecret = setupAdm.json.secretManual;
    await adminSession.request('/api/account/mfa/confirm', {
      method: 'POST',
      body: { deviceId: setupAdm.json.deviceId, code: generateTotpCode(adminTotpSecret) },
    });

    // Admin re-logs in -> MFA step mandatory -> Admin endpoints allowed -> Superadmin blocked
    const admLogin2 = await adminSession.request('/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '203.0.113.20' },
      body: { identifier: 'admin_lab', password: adminPass },
    });
    assert.equal(admLogin2.json.mfaRequired, true);
    assert.equal((await adminSession.request('/api/admin/overview')).status, 403);

    const mfaVerify = await adminSession.request('/api/auth/mfa/verify', {
      method: 'POST',
      body: { code: generateTotpCode(adminTotpSecret), isRecoveryCode: false },
    });
    assert.equal(mfaVerify.status, 200);
    assert.equal((await adminSession.request('/api/admin/overview')).status, 200);
    assert.equal((await adminSession.request('/api/superadmin/users')).status, 403);

    // Second-order SQLi search on Admin orders works safely
    const adminSearchOrders = await adminSession.request(
      `/api/admin/orders?search=${encodeURIComponent("' OR '1'='1")}`
    );
    assert.equal(adminSearchOrders.status, 200);
    assert.ok(adminSearchOrders.json.orders.some((o) => o.id === custAOrderId));
  });

  await test('09. Password Reset uses uniform response, SHA-256 single-use token, and revokes all active sessions', async () => {
    const reqKnown = await new HttpSession(baseUrl).request('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: 'mhs_a@usk.ac.id' },
    });
    const reqUnknown = await new HttpSession(baseUrl).request('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: 'tidakada@usk.ac.id' },
    });
    assert.equal(reqKnown.status, 200);
    assert.equal(reqUnknown.status, 200);
    assert.equal(reqKnown.json.message, reqUnknown.json.message, 'Forgot password response must be identical');

    // Insert a deterministic raw token hash in test DB to verify single-use + session revocation
    const rawResetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawResetToken).digest('hex');
    const db = getDb();
    const userA = db.prepare('SELECT id FROM users WHERE username = ?').get('mahasiswa_a');
    db.prepare(`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
      VALUES (?, ?, ?, '127.0.0.1')
    `).run(userA.id, tokenHash, new Date(Date.now() + 600_000).toISOString());

    const resetOk = await new HttpSession(baseUrl).request('/api/auth/reset-password', {
      method: 'POST',
      body: { token: rawResetToken, newPassword: custANewPass },
    });
    assert.equal(resetOk.status, 200);

    // Token reuse must fail
    const resetReuse = await new HttpSession(baseUrl).request('/api/auth/reset-password', {
      method: 'POST',
      body: { token: rawResetToken, newPassword: `${custANewPass}_2` },
    });
    assert.equal(resetReuse.status, 400);

    // Old Customer A session must be revoked
    const meOld = await custASession.request('/api/orders');
    assert.equal(meOld.status, 401, 'Old session must be revoked after password reset');
  });

  await test('10. Superadmin Audit Logs recorded SQLi probes, IDOR attempts, and privileged actions', async () => {
    const auditRes = await superSession.request('/api/superadmin/audit-logs');
    assert.equal(auditRes.status, 200);
    const eventTypes = new Set(auditRes.json.securityEvents.map((e) => e.event_type));
    assert.ok(eventTypes.has('SQLI_PROBE_DETECTED'), 'SQLi probe must be logged in security_events');
    assert.ok(eventTypes.has('INVALID_SORT_PARAM'), 'Invalid sort parameter must be logged');
    assert.ok(eventTypes.has('IDOR_ORDER_ATTEMPT'), 'IDOR attempt must be logged');
    assert.ok(eventTypes.has('BRUTE_FORCE_SUSPECTED'), 'Brute force attempt must be logged');
    assert.ok(auditRes.json.auditLogs.length >= 5);
  });

  console.log(`\nALL ${results.length} SECURITY ACCEPTANCE TESTS PASSED.`);
} finally {
  server.close();
  try { getDb().close(); } catch {}
  cleanupDbFiles();
}
