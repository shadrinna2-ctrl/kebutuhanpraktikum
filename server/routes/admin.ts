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
  CONDITION_ALLOWLIST,
  getClientIp,
  isValidSafeImageUrl,
  ORDER_STATUS_ALLOWLIST,
  parsePositiveInt,
} from '../security.ts';

const router = Router();
router.use(requireAuth, requireRole('admin', 'superadmin'), requirePrivilegedMfa);

router.get('/overview', (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const productsRow = db.prepare('SELECT COUNT(*) AS cnt FROM products WHERE is_active = 1').get() as { cnt: number };
  const ordersRow = db.prepare('SELECT COUNT(*) AS cnt FROM orders').get() as { cnt: number };
  const pendingRow = db.prepare("SELECT COUNT(*) AS cnt FROM orders WHERE status = 'pending'").get() as { cnt: number };
  const revRow = db
    .prepare("SELECT COALESCE(SUM(total_amount), 0) AS total FROM orders WHERE status = 'completed'")
    .get() as { total: number };

  const recentOrders = db
    .prepare('SELECT id, order_code, customer_name, total_amount, price_needs_confirmation, status, created_at FROM orders ORDER BY id DESC LIMIT 6')
    .all();

  const stockSummary = db
    .prepare('SELECT id, name, stock, category FROM products WHERE is_active = 1 ORDER BY stock ASC, id ASC LIMIT 8')
    .all();

  res.json({
    stats: {
      totalProducts: productsRow.cnt,
      totalOrders: ordersRow.cnt,
      pendingOrders: pendingRow.cnt,
      completedRevenue: revRow.total,
    },
    recentOrders,
    stockSummary,
  });
});

router.get('/products', (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const products = db
    .prepare('SELECT id, name, category, price, purchase_range, stock, condition, image, desc, model, rating FROM products WHERE is_active = 1 ORDER BY id ASC')
    .all();
  res.json({ products });
});

router.post('/products', (req: AuthRequest, res: Response) => {
  const ip = getClientIp(req);
  const { user } = req.auth!;
  const { name, category, price, purchaseRange, stock, condition, image, desc, model } = req.body || {};

  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
    res.status(400).json({ error: 'Nama barang harus 2–100 karakter.' });
    return;
  }
  if (typeof category !== 'string' || category.trim().length < 2 || category.trim().length > 60) {
    res.status(400).json({ error: 'Kategori wajib diisi (2–60 karakter).' });
    return;
  }
  const parsedPrice = parsePositiveInt(price, 0, 50_000_000);
  const parsedStock = parsePositiveInt(stock, 0, 10_000);
  if (parsedPrice === null || parsedStock === null) {
    res.status(400).json({ error: 'Harga dan stok harus berupa angka bulat non-negatif yang valid.' });
    return;
  }
  const cleanCondition = typeof condition === 'string' && CONDITION_ALLOWLIST.has(condition) ? condition : 'Baik';
  const defaultImg = '/src/assets/images/cat_electronics_lab_1795506640100.jpg';
  const cleanImage = typeof image === 'string' && image.trim() ? image.trim() : defaultImg;
  if (!isValidSafeImageUrl(cleanImage)) {
    res.status(400).json({ error: 'URL foto barang harus menggunakan HTTP/HTTPS atau aset lokal yang valid.' });
    return;
  }

  const db = getDb();
  const ins = db
    .prepare(
      `INSERT INTO products (name, category, price, purchase_range, stock, condition, image, desc, model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name.trim(),
      category.trim(),
      parsedPrice,
      typeof purchaseRange === 'string' ? purchaseRange.trim().slice(0, 60) : '',
      parsedStock,
      cleanCondition,
      cleanImage,
      typeof desc === 'string' ? desc.trim().slice(0, 500) : '',
      typeof model === 'string' && /^[a-z0-9_-]{2,30}$/i.test(model) ? model : 'camera'
    );

  const productId = Number(ins.lastInsertRowid);
  logAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'PRODUCT_CREATED',
    targetType: 'product',
    targetId: productId,
    details: { name: name.trim(), price: parsedPrice, stock: parsedStock },
    ipAddress: ip,
  });

  res.status(201).json({ id: productId, message: 'Barang berhasil ditambahkan.' });
});

router.put('/products/:id', (req: AuthRequest, res: Response) => {
  const ip = getClientIp(req);
  const { user } = req.auth!;
  const id = parsePositiveInt(req.params.id, 1, 1_000_000_000);
  if (!id) {
    res.status(400).json({ error: 'ID barang tidak valid.' });
    return;
  }

  const { name, category, price, purchaseRange, stock, condition, image, desc } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
    res.status(400).json({ error: 'Nama barang harus 2–100 karakter.' });
    return;
  }
  if (typeof category !== 'string' || category.trim().length < 2 || category.trim().length > 60) {
    res.status(400).json({ error: 'Kategori wajib diisi.' });
    return;
  }
  const parsedPrice = parsePositiveInt(price, 0, 50_000_000);
  const parsedStock = parsePositiveInt(stock, 0, 10_000);
  if (parsedPrice === null || parsedStock === null) {
    res.status(400).json({ error: 'Harga dan stok harus valid.' });
    return;
  }
  if (typeof condition !== 'string' || !CONDITION_ALLOWLIST.has(condition)) {
    res.status(400).json({ error: 'Kondisi barang tidak valid.' });
    return;
  }
  const defaultImg = '/src/assets/images/cat_electronics_lab_1795506640100.jpg';
  const cleanImage = typeof image === 'string' && image.trim() ? image.trim() : defaultImg;
  if (!isValidSafeImageUrl(cleanImage)) {
    res.status(400).json({ error: 'URL foto tidak valid.' });
    return;
  }

  const db = getDb();
  const upd = db
    .prepare(
      `UPDATE products
       SET name = ?, category = ?, price = ?, purchase_range = ?, stock = ?, condition = ?, image = ?, desc = ?, updated_at = datetime('now')
       WHERE id = ? AND is_active = 1`
    )
    .run(
      name.trim(),
      category.trim(),
      parsedPrice,
      typeof purchaseRange === 'string' ? purchaseRange.trim().slice(0, 60) : '',
      parsedStock,
      condition,
      cleanImage,
      typeof desc === 'string' ? desc.trim().slice(0, 500) : '',
      id
    );

  if (upd.changes === 0) {
    res.status(404).json({ error: 'Barang tidak ditemukan.' });
    return;
  }

  logAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'PRODUCT_UPDATED',
    targetType: 'product',
    targetId: id,
    details: { price: parsedPrice, stock: parsedStock },
    ipAddress: ip,
  });

  res.json({ message: 'Data barang berhasil diperbarui.' });
});

router.delete('/products/:id', requireReauth, (req: AuthRequest, res: Response) => {
  const ip = getClientIp(req);
  const { user } = req.auth!;
  const id = parsePositiveInt(req.params.id, 1, 1_000_000_000);
  if (!id) {
    res.status(400).json({ error: 'ID barang tidak valid.' });
    return;
  }

  const db = getDb();
  const upd = db.prepare("UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ? AND is_active = 1").run(id);
  if (upd.changes === 0) {
    res.status(404).json({ error: 'Barang tidak ditemukan.' });
    return;
  }

  logAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'PRODUCT_ARCHIVED',
    targetType: 'product',
    targetId: id,
    ipAddress: ip,
  });

  res.json({ message: 'Barang berhasil dinonaktifkan dari katalog.' });
});

router.get('/orders', (req: AuthRequest, res: Response) => {
  const db = getDb();
  const q = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 80) : '';
  const where = q ? 'WHERE (o.order_code LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)' : '';
  const params = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];

  const orders = db
    .prepare(
      `SELECT o.id, o.order_code, o.user_id, o.customer_name, o.customer_phone, o.borrow_date, o.borrow_days, o.total_amount, o.price_needs_confirmation, o.note, o.status, o.created_at
       FROM orders o
       ${where}
       ORDER BY o.id DESC
       LIMIT 100`
    )
    .all(...params) as Array<Record<string, unknown>>;

  const itemStmt = db.prepare('SELECT product_id, product_name, quantity, unit_price, subtotal FROM order_items WHERE order_id = ?');
  res.json({
    orders: orders.map((o) => ({
      ...o,
      items: itemStmt.all(Number(o.id)),
    })),
  });
});

router.patch('/orders/:id/status', (req: AuthRequest, res: Response) => {
  const ip = getClientIp(req);
  const { user } = req.auth!;
  const id = parsePositiveInt(req.params.id, 1, 1_000_000_000);
  const nextStatus = typeof req.body?.status === 'string' ? req.body.status.trim() : '';

  if (!id || !ORDER_STATUS_ALLOWLIST.has(nextStatus)) {
    res.status(400).json({ error: 'ID pesanan atau status tidak valid.' });
    return;
  }

  const db = getDb();
  db.exec('BEGIN IMMEDIATE;');
  try {
    const order = db.prepare('SELECT id, status FROM orders WHERE id = ? LIMIT 1').get(id) as
      | { id: number; status: string }
      | undefined;

    if (!order) {
      db.exec('ROLLBACK;');
      res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
      return;
    }

    const prevStatus = order.status;
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(nextStatus, id);

    // Restore stock atomically if transitioning into cancelled/completed from active status
    const wasActive = prevStatus !== 'cancelled' && prevStatus !== 'completed';
    const nowInactive = nextStatus === 'cancelled' || nextStatus === 'completed';
    if (wasActive && nowInactive) {
      const items = db.prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?').all(id) as Array<{
        product_id: number;
        quantity: number;
      }>;
      const restoreStmt = db.prepare("UPDATE products SET stock = stock + ?, updated_at = datetime('now') WHERE id = ?");
      for (const item of items) {
        restoreStmt.run(item.quantity, item.product_id);
      }
    }

    db.exec('COMMIT;');

    logAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'ORDER_STATUS_UPDATED',
      targetType: 'order',
      targetId: id,
      details: { from: prevStatus, to: nextStatus },
      ipAddress: ip,
    });

    res.json({ message: 'Status pesanan diperbarui.' });
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch {}
    console.error('[OrderStatus] Update failed:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Gagal memperbarui status pesanan.' });
  }
});

router.get('/customers', (_req: AuthRequest, res: Response) => {
  const db = getDb();
  // Explicitly select only non-sensitive customer summary columns
  const customers = db
    .prepare(
      `SELECT u.id, u.username, u.full_name, u.phone, u.email, u.email_verified, u.is_active,
              COUNT(o.id) AS order_count, COALESCE(SUM(o.total_amount), 0) AS total_spent
       FROM users u
       LEFT JOIN orders o ON o.user_id = u.id
       WHERE u.role = 'customer'
       GROUP BY u.id
       ORDER BY order_count DESC, u.id DESC`
    )
    .all();

  res.json({ customers });
});

router.get('/reports', (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const summary = db
    .prepare(
      `SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(total_amount), 0) AS gross_amount,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN total_amount ELSE 0 END), 0) AS completed_amount,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count
       FROM orders`
    )
    .get() as Record<string, number>;

  const statusCounts = db
    .prepare('SELECT status, COUNT(*) AS cnt FROM orders GROUP BY status')
    .all() as Array<{ status: string; cnt: number }>;

  res.json({
    summary: {
      totalOrders: Number(summary.total_orders || 0),
      grossAmount: Number(summary.gross_amount || 0),
      completedAmount: Number(summary.completed_amount || 0),
      cancelledCount: Number(summary.cancelled_count || 0),
      averageAmount: summary.total_orders ? Math.round(Number(summary.gross_amount) / Number(summary.total_orders)) : 0,
    },
    statusCounts,
  });
});

export default router;
