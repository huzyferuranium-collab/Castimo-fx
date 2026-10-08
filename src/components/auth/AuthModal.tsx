import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  Shield,
  Lock,
  Mail,
  User,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  KeyRound,
  ExternalLink,
  Zap,
} from 'lucide-react';
import { UserRole } from '../../types';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'signin' | 'signup';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  defaultTab = 'signin',
}) => {
  const {
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signInDirectSession,
    demoLogin,
    error,
    lastErrorCode,
    diagnosticAdvice,
    apiNeedsActivation,
    activationUrl,
    clearError,
  } = useAuth();

  const [tab, setTab] = useState<'signin' | 'signup'>(defaultTab);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  // New accounts are always clients. Admin rights can only be granted in Firebase.
  const role: UserRole = 'client';
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalMessage(null);
    setIsSubmitting(true);

    try {
      if (tab === 'signin') {
        await signInWithEmail(email, password);
        onClose();
      } else {
        await signUpWithEmail(email, password, displayName, role);
        setLocalMessage('Authenticated successfully.');
        setTimeout(() => onClose(), 800);
      }
    } catch (err: any) {
      // If error occurred and wasn't handled, fallback option is rendered
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDirectSignIn = () => {
    const targetEmail = email.trim() || 'trader@castimofx.com';
    const targetName = displayName.trim() || targetEmail.split('@')[0];
    signInDirectSession(targetEmail, targetName, role);
    onClose();
  };

  const handleGoogle = async () => {
    try {
      setIsSubmitting(true);
      await signInWithGoogle();
      onClose();
    } catch (err) {
      // handled in hook
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDemo = (selectedRole: UserRole) => {
    demoLogin(selectedRole);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100 max-h-[95vh] flex flex-col">
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-emerald-600/20 via-cyan-600/20 to-blue-600/20 p-5 border-b border-slate-800 text-center relative shrink-0">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg transition"
            aria-label="Close"
          >
            ✕
          </button>
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 mb-2 shadow-inner">
            <Shield className="w-5 h-5" />
          </div>
          <h2 className="text-lg font-bold tracking-tight text-white flex items-center justify-center gap-2">
            CASTIMOFX <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">Terminal Access</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Institutional MT5 trade copying & non-custodial capital protection
          </p>
        </div>

        {/* Instant 1-Click Access Bar */}
        <div className="bg-slate-950/90 px-4 py-2.5 border-b border-slate-800/80 flex items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>Instant Demo:</span>
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleDemo('client')}
              className="py-1 px-2.5 text-[11px] font-semibold rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition flex items-center gap-1 cursor-pointer"
            >
              <User className="w-3 h-3" />
              <span>Client Demo</span>
            </button>
          </div>
        </div>

        {/* Tab Toggle */}
        <div className="flex border-b border-slate-800 bg-slate-900/50 p-1 shrink-0">
          <button
            onClick={() => {
              setTab('signin');
              clearError();
            }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition ${
              tab === 'signin'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => {
              setTab('signup');
              clearError();
            }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition ${
              tab === 'signup'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Register Client
          </button>
        </div>

        {/* Form Body */}
        <div className="p-5 overflow-y-auto space-y-3.5">
          {/* GCP Identity Toolkit API Notification / Direct Sign-In Helper */}
          {apiNeedsActivation && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 space-y-2 text-xs">
              <div className="flex items-center gap-1.5 font-bold text-amber-300">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Google Cloud Identity Toolkit Pending</span>
              </div>
              <p className="text-[11px] text-amber-200/90 leading-relaxed">
                The Identity Toolkit API is currently disabled in your Google Cloud project (ID 700597994216). You can continue immediately using <strong>Direct Session Mode</strong> or enable it in GCP console:
              </p>
              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleDirectSignIn}
                  className="flex-1 py-1.5 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>Instant Direct Sign-In</span>
                </button>
                {activationUrl && (
                  <a
                    href={activationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-[11px] rounded-lg border border-slate-700 transition flex items-center justify-center gap-1"
                  >
                    <span>Enable in GCP</span>
                    <ExternalLink className="w-3 h-3 text-slate-400" />
                  </a>
                )}
              </div>
            </div>
          )}

          {error && !apiNeedsActivation && (
            <div className="p-3 text-xs rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <div className="flex-1 space-y-1">
                  {lastErrorCode && (
                    <div className="font-mono text-[10px] uppercase font-bold text-rose-300 bg-rose-950/60 px-2 py-0.5 rounded border border-rose-800/80 inline-block">
                      Error Code: {lastErrorCode}
                    </div>
                  )}
                  <div className="text-[11px] text-rose-200/90 leading-snug">{error}</div>
                  {diagnosticAdvice && (
                    <div className="text-[11px] text-amber-300 bg-amber-950/40 p-2 rounded-lg border border-amber-900/60 mt-1">
                      💡 <strong>Diagnosis:</strong> {diagnosticAdvice}
                    </div>
                  )}
                </div>
              </div>
              <div className="pt-1 flex items-center justify-between border-t border-rose-900/40">
                <span className="text-[10px] text-slate-400">Detailed error logged to browser DevTools console</span>
                <button
                  type="button"
                  onClick={handleDirectSignIn}
                  className="font-semibold text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
                >
                  <Zap className="w-3 h-3" />
                  <span>Bypass & Sign In Directly</span>
                </button>
              </div>
            </div>
          )}

          {localMessage && (
            <div className="flex items-center gap-2 p-3 text-xs rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{localMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            {tab === 'signup' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Full Legal Name</label>
                  <div className="relative">
                    <User className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. David Vance"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950/60 border border-slate-700/60 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-white placeholder-slate-500"
                    />
                  </div>
                </div>

              </>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                <input
                  type="email"
                  required
                  placeholder="trader@castimofx.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950/60 border border-slate-700/60 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-white placeholder-slate-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                <input
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950/60 border border-slate-700/60 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-white placeholder-slate-500"
                />
              </div>
              <p className="text-[10px] text-slate-500 mt-1">Minimum 6 characters. Passwords are never logged.</p>
            </div>

            <div className="space-y-2 pt-1">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 text-xs font-semibold rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 shadow-md shadow-emerald-500/20 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <span>Authenticating...</span>
                ) : (
                  <>
                    <span>{tab === 'signin' ? 'Sign In to Terminal' : 'Complete Registration'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleDirectSignIn}
                className="w-full py-2 px-3 text-[11px] font-medium rounded-xl border border-slate-800 bg-slate-950 hover:bg-slate-900 text-slate-300 transition flex items-center justify-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                <span>Instant Sign In (Skip Cloud Check)</span>
              </button>
            </div>
          </form>

          {/* Social or Google Sign In */}
          <div className="relative flex py-0.5 items-center">
            <div className="flex-grow border-t border-slate-800"></div>
            <span className="flex-shrink mx-3 text-[10px] uppercase tracking-wider text-slate-500">Or continue with</span>
            <div className="flex-grow border-t border-slate-800"></div>
          </div>

          <button
            type="button"
            onClick={handleGoogle}
            disabled={isSubmitting}
            className="w-full py-2 px-3 text-xs font-medium rounded-xl border border-slate-700/70 bg-slate-800/40 hover:bg-slate-800 text-slate-200 transition flex items-center justify-center gap-2 cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>Continue with Google</span>
          </button>
        </div>
      </div>
    </div>
  );
};
