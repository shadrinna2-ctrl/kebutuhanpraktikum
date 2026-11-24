# Security Summary

Ringkasan implementasi perlindungan database (SQL Injection Protection), keamanan autentikasi & identitas (Authentication & Identity Security), dan verifikasi penerimaan pada aplikasi **PinjamAlat**:

1. **Prepared Statements & Allowlist Query Control (#24.A, #24.B)**
   - Seluruh query ke database SQLite relasional (`node:sqlite` dengan `PRAGMA foreign_keys = ON`, mode WAL, dan `CHECK` constraint) menggunakan **prepared statements dengan parameter binding** (`?`) tanpa string concatenation dari input pengguna.
   - Pengurutan (`sortBy`, `sortDir`), filter kondisi, status pesanan, dan role menggunakan **allowlist statis** (`SORT_COLUMN_ALLOWLIST`, `SORT_DIR_ALLOWLIST`, `ORDER_STATUS_ALLOWLIST`, `ROLE_ALLOWLIST`, `CONDITION_ALLOWLIST`). Input di luar allowlist langsung ditolak dengan HTTP `400` dan dicatat ke tabel `security_events`.
   - Validasi ketat diterapkan pada input teks, angka bulat (`parsePositiveInt`), tanggal (`YYYY-MM-DD`), parameter pagination, JSON malform (`400`), dan URL gambar aman (`http://`, `https://`, atau aset lokal `/src/assets/images/...`).

2. **Database Integrity, Least-Privilege & Error Protection (#24.C, #24.D, #24.E, #24.G)**
   - Checkout peminjaman (`POST /api/orders`) berjalan di dalam transaksi `BEGIN IMMEDIATE` dengan pengurangan stok atomik (`WHERE id = ? AND stock >= ?`) dan penghitungan harga/total sepenuhnya di backend. Nilai harga/status yang dimanipulasi di frontend diabaikan.
   - Pembatalan atau penyelesaian pesanan oleh Admin mengembalikan stok secara atomik di dalam transaksi.
   - Penanganan error global dan endpoint tidak pernah membocorkan pesan error SQL, query, nama tabel/kolom, maupun credential; log server disanitasi dari field sensitif (`password`, `token`, `secret`, `code`).
   - Akses langsung ke direktori `/data` diblokir oleh middleware HTTP (`403`).
   - Middleware deteksi anomali (`sqliTelemetryMiddleware`) mencatat pola percobaan SQLi dan akses tidak sah tanpa menggantikan prepared statements.

3. **Authentication, Password Hashing Argon2id & Mandatory MFA (#25.A–#25.E)**
   - Registrasi wajib validasi data, verifikasi keunikan username/email, pembatasan rate per IP, dan mengunci role pendaftar sebagai `customer`.
   - Password minimal 12 karakter (mendukung passphrase 16+ karakter dan password manager), menolak daftar password umum/bocor, dan di-hash memakai **Argon2id** (`@node-rs/argon2`, `memoryCost: 65536`, `timeCost: 3`) dengan salt unik per akun.
   - Login menyamakan waktu komputasi Argon2id untuk akun tidak ada (`dummyHash`), menerapkan pembatasan rate bertingkat berbasis `(IP)` dan `(IP, akun)` untuk mencegah attacker mengunci akun korban, penundaan progresif, tantangan adaptif (CAPTCHA matematika HMAC-signed), serta pesan error umum.
   - Reset password menghasilkan token acak 256-bit (`crypto.randomBytes(32)`), menyimpan hash SHA-256 di database, berlaku 15 menit, sekali pakai atomik, memberikan respons seragam, dan mencabut seluruh sesi aktif setelah berhasil.
   - MFA TOTP RFC 6238 (dengan kunci terenkripsi AES-256-GCM dan 8 recovery code hash sekali pakai) **diwajibkan** untuk seluruh akun `admin` dan `superadmin` sebelum dapat mengakses endpoint/panel pengelola.

4. **Session Protection, RBAC, IDOR & Re-Authentication (#25.F–#25.L)**
   - Session ID acak 256-bit diregenerasi saat login, saat enrollment MFA, dan saat verifikasi MFA; disimpan dalam cookie `HttpOnly; Secure; SameSite=None; Partitioned` dengan batas idle timeout, masa berlaku maksimum, pencabutan sesi saat logout/deaktivasi/ubah role, dan deteksi perubahan User-Agent.
   - Perlindungan CSRF diterapkan melalui validasi `Origin` dan custom header `X-Requested-With: PinjamAlat`.
   - RBAC (`customer`, `admin`, `superadmin`) serta pemeriksaan kepemilikan data (anti-IDOR pada `/api/orders/:id` dan `/api/account/sessions/:sessionId`) diverifikasi di server pada setiap request.
   - Tindakan sensitif (ubah password, ubah profil/kontak, buat akun admin, ubah role/status user, hapus produk, dan ubah konfigurasi keamanan/kontak WA & IG) mewajibkan **autentikasi ulang eksplisit** (password saat ini + TOTP jika MFA aktif).

---

## PoC Verification

Pengujian keamanan otomatis dijalankan terhadap instance server penuh (`tests/security.test.mjs`) menggunakan database terisolasi (`npx tsx tests/security.test.mjs`) dengan seluruh 10 skenario utama (mencakup 20 kriteria penerimaan #26 dan kategori SQLi #24.F) lulus tanpa error:

- **Test 01**: Bootstrap Superadmin awal berhasil satu kali, memblokir klaim kedua (`403`), dan menetapkan cookie `HttpOnly; Secure; SameSite=None; Partitioned`.
- **Test 02**: Superadmin tanpa MFA diblokir (`403 MFA_SETUP_REQUIRED`), berhasil mengaktifkan TOTP RFC 6238 + 8 recovery codes, meregenerasi session ID, dan membuka akses panel.
- **Test 03**: Registrasi menolak password lemah (`short`) & bocor (`pinjamalat2026!`), memaksa `role = customer` meski payload mengirim `role: "superadmin"`, dan menyimpan hash `$argon2id$`.
- **Test 04**: Payload SQL Injection pada login (`' OR '1'='1`, `' OR 1=1 --`, `root_campus'--`, `UNION SELECT`) seluruhnya gagal (`401`), tidak memicu kebocoran pesan SQL/skema, dan tidak menghasilkan sesi.
- **Test 05**: Parameter `search` berisi payload `UNION SELECT`, `sortBy` berisi `price; DROP TABLE users;--`, `sortDir` injeksi, `page` tidak valid, JSON rusak, dan akses `/data/pinjamalat.db` ditolak/dinetralkan aman (`400`/`403`/array kosong).
- **Test 06**: Brute-force memicu tantangan adaptif (`428`) dan rate limit (`429`), sementara pengguna sah dari IP lain tidak terkunci permanen dan dapat masuk setelah menyelesaikan tantangan dengan regenerasi session ID.
- **Test 07**: Checkout mengabaikan manipulasi `price: 1`/`totalAmount: 1`/`status: "completed"` dari klien, menghitung total di server (`Rp300.000`), mencegah double-booking stok `1` secara paralel (`[201, 409]`), serta memblokir akses IDOR antar pelanggan (`403`) dan akses pelanggan ke `/api/admin/*` (`403`).
- **Test 08**: Pembuatan admin baru gagal tanpa autentikasi ulang (`403 REAUTH_REQUIRED`), berhasil dengan password + TOTP valid, mewajibkan MFA pada login Admin, memblokir Admin dari `/api/superadmin/*` (`403`), dan menangani pencarian second-order SQLi dengan aman.
- **Test 09**: Forgot password mengembalikan pesan identik untuk email terdaftar vs tidak terdaftar; token reset sekali pakai SHA-256 berhasil mengubah password, menolak pemakaian ulang (`400`), dan langsung mencabut sesi lama pelanggan (`401`).
- **Test 10**: Audit log mencatat `SQLI_PROBE_DETECTED`, `INVALID_SORT_PARAM`, `IDOR_ORDER_ATTEMPT`, `BRUTE_FORCE_SUSPECTED`, dan jejak tindakan administratif penting.
- **Verifikasi Build & Runtime**: `vite build` sukses, `tsc --noEmit` lulus dengan 0 error, serta server live di port `3000` mengembalikan HTML (`200`), API katalog terurut (`200`), dan penolakan payload SQLi login (`401`).
