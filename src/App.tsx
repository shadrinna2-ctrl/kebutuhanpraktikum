import React, { useCallback, useEffect, useState } from 'react';
import {
  ShoppingBag,
  Search,
  ShieldCheck,
  LogOut,
  X,
  Plus,
  Minus,
  Trash2,
  Box,
  ArrowRight,
  CheckCircle2,
  Calendar,
  ExternalLink,
  AlertCircle,
  Layers,
  Cpu,
  KeyRound,
  PackageCheck,
  ClipboardList,
  MessageCircle,
  Camera,
} from 'lucide-react';
import { ApiError, apiRequest, formatRupiah } from './api';
import { ThreeViewer } from './components/ThreeViewer';
import { AuthModal } from './components/AuthModal';
import { AccountSecurityView } from './components/AccountSecurityView';
import { AdminDashboardView } from './components/AdminDashboardView';
import type { CartItem, Order, Product, User } from './types';

type AppPage = 'store' | 'security' | 'admin';

const SORT_OPTIONS = [
  { value: 'id:asc', label: 'Urutan Default' },
  { value: 'price:asc', label: 'Harga Termurah' },
  { value: 'price:desc', label: 'Harga Termahal' },
  { value: 'stock:desc', label: 'Stok Terbanyak' },
  { value: 'name:asc', label: 'Nama (A–Z)' },
];

const ORDER_STATUS_TEXT: Record<string, string> = {
  pending: 'Menunggu Konfirmasi',
  confirmed: 'Dikonfirmasi',
  ongoing: 'Sedang Dipinjam',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
};

const FALLBACK_IMAGE = '/src/assets/images/cat_electronics_lab_1795506640100.jpg';

export function App() {
  const [page, setPage] = useState<AppPage>('store');
  const [user, setUser] = useState<User | null>(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [siteInfo, setSiteInfo] = useState({
    whatsapp: '6282164462480',
    instagram: 'https://www.instagram.com/shadrinna_/',
  });

  // Catalog state (server-driven with allowlist sorting + parameterized filtering)
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>(['Semua']);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Semua');
  const [sortOption, setSortOption] = useState('id:asc');
  const [catalogPage, setCatalogPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalProductsCount, setTotalProductsCount] = useState(28);
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  // Interactive viewer & modals
  const [selectedModel, setSelectedModel] = useState('camera');
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'register' | 'bootstrap'>('login');

  // Checkout state
  const [borrowName, setBorrowName] = useState('');
  const [borrowPhone, setBorrowPhone] = useState('');
  const [borrowDate, setBorrowDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [borrowDays, setBorrowDays] = useState(2);
  const [borrowNote, setBorrowNote] = useState('');
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [lastCreatedOrder, setLastCreatedOrder] = useState<Order | null>(null);

  // Customer order history
  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  const loadSession = useCallback(async () => {
    try {
      const [meRes, bootRes, siteRes] = await Promise.all([
        apiRequest<{ authenticated: boolean; user: User | null }>('/api/auth/me'),
        apiRequest<{ needsBootstrap: boolean }>('/api/auth/bootstrap-status'),
        apiRequest<{ whatsapp: string; instagram: string }>('/api/site-info'),
      ]);
      setUser(meRes.user);
      setNeedsBootstrap(bootRes.needsBootstrap);
      setSiteInfo(siteRes);
      if (meRes.user) {
        setBorrowName((prev) => prev || meRes.user!.fullName);
        setBorrowPhone((prev) => prev || meRes.user!.phone);
      }
    } catch {
      // Guest state
    }
  }, []);

  const loadProducts = useCallback(async () => {
    setLoadingCatalog(true);
    try {
      const [sortBy, sortDir] = sortOption.split(':');
      const params = new URLSearchParams({
        search: search.trim(),
        category,
        sortBy: sortBy || 'id',
        sortDir: sortDir || 'asc',
        page: String(catalogPage),
        limit: '12',
      });
      const res = await apiRequest<{
        items: Product[];
        categories: string[];
        pagination: { page: number; totalPages: number; total: number };
      }>(`/api/products?${params.toString()}`);

      setProducts(res.items);
      setCategories(res.categories);
      setTotalPages(res.pagination.totalPages);
      if (category === 'Semua' && !search.trim()) {
        setTotalProductsCount(res.pagination.total);
      }
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Gagal memuat katalog peralatan.');
    } finally {
      setLoadingCatalog(false);
    }
  }, [search, category, sortOption, catalogPage, showToast]);

  const loadMyOrders = useCallback(async () => {
    if (!user) {
      setMyOrders([]);
      return;
    }
    try {
      const res = await apiRequest<{ orders: Order[] }>('/api/orders');
      setMyOrders(res.orders);
    } catch {
      setMyOrders([]);
    }
  }, [user]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    loadMyOrders();
  }, [loadMyOrders]);

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network hiccup during logout
    }
    setUser(null);
    setMyOrders([]);
    setPage('store');
    showToast('Sesi Anda telah ditutup.');
  };

  const addToCart = (product: Product) => {
    if (product.stock <= 0) {
      showToast('Stok barang sedang habis.');
      return;
    }
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) {
          showToast(`Maksimal stok tersedia (${product.stock} unit).`);
          return prev;
        }
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
    showToast(`${product.name} ditambahkan ke keranjang.`);
  };

  const updateCartQty = (productId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id !== productId) return item;
          const nextQty = Math.min(item.product.stock, item.quantity + delta);
          return nextQty <= 0 ? null : { ...item, quantity: nextQty };
        })
        .filter((item): item is CartItem => item !== null)
    );
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setCartOpen(false);
      setAuthInitialMode('login');
      setAuthModalOpen(true);
      showToast('Silakan masuk terlebih dahulu untuk menyelesaikan peminjaman.');
      return;
    }
    if (cart.length === 0) return;

    setCheckoutSubmitting(true);
    try {
      const res = await apiRequest<{ order: Order }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerName: borrowName,
          customerPhone: borrowPhone,
          borrowDate,
          borrowDays,
          note: borrowNote,
          items: cart.map((c) => ({ productId: c.product.id, quantity: c.quantity })),
        }),
      });
      setLastCreatedOrder(res.order);
      setCart([]);
      setBorrowNote('');
      showToast(`Peminjaman ${res.order.order_code} berhasil dicatat.`);
      await Promise.all([loadProducts(), loadMyOrders()]);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Gagal mengirim pengajuan peminjaman.');
    } finally {
      setCheckoutSubmitting(false);
    }
  };

  const cartCount = cart.reduce((acc, item) => acc + item.quantity, 0);
  const estimatedSubtotal = cart.reduce(
    (acc, item) => acc + item.product.price * item.quantity * borrowDays,
    0
  );
  const hasUnpricedItems = cart.some((item) => item.product.price === 0);

  const buildWhatsappConfirmUrl = (order: Order) => {
    const cleanPhone = siteInfo.whatsapp.replace(/[^0-9]/g, '');
    const itemsText = order.items.map((i) => `- ${i.product_name} (${i.quantity}x)`).join('\n');
    const text = `Halo Admin PinjamAlat, saya ingin konfirmasi peminjaman:\nKode: ${order.order_code}\nNama: ${order.customer_name}\nTanggal: ${order.borrow_date} (${order.borrow_days} hari)\nAlat:\n${itemsText}`;
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50/90 via-sky-50/60 to-teal-50/75 text-slate-900 flex flex-col">
      {/* TOP BAR (Strict 3-Zone Contract) */}
      <header className="sticky top-0 z-40 border-b border-indigo-100/90 bg-white/90 backdrop-blur-md shadow-xs">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-6">
          {/* Zone 1: Brand */}
          <button
            type="button"
            onClick={() => setPage('store')}
            className="flex items-center gap-3 text-left shrink-0 whitespace-nowrap"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 via-violet-600 to-teal-500 text-white shadow-md shadow-indigo-500/25">
              <Layers className="h-6 w-6" />
            </span>
            <span className="text-lg font-extrabold tracking-tight text-slate-900 font-display whitespace-nowrap">
              PinjamAlat
            </span>
          </button>

          {/* Zone 2: Primary Navigation (4-5 concise links, whitespace-nowrap) */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <a
              href="#katalog"
              onClick={() => setPage('store')}
              className={`whitespace-nowrap shrink-0 hover:text-indigo-700 transition-colors ${page === 'store' ? 'text-indigo-700 font-semibold' : ''}`}
            >
              Katalog
            </a>
            <a
              href="#preview-3d"
              onClick={() => setPage('store')}
              className="whitespace-nowrap shrink-0 hover:text-indigo-700 transition-colors"
            >
              Preview 3D
            </a>
            <a
              href="#pesanan"
              onClick={() => setPage('store')}
              className="whitespace-nowrap shrink-0 hover:text-indigo-700 transition-colors"
            >
              Pesanan
            </a>
            {user && (
              <button
                type="button"
                onClick={() => setPage('security')}
                className={`whitespace-nowrap shrink-0 hover:text-indigo-700 transition-colors ${page === 'security' ? 'text-indigo-700 font-semibold' : ''}`}
              >
                Keamanan
              </button>
            )}
            {(user?.role === 'admin' || user?.role === 'superadmin') && (
              <button
                type="button"
                onClick={() => setPage('admin')}
                className={`whitespace-nowrap shrink-0 hover:text-indigo-700 transition-colors ${page === 'admin' ? 'text-indigo-700 font-semibold' : ''}`}
              >
                Dashboard
              </button>
            )}
          </nav>

          {/* Zone 3: Actions */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                setLastCreatedOrder(null);
                setCartOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-3.5 py-2 text-xs font-semibold text-indigo-950 hover:bg-indigo-100/80 transition-colors whitespace-nowrap shrink-0"
            >
              <ShoppingBag className="h-5 w-5 text-indigo-600" />
              <span>Keranjang</span>
              <span className="font-mono-tabular text-teal-700 font-bold">({cartCount})</span>
            </button>

            {user ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage('security')}
                  className="hidden sm:inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-teal-600 px-3.5 py-2 text-xs font-semibold text-white hover:from-indigo-500 hover:to-teal-500 shadow-sm whitespace-nowrap shrink-0"
                >
                  <ShieldCheck className="h-5 w-5 text-teal-200" />
                  <span>{user.username}</span>
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  aria-label="Keluar"
                  title="Keluar"
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-colors"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAuthInitialMode(needsBootstrap ? 'bootstrap' : 'login');
                  setAuthModalOpen(true);
                }}
                className="rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-teal-600 px-4 py-2 text-xs font-semibold text-white hover:from-indigo-500 hover:to-teal-500 shadow-sm whitespace-nowrap shrink-0"
              >
                {needsBootstrap ? 'Setup / Masuk' : 'Masuk'}
              </button>
            )}
          </div>
        </div>

        {/* Mobile Secondary Quick Nav */}
        <div className="flex md:hidden items-center gap-5 overflow-x-auto border-t border-slate-100 px-6 py-2 text-xs font-medium text-slate-600">
          <a href="#katalog" onClick={() => setPage('store')} className="whitespace-nowrap">Katalog</a>
          <a href="#preview-3d" onClick={() => setPage('store')} className="whitespace-nowrap">Preview 3D</a>
          <a href="#pesanan" onClick={() => setPage('store')} className="whitespace-nowrap">Pesanan</a>
          {user && (
            <button type="button" onClick={() => setPage('security')} className="whitespace-nowrap text-teal-700 font-semibold">
              Keamanan
            </button>
          )}
          {(user?.role === 'admin' || user?.role === 'superadmin') && (
            <button type="button" onClick={() => setPage('admin')} className="whitespace-nowrap text-teal-700 font-semibold">
              Dashboard
            </button>
          )}
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1">
        {page === 'security' && user && (
          <AccountSecurityView
            user={user}
            onRefreshUser={loadSession}
            onToast={showToast}
          />
        )}

        {page === 'admin' && user && (user.role === 'admin' || user.role === 'superadmin') && (
          <AdminDashboardView
            user={user}
            onToast={showToast}
            onProductsChanged={() => {
              loadProducts();
              loadSession();
            }}
            onNavigateSecurity={() => setPage('security')}
          />
        )}

        {page === 'store' && (
          <>
            {/* HERO SECTION */}
            <section className="relative overflow-hidden bg-gradient-to-br from-[#0e1336] via-[#221c5e] to-[#0b4454] text-white">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(129,140,248,0.34),transparent_50%),radial-gradient(ellipse_at_bottom_right,rgba(20,184,166,0.30),transparent_55%),radial-gradient(ellipse_at_top_right,rgba(236,72,153,0.18),transparent_42%)]"
              />
              <div className="relative mx-auto grid max-w-7xl gap-10 px-6 py-16 lg:grid-cols-12 lg:py-20 items-stretch">
                <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
                  <p className="text-xs font-semibold uppercase tracking-widest text-teal-300">
                    Inventaris Praktikum, Riset & Multimedia Kampus
                  </p>
                  <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl text-balance leading-[1.12]">
                    Peminjaman alat laboratorium dan produksi media tanpa proses rumit.
                  </h1>
                  <p className="text-base text-indigo-100/90 leading-relaxed max-w-xl">
                    Telusuri ketersediaan stok secara langsung, periksa detail fisik perangkat dalam tampilan 3D interaktif, dan ajukan jadwal peminjaman terverifikasi dalam hitungan menit.
                  </p>
                  <div className="flex flex-wrap items-center gap-3.5 pt-1">
                    <a
                      href="#katalog"
                      className="inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-teal-500 via-cyan-500 to-indigo-500 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-950/40 hover:from-teal-400 hover:to-indigo-400 transition-all"
                    >
                      Lihat Katalog Alat <ArrowRight className="h-5 w-5" />
                    </a>
                    <a
                      href="#preview-3d"
                      className="inline-flex items-center gap-2.5 rounded-xl border border-indigo-300/30 bg-white/10 px-5 py-3.5 text-sm font-semibold text-white backdrop-blur-xs hover:bg-white/20 transition-colors"
                    >
                      <Box className="h-5 w-5 text-cyan-300" /> Inspeksi 3D
                    </a>
                  </div>
                </div>

                <div className="lg:col-span-6">
                  <div className="h-full overflow-hidden rounded-2xl border border-indigo-300/25 bg-indigo-950/60 shadow-2xl shadow-indigo-950/60">
                    <img
                      src="/src/assets/images/hero_lab_equipment_1795506639255.jpg"
                      alt="Peralatan laboratorium dan multimedia PinjamAlat"
                      referrerPolicy="no-referrer"
                      className="aspect-[16/10] lg:h-full w-full object-cover"
                    />
                  </div>
                </div>
              </div>

              {/* 4-Column Summary Strip below Hero with Large Vibrant Icons */}
              <div className="relative border-t border-white/15 bg-indigo-950/50 backdrop-blur-sm">
                <div className="mx-auto grid max-w-7xl grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/15 px-6">
                  <div className="flex items-center gap-4 py-5 lg:pr-6">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-900/40">
                      <Cpu className="h-7 w-7" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-white font-mono-tabular">{totalProductsCount}</p>
                      <p className="mt-0.5 text-xs text-indigo-200">Jenis peralatan terkalibrasi siap pakai</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 py-5 sm:pl-6 lg:px-6">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-teal-900/40">
                      <ShieldCheck className="h-7 w-7" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-white font-mono-tabular">100%</p>
                      <p className="mt-0.5 text-xs text-indigo-200">Validasi stok & transaksi di server</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 py-5 lg:px-6">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-500 text-white shadow-lg shadow-cyan-900/40">
                      <Box className="h-7 w-7" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-white font-mono-tabular">360°</p>
                      <p className="mt-0.5 text-xs text-indigo-200">Pratinjau geometri WebGL interaktif</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 py-5 sm:pl-6">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-rose-500 text-white shadow-lg shadow-rose-900/40">
                      <KeyRound className="h-7 w-7" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-white font-mono-tabular">MFA + RBAC</p>
                      <p className="mt-0.5 text-xs text-indigo-200">Perlindungan akun & data terenkripsi</p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* CATALOG SECTION */}
            <section id="katalog" className="mx-auto max-w-7xl px-6 py-14 space-y-8">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 rounded-2xl border border-indigo-200/70 bg-gradient-to-r from-white via-indigo-50/70 to-teal-50/70 p-6 shadow-xs">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-teal-500 text-white shadow-md shadow-indigo-500/25">
                    <Layers className="h-7 w-7" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">
                      Katalog Peralatan
                    </p>
                    <h2 className="mt-0.5 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                      Pilih Perlengkapan Sesuai Kebutuhan
                    </h2>
                  </div>
                </div>

                {/* Search + Category + Allowlisted Sort */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative w-full sm:w-64">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-indigo-500" />
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setCatalogPage(1);
                      }}
                      placeholder="Cari osiloskop, kamera, server..."
                      className="w-full rounded-xl border border-indigo-200 bg-white pl-10 pr-3 py-2.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>

                  <select
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      setCatalogPage(1);
                    }}
                    aria-label="Filter kategori"
                    className="rounded-xl border border-indigo-200 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none"
                  >
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat === 'Semua' ? 'Semua Kategori' : cat}
                      </option>
                    ))}
                  </select>

                  <select
                    value={sortOption}
                    onChange={(e) => {
                      setSortOption(e.target.value);
                      setCatalogPage(1);
                    }}
                    aria-label="Urutkan barang"
                    className="rounded-xl border border-indigo-200 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none"
                  >
                    {SORT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {loadingCatalog ? (
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {[1, 2, 3, 4].map((idx) => (
                    <div key={idx} className="h-80 animate-pulse rounded-2xl bg-slate-200" />
                  ))}
                </div>
              ) : products.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center space-y-2">
                  <p className="text-base font-semibold text-slate-800">Peralatan tidak ditemukan</p>
                  <p className="text-xs text-slate-500">
                    Coba kata kunci pencarian lain atau pilih "Semua Kategori".
                  </p>
                </div>
              ) : (
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {products.map((product) => (
                    <article
                      key={product.id}
                      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow hover:shadow-md"
                    >
                      <button
                        type="button"
                        onClick={() => setDetailProduct(product)}
                        className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100 text-left"
                      >
                        <img
                          src={product.image}
                          alt={product.name}
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.src = FALLBACK_IMAGE;
                          }}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      </button>

                      <div className="flex flex-1 flex-col p-5">
                        {/* Zero-pill unboxed metadata */}
                        <p className="text-[11px] font-medium text-slate-500">
                          {product.category} · Stok <span className="font-mono-tabular">{product.stock}</span> · {product.condition}
                        </p>

                        <h3 className="mt-1.5 text-base font-bold text-slate-900 leading-snug">
                          <button
                            type="button"
                            onClick={() => setDetailProduct(product)}
                            className="text-left hover:text-teal-700"
                          >
                            {product.name}
                          </button>
                        </h3>

                        <p className="mt-2 line-clamp-2 text-xs text-slate-600 leading-relaxed flex-1">
                          {product.desc}
                        </p>

                        <div className="mt-4 flex items-end justify-between gap-2 border-t border-indigo-50 pt-3.5">
                          <div>
                            <p className="text-[11px] text-slate-500">Tarif sewa</p>
                            <p className="text-sm font-bold text-indigo-950 font-mono-tabular">
                              {product.price > 0 ? `${formatRupiah(product.price)}/hr` : 'Konfirmasi Admin'}
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedModel(product.model);
                                document.getElementById('preview-3d')?.scrollIntoView({ behavior: 'smooth' });
                              }}
                              title="Lihat di 3D Viewer"
                              className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-2 text-indigo-700 hover:bg-indigo-100 transition-colors"
                            >
                              <Box className="h-5 w-5" />
                            </button>
                            <button
                              type="button"
                              disabled={product.stock <= 0}
                              onClick={() => addToCart(product)}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-teal-600 px-3.5 py-2 text-xs font-semibold text-white hover:from-indigo-500 hover:to-teal-500 shadow-xs disabled:from-slate-300 disabled:to-slate-300 disabled:text-slate-500 whitespace-nowrap"
                            >
                              <ShoppingBag className="h-4 w-4" />
                              {product.stock > 0 ? 'Pinjam' : 'Habis'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-4">
                  <button
                    type="button"
                    disabled={catalogPage <= 1}
                    onClick={() => setCatalogPage((p) => Math.max(1, p - 1))}
                    className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40"
                  >
                    Sebelumnya
                  </button>
                  <span className="px-3 text-xs font-mono-tabular text-slate-600">
                    Halaman {catalogPage} dari {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={catalogPage >= totalPages}
                    onClick={() => setCatalogPage((p) => Math.min(totalPages, p + 1))}
                    className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40"
                  >
                    Berikutnya
                  </button>
                </div>
              )}
            </section>

            {/* 3D INTERACTIVE PREVIEW SECTION */}
            <section id="preview-3d" className="relative overflow-hidden bg-gradient-to-br from-[#0e1338] via-[#1c1a4f] to-[#0b3e4f] py-16">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(139,92,246,0.28),transparent_50%),radial-gradient(ellipse_at_bottom_left,rgba(20,184,166,0.24),transparent_50%)]"
              />
              <div className="relative mx-auto max-w-7xl px-6">
                <ThreeViewer
                  products={products}
                  selectedModel={selectedModel}
                  onSelectModel={setSelectedModel}
                />
              </div>
            </section>

            {/* 3-STEP HOW IT WORKS */}
            <section className="mx-auto max-w-7xl px-6 py-14">
              <div className="rounded-3xl border border-indigo-200/70 bg-gradient-to-br from-indigo-100/75 via-violet-50/80 to-teal-100/70 p-8 md:p-10 shadow-xs">
                <div className="mb-8 flex items-center gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-md shadow-indigo-500/25">
                    <PackageCheck className="h-7 w-7" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">Alur Peminjaman</p>
                    <h2 className="mt-0.5 text-2xl font-bold text-slate-900">Tiga Langkah Transparan</h2>
                  </div>
                </div>
                <div className="grid gap-6 md:grid-cols-3">
                  <div className="rounded-2xl border border-indigo-100 bg-white/95 p-6 shadow-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/25">
                        <Search className="h-8 w-8" />
                      </div>
                      <span className="text-sm font-bold font-mono-tabular text-indigo-600">01</span>
                    </div>
                    <h3 className="mt-5 text-base font-bold text-slate-900">Pilih Alat & Jadwal</h3>
                    <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                      Tambahkan alat yang dibutuhkan ke keranjang dan tentukan tanggal serta durasi penggunaan.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-teal-100 bg-white/95 p-6 shadow-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-lg shadow-teal-500/25">
                        <ShieldCheck className="h-8 w-8" />
                      </div>
                      <span className="text-sm font-bold font-mono-tabular text-teal-600">02</span>
                    </div>
                    <h3 className="mt-5 text-base font-bold text-slate-900">Validasi Stok Otomatis</h3>
                    <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                      Sistem memeriksa dan mengunci stok secara atomik di server untuk mencegah bentrok peminjaman ganda.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-rose-100 bg-white/95 p-6 shadow-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-rose-500 text-white shadow-lg shadow-rose-500/25">
                        <PackageCheck className="h-8 w-8" />
                      </div>
                      <span className="text-sm font-bold font-mono-tabular text-rose-600">03</span>
                    </div>
                    <h3 className="mt-5 text-base font-bold text-slate-900">Serah Terima & Pantau</h3>
                    <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                      Pantau status persetujuan dan riwayat transaksi langsung dari akun terproteksi Anda.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* CUSTOMER ORDER HISTORY */}
            <section id="pesanan" className="mx-auto max-w-7xl px-6 pb-14">
              <div className="rounded-2xl border border-indigo-100 bg-white/95 p-6 md:p-8 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-indigo-50 pb-5 mb-5">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-cyan-500 text-white shadow-md shadow-indigo-500/20">
                      <ClipboardList className="h-6 w-6" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-slate-900">Riwayat Peminjaman Saya</h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Hanya menampilkan transaksi milik akun Anda yang sedang masuk.
                      </p>
                    </div>
                  </div>
                  {!user && (
                    <button
                      type="button"
                      onClick={() => {
                        setAuthInitialMode('login');
                        setAuthModalOpen(true);
                      }}
                      className="rounded-xl bg-gradient-to-r from-indigo-600 to-teal-600 px-4 py-2.5 text-xs font-semibold text-white hover:from-indigo-500 hover:to-teal-500 shadow-sm"
                    >
                      Masuk untuk Melihat Riwayat
                    </button>
                  )}
                </div>

                {!user ? (
                  <p className="text-sm text-slate-500">
                    Silakan masuk dengan akun Anda untuk mengakses daftar transaksi pribadi secara aman.
                  </p>
                ) : myOrders.length === 0 ? (
                  <p className="text-sm text-slate-500">Anda belum memiliki transaksi peminjaman.</p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {myOrders.map((order) => (
                      <div key={order.id} className="py-4 flex flex-wrap items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-3 text-xs">
                            <span className="font-mono-tabular font-bold text-slate-900">{order.order_code}</span>
                            <span className="text-slate-400">·</span>
                            <span className="font-semibold text-teal-700">
                              {ORDER_STATUS_TEXT[order.status] || order.status}
                            </span>
                          </div>
                          <p className="text-sm font-medium text-slate-800">
                            {order.items.map((i) => `${i.product_name} ×${i.quantity}`).join(', ')}
                          </p>
                          <p className="text-xs text-slate-500 font-mono-tabular">
                            Mulai {order.borrow_date} · {order.borrow_days} hari
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-slate-900 font-mono-tabular">
                            {order.price_needs_confirmation
                              ? 'Menunggu Konfirmasi Harga'
                              : formatRupiah(order.total_amount)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* CONTACT CTA BANNER */}
            <section className="mx-auto max-w-7xl px-6 pb-16">
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-indigo-600 via-violet-600 to-teal-500 p-8 md:p-10 text-white shadow-xl shadow-indigo-900/15">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                  <div className="flex items-start sm:items-center gap-5">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/15 border border-white/25 text-white backdrop-blur-xs shadow-lg">
                      <MessageCircle className="h-8 w-8" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-teal-200">
                        Layanan Konsultasi & Koordinasi Alat
                      </p>
                      <h2 className="mt-1 text-2xl font-bold text-white">
                        Butuh Bantuan Jadwal atau Ketersediaan Khusus?
                      </h2>
                      <p className="mt-1 text-sm text-indigo-100 max-w-xl">
                        Hubungi admin laboratorium langsung melalui WhatsApp atau pantau informasi inventaris terbaru di Instagram resmi kami.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 shrink-0">
                    <a
                      href={`https://wa.me/${siteInfo.whatsapp.replace(/[^0-9]/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-xs font-bold text-indigo-900 shadow-md hover:bg-indigo-50 transition-colors"
                    >
                      <MessageCircle className="h-5 w-5 text-emerald-600" />
                      WhatsApp Admin
                    </a>
                    <a
                      href={siteInfo.instagram}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/15 px-5 py-3 text-xs font-bold text-white backdrop-blur-xs hover:bg-white/25 transition-colors"
                    >
                      <Camera className="h-5 w-5 text-pink-200" />
                      Instagram
                    </a>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      {/* FOOTER */}
      <footer className="border-t border-indigo-950/80 bg-[#10132e] text-indigo-100">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-xs">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-teal-500 text-white shadow-sm">
              <Layers className="h-5 w-5" />
            </span>
            <div>
              <span className="font-bold text-white">PinjamAlat</span> · Layanan Peminjaman Alat Laboratorium & Multimedia
            </div>
          </div>
          <div className="flex items-center gap-5">
            <a
              href={`https://wa.me/${siteInfo.whatsapp.replace(/[^0-9]/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-indigo-200 hover:text-teal-300 transition-colors"
            >
              <MessageCircle className="h-4 w-4 text-emerald-400" /> WhatsApp Admin <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <a
              href={siteInfo.instagram}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-indigo-200 hover:text-pink-300 transition-colors"
            >
              <Camera className="h-4 w-4 text-pink-400" /> Instagram <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </footer>

      {/* PRODUCT DETAIL MODAL */}
      {detailProduct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetailProduct(null);
          }}
        >
          <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <button
              type="button"
              onClick={() => setDetailProduct(null)}
              aria-label="Tutup"
              className="absolute right-4 top-4 z-10 rounded-full bg-white/90 p-1.5 text-slate-700 shadow-xs hover:bg-white"
            >
              <X className="h-5 w-5" />
            </button>
            <img
              src={detailProduct.image}
              alt={detailProduct.name}
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.src = FALLBACK_IMAGE;
              }}
              className="h-60 w-full object-cover bg-slate-100"
            />
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-teal-700">
                    {detailProduct.category} · Kondisi {detailProduct.condition}
                  </p>
                  <h3 className="mt-1 text-xl font-bold text-slate-900">{detailProduct.name}</h3>
                </div>
                <span className="font-mono-tabular text-base font-bold text-slate-900 whitespace-nowrap">
                  {detailProduct.price > 0 ? `${formatRupiah(detailProduct.price)}/hr` : 'Konfirmasi Admin'}
                </span>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">{detailProduct.desc}</p>
              <div className="flex flex-wrap gap-6 border-t border-slate-100 pt-3 text-xs text-slate-500">
                <span>
                  Stok Tersedia: <strong className="text-slate-900 font-mono-tabular">{detailProduct.stock} unit</strong>
                </span>
                {detailProduct.purchase_range && (
                  <span>
                    Estimasi Nilai: <strong className="text-slate-900">{detailProduct.purchase_range}</strong>
                  </span>
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  disabled={detailProduct.stock <= 0}
                  onClick={() => {
                    addToCart(detailProduct);
                    setDetailProduct(null);
                  }}
                  className="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-300"
                >
                  {detailProduct.stock > 0 ? 'Tambah ke Keranjang' : 'Stok Habis'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedModel(detailProduct.model);
                    setDetailProduct(null);
                    document.getElementById('preview-3d')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Box className="h-4 w-4" /> Model 3D
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CART & CHECKOUT MODAL */}
      {cartOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-end bg-slate-950/65"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCartOpen(false);
          }}
        >
          <div className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h2 className="text-lg font-bold text-slate-900">Keranjang Peminjaman</h2>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {lastCreatedOrder ? (
                <div className="rounded-xl border border-teal-200 bg-teal-50 p-5 space-y-3">
                  <div className="flex items-center gap-2 text-teal-800">
                    <CheckCircle2 className="h-5 w-5" />
                    <h3 className="font-bold text-sm">Pengajuan Peminjaman Tercatat</h3>
                  </div>
                  <p className="text-xs text-teal-900">
                    Kode Pesanan: <strong className="font-mono-tabular">{lastCreatedOrder.order_code}</strong>
                  </p>
                  <p className="text-xs text-teal-900">
                    Total Terverifikasi Server:{' '}
                    <strong className="font-mono-tabular">
                      {lastCreatedOrder.price_needs_confirmation
                        ? 'Menunggu Konfirmasi Admin'
                        : formatRupiah(lastCreatedOrder.total_amount)}
                    </strong>
                  </p>
                  <a
                    href={buildWhatsappConfirmUrl(lastCreatedOrder)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-teal-800"
                  >
                    Konfirmasi via WhatsApp Admin <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              ) : cart.length === 0 ? (
                <div className="py-16 text-center text-sm text-slate-500">
                  Keranjang Anda masih kosong. Pilih peralatan dari katalog terlebih dahulu.
                </div>
              ) : (
                <>
                  <div className="divide-y divide-slate-100">
                    {cart.map((item) => (
                      <div key={item.product.id} className="py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900 truncate">{item.product.name}</p>
                          <p className="text-xs text-slate-500 font-mono-tabular">
                            {item.product.price > 0
                              ? `${formatRupiah(item.product.price)}/hr`
                              : 'Konfirmasi Admin'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => updateCartQty(item.product.id, -1)}
                            className="rounded border border-slate-200 p-1 hover:bg-slate-50"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-6 text-center text-xs font-mono-tabular font-semibold">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateCartQty(item.product.id, 1)}
                            className="rounded border border-slate-200 p-1 hover:bg-slate-50"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => updateCartQty(item.product.id, -item.quantity)}
                            className="ml-1 rounded p-1 text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <form onSubmit={handleCheckout} className="space-y-3 border-t border-slate-200 pt-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Detail Peminjam & Jadwal
                    </h3>
                    <input
                      type="text"
                      required
                      value={borrowName}
                      onChange={(e) => setBorrowName(e.target.value)}
                      placeholder="Nama Lengkap Peminjam"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                    <input
                      type="tel"
                      required
                      value={borrowPhone}
                      onChange={(e) => setBorrowPhone(e.target.value)}
                      placeholder="Nomor WhatsApp (08xxxxxxxxxx)"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono-tabular"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          <Calendar className="inline h-3 w-3 mr-1" /> Tanggal Mulai
                        </label>
                        <input
                          type="date"
                          required
                          min={new Date().toISOString().slice(0, 10)}
                          value={borrowDate}
                          onChange={(e) => setBorrowDate(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono-tabular"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">Durasi (Hari)</label>
                        <input
                          type="number"
                          min={1}
                          max={90}
                          required
                          value={borrowDays}
                          onChange={(e) => setBorrowDays(Math.max(1, Number(e.target.value) || 1))}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono-tabular"
                        />
                      </div>
                    </div>
                    <textarea
                      rows={2}
                      value={borrowNote}
                      onChange={(e) => setBorrowNote(e.target.value)}
                      placeholder="Catatan keperluan praktikum/acara (opsional)"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />

                    <div className="rounded-lg bg-slate-50 p-3 flex items-center justify-between text-xs">
                      <span className="text-slate-600">Estimasi Total ({borrowDays} hari)</span>
                      <span className="font-bold font-mono-tabular text-slate-900">
                        {hasUnpricedItems ? 'Dihitung + Konfirmasi Admin' : formatRupiah(estimatedSubtotal)}
                      </span>
                    </div>

                    <button
                      type="submit"
                      disabled={checkoutSubmitting}
                      className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {checkoutSubmitting
                        ? 'Memproses Transaksi...'
                        : user
                        ? 'Ajukan Peminjaman'
                        : 'Masuk & Ajukan Peminjaman'}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AUTH MODAL */}
      <AuthModal
        open={authModalOpen}
        needsBootstrap={needsBootstrap}
        initialMode={authInitialMode}
        onClose={() => setAuthModalOpen(false)}
        onAuthenticated={(authUser, flags) => {
          setUser(authUser);
          setNeedsBootstrap(false);
          setBorrowName((prev) => prev || authUser.fullName);
          setBorrowPhone((prev) => prev || authUser.phone);
          loadMyOrders();
          if (flags.suspiciousAlert) {
            showToast(flags.suspiciousAlert);
          } else if (flags.mfaSetupRequired) {
            setPage('security');
            showToast('Silakan aktifkan Authenticator MFA Anda terlebih dahulu.');
          } else {
            showToast(`Selamat datang kembali, ${authUser.fullName}.`);
          }
        }}
      />

      {/* TOAST NOTIFICATION */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-xs font-medium text-white shadow-lg">
          <AlertCircle className="h-4 w-4 text-teal-400 shrink-0" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

export default App;
