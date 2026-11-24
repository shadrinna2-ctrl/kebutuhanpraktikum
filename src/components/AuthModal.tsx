import React, { useState } from 'react';
import { X, ShieldCheck, KeyRound, Mail, UserPlus, AlertTriangle } from 'lucide-react';
import { ApiError, apiRequest } from '../api';
import type { AdaptiveChallenge, User } from '../types';

type AuthMode = 'login' | 'register' | 'mfa' | 'forgot' | 'reset' | 'bootstrap';

interface AuthModalProps {
  open: boolean;
  needsBootstrap: boolean;
  initialMode?: AuthMode;
  onClose: () => void;
  onAuthenticated: (user: User, flags: { mfaSetupRequired?: boolean; suspiciousAlert?: string | null }) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  open,
  needsBootstrap,
  initialMode = 'login',
  onClose,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<AuthMode>(needsBootstrap ? 'bootstrap' : initialMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // Login fields
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<AdaptiveChallenge | null>(null);
  const [challengeAnswer, setChallengeAnswer] = useState('');

  // MFA fields
  const [mfaCode, setMfaCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);

  // Register / Bootstrap fields
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');

  // Forgot / Reset fields
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');

  if (!open) return null;

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError('');
    setInfo('');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const res = await apiRequest<{
        mfaRequired?: boolean;
        mfaSetupRequired?: boolean;
        suspiciousAlert?: string | null;
        message?: string;
        user: User;
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          identifier,
          password,
          challengeId: challenge?.challengeId,
          challengeAnswer: challenge ? challengeAnswer : undefined,
        }),
      });

      if (res.mfaRequired) {
        setMode('mfa');
        setInfo(res.message || 'Masukkan kode Authenticator 6 digit.');
      } else {
        onAuthenticated(res.user, {
          mfaSetupRequired: res.mfaSetupRequired,
          suspiciousAlert: res.suspiciousAlert,
        });
        onClose();
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.data?.requiresChallenge && err.data?.challenge) {
          setChallenge(err.data.challenge as AdaptiveChallenge);
          setChallengeAnswer('');
        }
      } else {
        setError('Gagal terhubung ke server.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest<{ verified: boolean; user: User }>('/api/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ code: mfaCode, isRecoveryCode: useRecovery }),
      });
      onAuthenticated(res.user, { mfaSetupRequired: false });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verifikasi MFA gagal.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username,
          email,
          fullName,
          phone,
          password: regPassword,
        }),
      });
      setInfo(res.message);
      setMode('login');
      setIdentifier(username);
      setPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registrasi gagal.');
    } finally {
      setLoading(false);
    }
  };

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest<{ user: User; mfaSetupRequired: boolean; message: string }>(
        '/api/auth/bootstrap-superadmin',
        {
          method: 'POST',
          body: JSON.stringify({
            username,
            email,
            fullName,
            phone,
            password: regPassword,
          }),
        }
      );
      onAuthenticated(res.user, { mfaSetupRequired: res.mfaSetupRequired });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal membuat akun Superadmin awal.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: forgotEmail }),
      });
      setInfo(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Permintaan reset gagal.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken, newPassword }),
      });
      setInfo(res.message);
      setMode('login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reset password gagal.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup"
          className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-5 flex items-center gap-4 pr-6">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-teal-500 text-white shadow-lg shadow-indigo-500/25">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">
              Autentikasi Terproteksi
            </p>
            <h2 className="mt-0.5 text-xl font-bold text-slate-900">
              {mode === 'login' && 'Masuk ke PinjamAlat'}
              {mode === 'register' && 'Daftar Akun Pelanggan'}
              {mode === 'mfa' && 'Verifikasi Multi-Faktor (MFA)'}
              {mode === 'forgot' && 'Pemulihan Password'}
              {mode === 'reset' && 'Atur Ulang Password'}
              {mode === 'bootstrap' && 'Klaim Superadmin Awal'}
            </h2>
          </div>
        </div>

        {/* Mode Tabs for standard usage */}
        {mode !== 'mfa' && (
          <div className="mb-5 flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
            {needsBootstrap && (
              <button
                type="button"
                onClick={() => switchMode('bootstrap')}
                className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                  mode === 'bootstrap' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Setup Awal
              </button>
            )}
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                mode === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Masuk
            </button>
            <button
              type="button"
              onClick={() => switchMode('register')}
              className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                mode === 'register' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Daftar
            </button>
            <button
              type="button"
              onClick={() => switchMode('forgot')}
              className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                mode === 'forgot' || mode === 'reset'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Lupa Sandi
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {info && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2.5 text-xs text-teal-800">
            <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{info}</span>
          </div>
        )}

        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Username atau Email
              </label>
              <input
                type="text"
                required
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="nama@usk.ac.id atau username"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimal 12 karakter"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-teal-600 focus:outline-none"
              />
            </div>

            {challenge && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                <p className="text-xs font-semibold text-amber-900">
                  Verifikasi Keamanan Tambahan: {challenge.question}
                </p>
                <input
                  type="text"
                  required
                  value={challengeAnswer}
                  onChange={(e) => setChallengeAnswer(e.target.value)}
                  placeholder="Masukkan hasil angka"
                  className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:from-indigo-500 hover:to-teal-500 shadow-sm disabled:opacity-50"
            >
              {loading ? 'Memverifikasi...' : 'Masuk Sekarang'}
            </button>
          </form>
        )}

        {mode === 'mfa' && (
          <form onSubmit={handleVerifyMfa} className="space-y-4">
            <p className="text-xs text-slate-600 leading-relaxed">
              Masukkan kode 6 digit dari aplikasi Authenticator TOTP Anda, atau gunakan salah satu Recovery Code cadangan.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {useRecovery ? 'Recovery Code (XXXX-XXXX)' : 'Kode Authenticator (6 Digit)'}
              </label>
              <input
                type="text"
                required
                autoFocus
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder={useRecovery ? 'ABCD-1234' : '123456'}
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm font-mono-tabular tracking-widest focus:border-teal-600 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setUseRecovery(!useRecovery);
                setMfaCode('');
              }}
              className="text-xs font-medium text-teal-700 hover:underline"
            >
              {useRecovery ? 'Gunakan kode Authenticator TOTP' : 'Kehilangan perangkat? Gunakan Recovery Code'}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
            >
              <KeyRound className="h-4 w-4" />
              {loading ? 'Memeriksa...' : 'Verifikasi & Masuk'}
            </button>
          </form>
        )}

        {(mode === 'register' || mode === 'bootstrap') && (
          <form onSubmit={mode === 'bootstrap' ? handleBootstrap : handleRegister} className="space-y-3.5">
            {mode === 'bootstrap' && (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 leading-relaxed">
                Belum ada akun Superadmin terdaftar. Klaim akun Superadmin pertama untuk mengelola barang, admin, konfigurasi keamanan, dan audit log.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Username</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="andi_mhs"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">No. WhatsApp</label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="08xxxxxxxxxx"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Lengkap</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nama sesuai KTM"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@mhs.usk.ac.id"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Password (min. 12 karakter / frasa sandi)
              </label>
              <input
                type="password"
                required
                minLength={12}
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                placeholder="Min. 12 karakter, 3 jenis karakter atau frasa 16+ karakter"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Password di-hash menggunakan Argon2id. Mendukung password manager dan passphrase.
              </p>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <UserPlus className="h-4 w-4" />
              {loading
                ? 'Menyimpan...'
                : mode === 'bootstrap'
                ? 'Buat Superadmin Awal'
                : 'Daftar sebagai Pelanggan'}
            </button>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleForgot} className="space-y-4">
            <p className="text-xs text-slate-600 leading-relaxed">
              Masukkan email akun Anda. Tautan token pemulihan sekali pakai (berlaku 15 menit) akan dikirim melalui kanal terverifikasi.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Email Terdaftar</label>
              <input
                type="email"
                required
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="nama@mhs.usk.ac.id"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-teal-600 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Mail className="h-4 w-4" />
              {loading ? 'Mengirim...' : 'Kirim Permintaan Reset'}
            </button>
            <button
              type="button"
              onClick={() => switchMode('reset')}
              className="w-full text-center text-xs font-medium text-teal-700 hover:underline"
            >
              Sudah punya token reset? Masukkan token di sini
            </button>
          </form>
        )}

        {mode === 'reset' && (
          <form onSubmit={handleReset} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Token Reset Password</label>
              <input
                type="text"
                required
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
                placeholder="Tempel token 64-karakter"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm font-mono-tabular focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Password Baru (min. 12 karakter)</label>
              <input
                type="password"
                required
                minLength={12}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Masukkan password baru"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-teal-600 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {loading ? 'Menyimpan...' : 'Perbarui Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
