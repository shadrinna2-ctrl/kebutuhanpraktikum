# PinjamAlat

Marketplace peminjaman dan penyewaan alat praktikum untuk mahasiswa. UI berbahasa Indonesia, mobile-first, dengan palet:
- Deep Navy `#123B50`
- Teal `#0D9488`
- Amber Orange `#F59E0B`
- Soft Mint `#E8F4F3`
- Off White `#F8FAFC`
- Slate `#1E293B`

## Menjalankan aplikasi

Pastikan Node.js 18+ dan npm terpasang.

```bash
npm install
npm run dev
```

Buka alamat lokal yang ditampilkan Vite (umumnya http://localhost:5173). Untuk build produksi:

```bash
npm run build
npm run preview
```

## Fitur demo yang tersedia
- Beranda marketplace, kategori, pencarian, katalog, filter kategori/harga/kondisi, urutkan, grid/list.
- 20 produk seed dengan harga Rupiah, spesifikasi, deskripsi, stok, status dan foto placeholder Unsplash.
- Detail produk, tanggal mulai/selesai, durasi, jumlah unit, metode pengambilan, kalkulasi harga/deposit/diskon mingguan.
- Wishlist, keranjang, checkout, data mahasiswa, metode pembayaran simulasi, pembuatan pesanan.
- Daftar pesanan, status dan alur pengembalian simulasi.
- Dashboard pemilik, dashboard admin, profil, halaman chat placeholder.
- 5 jasa contoh dan 3 paket bundling ditampilkan sebagai data seed; paket terlihat di beranda.
- Mode gelap/terang dan bottom navigation mobile.

## Catatan penting: status implementasi
Ini adalah **MVP frontend interaktif** dengan data contoh di memori React. Pembayaran, login Google/email kampus, upload KTM, chat real-time, notifikasi email/WhatsApp, verifikasi admin, penyimpanan permanen, dan integrasi Midtrans/Xendit masih berupa placeholder/demo dan belum memproses data atau uang sungguhan. Refresh halaman akan mengembalikan state demo ke awal.

## Arsitektur backend yang direkomendasikan
Untuk produksi, sambungkan React ke Supabase:
1. Auth: Supabase Auth (email kampus/Google) + verifikasi mahasiswa.
2. Storage: bucket `product-images`, `identity-documents`, `handover-evidence`.
3. Database: tabel `users`, `categories`, `products`, `product_images`, `product_specs`, `availability`, `bookings`, `booking_items`, `payments`, `reviews`, `messages`, `notifications`, `wishlists`, `services`, `bundles`, `promos`, `damage_reports`.
4. Buat RPC/transaction untuk pengecekan bentrok tanggal dan stok agar tidak terjadi double booking. Kurangi stok saat pemilik mengonfirmasi.
5. Gunakan Edge Functions/server backend untuk pembatalan unpaid 24 jam, pengingat H-1/3 jam, perhitungan denda, dan refund deposit.
6. Integrasi Midtrans Snap/Xendit di server; jangan pernah menaruh secret key di frontend.

## Aturan harga contoh
Sewa = tarif × durasi × jumlah unit. Diskon mingguan 10% jika durasi minimal 7 hari. Biaya layanan demo Rp 3.000. Deposit ditampilkan terpisah sebagai dana jaminan yang dikembalikan setelah pemeriksaan barang. Denda contoh di detail: 10% tarif harian per hari keterlambatan.

## Kustomisasi
- Ubah nama/identitas visual di `src/App.jsx` dan `src/styles.css`.
- Ubah produk, jasa, paket, kategori di `src/data.js`.
- Ubah warna pada CSS variables di `src/styles.css` dan `tailwind.config.js`.
