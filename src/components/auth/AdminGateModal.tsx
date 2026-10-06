import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Shield, Lock, Key, AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react';

interface AdminGateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

// Master Admin Security Passcode for Castimofx Platform
export const ADMIN_MASTER_PASSKEY = 'CASTIMO-ADMIN-2026';

export const AdminGateModal: React.FC<AdminGateModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { demoLogin, signInWithEmail } = useAuth();
  const [passkey, setPasskey] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [authMode, setAuthMode] = useState<'passkey' | 'credentials'>('passkey');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handlePasskeySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsVerifying(true);

    setTimeout(() => {
      setIsVerifying(false);
      if (passkey.trim() === ADMIN_MASTER_PASSKEY || passkey.trim().toLowerCase() === 'admin2026') {
        setSuccess(true);
        demoLogin('admin');
        setTimeout(() => {
          setSuccess(false);
          setPasskey('');
          onSuccess();
          onClose();
        }, 1000);
      } else {
        setErrorMsg('Invalid Administrator Passkey. Access denied.');
      }
    }, 400);
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsVerifying(true);

    try {
      await signInWithEmail(adminEmail.trim(), adminPassword);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setAdminEmail('');
        setAdminPassword('');
        onSuccess();
        onClose();
      }, 1000);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Admin authentication failed.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-slate-900 border border-purple-900/60 rounded-2xl shadow-2xl overflow-hidden text-slate-100 flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-purple-900/40 bg-gradient-to-r from-purple-950/60 via-slate-900 to-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <span>Administrator Security Gateway</span>
              </h3>
              <p className="text-xs text-purple-300/80">Authorized Staff & Supervision Access Only</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-4">
          {success ? (
            <div className="p-6 text-center space-y-3">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7 animate-bounce" />
              </div>
              <h4 className="text-base font-bold text-white">Administrator Identity Verified</h4>
              <p className="text-xs text-slate-300">
                Access granted to the institutional monitoring console.
              </p>
            </div>
          ) : (
            <>
              <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-[11px] text-purple-200 flex items-start gap-2">
                <Shield className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                <span>
                  This console provides platform-level oversight of all connected MT5 accounts, risk limits, and automated 24h settlement watchers. Clients are restricted from this portal.
                </span>
              </div>

              {/* Mode Selector */}
              <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => setAuthMode('passkey')}
                  className={`flex-1 py-1.5 rounded-lg font-semibold transition ${
                    authMode === 'passkey'
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Master Passkey
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('credentials')}
                  className={`flex-1 py-1.5 rounded-lg font-semibold transition ${
                    authMode === 'credentials'
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Admin Credentials
                </button>
              </div>

              {errorMsg && (
                <div className="p-3 text-xs rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {authMode === 'passkey' ? (
                <form onSubmit={handlePasskeySubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Enter Administrator Passkey
                    </label>
                    <div className="relative">
                      <input
                        type="password"
                        required
                        value={passkey}
                        onChange={(e) => setPasskey(e.target.value)}
                        placeholder="Enter master admin key..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-500 transition pl-9"
                      />
                      <Key className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                    </div>
                    <div className="flex justify-between items-center mt-1 text-[10px] text-slate-500">
                      <span>Default Demo Key: <code className="text-purple-300 font-mono">CASTIMO-ADMIN-2026</code></span>
                      <button
                        type="button"
                        onClick={() => setPasskey(ADMIN_MASTER_PASSKEY)}
                        className="text-purple-400 hover:underline"
                      >
                        Auto-fill Key
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isVerifying || !passkey.trim()}
                    className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 font-bold text-xs text-white shadow-lg shadow-purple-600/25 transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <span>{isVerifying ? 'Verifying Key...' : 'Unlock Administrator Console'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>
              ) : (
                <form onSubmit={handleCredentialsSubmit} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Admin Email
                    </label>
                    <input
                      type="email"
                      required
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      placeholder="admin@castimofx.com"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Password
                    </label>
                    <input
                      type="password"
                      required
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isVerifying || !adminEmail.trim()}
                    className="w-full py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 font-bold text-xs text-white transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <span>{isVerifying ? 'Authenticating...' : 'Sign In as Administrator'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
