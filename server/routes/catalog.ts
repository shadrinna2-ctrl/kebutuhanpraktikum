import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb, logAudit, logSecurityEvent } from '../db.ts';
import { requireAuth, type AuthRequest } from '../middleware.ts';
import {
  getClientIp,
  isValidDateYmd,
  isValidPhone,
  parsePositiveInt,
  SORT_COLUMN_ALLOWLIST,
  SORT_DIR_ALLOWLIST,
} from '../security.ts';

const router = Router();

router.get('/site-info', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM site_settings').all() as Array<{ key: string; value: string }>;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  res.json({
    whatsapp: map.admin_wa || '6282164462480',
    instagram: map.admin_ig || 'https://www.instagram.com/shadrinna_/',
  });
});

router.get('/products', (req: Request, res: Response) => {
  const db = getDb();
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  const category = typeof req.query.category === 'string' ? req.query.category.trim().slice(0, 80) : 'Semua';
  const sortByRaw = typeof req.query.sortBy === 'string' ? req.query.sortBy.trim().toLowerCase() : 'id';
  const sortDirRaw = typeof req.query.sortDir === 'string' ? req.query.sortDir.trim().toLowerCase() : 'asc';
  const pageRaw = req.query.page ?? '1';
  const limitRaw = req.query.limit ?? '50';

  const sortCol = SORT_COLUMN_ALLOWLIST[sortByRaw];
  const sortDir = SORT_DIR_ALLOWLIST[sortDirRaw];
  if (!sortCol || !sortDir) {
    logSecurityEvent({
      eventType: 'INVALID_SORT_PARAM',
      severity: 'high',
      ipAddress: getClientIp(req),
      path: req.originalUrl,
      method: req.method,
      summary: 'Parameter sorting di luar allowlist ditolak.',
    });
    res.status(400).json({ error: 'Parameter pengurutan tidak valid.' });
    return;
  }

  const page = parsePositiveInt(pageRaw, 1, 1000);
  const limit = parsePositiveInt(limitRaw, 1, 100);
  if (!page || !limit) {
    res.status(400).json({ error: 'Parameter pagination tidak valid.' });
    return;
  }

  const whereClauses: string[] = ['is_active = 1'];
  const params: Array<string | number> = [];

  if (category && category !== 'Semua') {
    whereClauses.push('category = ?');
    params.push(category);
  }
  if (search) {
    const pattern = `%${search}%`;
    whereClauses.push('(name LIKE ? OR category LIKE ? OR desc LIKE ?)');
    params.push(pattern, pattern, pattern);
  }

  const whereSql = whereClauses.join(' AND ');
  const offset = (page - 1) * limit;

  try {
    const countRow = db
      .prepare(`SELECT COUNT(*) AS total FROM products WHERE ${whereSql}`)
      .get(...params) as { total: number };

    // sortCol and sortDir come strictly from static allowlist lookup maps
    const items = db
      .prepare(
        `SELECT id, name, category, price, purchase_range, stock, condition, image, desc, model, rating
         FROM products
         WHERE ${whereSql}
         ORDER BY ${sortCol} ${sortDir}, id ASC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);

    const catRows = db
      .prepare('SELECT DISTINCT category FROM products WHERE is_active = 1 ORDER BY category ASC')
      .all() as Array<{ category: string }>;

    res.json({
      items,
      categories: ['Semua', ...catRows.map((c) => c.category)],
      pagination: {
        page,
        limit,
        total: countRow.total,
        totalPages: Math.max(1, Math.ceil(countRow.total / limit)),
      },
    });
  } catch (err) {
    console.error('[Catalog] Query failed:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Gagal memuat katalog barang.' });
  }
});

router.get('/products/:id', (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id, 1, 1_000_000_000);
  if (!id) {
    res.status(400).json({ error: 'ID barang tidak valid.' });
    return;
  }

  const db = getDb();
  const product = db
    .prepare(
      'SELECT id, name, category, price, purchase_range, stock, condition, image, desc, model, rating FROM products WHERE id = ? AND is_active = 1'
    )
    .get(id);

  if (!product) {
    res.status(404).json({ error: 'Barang tidak ditemukan.' });
    return;
  }

  res.json(product);
});

router.get('/orders', requireAuth, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const { user } = req.auth!;

  try {
    // Customers ONLY see their own orders
    const orders = db
      .prepare(
        `SELECT id, order_code, user_id, customer_name, customer_phone, borrow_date, borrow_days, total_amount, price_needs_confirmation, note, status, created_at
         FROM orders
         WHERE user_id = ?
         ORDER BY id DESC
         LIMIT 50`
      )
      .all(user.id) as Array<Record<string, unknown>>;

    const itemStmt = db.prepare(
      'SELECT product_id, product_name, quantity, unit_price, subtotal FROM order_items WHERE order_id = ?'
    );

    const enriched = orders.map((o) => ({
      ...o,
      items: itemStmt.all(Number(o.id)),
    }));

    res.json({ orders: enriched });
  } catch (err) {
    console.error('[Orders] List failed:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Gagal memuat riwayat pesanan.' });
  }
});

router.get('/orders/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const orderId = parsePositiveInt(req.params.id, 1, 1_000_000_000);
  if (!orderId) {
    res.status(400).json({ error: 'ID pesanan tidak valid.' });
    return;
  }

  const db = getDb();
  const { user } = req.auth!;

  const order = db
    .prepare(
      `SELECT id, order_code, user_id, customer_name, customer_phone, borrow_date, borrow_days, total_amount, price_needs_confirmation, note, status, created_at
       FROM orders
       WHERE id = ?
       LIMIT 1`
    )
    .get(orderId) as Record<string, unknown> | undefined;

  if (!order) {
    res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    return;
  }

  // Strict IDOR enforcement: customers cannot read other customers' orders
  if (Number(order.user_id) !== user.id && user.role === 'customer') {
    logSecurityEvent({
      eventType: 'IDOR_ORDER_ATTEMPT',
      severity: 'high',
      userId: user.id,
      ipAddress: getClientIp(req),
      path: req.originalUrl,
      method: req.method,
      summary: `Pengguna #${user.id} mencoba membaca pesanan milik pengguna #${String(order.user_id)}.`,
    });
    res.status(403).json({ error: 'Anda tidak berhak mengakses transaksi ini.' });
    return;
  }

  const items = db
    .prepare('SELECT product_id, product_name, quantity, unit_price, subtotal FROM order_items WHERE order_id = ?')
    .all(orderId);

  res.json({ order: { ...order, items } });
});

router.post('/orders', requireAuth, (req: AuthRequest, res: Response) => {
  const ip = getClientIp(req);
  const { user } = req.auth!;
  const { customerName, customerPhone, borrowDate, borrowDays, note, items } = req.body || {};

  if (typeof customerName !== 'string' || customerName.trim().length < 2 || customerName.trim().length > 80) {
    res.status(400).json({ error: 'Nama peminjam harus 2–80 karakter.' });
    return;
  }
  if (!isValidPhone(customerPhone)) {
    res.status(400).json({ error: 'Nomor WhatsApp tidak valid.' });
    return;
  }
  if (!isValidDateYmd(borrowDate)) {
    res.status(400).json({ error: 'Format tanggal peminjaman harus YYYY-MM-DD.' });
    return;
  }
  const todayYmd = new Date().toISOString().slice(0, 10);
  if (borrowDate < todayYmd) {
    res.status(400).json({ error: 'Tanggal mulai peminjaman tidak boleh di masa lalu.' });
    return;
  }
  const days = parsePositiveInt(borrowDays, 1, 90);
  if (!days) {
    res.status(400).json({ error: 'Durasi peminjaman harus antara 1 hingga 90 hari.' });
    return;
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
    res.status(400).json({ error: 'Keranjang harus berisi 1 hingga 20 jenis barang.' });
    return;
  }

  // Normalize and aggregate duplicate product IDs
  const qtyByProduct = new Map<number, number>();
  for (const rawItem of items) {
    const pid = parsePositiveInt(rawItem?.productId, 1, 1_000_000_000);
    const qty = parsePositiveInt(rawItem?.quantity, 1, 50);
    if (!pid || !qty) {
      res.status(400).json({ error: 'Item barang dan jumlah peminjaman tidak valid.' });
      return;
    }
    qtyByProduct.set(pid, (qtyByProduct.get(pid) ?? 0) + qty);
  }

  const db = getDb();
  const cleanNote = typeof note === 'string' ? note.trim().slice(0, 500) : '';
  const orderCode = `PA-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;

  // Atomic transaction with BEGIN IMMEDIATE lock to prevent double booking / stock race condition
  db.exec('BEGIN IMMEDIATE;');
  try {
    const selectProduct = db.prepare(
      'SELECT id, name, price, stock FROM products WHERE id = ? AND is_active = 1 LIMIT 1'
    );
    const decrementStock = db.prepare(
      "UPDATE products SET stock = stock - ?, updated_at = datetime('now') WHERE id = ? AND stock >= ? AND is_active = 1"
    );

    let totalAmount = 0;
    let priceNeedsConfirmation = 0;
    const verifiedItems: Array<{ productId: number; name: string; qty: number; unitPrice: number; subtotal: number }> = [];

    for (const [productId, qty] of qtyByProduct.entries()) {
      const prod = selectProduct.get(productId) as
        | { id: number; name: string; price: number; stock: number }
        | undefined;
      if (!prod) {
        db.exec('ROLLBACK;');
        res.status(404).json({ error: `Produk dengan ID ${productId} tidak tersedia.` });
        return;
      }

      const stockUpd = decrementStock.run(qty, productId, qty);
      if (stockUpd.changes !== 1) {
        db.exec('ROLLBACK;');
        res.status(409).json({ error: `Stok "${prod.name}" tidak mencukupi (tersisa ${prod.stock} unit).` });
        return;
      }

      // Compute price strictly from backend DB, ignoring any frontend price/total
      const unitPrice = Number(prod.price);
      if (unitPrice === 0) priceNeedsConfirmation = 1;
      const subtotal = unitPrice * qty * days;
      totalAmount += subtotal;
      verifiedItems.push({
        productId: prod.id,
        name: prod.name,
        qty,
        unitPrice,
        subtotal,
      });
    }

    const orderInsert = db
      .prepare(
        `INSERT INTO orders (order_code, user_id, customer_name, customer_phone, borrow_date, borrow_days, total_amount, price_needs_confirmation, note, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
      )
      .run(
        orderCode,
        user.id,
        customerName.trim(),
        String(customerPhone).trim(),
        borrowDate,
        days,
        totalAmount,
        priceNeedsConfirmation,
        cleanNote
      );

    const orderId = Number(orderInsert.lastInsertRowid);
    const insertItem = db.prepare(
      'INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const vi of verifiedItems) {
      insertItem.run(orderId, vi.productId, vi.name, vi.qty, vi.unitPrice, vi.subtotal);
    }

    db.exec('COMMIT;');

    logAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'ORDER_CREATED',
      targetType: 'order',
      targetId: orderId,
      details: { orderCode, totalAmount, days, itemCount: verifiedItems.length },
      ipAddress: ip,
    });

    res.status(201).json({
      order: {
        id: orderId,
        order_code: orderCode,
        customer_name: customerName.trim(),
        customer_phone: String(customerPhone).trim(),
        borrow_date: borrowDate,
        borrow_days: days,
        total_amount: totalAmount,
        price_needs_confirmation: priceNeedsConfirmation,
        note: cleanNote,
        status: 'pending',
        items: verifiedItems,
      },
    });
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch {}
    console.error('[CreateOrder] Transaction failed:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Gagal memproses pesanan.' });
  }
});

export default router;
