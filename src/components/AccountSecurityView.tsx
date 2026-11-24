import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Smartphone,
  KeyRound,
  LogOut,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Trash2,
  MailCheck,
  Clock,
  MonitorCheck,
  History,
} from 'lucide-react';
import { ApiError, apiRequest } from '../api';
import type { ActiveSession, LoginHistoryRow, MfaDevice, SecurityEventRow, User } from '../types';

interface AccountSecurityViewProps {
  user: User;
  onRefreshUser: () => Promise<void>;
  onToast: (msg: string) => void;
}

interface SecurityOverviewResponse {
  accountStatus: {
    emailVerified: boolean;
    mfaEnabled: boolean;
    mfaMandatory: boolean;
    lastLoginAt: string | null;
    lastLoginIp: string | null;
    approxLocation: string;
    activeSessionsCount: number;
    unusedRecoveryCodes: number;
  };
  sessions: ActiveSession[];
  loginHistory: LoginHistoryRow[];
  mfaDevices: MfaDevice[];
  alerts: SecurityEventRow[];
}

export const AccountSecurityView: React.FC<AccountSecurityViewProps> = ({
  user,
  onRefreshUser,
  onToast,
}) => {
  const [data, setData] = useState<SecurityOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Profile form
  const [fullName, setFullName] = useState(user.fullName);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone);
  const [profilePw, setProfilePw] = useState('');
  const [profileTotp, setProfileTotp] = useState('');

  // Change Password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwTotp, setPwTotp] = useState('');

  // MFA Setup state
  const [mfaSetup, setMfaSetup] = useState<{
    deviceId: number;
    label: string;
    secretManual: string;
    qrDataUrl: string;
  } | null>(null);
  const [mfaLabel, setMfaLabel] = useState('Authenticator Utama');
  const [mfaConfirmCode, setMfaConfirmCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [regenPw, setRegenPw] = useState('');
  const [regenTotp, setRegenTotp] = useState('');

  const loadSecurity = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest<SecurityOverviewResponse>('/api/account/security');
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat status keamanan.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSecurity();
  }, []);

  const handleVerifyEmailDemo = async () => {
    try {
      const res = await apiRequest<{ message: string }>('/api/account/verify-email-confirm', {
        method: 'POST',
      });
      onToast(res.message);
      await onRefreshUser();
      await loadSecurity();
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'Gagal memverifikasi email.');
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ message: string }>('/api/account/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          fullName,
          email,
          phone,
          currentPassword: profilePw,
          totpCode: profileTotp,
        }),
      });
      setProfilePw('');
      setProfileTotp('');
      onToast(res.message);
      await onRefreshUser();
      await loadSecurity();
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'Gagal memperbarui profil.');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ message: string }>('/api/account/password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword,
          newPassword,
          totpCode: pwTotp,
        }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setPwTotp('');
      onToast(res.message);
      await loadSecurity();
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'Gagal mengubah password.');
    }
  };

  const handleStartMfaSetup = async () => {
    try {
      const res = await apiRequest<{
        deviceId: number;
        label: string;
        secretManual: string;
        qrDataUrl: string;
      }>('/api/account/mfa/setup', {
        method: 'POST',
        body: JSON.stringify({ label: mfaLabel }),
      });
      setMfaSetup(res);
      setMfaConfirmCode('');
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'Gagal memulai setup MFA.');
    }
  };

  const handleConfirmMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaSetup) return;
    try {
      const res = await apiRequest<{ message: string; recoveryCodes: string[] | null }>(
        '/api/account/mfa/confirm',
        {
          method: 'POST',
          body: JSON.stringify({ deviceId: mfaSetup.deviceId, code: mfaConfirmCode }),
        }
      );
      setMfaSetup(null);
      setMfaConfirmCode('');
      if (res.recoveryCodes) {
        setRecoveryCodes(res.recoveryCodes);
      }
      onToast(res.message);
      await onRefreshUser();
      await loadSecurity();
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'Kode TOTP tidak valid.');
    }
  };

  const handleRegenRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ recoveryCodes: string[] }>(
        '/api/account/mfa/recovery-codes/regenerate',
        {
          method: 'POST',
          body: JSON.stringify({ currentPassword: regenPw, totpCode: regenTotp }),
        }
      );
      setRecoveryCodes(res.recoveryCodes);
      setRegenPw('');
      setRegenTotp('');
      onToast('Recovery codes baru telah dibuat. Simpan di tempat aman.');
      await loadSecurity();
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'Gagal membuat ulang recovery codes.');
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      const res = await apiRequest<{ message: string }>(`/api/account/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      onToast(res.message);
      await loadSecurity();
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'Gagal mencabut sesi.');
    }
  };

  const handleRevokeOtherSessions = async () => {
    try {
      const res = await apiRequest<{ message: string }>('/api/account/sessions/revoke-others', {
        method: 'POST',
      });
      onToast(res.message);
      await loadSecurity();
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'Gagal mencabut sesi lain.');
    }
  };

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="h-48 animate-pulse rounded-xl bg-slate-200" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#121842] via-[#251f63] to-[#0e4b5c] p-6 md:p-8 text-white shadow-xl shadow-indigo-950/15">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-5">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-indigo-500 text-white shadow-lg shadow-indigo-950/40">
              <ShieldCheck className="h-8 w-8" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-teal-300">
                Keamanan Akun & Identitas
              </p>
              <h1 className="mt-1 text-2xl font-bold text-white">
                Pusat Keamanan {user.fullName}
              </h1>
              <p className="mt-1 text-sm text-indigo-200">
                Peran: <span className="font-semibold text-white uppercase">{user.role}</span> ·{' '}
                <span>{user.email}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadSecurity}
            className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 py-2.5 text-xs font-semibold text-white backdrop-blur-xs hover:bg-white/20 transition-colors"
          >
            <RefreshCw className="h-4 w-4 text-cyan-300" /> Muat Ulang Status
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Mandatory MFA warning banner for Admin / Superadmin */}
          {data.accountStatus.mfaMandatory && !data.accountStatus.mfaEnabled && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-amber-700" />
              <div className="text-sm">
                <p className="font-semibold">Wajib Aktivasi MFA Authenticator</p>
                <p className="mt-1 text-xs text-amber-800">
                  Akun dengan peran {user.role.toUpperCase()} wajib mengaktifkan TOTP MFA di bawah sebelum dapat membuka Dashboard Admin/Superadmin.
                </p>
              </div>
            </div>
          )}

          {/* Account Security Status Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-indigo-100 bg-white/95 p-5 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-xs font-medium text-slate-500">Verifikasi Email</span>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">
                      {data.accountStatus.emailVerified ? 'Terverifikasi' : 'Belum Terverifikasi'}
                    </span>
                    {data.accountStatus.emailVerified && <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                  </div>
                </div>
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-teal-500/20">
                  <MailCheck className="h-6 w-6" />
                </div>
              </div>
              {!data.accountStatus.emailVerified && (
                <button
                  type="button"
                  onClick={handleVerifyEmailDemo}
                  className="mt-3 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:from-teal-500 hover:to-emerald-500"
                >
                  Verifikasi Sekarang
                </button>
              )}
            </div>

            <div className="rounded-2xl border border-indigo-100 bg-white/95 p-5 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-xs font-medium text-slate-500">MFA Authenticator</span>
                  <p className="mt-2 text-sm font-bold text-slate-900">
                    {data.accountStatus.mfaEnabled ? 'Aktif (TOTP)' : 'Nonaktif'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 font-mono-tabular">
                    Recovery code: {data.accountStatus.unusedRecoveryCodes}
                  </p>
                </div>
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20">
                  <Smartphone className="h-6 w-6" />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-indigo-100 bg-white/95 p-5 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-xs font-medium text-slate-500">Login Terakhir</span>
                  <p className="mt-2 text-xs font-bold text-slate-900 font-mono-tabular">
                    {data.accountStatus.lastLoginAt
                      ? new Date(data.accountStatus.lastLoginAt).toLocaleString('id-ID')
                      : '-'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 truncate">
                    {data.accountStatus.lastLoginIp || '-'} · {data.accountStatus.approxLocation}
                  </p>
                </div>
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-600 text-white shadow-md shadow-cyan-500/20">
                  <Clock className="h-6 w-6" />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-indigo-100 bg-white/95 p-5 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-xs font-medium text-slate-500">Sesi Perangkat Aktif</span>
                  <p className="mt-2 text-2xl font-bold text-slate-900 font-mono-tabular">
                    {data.accountStatus.activeSessionsCount}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">HttpOnly · Argon2id</p>
                </div>
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-rose-500 text-white shadow-md shadow-rose-500/20">
                  <MonitorCheck className="h-6 w-6" />
                </div>
              </div>
            </div>
          </div>

          {/* Suspicious Activity Notifications */}
          {data.alerts.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 shadow-xs">
              <h2 className="text-sm font-bold text-amber-950 mb-3">
                Notifikasi Aktivitas Keamanan Terbaru
              </h2>
              <div className="divide-y divide-amber-200/70">
                {data.alerts.map((a) => (
                  <div key={a.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-semibold text-amber-800">{a.event_type}</span>
                      <span className="mx-2 text-amber-400">·</span>
                      <span className="text-slate-700">{a.summary}</span>
                    </div>
                    <span className="font-mono-tabular text-slate-500">
                      {a.ip_address} · {new Date(a.created_at).toLocaleString('id-ID')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MFA Setup & Recovery Codes */}
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-indigo-100 bg-white/95 p-6 space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20">
                    <Smartphone className="h-6 w-6" />
                  </div>
                  <h2 className="text-base font-bold text-slate-900">
                    Multi-Factor Authentication (TOTP)
                  </h2>
                </div>
                <span className="text-xs font-semibold text-indigo-700">
                  {data.accountStatus.mfaEnabled ? 'Aktif' : 'Belum Aktif'}
                </span>
              </div>

              {!mfaSetup ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Lindungi akun Anda dengan aplikasi Authenticator (Google Authenticator / Authy / 1Password). Wajib bagi Admin dan Superadmin.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={mfaLabel}
                      onChange={(e) => setMfaLabel(e.target.value)}
                      placeholder="Label perangkat (mis. Ponsel Utama)"
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleStartMfaSetup}
                      className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 whitespace-nowrap"
                    >
                      + Tambah Authenticator
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleConfirmMfa} className="space-y-4 border-t border-slate-100 pt-4">
                  <div className="flex flex-col sm:flex-row gap-4 items-center">
                    <img
                      src={mfaSetup.qrDataUrl}
                      alt="QR Code TOTP"
                      className="h-36 w-36 rounded-lg border border-slate-200 p-1 bg-white"
                    />
                    <div className="space-y-2 text-xs">
                      <p className="font-semibold text-slate-900">
                        1. Pindai QR Code di aplikasi Authenticator Anda
                      </p>
                      <p className="text-slate-600">Atau masukkan kunci manual berikut:</p>
                      <code className="block rounded-md bg-slate-100 px-2.5 py-1.5 font-mono-tabular text-xs text-slate-900 break-all">
                        {mfaSetup.secretManual}
                      </code>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={mfaConfirmCode}
                      onChange={(e) => setMfaConfirmCode(e.target.value)}
                      placeholder="Masukkan 6 digit kode TOTP"
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono-tabular focus:border-teal-600 focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                    >
                      Aktifkan MFA
                    </button>
                    <button
                      type="button"
                      onClick={() => setMfaSetup(null)}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      Batal
                    </button>
                  </div>
                </form>
              )}

              {recoveryCodes && (
                <div className="rounded-lg border border-teal-200 bg-teal-50 p-4 space-y-2">
                  <p className="text-xs font-bold text-teal-900">
                    Simpan Recovery Codes (Ditampilkan Sekali Saja)
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {recoveryCodes.map((code) => (
                      <code
                        key={code}
                        className="rounded bg-white px-2 py-1 text-center font-mono-tabular text-xs font-semibold text-slate-900 border border-teal-200"
                      >
                        {code}
                      </code>
                    ))}
                  </div>
                </div>
              )}

              {data.mfaDevices.length > 0 && (
                <div className="border-t border-slate-100 pt-3">
                  <p className="text-xs font-semibold text-slate-700 mb-2">Perangkat Terdaftar</p>
                  <div className="space-y-2">
                    {data.mfaDevices.map((d) => (
                      <div key={d.id} className="flex items-center justify-between text-xs text-slate-700">
                        <span>
                          {d.label} · {d.verified ? 'Terverifikasi' : 'Menunggu'}
                        </span>
                        <span className="font-mono-tabular text-slate-500">
                          {new Date(d.created_at).toLocaleDateString('id-ID')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.accountStatus.mfaEnabled && (
                <form onSubmit={handleRegenRecovery} className="border-t border-slate-100 pt-4 space-y-2">
                  <p className="text-xs font-semibold text-slate-700">Buat Ulang Recovery Codes (Butuh Re-Auth)</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="password"
                      required
                      value={regenPw}
                      onChange={(e) => setRegenPw(e.target.value)}
                      placeholder="Password saat ini"
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
                    />
                    <input
                      type="text"
                      required
                      value={regenTotp}
                      onChange={(e) => setRegenTotp(e.target.value)}
                      placeholder="Kode TOTP 6 digit"
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono-tabular focus:border-teal-600 focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Regenerasi 8 Recovery Codes
                  </button>
                </form>
              )}
            </div>

            {/* Password & Profile with Re-Auth */}
            <div className="space-y-6">
              <form onSubmit={handleChangePassword} className="rounded-2xl border border-indigo-100 bg-white/95 p-6 space-y-3.5 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-md shadow-teal-500/20">
                    <KeyRound className="h-6 w-6" />
                  </div>
                  <h2 className="text-base font-bold text-slate-900">Ganti Password (Argon2id)</h2>
                </div>
                <p className="text-xs text-slate-600">
                  Memerlukan autentikasi ulang. Semua sesi pada perangkat lain akan dicabut otomatis setelah password diubah.
                </p>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Password saat ini"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
                <input
                  type="password"
                  required
                  minLength={12}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Password baru (min. 12 karakter)"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
                {user.mfaEnabled && (
                  <input
                    type="text"
                    required
                    value={pwTotp}
                    onChange={(e) => setPwTotp(e.target.value)}
                    placeholder="Kode TOTP 6 digit (Wajib)"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono-tabular focus:border-teal-600 focus:outline-none"
                  />
                )}
                <button
                  type="submit"
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-teal-600 px-4 py-2.5 text-xs font-semibold text-white hover:from-indigo-500 hover:to-teal-500 shadow-xs"
                >
                  Simpan Password Baru
                </button>
              </form>

              <form onSubmit={handleUpdateProfile} className="rounded-2xl border border-indigo-100 bg-white/95 p-6 space-y-3 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-md shadow-indigo-500/20">
                    <ShieldCheck className="h-6 w-6" />
                  </div>
                  <h2 className="text-base font-bold text-slate-900">Perbarui Profil (Butuh Re-Auth)</h2>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Nama Lengkap"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Nomor WhatsApp"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="password"
                    required
                    value={profilePw}
                    onChange={(e) => setProfilePw(e.target.value)}
                    placeholder="Password konfirmasi"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  />
                  {user.mfaEnabled && (
                    <input
                      type="text"
                      required
                      value={profileTotp}
                      onChange={(e) => setProfileTotp(e.target.value)}
                      placeholder="Kode TOTP 6 digit"
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono-tabular focus:border-teal-600 focus:outline-none"
                    />
                  )}
                </div>
                <button
                  type="submit"
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Simpan Profil
                </button>
              </form>
            </div>
          </div>

          {/* Active Devices / Sessions */}
          <div className="rounded-2xl border border-indigo-100 bg-white/95 p-6 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-rose-500 text-white shadow-md shadow-rose-500/20">
                  <MonitorCheck className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Perangkat & Sesi Aktif</h2>
                  <p className="text-xs text-slate-500">
                    Kelola seluruh sesi yang sedang masuk ke akun Anda.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleRevokeOtherSessions}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
              >
                <LogOut className="h-4 w-4" /> Keluar dari Perangkat Lain
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 pr-4">Sesi</th>
                    <th className="py-2.5 pr-4">IP & Lokasi</th>
                    <th className="py-2.5 pr-4">Perangkat (User-Agent)</th>
                    <th className="py-2.5 pr-4">Aktivitas Terakhir</th>
                    <th className="py-2.5 text-right">Tindakan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.sessions.map((s) => (
                    <tr key={s.id}>
                      <td className="py-3 pr-4 font-mono-tabular">
                        {s.idPrefix}… {s.isCurrent && <span className="font-sans font-semibold text-teal-700">(Sesi ini)</span>}
                      </td>
                      <td className="py-3 pr-4">
                        <span className="font-mono-tabular">{s.ipAddress}</span>
                        <span className="block text-slate-500">{s.approxLocation}</span>
                      </td>
                      <td className="py-3 pr-4 max-w-xs truncate text-slate-600">{s.userAgent}</td>
                      <td className="py-3 pr-4 font-mono-tabular text-slate-600">
                        {new Date(s.lastActivityAt).toLocaleString('id-ID')}
                      </td>
                      <td className="py-3 text-right">
                        {!s.isCurrent && (
                          <button
                            type="button"
                            onClick={() => handleRevokeSession(s.id)}
                            className="inline-flex items-center gap-1 rounded border border-red-200 px-2.5 py-1 text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-3 w-3" /> Cabut
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Login History */}
          <div className="rounded-2xl border border-indigo-100 bg-white/95 p-6 shadow-xs">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/20">
                <History className="h-6 w-6" />
              </div>
              <h2 className="text-base font-bold text-slate-900">Riwayat Login Terbaru</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 pr-4">Waktu</th>
                    <th className="py-2.5 pr-4">Status</th>
                    <th className="py-2.5 pr-4">Alamat IP</th>
                    <th className="py-2.5 pr-4">Perkiraan Lokasi</th>
                    <th className="py-2.5">Keterangan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.loginHistory.map((row) => (
                    <tr key={row.id}>
                      <td className="py-2.5 pr-4 font-mono-tabular text-slate-700">
                        {new Date(row.created_at).toLocaleString('id-ID')}
                      </td>
                      <td className="py-2.5 pr-4 font-semibold">
                        <span className={row.success ? 'text-emerald-700' : 'text-red-700'}>
                          {row.success ? 'Berhasil' : 'Gagal'}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 font-mono-tabular">{row.ip_address}</td>
                      <td className="py-2.5 pr-4 text-slate-600">{row.approx_location}</td>
                      <td className="py-2.5 text-slate-600">
                        {row.suspicious ? 'Aktivitas Mencurigakan · ' : ''}
                        {row.failure_reason || 'Autentikasi normal'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
