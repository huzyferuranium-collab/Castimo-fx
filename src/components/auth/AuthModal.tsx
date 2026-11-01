import React, { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  Shield,
  Lock,
  Mail,
  User,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { UserRole } from '../../types';
import { emailCodesAvailable, sendEmailCode, verifyEmailCode } from '../../services/emailCodeApi';
import { Collapsible } from '../common/Collapsible';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'signin' | 'signup' | 'verify';
  prefillEmail?: string;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  defaultTab = 'signin',
  prefillEmail,
}) => {
  const {
    signInWithEmail,
    signUpWithEmail,
    error,
    lastErrorCode,
    diagnosticAdvice,
    clearError,
    user,
    isEmailVerified,
    sendVerificationEmail,
    refreshEmailVerified,
    resetPassword,
  } = useAuth();

  const [tab, setTab] = useState<'signin' | 'signup' | 'verify'>(defaultTab);
  const [showPassword, setShowPassword] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetNote, setResetNote] = useState<{ ok: boolean; text: string } | null>(null);
  const resetting = showReset && tab === 'signin';

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetBusy) return;
    setResetBusy(true);
    setResetNote(null);
    const r = await resetPassword(email);
    setResetBusy(false);
    setResetNote(
      r.success
        ? { ok: true, text: 'If that email has an account, a reset link is on its way. Please check your inbox and spam folder.' }
        : { ok: false, text: r.error || 'Could not send the link.' }
    );
  };
  const [email, setEmail] = useState(prefillEmail || '');
  const [verifyNote, setVerifyNote] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [codesOn, setCodesOn] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  // New accounts are always clients. Admin rights can only be granted in Firebase.
  const role: UserRole = 'client';
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || tab !== 'verify' || !user) return;
    let cancelled = false;
    emailCodesAvailable().then((v) => {
      if (!cancelled) setCodesOn(v);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, tab, user]);

  const handleSendCode = async () => {
    setVerifyBusy(true);
    setVerifyNote(null);
    const r = await sendEmailCode();
    setVerifyBusy(false);
    if (r.ok) {
      setCodeSent(true);
      setVerifyNote(r.data?.alreadyVerified ? 'Your email is already verified.' : 'We sent a 6-digit code. It works for 10 minutes. Please check your inbox and spam folder.');
    } else setVerifyNote(r.error || 'Could not send the code.');
  };

  const handleConfirmCode = async () => {
    setVerifyBusy(true);
    setVerifyNote(null);
    const r = await verifyEmailCode(codeInput.trim());
    if (r.ok) {
      const ok = await refreshEmailVerified();
      setVerifyNote(ok ? 'Your email is confirmed. Thank you!' : 'Your code was accepted. If the page does not update, press "I have verified".');
      setCodeInput('');
    } else setVerifyNote(r.error || 'That code could not be checked.');
    setVerifyBusy(false);
  };

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
        setLocalMessage('Account created.');
        setTimeout(() => onClose(), 800);
      }
    } catch (err: any) {
      // If error occurred and wasn't handled, fallback option is rendered
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendLink = async () => {
    setVerifyBusy(true);
    setVerifyNote(null);
    const res = await sendVerificationEmail();
    setVerifyNote(
      res.success
        ? 'Verification link sent. Open it from your inbox (check spam), then press "I have verified".'
        : res.error || 'Could not send the email.'
    );
    setVerifyBusy(false);
  };

  const handleCheckVerified = async () => {
    setVerifyBusy(true);
    const ok = await refreshEmailVerified();
    setVerifyNote(ok ? 'Email verified. Thank you!' : 'Not verified yet. Open the link in the email first.');
    setVerifyBusy(false);
    if (ok) setTimeout(() => onClose(), 900);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100 max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600/20 via-cyan-600/20 to-blue-600/20 px-5 py-4 border-b border-slate-800 relative shrink-0">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 text-slate-400 hover:text-white p-1.5 rounded-lg transition"
            aria-label="Close"
          >
            ✕
          </button>
          <div className="flex items-center gap-3 pr-8">
            <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shrink-0">
              <Shield className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold tracking-tight text-white">Castimofx</h2>
              <p className="text-xs text-slate-400">
                {resetting
                  ? 'Reset your password'
                  : tab === 'verify'
                  ? 'Confirm your email'
                  : tab === 'signup'
                  ? 'Create your account'
                  : 'Sign in to your account'}
              </p>
            </div>
          </div>
        </div>

        {/* Tab Toggle */}
        {tab !== 'verify' && (
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
            Register
          </button>
        </div>
        )}

        {/* Form Body */}
        <div className="p-5 overflow-y-auto space-y-3.5">
          {error && (
            <div className="p-3 text-xs rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <div className="flex-1 space-y-1">
                  <div className="text-[11px] text-rose-200/90 leading-snug">{error}</div>
                  {(diagnosticAdvice || lastErrorCode) && (
                    <Collapsible variant="plain" title="Details" openLabel="Show" closeLabel="Hide" className="text-rose-200/90">
                      {diagnosticAdvice && <p>{diagnosticAdvice}</p>}
                      {lastErrorCode && <p className="font-mono text-[10px] opacity-80">{lastErrorCode}</p>}
                    </Collapsible>
                  )}
                </div>
              </div>
            </div>
          )}

          {localMessage && (
            <div className="flex items-center gap-2 p-3 text-xs rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{localMessage}</span>
            </div>
          )}

          {tab === 'verify' && (
            <div className="space-y-3 text-xs">
              <p className="text-slate-300 leading-relaxed">
                We will email a link to <strong className="text-white">{user?.email || email || 'your email'}</strong>. Open it, then press “I have verified”.
              </p>
              {isEmailVerified && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Your email is already verified.</span>
                </div>
              )}
              {verifyNote && <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-700/60 text-slate-200">{verifyNote}</div>}
              {codesOn && !isEmailVerified && (
                <div className="space-y-2 p-3 rounded-xl bg-slate-950/50 border border-slate-700/60">
                  <p className="text-slate-300">Prefer a 6-digit code instead?</p>
                  <button
                    type="button"
                    disabled={verifyBusy || !user}
                    onClick={handleSendCode}
                    className="w-full py-2 px-3 font-semibold rounded-xl bg-emerald-500 text-slate-950 disabled:opacity-50 cursor-pointer"
                  >
                    {codeSent ? 'Send a new code' : 'Email me a code'}
                  </button>
                  {codeSent && (
                    <div className="flex gap-2">
                      <input
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={codeInput}
                        onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, ''))}
                        placeholder="6-digit code"
                        className="flex-1 px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white font-mono tracking-widest"
                      />
                      <button
                        type="button"
                        disabled={verifyBusy || codeInput.length !== 6}
                        onClick={handleConfirmCode}
                        className="btn-gold px-4 py-2 rounded-xl font-semibold disabled:opacity-50 cursor-pointer"
                      >
                        Confirm
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button
                type="button"
                disabled={verifyBusy || !user}
                onClick={handleSendLink}
                className="btn-gold w-full py-2.5 px-4 rounded-xl font-semibold disabled:opacity-50 cursor-pointer"
              >
                Send verification link
              </button>
              <button
                type="button"
                disabled={verifyBusy || !user}
                onClick={handleCheckVerified}
                className="w-full py-2 px-3 font-medium rounded-xl border border-slate-700 bg-slate-950 text-slate-200 disabled:opacity-50 cursor-pointer"
              >
                I have verified
              </button>
              {!user && <p className="text-[11px] text-amber-300">Sign in with a real account first.</p>}
            </div>
          )}

          {resetting && (
            <form onSubmit={handleReset} className="space-y-3">
              <p className="text-xs text-slate-300 leading-relaxed">
                Enter your email and we will send a link to choose a new password.
              </p>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                <input
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950/60 border border-slate-700/60 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-white placeholder-slate-500"
                />
              </div>
              {resetNote && (
                <div
                  className={`p-3 text-xs rounded-xl border ${
                    resetNote.ok
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  }`}
                >
                  {resetNote.text}
                </div>
              )}
              <button
                type="submit"
                disabled={resetBusy}
                className="btn-gold w-full py-2.5 px-4 rounded-xl font-semibold disabled:opacity-50 cursor-pointer"
              >
                {resetBusy ? 'Sending…' : 'Send reset link'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowReset(false);
                  setResetNote(null);
                }}
                className="w-full text-center text-xs text-slate-400 hover:text-emerald-400 cursor-pointer"
              >
                Back to sign in
              </button>
            </form>
          )}

          {tab !== 'verify' && !resetting && (
          <form onSubmit={handleSubmit} className="space-y-3">
            {tab === 'signup' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Full name</label>
                  <div className="relative">
                    <User className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                    <input
                      type="text"
                      required
                      placeholder="Your full name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950/60 border border-slate-700/60 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-white placeholder-slate-500"
                    />
                  </div>
                </div>

              </>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                <input
                  type="email"
                  required
                  placeholder="you@example.com"
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
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-10 py-2 text-xs bg-slate-950/60 border border-slate-700/60 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-white placeholder-slate-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-emerald-400"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[11px] text-slate-500">At least 6 characters</p>
                {tab === 'signin' && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowReset(true);
                      setResetNote(null);
                      clearError();
                    }}
                    className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300 cursor-pointer shrink-0 ml-2"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-gold w-full py-2.5 px-4 text-xs font-semibold rounded-xl flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <span>Please wait…</span>
                ) : (
                  <>
                    <span>{tab === 'signin' ? 'Sign in' : 'Create account'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>

            </div>

            <Collapsible title="Security" openLabel="Details" closeLabel="Hide" className="mt-1">
              <p>Your password is never logged. New accounts are client accounts; administrator rights can only be granted by the owner.</p>
              <p>Your money stays in your own broker account. Castimofx never holds your funds.</p>
            </Collapsible>
          </form>
          )}

        </div>
      </div>
    </div>
  );
};
