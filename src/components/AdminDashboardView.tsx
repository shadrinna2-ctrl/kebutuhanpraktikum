import React, { useCallback, useEffect, useState } from 'react';
import {
  ShieldAlert,
  Package,
  ClipboardList,
  Users,
  BarChart3,
  ShieldCheck,
  Settings,
  FileSearch,
  Plus,
  Pencil,
  Trash2,
  Download,
  Lock,
  UserPlus,
  X,
  Clock,
  Wallet,
} from 'lucide-react';
import { ApiError, apiRequest, formatRupiah } from '../api';
import type { AuditLogRow, Order, Product, SecurityEventRow, User, UserRole } from '../types';

interface AdminDashboardViewProps {
  user: User;
  onToast: (msg: string) => void;
  onProductsChanged: () => void;
  onNavigateSecurity: () => void;
}

type AdminTab =
  | 'overview'
  | 'products'
  | 'orders'
  | 'customers'
  | 'reports'
  | 'users'
  | 'security-config'
  | 'audit';

interface OverviewData {
  stats: {
    totalProducts: number;
    totalOrders: number;
    pendingOrders: number;
    completedRevenue: number;
  };
  recentOrders: Array<{
    id: number;
    order_code: string;
    customer_name: string;
    total_amount: number;
    price_needs_confirmation: number;
    status: string;
    created_at: string;
  }>;
  stockSummary: Array<{
    id: number;
    name: string;
    stock: number;
    category: string;
  }>;
}

interface CustomerSummary {
  id: number;
  username: string;
  full_name: string;
  phone: string;
  email: string;
  email_verified: number;
  is_active: number;
  order_count: number;
  total_spent: number;
}

interface ReportData {
  summary: {
    totalOrders: number;
    grossAmount: number;
    completedAmount: number;
    cancelledCount: number;
    averageAmount: number;
  };
  statusCounts: Array<{ status: string; cnt: number }>;
}

interface AdminUserRow {
  id: number;
  username: string;
  email: string;
  full_name: string;
  phone: string;
  role: UserRole;
  email_verified: number;
  is_active: number;
  mfa_enabled: number;
  last_login_at: string | null;
  last_login_ip: string | null;
  created_at: string;
}

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: 'Menunggu',
  confirmed: 'Dikonfirmasi',
  ongoing: 'Sedang Dipinjam',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
};

function sanitizeCsvCell(raw: unknown): string {
  let str = String(raw ?? '').replace(/"/g, '""');
  // Prevent CSV formula injection (=, +, -, @, tab, CR)
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  return `"${str}"`;
}

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({
  user,
  onToast,
  onProductsChanged,
  onNavigateSecurity,
}) => {
  const [tab, setTab] = useState<AdminTab>('overview');
  const [loading, setLoading] = useState(false);

  // Overview
  const [overview, setOverview] = useState<OverviewData | null>(null);

  // Products
  const [products, setProducts] = useState<Product[]>([]);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [pName, setPName] = useState('');
  const [pCategory, setPCategory] = useState('');
  const [pPrice, setPPrice] = useState('0');
  const [pPurchaseRange, setPPurchaseRange] = useState('');
  const [pStock, setPStock] = useState('1');
  const [pCondition, setPCondition] = useState<'Baik' | 'Sangat Baik' | 'Perlu Perawatan'>('Baik');
  const [pImage, setPImage] = useState('/src/assets/images/cat_electronics_lab_1795506640100.jpg');
  const [pDesc, setPDesc] = useState('');

  // Orders
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderSearch, setOrderSearch] = useState('');

  // Customers & Reports
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [report, setReport] = useState<ReportData | null>(null);

  // Superadmin states
  const [usersList, setUsersList] = useState<AdminUserRow[]>([]);
  const [newAdmUsername, setNewAdmUsername] = useState('');
  const [newAdmEmail, setNewAdmEmail] = useState('');
  const [newAdmFullName, setNewAdmFullName] = useState('');
  const [newAdmPhone, setNewAdmPhone] = useState('');
  const [newAdmPassword, setNewAdmPassword] = useState('');
  const [newAdmRole, setNewAdmRole] = useState<'admin' | 'superadmin'>('admin');

  const [secIdle, setSecIdle] = useState('30');
  const [secMaxH, setSecMaxH] = useState('12');
  const [secMinPw, setSecMinPw] = useState('12');
  const [secMaxAttempt, setSecMaxAttempt] = useState('5');
  const [adminWa, setAdminWa] = useState('6282164462480');
  const [adminIg, setAdminIg] = useState('https://www.instagram.com/shadrinna_/');

  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEventRow[]>([]);

  // Inline Re-Authentication Modal
  const [reauthAction, setReauthAction] = useState<{
    title: string;
    description: string;
    onConfirm: (currentPassword: string, totpCode: string) => Promise<void>;
  } | null>(null);
  const [reauthPw, setReauthPw] = useState('');
  const [reauthTotp, setReauthTotp] = useState('');
  const [reauthSubmitting, setReauthSubmitting] = useState(false);

  const loadTabData = useCallback(async () => {
    if (!user.mfaEnabled) return;
    setLoading(true);
    try {
      if (tab === 'overview') {
        const res = await apiRequest<OverviewData>('/api/admin/overview');
        setOverview(res);
      } else if (tab === 'products') {
        const res = await apiRequest<{ products: Product[] }>('/api/admin/products');
        setProducts(res.products);
      } else if (tab === 'orders') {
        const q = orderSearch.trim() ? `?search=${encodeURIComponent(orderSearch.trim())}` : '';
        const res = await apiRequest<{ orders: Order[] }>(`/api/admin/orders${q}`);
        setOrders(res.orders);
      } else if (tab === 'customers') {
        const res = await apiRequest<{ customers: CustomerSummary[] }>('/api/admin/customers');
        setCustomers(res.customers);
      } else if (tab === 'reports') {
        const [repRes, ordRes] = await Promise.all([
          apiRequest<ReportData>('/api/admin/reports'),
          apiRequest<{ orders: Order[] }>('/api/admin/orders'),
        ]);
        setReport(repRes);
        setOrders(ordRes.orders);
      } else if (tab === 'users' && user.role === 'superadmin') {
        const res = await apiRequest<{ users: AdminUserRow[] }>('/api/superadmin/users');
        setUsersList(res.users);
      } else if (tab === 'security-config' && user.role === 'superadmin') {
        const res = await apiRequest<{
          securityConfig: Record<string, string>;
          siteSettings: Record<string, string>;
        }>('/api/superadmin/security-config');
        setSecIdle(res.securityConfig.idle_timeout_minutes || '30');
        setSecMaxH(res.securityConfig.max_session_hours || '12');
        setSecMinPw(res.securityConfig.min_password_length || '12');
        setSecMaxAttempt(res.securityConfig.max_login_attempts || '5');
        setAdminWa(res.siteSettings.admin_wa || '6282164462480');
        setAdminIg(res.siteSettings.admin_ig || 'https://www.instagram.com/shadrinna_/');
      } else if (tab === 'audit' && user.role === 'superadmin') {
        const res = await apiRequest<{ auditLogs: AuditLogRow[]; securityEvents: SecurityEventRow[] }>(
          '/api/superadmin/audit-logs'
        );
        setAuditLogs(res.auditLogs);
        setSecurityEvents(res.securityEvents);
      }
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'Gagal memuat data dashboard.');
    } finally {
      setLoading(false);
    }
  }, [tab, orderSearch, user.mfaEnabled, user.role, onToast]);

  useEffect(() => {
    loadTabData();
  }, [loadTabData]);

  // Mandatory MFA gate for Admin / Superadmin
  if (!user.mfaEnabled) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-8 space-y-4">
          <div className="flex items-center gap-3 text-amber-900">
            <ShieldAlert className="h-7 w-7 text-amber-700" />
            <h1 className="text-xl font-bold">Aktivasi MFA Wajib Diperlukan</h1>
          </div>
          <p className="text-sm text-amber-900/90 leading-relaxed">
            Demi melindungi integritas katalog, transaksi peminjaman, dan data pengguna, seluruh akun{' '}
            <strong className="uppercase">{user.role}</strong> diwajibkan mengaktifkan autentikator TOTP (Multi-Factor Authentication) sebelum mengakses panel pengelolaan.
          </p>
          <button
            type="button"
            onClick={onNavigateSecurity}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <ShieldCheck className="h-4 w-4" /> Aktifkan MFA di Halaman Keamanan
          </button>
        </div>
      </div>
    );
  }

  const promptReauth = (
    title: string,
    description: string,
    onConfirm: (currentPassword: string, totpCode: string) => Promise<void>
  ) => {
    setReauthPw('');
    setReauthTotp('');
    setReauthAction({ title, description, onConfirm });
  };

  const handleReauthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reauthAction) return;
    setReauthSubmitting(true);
    try {
      await reauthAction.onConfirm(reauthPw, reauthTotp);
      setReauthAction(null);
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'Autentikasi ulang gagal.');
    } finally {
      setReauthSubmitting(false);
    }
  };

  const openAddProduct = () => {
    setEditingProduct(null);
    setPName('');
    setPCategory('Elektronika & IoT');
    setPPrice('25000');
    setPPurchaseRange('Rp500.000 - Rp1.000.000');
    setPStock('3');
    setPCondition('Baik');
    setPImage('/src/assets/images/cat_electronics_lab_1795506640100.jpg');
    setPDesc('');
    setProductModalOpen(true);
  };

  const openEditProduct = (p: Product) => {
    setEditingProduct(p);
    setPName(p.name);
    setPCategory(p.category);
    setPPrice(String(p.price));
    setPPurchaseRange(p.purchase_range);
    setPStock(String(p.stock));
    setPCondition(p.condition);
    setPImage(p.image);
    setPDesc(p.desc);
    setProductModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: pName,
        category: pCategory,
        price: Number(pPrice),
        purchaseRange: pPurchaseRange,
        stock: Number(pStock),
        condition: pCondition,
        image: pImage,
        desc: pDesc,
      };
      if (editingProduct) {
        const res = await apiRequest<{ message: string }>(`/api/admin/products/${editingProduct.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        onToast(res.message);
      } else {
        const res = await apiRequest<{ message: string }>('/api/admin/products', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onToast(res.message);
      }
      setProductModalOpen(false);
      onProductsChanged();
      await loadTabData();
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'Gagal menyimpan produk.');
    }
  };

  const handleDeleteProduct = (p: Product) => {
    promptReauth(
      `Nonaktifkan "${p.name}"?`,
      'Tindakan penghapusan/arsip produk memerlukan konfirmasi password dan kode TOTP Anda.',
      async (currentPassword, totpCode) => {
        const res = await apiRequest<{ message: string }>(`/api/admin/products/${p.id}`, {
          method: 'DELETE',
          body: JSON.stringify({ currentPassword, totpCode }),
        });
        onToast(res.message);
        onProductsChanged();
        await loadTabData();
      }
    );
  };

  const handleUpdateOrderStatus = async (orderId: number, status: string) => {
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      onToast(res.message);
      onProductsChanged();
      await loadTabData();
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'Gagal memperbarui status pesanan.');
    }
  };

  const handleExportCsv = () => {
    const header = ['Kode Pesanan', 'Peminjam', 'WhatsApp', 'Tanggal', 'Durasi (Hari)', 'Total', 'Status'];
    const rows = orders.map((o) =>
      [
        o.order_code,
        o.customer_name,
        o.customer_phone,
        o.borrow_date,
        o.borrow_days,
        o.total_amount,
        ORDER_STATUS_LABEL[o.status] || o.status,
      ]
        .map(sanitizeCsvCell)
        .join(',')
    );
    const csv = [header.map(sanitizeCsvCell).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `laporan-pinjamalat-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateAdmin = (e: React.FormEvent) => {
    e.preventDefault();
    promptReauth(
      `Buat Akun ${newAdmRole.toUpperCase()}`,
      `Membuat akun ${newAdmUsername} (${newAdmRole}) adalah tindakan sensitif dan dicatat di audit log.`,
      async (currentPassword, totpCode) => {
        const res = await apiRequest<{ message: string }>('/api/superadmin/admins', {
          method: 'POST',
          body: JSON.stringify({
            username: newAdmUsername,
            email: newAdmEmail,
            fullName: newAdmFullName,
            phone: newAdmPhone,
            password: newAdmPassword,
            role: newAdmRole,
            currentPassword,
            totpCode,
          }),
        });
        setNewAdmUsername('');
        setNewAdmEmail('');
        setNewAdmFullName('');
        setNewAdmPhone('');
        setNewAdmPassword('');
        onToast(res.message);
        await loadTabData();
      }
    );
  };

  const handleChangeUserRole = (u: AdminUserRow, nextRole: UserRole) => {
    if (nextRole === u.role) return;
    promptReauth(
      `Ubah Role ${u.username}`,
      `Role akan diubah dari ${u.role} menjadi ${nextRole}. Sesi aktif akun target akan dicabut otomatis.`,
      async (currentPassword, totpCode) => {
        const res = await apiRequest<{ message: string }>(`/api/superadmin/users/${u.id}/role`, {
          method: 'PATCH',
          body: JSON.stringify({ role: nextRole, currentPassword, totpCode }),
        });
        onToast(res.message);
        await loadTabData();
      }
    );
  };

  const handleToggleUserStatus = (u: AdminUserRow) => {
    const nextActive = !Boolean(u.is_active);
    promptReauth(
      `${nextActive ? 'Aktifkan' : 'Nonaktifkan'} Akun ${u.username}`,
      nextActive
        ? 'Akun akan diizinkan masuk kembali.'
        : 'Seluruh sesi aktif akun ini akan langsung dicabut.',
      async (currentPassword, totpCode) => {
        const res = await apiRequest<{ message: string }>(`/api/superadmin/users/${u.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: nextActive, currentPassword, totpCode }),
        });
        onToast(res.message);
        await loadTabData();
      }
    );
  };

  const handleSaveSecurityConfig = (e: React.FormEvent) => {
    e.preventDefault();
    promptReauth(
      'Simpan Konfigurasi Keamanan & Kontak',
      'Mengubah batas sesi, kebijakan sandi, atau kontak WhatsApp/Instagram admin membutuhkan autentikasi ulang.',
      async (currentPassword, totpCode) => {
        const res = await apiRequest<{ message: string }>('/api/superadmin/security-config', {
          method: 'PUT',
          body: JSON.stringify({
            idleTimeoutMinutes: Number(secIdle),
            maxSessionHours: Number(secMaxH),
            minPasswordLength: Number(secMinPw),
            maxLoginAttempts: Number(secMaxAttempt),
            adminWa,
            adminIg,
            currentPassword,
            totpCode,
          }),
        });
        onToast(res.message);
        onProductsChanged();
        await loadTabData();
      }
    );
  };

  const navItems: Array<{ id: AdminTab; label: string; icon: React.ReactNode; superOnly?: boolean }> = [
    { id: 'overview', label: 'Ringkasan', icon: <BarChart3 className="h-5 w-5" /> },
    { id: 'products', label: 'Produk', icon: <Package className="h-5 w-5" /> },
    { id: 'orders', label: 'Pesanan', icon: <ClipboardList className="h-5 w-5" /> },
    { id: 'customers', label: 'Pelanggan', icon: <Users className="h-5 w-5" /> },
    { id: 'reports', label: 'Laporan', icon: <Download className="h-5 w-5" /> },
    { id: 'users', label: 'Akun & RBAC', icon: <UserPlus className="h-5 w-5" />, superOnly: true },
    { id: 'security-config', label: 'Keamanan & Kontak', icon: <Settings className="h-5 w-5" />, superOnly: true },
    { id: 'audit', label: 'Audit Log', icon: <FileSearch className="h-5 w-5" />, superOnly: true },
  ];

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#10153a] via-[#251d5e] to-[#0e4959] p-6 md:p-7 text-white shadow-xl shadow-indigo-950/15 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-teal-400 text-white shadow-lg shadow-indigo-950/40">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-teal-300">
                Panel Pengelolaan · {user.role.toUpperCase()} (MFA Terverifikasi)
              </p>
              <h1 className="mt-0.5 text-2xl font-bold text-white">Dashboard Operasional PinjamAlat</h1>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {navItems
            .filter((item) => !item.superOnly || user.role === 'superadmin')
            .map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-all ${
                  tab === item.id
                    ? 'bg-gradient-to-r from-teal-500 to-cyan-500 text-white shadow-md shadow-cyan-950/30'
                    : 'border border-white/15 bg-white/10 text-indigo-100 hover:bg-white/20'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
        </div>
      </div>

      {loading && (
        <div className="h-32 animate-pulse rounded-2xl bg-indigo-100/70" />
      )}

      {/* OVERVIEW */}
      {tab === 'overview' && overview && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-white/95 p-5 shadow-xs">
              <div>
                <p className="text-xs font-medium text-slate-500">Total Alat Aktif</p>
                <p className="mt-2 text-2xl font-bold text-slate-900 font-mono-tabular">
                  {overview.stats.totalProducts}
                </p>
              </div>
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/25">
                <Package className="h-7 w-7" />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-white/95 p-5 shadow-xs">
              <div>
                <p className="text-xs font-medium text-slate-500">Total Transaksi</p>
                <p className="mt-2 text-2xl font-bold text-slate-900 font-mono-tabular">
                  {overview.stats.totalOrders}
                </p>
              </div>
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-600 text-white shadow-lg shadow-cyan-500/25">
                <ClipboardList className="h-7 w-7" />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-white/95 p-5 shadow-xs">
              <div>
                <p className="text-xs font-medium text-slate-500">Menunggu Konfirmasi</p>
                <p className="mt-2 text-2xl font-bold text-amber-700 font-mono-tabular">
                  {overview.stats.pendingOrders}
                </p>
              </div>
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/25">
                <Clock className="h-7 w-7" />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-white/95 p-5 shadow-xs">
              <div>
                <p className="text-xs font-medium text-slate-500">Pendapatan Selesai</p>
                <p className="mt-2 text-2xl font-bold text-teal-700 font-mono-tabular">
                  {formatRupiah(overview.stats.completedRevenue)}
                </p>
              </div>
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-teal-500/25">
                <Wallet className="h-7 w-7" />
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-bold text-slate-900 mb-3">Pesanan Terbaru</h2>
              {overview.recentOrders.length === 0 ? (
                <p className="text-xs text-slate-500">Belum ada transaksi masuk.</p>
              ) : (
                <div className="divide-y divide-slate-100 text-xs">
                  {overview.recentOrders.map((o) => (
                    <div key={o.id} className="py-2.5 flex items-center justify-between gap-2">
                      <div>
                        <span className="font-mono-tabular font-semibold text-slate-900">{o.order_code}</span>
                        <span className="mx-2 text-slate-300">·</span>
                        <span className="text-slate-700">{o.customer_name}</span>
                      </div>
                      <div className="text-right font-mono-tabular">
                        <span className="font-semibold text-slate-900">{formatRupiah(o.total_amount)}</span>
                        <span className="ml-2 text-slate-500">{ORDER_STATUS_LABEL[o.status] || o.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-bold text-slate-900 mb-3">Alat dengan Stok Terendah</h2>
              <div className="space-y-3">
                {overview.stockSummary.map((s) => (
                  <div key={s.id} className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="font-medium text-slate-800">{s.name}</span>
                      <span className="font-mono-tabular text-slate-600">Stok: {s.stock}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${s.stock <= 1 ? 'bg-amber-500' : 'bg-teal-600'}`}
                        style={{ width: `${Math.min(100, Math.max(8, s.stock * 18))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PRODUCTS */}
      {tab === 'products' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Kelola Katalog Peralatan ({products.length})</h2>
            <button
              type="button"
              onClick={openAddProduct}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-800"
            >
              <Plus className="h-4 w-4" /> Tambah Barang
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2.5 pr-4">Barang</th>
                  <th className="py-2.5 pr-4">Kategori</th>
                  <th className="py-2.5 pr-4">Harga/Hari</th>
                  <th className="py-2.5 pr-4">Stok</th>
                  <th className="py-2.5 pr-4">Kondisi</th>
                  <th className="py-2.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2.5 pr-4 font-semibold text-slate-900">{p.name}</td>
                    <td className="py-2.5 pr-4 text-slate-600">{p.category}</td>
                    <td className="py-2.5 pr-4 font-mono-tabular">
                      {p.price > 0 ? formatRupiah(p.price) : 'Konfirmasi Admin'}
                    </td>
                    <td className="py-2.5 pr-4 font-mono-tabular">{p.stock}</td>
                    <td className="py-2.5 pr-4 text-slate-600">{p.condition}</td>
                    <td className="py-2.5 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openEditProduct(p)}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 text-slate-700 hover:bg-slate-50"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteProduct(p)}
                        className="inline-flex items-center gap-1 rounded border border-red-200 px-2.5 py-1 text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-3 w-3" /> Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ORDERS */}
      {tab === 'orders' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-slate-900">Daftar Transaksi Peminjaman</h2>
            <input
              type="search"
              value={orderSearch}
              onChange={(e) => setOrderSearch(e.target.value)}
              placeholder="Cari kode pesanan, nama, atau WhatsApp..."
              className="w-full sm:w-72 rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2.5 pr-4">Kode</th>
                  <th className="py-2.5 pr-4">Peminjam</th>
                  <th className="py-2.5 pr-4">Barang</th>
                  <th className="py-2.5 pr-4">Jadwal</th>
                  <th className="py-2.5 pr-4">Total (Server)</th>
                  <th className="py-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="py-3 pr-4 font-mono-tabular font-semibold text-slate-900">{o.order_code}</td>
                    <td className="py-3 pr-4">
                      <span className="font-medium text-slate-900">{o.customer_name}</span>
                      <span className="block text-slate-500 font-mono-tabular">{o.customer_phone}</span>
                    </td>
                    <td className="py-3 pr-4 text-slate-700">
                      {o.items.map((it) => `${it.product_name} ×${it.quantity}`).join(', ')}
                    </td>
                    <td className="py-3 pr-4 font-mono-tabular text-slate-600">
                      {o.borrow_date} ({o.borrow_days} hr)
                    </td>
                    <td className="py-3 pr-4 font-mono-tabular font-semibold">
                      {o.price_needs_confirmation ? 'Perlu Konfirmasi' : formatRupiah(o.total_amount)}
                    </td>
                    <td className="py-3 text-right">
                      <select
                        value={o.status}
                        onChange={(e) => handleUpdateOrderStatus(o.id, e.target.value)}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs focus:border-teal-600 focus:outline-none"
                      >
                        {Object.entries(ORDER_STATUS_LABEL).map(([val, label]) => (
                          <option key={val} value={val}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CUSTOMERS */}
      {tab === 'customers' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <h2 className="text-base font-bold text-slate-900">Pelanggan Terdaftar</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2.5 pr-4">Nama / Username</th>
                  <th className="py-2.5 pr-4">Email</th>
                  <th className="py-2.5 pr-4">WhatsApp</th>
                  <th className="py-2.5 pr-4">Total Pesanan</th>
                  <th className="py-2.5 text-right">Total Transaksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2.5 pr-4">
                      <span className="font-semibold text-slate-900">{c.full_name}</span>
                      <span className="ml-2 text-slate-500">@{c.username}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-slate-700">{c.email}</td>
                    <td className="py-2.5 pr-4 font-mono-tabular">{c.phone}</td>
                    <td className="py-2.5 pr-4 font-mono-tabular">{c.order_count}</td>
                    <td className="py-2.5 text-right font-mono-tabular font-semibold">
                      {formatRupiah(c.total_spent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* REPORTS */}
      {tab === 'reports' && report && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-white/95 p-6 shadow-xs">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-teal-500 text-white shadow-md shadow-indigo-500/20">
                <BarChart3 className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Laporan Transaksi Peminjaman</h2>
                <p className="text-xs text-slate-500">
                  Seluruh total dihitung langsung dari tarif server untuk mencegah manipulasi nominal.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-teal-600 px-4 py-2.5 text-xs font-semibold text-white hover:from-indigo-500 hover:to-teal-500 shadow-xs"
            >
              <Download className="h-5 w-5" /> Ekspor CSV Aman
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-white/95 p-5 shadow-xs">
              <div>
                <span className="text-xs text-slate-500">Total Nilai Transaksi</span>
                <p className="mt-1.5 text-xl font-bold font-mono-tabular">{formatRupiah(report.summary.grossAmount)}</p>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20">
                <BarChart3 className="h-6 w-6" />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-white/95 p-5 shadow-xs">
              <div>
                <span className="text-xs text-slate-500">Pendapatan Selesai</span>
                <p className="mt-1.5 text-xl font-bold text-teal-700 font-mono-tabular">
                  {formatRupiah(report.summary.completedAmount)}
                </p>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-teal-500/20">
                <Wallet className="h-6 w-6" />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-white/95 p-5 shadow-xs">
              <div>
                <span className="text-xs text-slate-500">Rata-rata Per Transaksi</span>
                <p className="mt-1.5 text-xl font-bold font-mono-tabular">{formatRupiah(report.summary.averageAmount)}</p>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-600 text-white shadow-md shadow-cyan-500/20">
                <ClipboardList className="h-6 w-6" />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-white/95 p-5 shadow-xs">
              <div>
                <span className="text-xs text-slate-500">Pesanan Dibatalkan</span>
                <p className="mt-1.5 text-xl font-bold text-rose-600 font-mono-tabular">{report.summary.cancelledCount}</p>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 text-white shadow-md shadow-rose-500/20">
                <ShieldAlert className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUPERADMIN: USERS & RBAC */}
      {tab === 'users' && user.role === 'superadmin' && (
        <div className="grid gap-6 lg:grid-cols-12">
          <form onSubmit={handleCreateAdmin} className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h2 className="text-sm font-bold text-slate-900">Tambah Admin / Superadmin</h2>
            <p className="text-xs text-slate-500">
              Akun admin baru wajib mengaktifkan TOTP Authenticator pada login pertama. Memerlukan re-auth.
            </p>
            <input
              type="text"
              required
              value={newAdmUsername}
              onChange={(e) => setNewAdmUsername(e.target.value)}
              placeholder="Username"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
            <input
              type="text"
              required
              value={newAdmFullName}
              onChange={(e) => setNewAdmFullName(e.target.value)}
              placeholder="Nama Lengkap"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
            <input
              type="email"
              required
              value={newAdmEmail}
              onChange={(e) => setNewAdmEmail(e.target.value)}
              placeholder="Email"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
            <input
              type="tel"
              required
              value={newAdmPhone}
              onChange={(e) => setNewAdmPhone(e.target.value)}
              placeholder="Nomor WhatsApp"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
            <input
              type="password"
              required
              minLength={12}
              value={newAdmPassword}
              onChange={(e) => setNewAdmPassword(e.target.value)}
              placeholder="Password awal (min. 12 karakter)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
            <select
              value={newAdmRole}
              onChange={(e) => setNewAdmRole(e.target.value as 'admin' | 'superadmin')}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
            >
              <option value="admin">Admin</option>
              <option value="superadmin">Superadmin</option>
            </select>
            <button
              type="submit"
              className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Buat Akun Istimewa
            </button>
          </form>

          <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white p-5 overflow-x-auto">
            <h2 className="text-sm font-bold text-slate-900 mb-3">Manajemen Akun & Hak Akses</h2>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3">Akun</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">MFA</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 text-right">Kontrol</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usersList.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2.5 pr-3">
                      <span className="font-semibold text-slate-900">{u.full_name}</span>
                      <span className="block text-slate-500">@{u.username} · {u.email}</span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <select
                        value={u.role}
                        disabled={u.id === user.id}
                        onChange={(e) => handleChangeUserRole(u, e.target.value as UserRole)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
                      >
                        <option value="customer">customer</option>
                        <option value="admin">admin</option>
                        <option value="superadmin">superadmin</option>
                      </select>
                    </td>
                    <td className="py-2.5 pr-3">{u.mfa_enabled ? 'Aktif' : 'Belum'}</td>
                    <td className="py-2.5 pr-3">{u.is_active ? 'Aktif' : 'Nonaktif'}</td>
                    <td className="py-2.5 text-right">
                      {u.id !== user.id && (
                        <button
                          type="button"
                          onClick={() => handleToggleUserStatus(u)}
                          className="rounded border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50"
                        >
                          {u.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUPERADMIN: SECURITY CONFIG & WHATSAPP/IG */}
      {tab === 'security-config' && user.role === 'superadmin' && (
        <form onSubmit={handleSaveSecurityConfig} className="rounded-xl border border-slate-200 bg-white p-6 space-y-5 max-w-2xl">
          <div>
            <h2 className="text-base font-bold text-slate-900">Kebijakan Keamanan & Kontak Resmi</h2>
            <p className="text-xs text-slate-500 mt-1">
              Seluruh perubahan memerlukan autentikasi ulang dan dicatat di audit log.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Batas Idle Sesi (Menit)</label>
              <input
                type="number"
                min={5}
                max={240}
                value={secIdle}
                onChange={(e) => setSecIdle(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Masa Berlaku Maks. Sesi (Jam)</label>
              <input
                type="number"
                min={1}
                max={168}
                value={secMaxH}
                onChange={(e) => setSecMaxH(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Panjang Minimal Password</label>
              <input
                type="number"
                min={12}
                max={32}
                value={secMinPw}
                onChange={(e) => setSecMinPw(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Ambang Tantangan Login Gagal</label>
              <input
                type="number"
                min={3}
                max={15}
                value={secMaxAttempt}
                onChange={(e) => setSecMaxAttempt(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Nomor WhatsApp Admin</label>
              <input
                type="text"
                required
                value={adminWa}
                onChange={(e) => setAdminWa(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">URL Instagram Admin</label>
              <input
                type="url"
                required
                value={adminIg}
                onChange={(e) => setAdminIg(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-xs font-semibold text-white hover:bg-slate-800"
          >
            <Lock className="h-4 w-4" /> Simpan Konfigurasi (Butuh Re-Auth)
          </button>
        </form>
      )}

      {/* SUPERADMIN: AUDIT LOG & SECURITY EVENTS */}
      {tab === 'audit' && user.role === 'superadmin' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-bold text-slate-900 mb-3">
              Deteksi Anomali & Percobaan SQL Injection ({securityEvents.length})
            </h2>
            <div className="overflow-x-auto max-h-80">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3">Waktu</th>
                    <th className="py-2 pr-3">Tipe Kejadian</th>
                    <th className="py-2 pr-3">Keparahan</th>
                    <th className="py-2 pr-3">IP & Endpoint</th>
                    <th className="py-2">Ringkasan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {securityEvents.map((ev) => (
                    <tr key={ev.id}>
                      <td className="py-2 pr-3 font-mono-tabular text-slate-500">
                        {new Date(ev.created_at).toLocaleString('id-ID')}
                      </td>
                      <td className="py-2 pr-3 font-semibold text-slate-900">{ev.event_type}</td>
                      <td className="py-2 pr-3 uppercase font-semibold text-amber-700">{ev.severity}</td>
                      <td className="py-2 pr-3 font-mono-tabular text-slate-600">
                        {ev.ip_address} · {ev.method} {ev.path}
                      </td>
                      <td className="py-2 text-slate-700">{ev.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-bold text-slate-900 mb-3">
              Audit Log Tindakan Penting ({auditLogs.length})
            </h2>
            <div className="overflow-x-auto max-h-80">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3">Waktu</th>
                    <th className="py-2 pr-3">Aktor</th>
                    <th className="py-2 pr-3">Aksi</th>
                    <th className="py-2 pr-3">Target</th>
                    <th className="py-2">Detail (Tersanitasi)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="py-2 pr-3 font-mono-tabular text-slate-500">
                        {new Date(log.created_at).toLocaleString('id-ID')}
                      </td>
                      <td className="py-2 pr-3">
                        {log.actor_username || 'sistem'} ({log.actor_role})
                      </td>
                      <td className="py-2 pr-3 font-semibold text-slate-900">{log.action}</td>
                      <td className="py-2 pr-3 font-mono-tabular text-slate-600">
                        {log.target_type} #{log.target_id || '-'}
                      </td>
                      <td className="py-2 font-mono-tabular text-slate-600 max-w-md truncate">
                        {log.details_json}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* PRODUCT ADD/EDIT MODAL */}
      {productModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setProductModalOpen(false);
          }}
        >
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <button
              type="button"
              onClick={() => setProductModalOpen(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-bold text-slate-900 mb-4">
              {editingProduct ? 'Edit Data Barang' : 'Tambah Barang Baru'}
            </h3>
            <form onSubmit={handleSaveProduct} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  value={pName}
                  onChange={(e) => setPName(e.target.value)}
                  placeholder="Nama barang"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
                <input
                  type="text"
                  required
                  value={pCategory}
                  onChange={(e) => setPCategory(e.target.value)}
                  placeholder="Kategori"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <input
                  type="number"
                  min={0}
                  required
                  value={pPrice}
                  onChange={(e) => setPPrice(e.target.value)}
                  placeholder="Harga sewa/hari"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono-tabular"
                />
                <input
                  type="number"
                  min={0}
                  required
                  value={pStock}
                  onChange={(e) => setPStock(e.target.value)}
                  placeholder="Stok"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono-tabular"
                />
                <select
                  value={pCondition}
                  onChange={(e) => setPCondition(e.target.value as 'Baik' | 'Sangat Baik' | 'Perlu Perawatan')}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs"
                >
                  <option value="Baik">Baik</option>
                  <option value="Sangat Baik">Sangat Baik</option>
                  <option value="Perlu Perawatan">Perlu Perawatan</option>
                </select>
              </div>
              <input
                type="text"
                value={pPurchaseRange}
                onChange={(e) => setPPurchaseRange(e.target.value)}
                placeholder="Estimasi nilai barang (mis. Rp1.500.000)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
              <input
                type="text"
                value={pImage}
                onChange={(e) => setPImage(e.target.value)}
                placeholder="Path gambar lokal atau URL HTTPS"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
              <textarea
                rows={3}
                value={pDesc}
                onChange={(e) => setPDesc(e.target.value)}
                placeholder="Deskripsi spesifikasi peralatan"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setProductModalOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  Simpan Barang
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INLINE RE-AUTHENTICATION MODAL */}
      {reauthAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setReauthAction(null);
          }}
        >
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <button
              type="button"
              onClick={() => setReauthAction(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </button>
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
              Autentikasi Ulang Diperlukan
            </p>
            <h3 className="mt-1 text-lg font-bold text-slate-900">{reauthAction.title}</h3>
            <p className="mt-2 text-xs text-slate-600 leading-relaxed">{reauthAction.description}</p>
            <form onSubmit={handleReauthSubmit} className="mt-4 space-y-3">
              <input
                type="password"
                required
                autoFocus
                value={reauthPw}
                onChange={(e) => setReauthPw(e.target.value)}
                placeholder="Password Anda saat ini"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {user.mfaEnabled && (
                <input
                  type="text"
                  required
                  value={reauthTotp}
                  onChange={(e) => setReauthTotp(e.target.value)}
                  placeholder="Kode TOTP 6 digit"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono-tabular"
                />
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReauthAction(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={reauthSubmitting}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {reauthSubmitting ? 'Memverifikasi...' : 'Konfirmasi & Jalankan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
