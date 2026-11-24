import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './security.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = process.env.PINJAMALAT_DB_PATH
  ? path.resolve(process.cwd(), process.env.PINJAMALAT_DB_PATH)
  : path.join(DATA_DIR, 'pinjamalat.db');

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!_db) {
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
    }
    _db = new DatabaseSync(DB_PATH);
    _db.exec('PRAGMA foreign_keys = ON;');
    _db.exec('PRAGMA journal_mode = WAL;');
    _db.exec('PRAGMA busy_timeout = 5000;');
  }
  return _db;
}

const LEGACY_GENERIC_IMAGES = [
  '/src/assets/images/cat_camera_media_1795506639513.jpg',
  '/src/assets/images/cat_electronics_lab_1795506640100.jpg',
  '/src/assets/images/cat_network_compute_1795506640337.jpg',
];

const SEED_PRODUCTS = [
  { id: 1, name: 'Kamera DSLR', category: 'Kamera', price: 75000, purchaseRange: 'Rp7–15 juta', stock: 5, condition: 'Sangat Baik', image: '/src/assets/images/dslr_camera_product_1795507720310.jpg', desc: 'Kamera untuk dokumentasi kegiatan, tugas fotografi, dan acara kampus.', model: 'camera', rating: 4.9 },
  { id: 2, name: 'Tripod Kamera', category: 'Aksesori', price: 15000, purchaseRange: 'Rp400–900 ribu', stock: 8, condition: 'Baik', image: '/src/assets/images/camera_tripod_product_1795507720304.jpg', desc: 'Tripod untuk membantu pengambilan foto dan video agar lebih stabil.', model: 'tripod', rating: 4.8 },
  { id: 3, name: 'Proyektor', category: 'Elektronik', price: 50000, purchaseRange: 'Rp5–12 juta', stock: 4, condition: 'Baik', image: '/src/assets/images/office_projector_product_1795507719512.jpg', desc: 'Proyektor untuk presentasi kelas, rapat, dan kegiatan organisasi.', model: 'projector', rating: 4.7 },
  { id: 4, name: 'Mikrofon', category: 'Audio', price: 25000, purchaseRange: 'Rp1–3 juta', stock: 6, condition: 'Sangat Baik', image: '/src/assets/images/studio_microphone_product_1795507721096.jpg', desc: 'Mikrofon untuk acara, wawancara, dan kebutuhan rekaman suara.', model: 'mic', rating: 4.9 },
  { id: 5, name: 'Laptop', category: 'Elektronik', price: 100000, purchaseRange: 'Rp10–25 juta', stock: 4, condition: 'Sangat Baik', image: '/src/assets/images/pro_laptop_product_1795507720971.jpg', desc: 'Laptop untuk mengerjakan tugas, presentasi, dan kegiatan produktif.', model: 'laptop', rating: 4.9 },
  { id: 6, name: 'Ring Light', category: 'Aksesori', price: 20000, purchaseRange: 'Rp300–800 ribu', stock: 7, condition: 'Baik', image: '/src/assets/images/ring_light_product_1795507721842.jpg', desc: 'Pencahayaan tambahan untuk foto, video, dan pertemuan daring.', model: 'ring', rating: 4.6 },
  { id: 7, name: 'Speaker Portable', category: 'Audio', price: 30000, purchaseRange: 'Rp1–4 juta', stock: 5, condition: 'Baik', image: '/src/assets/images/portable_speaker_product_1795507721988.jpg', desc: 'Speaker praktis untuk kegiatan kelompok dan acara kecil.', model: 'speaker', rating: 4.7 },
  { id: 8, name: 'Webcam', category: 'Kamera', price: 20000, purchaseRange: 'Rp700 ribu–2 juta', stock: 6, condition: 'Baik', image: '/src/assets/images/usb_webcam_product_1795507722270.jpg', desc: 'Webcam untuk kelas daring, rapat, dan perekaman video.', model: 'webcam', rating: 4.7 },
  { id: 9, name: 'Workstation PC', category: 'Laboratorium Komputer', price: 150000, purchaseRange: 'Rp15–50 juta', stock: 3, condition: 'Sangat Baik', image: '/src/assets/images/workstation_pc_product_1795507723499.jpg', desc: 'Komputer spesifikasi tinggi untuk simulasi, pemrograman, dan desain.', model: 'workstation', rating: 4.9 },
  { id: 10, name: 'Server Enterprise', category: 'Laboratorium Komputer', price: 250000, purchaseRange: 'Rp30–150 juta', stock: 2, condition: 'Sangat Baik', image: '/src/assets/images/enterprise_server_product_1795507723224.jpg', desc: 'Server untuk menyimpan data dan menjalankan layanan jaringan.', model: 'server', rating: 4.9 },
  { id: 11, name: 'NAS Storage', category: 'Laboratorium Komputer', price: 90000, purchaseRange: 'Rp8–40 juta', stock: 3, condition: 'Baik', image: '/src/assets/images/nas_storage_product_1795507723575.jpg', desc: 'Penyimpanan data terpusat yang dapat diakses oleh banyak komputer.', model: 'nas', rating: 4.8 },
  { id: 12, name: 'Enterprise Router', category: 'Laboratorium Jaringan Komputer', price: 85000, purchaseRange: 'Rp5–50 juta', stock: 4, condition: 'Baik', image: '/src/assets/images/enterprise_router_product_1795507779982.jpg', desc: 'Untuk praktikum routing, konfigurasi IP, dan manajemen jaringan.', model: 'router', rating: 4.8 },
  { id: 13, name: 'Managed Switch 48 Port', category: 'Laboratorium Jaringan Komputer', price: 75000, purchaseRange: 'Rp5–40 juta', stock: 4, condition: 'Baik', image: '/src/assets/images/managed_switch_product_1795507779377.jpg', desc: 'Switch terkelola untuk praktikum VLAN, trunking, dan konfigurasi jaringan.', model: 'switch', rating: 4.7 },
  { id: 14, name: 'Hardware Firewall', category: 'Laboratorium Jaringan Komputer', price: 120000, purchaseRange: 'Rp10–80 juta', stock: 2, condition: 'Sangat Baik', image: '/src/assets/images/hardware_firewall_product_1795507780162.jpg', desc: 'Perangkat keamanan jaringan untuk praktikum pengaturan akses dan firewall.', model: 'firewall', rating: 4.9 },
  { id: 15, name: 'Fiber Optic Fusion Splicer', category: 'Laboratorium Jaringan Komputer', price: 180000, purchaseRange: 'Rp15–80 juta', stock: 2, condition: 'Sangat Baik', image: '/src/assets/images/fusion_splicer_product_1795507780196.jpg', desc: 'Alat untuk menyambungkan inti kabel fiber optik dengan teknik fusion splicing.', model: 'splicer', rating: 4.9 },
  { id: 16, name: 'OTDR', category: 'Laboratorium Jaringan Komputer', price: 175000, purchaseRange: 'Rp15–100 juta', stock: 2, condition: 'Baik', image: '/src/assets/images/otdr_tester_product_1795507727436.jpg', desc: 'Optical Time Domain Reflectometer untuk menguji kualitas kabel fiber optik.', model: 'otdr', rating: 4.8 },
  { id: 17, name: 'Digital Oscilloscope', category: 'Laboratorium Elektronika', price: 95000, purchaseRange: 'Rp5–50 juta', stock: 4, condition: 'Sangat Baik', image: '/src/assets/images/digital_oscilloscope_product_1795507780626.jpg', desc: 'Mengamati bentuk gelombang dan sinyal listrik dalam praktikum elektronika.', model: 'oscilloscope', rating: 5.0 },
  { id: 18, name: 'Spectrum Analyzer', category: 'Laboratorium Elektronika', price: 220000, purchaseRange: 'Rp20–150 juta', stock: 2, condition: 'Sangat Baik', image: '/src/assets/images/spectrum_analyzer_product_1795507780695.jpg', desc: 'Menganalisis frekuensi dan spektrum sinyal RF maupun audio.', model: 'spectrum', rating: 4.9 },
  { id: 19, name: 'Function Generator', category: 'Laboratorium Elektronika', price: 55000, purchaseRange: 'Rp3–20 juta', stock: 5, condition: 'Baik', image: '/src/assets/images/function_generator_product_1795507780584.jpg', desc: 'Menghasilkan berbagai bentuk sinyal untuk pengujian rangkaian.', model: 'functiongen', rating: 4.8 },
  { id: 20, name: 'Programmable DC Power Supply', category: 'Laboratorium Elektronika', price: 45000, purchaseRange: 'Rp2–20 juta', stock: 6, condition: 'Baik', image: '/src/assets/images/dc_power_supply_1795507780724.jpg', desc: 'Menyediakan tegangan dan arus DC yang dapat diatur secara presisi.', model: 'powersupply', rating: 4.8 },
  { id: 21, name: 'Vector Network Analyzer (VNA)', category: 'Laboratorium Elektronika', price: 190000, purchaseRange: 'Rp15–100 juta', stock: 2, condition: 'Sangat Baik', image: '/src/assets/images/vector_network_analyzer_1795507866585.jpg', desc: 'Mengukur karakteristik jaringan dan komponen frekuensi radio.', model: 'vna', rating: 4.9 },
  { id: 22, name: 'SMT Pick and Place Machine', category: 'Laboratorium Elektronika', price: 300000, purchaseRange: 'Rp30–200 juta', stock: 1, condition: 'Sangat Baik', image: '/src/assets/images/smt_pick_place_1795507867468.jpg', desc: 'Mesin untuk memasang komponen elektronik pada PCB secara otomatis.', model: 'pickplace', rating: 4.8 },
  { id: 23, name: 'PCB CNC Machine', category: 'Alat Laboratorium Lanjutan', price: 160000, purchaseRange: 'Rp20–100 juta', stock: 2, condition: 'Baik', image: '/src/assets/images/pcb_cnc_machine_1795507871134.jpg', desc: 'Mesin CNC untuk proses pembuatan dan pemotongan jalur PCB.', model: 'cnc', rating: 4.8 },
  { id: 24, name: 'Rework Station BGA', category: 'Alat Laboratorium Lanjutan', price: 85000, purchaseRange: 'Rp10–50 juta', stock: 3, condition: 'Baik', image: '/src/assets/images/bga_rework_station_1795507730144.jpg', desc: 'Stasiun pengerjaan ulang komponen BGA pada papan rangkaian elektronik.', model: 'bga', rating: 4.7 },
  { id: 25, name: 'Logic Analyzer', category: 'Alat Laboratorium Lanjutan', price: 40000, purchaseRange: 'Rp3–30 juta', stock: 5, condition: 'Baik', image: '/src/assets/images/logic_analyzer_product_1795507867301.jpg', desc: 'Menganalisis banyak kanal sinyal digital dan memeriksa komunikasi protokol.', model: 'logicanalyzer', rating: 4.8 },
  { id: 26, name: 'Thermal Camera', category: 'Alat Laboratorium Lanjutan', price: 90000, purchaseRange: 'Rp5–50 juta', stock: 3, condition: 'Sangat Baik', image: '/src/assets/images/thermal_camera_product_1795507867644.jpg', desc: 'Kamera pencitraan panas untuk memeriksa suhu komponen dan titik panas.', model: 'thermal', rating: 4.9 },
  { id: 27, name: '3D Printer Industrial', category: 'Alat Laboratorium Lanjutan', price: 140000, purchaseRange: 'Rp20–100 juta', stock: 2, condition: 'Sangat Baik', image: '/src/assets/images/industrial_3d_printer_1795507868597.jpg', desc: 'Printer 3D untuk membuat prototipe dan komponen berdasarkan model digital.', model: 'printer', rating: 4.9 },
  { id: 28, name: 'Electronic Load Tester', category: 'Alat Laboratorium Lanjutan', price: 50000, purchaseRange: 'Rp3–25 juta', stock: 4, condition: 'Baik', image: '/src/assets/images/electronic_load_tester_1795507869094.jpg', desc: 'Menguji kemampuan sumber daya dengan beban elektronik yang dapat diatur.', model: 'electronicload', rating: 4.7 },
];

export async function initializeDatabase(): Promise<void> {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin', 'superadmin')),
      password_hash TEXT NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
      email_verify_token_hash TEXT,
      email_verify_expires_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      mfa_enabled INTEGER NOT NULL DEFAULT 0 CHECK (mfa_enabled IN (0, 1)),
      totp_secret_enc TEXT,
      last_login_at TEXT,
      last_login_ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mfa_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      secret_enc TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recovery_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ip_address TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      approx_location TEXT NOT NULL,
      mfa_verified INTEGER NOT NULL DEFAULT 0 CHECK (mfa_verified IN (0, 1)),
      last_reauth_at TEXT,
      last_activity_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      revoke_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      requested_ip TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price INTEGER NOT NULL CHECK (price >= 0),
      purchase_range TEXT NOT NULL DEFAULT '',
      stock INTEGER NOT NULL DEFAULT 1 CHECK (stock >= 0),
      condition TEXT NOT NULL DEFAULT 'Baik' CHECK (condition IN ('Baik', 'Sangat Baik', 'Perlu Perawatan')),
      image TEXT NOT NULL,
      desc TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT 'camera',
      rating REAL NOT NULL DEFAULT 4.8 CHECK (rating >= 0 AND rating <= 5),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_code TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      borrow_date TEXT NOT NULL,
      borrow_days INTEGER NOT NULL CHECK (borrow_days >= 1 AND borrow_days <= 365),
      total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
      price_needs_confirmation INTEGER NOT NULL DEFAULT 0 CHECK (price_needs_confirmation IN (0, 1)),
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'ongoing', 'completed', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity >= 1),
      unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
      subtotal INTEGER NOT NULL CHECK (subtotal >= 0)
    );

    CREATE TABLE IF NOT EXISTS login_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      identifier_masked TEXT NOT NULL,
      success INTEGER NOT NULL CHECK (success IN (0, 1)),
      failure_reason TEXT,
      ip_address TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      approx_location TEXT NOT NULL,
      suspicious INTEGER NOT NULL DEFAULT 0 CHECK (suspicious IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS security_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ip_address TEXT NOT NULL,
      path TEXT NOT NULL,
      method TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_preview TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      details_json TEXT NOT NULL DEFAULT '{}',
      ip_address TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS security_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_login_history_user_id ON login_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON security_events(created_at);
  `);

  // Seed products if empty
  const productCountRow = db.prepare('SELECT COUNT(*) AS cnt FROM products').get() as { cnt: number };
  if (productCountRow.cnt === 0) {
    const insertProduct = db.prepare(`
      INSERT INTO products (id, name, category, price, purchase_range, stock, condition, image, desc, model, rating)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.exec('BEGIN IMMEDIATE;');
    try {
      for (const p of SEED_PRODUCTS) {
        insertProduct.run(
          p.id,
          p.name,
          p.category,
          p.price,
          p.purchaseRange,
          p.stock,
          p.condition,
          p.image,
          p.desc,
          p.model,
          p.rating
        );
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  } else {
    // Migrate previously seeded rows that still point to legacy generic category photos
    const updateImg = db.prepare(`
      UPDATE products
      SET image = ?, updated_at = datetime('now')
      WHERE id = ? AND image IN (?, ?, ?)
    `);
    db.exec('BEGIN IMMEDIATE;');
    try {
      for (const p of SEED_PRODUCTS) {
        updateImg.run(p.image, p.id, ...LEGACY_GENERIC_IMAGES);
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  // Seed default site settings & security config
  const upsertSetting = db.prepare(`
    INSERT INTO site_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `);
  upsertSetting.run('admin_wa', '6282164462480');
  upsertSetting.run('admin_ig', 'https://www.instagram.com/shadrinna_/');

  const upsertConfig = db.prepare(`
    INSERT INTO security_config (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `);
  upsertConfig.run('idle_timeout_minutes', '30');
  upsertConfig.run('max_session_hours', '24');
  upsertConfig.run('min_password_length', '12');
  upsertConfig.run('max_login_attempts', '5');
  upsertConfig.run('require_customer_mfa_high_value', 'true');

  // Optional env-configured bootstrap for Superadmin & Admin (never hardcoded in source)
  const superadminPasscode = process.env.SUPERADMIN_BOOTSTRAP_PASSCODE;
  if (superadminPasscode && superadminPasscode.length >= 12) {
    const existingSuper = db.prepare("SELECT id FROM users WHERE role = 'superadmin' LIMIT 1").get();
    if (!existingSuper) {
      const pwHash = await hashPassword(superadminPasscode);
      db.prepare(`
        INSERT INTO users (username, email, full_name, phone, role, password_hash, email_verified, is_active, mfa_enabled)
        VALUES (?, ?, ?, ?, 'superadmin', ?, 1, 1, 0)
      `).run('superadmin', 'superadmin@pinjamalat.local', 'Superadmin PinjamAlat', '6282164462480', pwHash);
    }
  }

  const adminPasscode = process.env.ADMIN_BOOTSTRAP_PASSCODE;
  if (adminPasscode && adminPasscode.length >= 12) {
    const existingAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    if (!existingAdmin) {
      const pwHash = await hashPassword(adminPasscode);
      db.prepare(`
        INSERT INTO users (username, email, full_name, phone, role, password_hash, email_verified, is_active, mfa_enabled)
        VALUES (?, ?, ?, ?, 'admin', ?, 1, 1, 0)
      `).run('admin', 'admin@pinjamalat.local', 'Admin PinjamAlat', '6282164462480', pwHash);
    }
  }
}

export function getSecurityConfigValue(key: string, fallback: string): string {
  const db = getDb();
  const row = db.prepare('SELECT value FROM security_config WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : fallback;
}

export function logAudit(params: {
  actorUserId: number | null;
  actorRole: string;
  action: string;
  targetType: string;
  targetId?: string | number | null;
  details?: Record<string, unknown>;
  ipAddress: string;
}): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO audit_logs (actor_user_id, actor_role, action, target_type, target_id, details_json, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.actorUserId,
      params.actorRole,
      params.action,
      params.targetType,
      params.targetId != null ? String(params.targetId) : null,
      JSON.stringify(params.details ?? {}),
      params.ipAddress
    );
  } catch (err) {
    console.error('[AuditLog] Failed to record audit entry:', err instanceof Error ? err.message : 'unknown');
  }
}

export function logSecurityEvent(params: {
  eventType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  userId?: number | null;
  ipAddress: string;
  path: string;
  method: string;
  summary: string;
  payloadPreview?: string | null;
}): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO security_events (event_type, severity, user_id, ip_address, path, method, summary, payload_preview)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.eventType,
      params.severity,
      params.userId ?? null,
      params.ipAddress,
      params.path.slice(0, 180),
      params.method.slice(0, 16),
      params.summary.slice(0, 240),
      params.payloadPreview ? params.payloadPreview.slice(0, 180) : null
    );
  } catch (err) {
    console.error('[SecurityEvent] Failed to record event:', err instanceof Error ? err.message : 'unknown');
  }
}
