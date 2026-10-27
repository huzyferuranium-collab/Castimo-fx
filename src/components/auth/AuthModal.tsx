import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  Shield,
  Lock,
  Mail,
  User,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Phone,
  MessageSquare,
  ExternalLink,
  RefreshCw,
  ArrowLeft,
} from 'lucide-react';
import { UserRole } from '../../types';
import { requestWhatsAppOtp, submitWhatsAppOtp } from '../../services/whatsappVerification';

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
  } = useAuth();

  const [tab, setTab] = useState<'signin' | 'signup' | 'verify'>(defaultTab);
  const [email, setEmail] = useState(prefillEmail || '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  
  // WhatsApp OTP Verification Step
  const [whatsappStep, setWhatsappStep] = useState<'form' | 'verify_otp'>('form');
  const [whatsappCode, setWhatsappCode] = useState('');
  const [directWhatsAppLink, setDirectWhatsAppLink] = useState<string>('');
  const [whatsappError, setWhatsappError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  const [verifyNote, setVerifyNote] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  // New accounts are always clients. Admin rights can only be granted in Firebase.
  const role: UserRole = 'client';
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  // Resend cooldown timer countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  if (!isOpen) return null;

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalMessage(null);
    setIsSubmitting(true);

    try {
      await signInWithEmail(email, password);
      onClose();
    } catch {
      // Handled by useAuth error state
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInitiateWhatsAppVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setWhatsappError(null);
    setLocalMessage(null);

    // Validate phone number format (must contain at least country code and digits)
    const cleanPhone = whatsappNumber.trim().replace(/[\s\-\(\)]/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : '+' + cleanPhone;

    if (!/^\+[1-9]\d{6,14}$/.test(formattedPhone)) {
      setWhatsappError('Please enter a valid WhatsApp phone number with country code (e.g. +1 555 123 4567 or +256 700 000 000).');
      return;
    }

    if (password.length < 6) {
      setWhatsappError('Password must be at least 6 characters.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await requestWhatsAppOtp(formattedPhone);
      if (res.success) {
        setWhatsappStep('verify_otp');
        setDirectWhatsAppLink(res.directLink || '');
        setResendCooldown(60);
      } else {
        setWhatsappError(res.error || 'Failed to dispatch WhatsApp code.');
      }
    } catch (err: any) {
      setWhatsappError(err?.message || 'Could not connect to WhatsApp verification server.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendWhatsAppCode = async () => {
    if (resendCooldown > 0) return;
    setWhatsappError(null);
    setIsSubmitting(true);
    const cleanPhone = whatsappNumber.trim().replace(/[\s\-\(\)]/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : '+' + cleanPhone;

    try {
      const res = await requestWhatsAppOtp(formattedPhone);
      if (res.success) {
        setResendCooldown(60);
        setLocalMessage('A fresh verification code was sent to your WhatsApp.');
      } else {
        setWhatsappError(res.error || 'Failed to resend verification code.');
      }
    } catch (err: any) {
      setWhatsappError(err?.message || 'Could not resend code.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyCodeAndRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setWhatsappError(null);

    const cleanCode = whatsappCode.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      setWhatsappError('Please enter the complete 6-digit WhatsApp verification code.');
      return;
    }

    const cleanPhone = whatsappNumber.trim().replace(/[\s\-\(\)]/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : '+' + cleanPhone;

    setIsSubmitting(true);
    try {
      const verifyRes = await submitWhatsAppOtp(formattedPhone, cleanCode);
      if (!verifyRes.success) {
        setWhatsappError(verifyRes.error || 'Invalid or expired WhatsApp verification code.');
        setIsSubmitting(false);
        return;
      }

      // Verified! Now create the client account
      await signUpWithEmail(email, password, displayName, role, formattedPhone, true);
      setLocalMessage('WhatsApp verified! Registration complete.');
      setTimeout(() => onClose(), 800);
    } catch (err: any) {
      setWhatsappError(err?.message || 'Failed to complete registration.');
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
            Institutional MT5 trade copying & verified client registration
          </p>
        </div>

        {/* Tab Toggle */}
        {tab !== 'verify' && (
          <div className="flex border-b border-slate-800 bg-slate-900/50 p-1 shrink-0">
            <button
              onClick={() => {
                setTab('signin');
                setWhatsappStep('form');
                clearError();
                setWhatsappError(null);
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
                setWhatsappStep('form');
                clearError();
                setWhatsappError(null);
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
        )}

        {/* Form Body */}
        <div className="p-5 overflow-y-auto space-y-3.5">
          {error && (
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
            </div>
          )}

          {whatsappError && (
            <div className="p-3 text-xs rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <div className="text-[11px] leading-snug">{whatsappError}</div>
            </div>
          )}

          {localMessage && (
            <div className="flex items-center gap-2 p-3 text-xs rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{localMessage}</span>
            </div>
          )}

          {/* Email Verification Tab */}
          {tab === 'verify' && (
            <div className="space-y-3 text-xs">
              <p className="text-slate-300 leading-relaxed">
                We send a verification link to <strong className="text-white">{user?.email || email || 'your email'}</strong>.
                Open it, then come back and press the button below.
              </p>
              {isEmailVerified && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Your email is already verified.</span>
                </div>
              )}
              {verifyNote && <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-700/60 text-slate-200">{verifyNote}</div>}
              <button
                type="button"
                disabled={verifyBusy || !user}
                onClick={handleSendLink}
                className="w-full py-2.5 px-4 font-semibold rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 disabled:opacity-50 cursor-pointer"
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

          {/* Sign In Form */}
          {tab === 'signin' && (
            <form onSubmit={handleSignInSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
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
                    type="password"
                    required
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950/60 border border-slate-700/60 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-white placeholder-slate-500"
                  />
                </div>
              </div>

              <div className="pt-1">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 text-xs font-semibold rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 shadow-md shadow-emerald-500/20 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <span>Signing In...</span>
                  ) : (
                    <>
                      <span>Sign In to Terminal</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Register Client Form (with WhatsApp number and verification) */}
          {tab === 'signup' && (
            <>
              {whatsappStep === 'form' ? (
                <form onSubmit={handleInitiateWhatsAppVerification} className="space-y-3">
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

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
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
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-slate-300">WhatsApp Phone Number</label>
                      <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-semibold">
                        <MessageSquare className="w-3 h-3" /> WhatsApp Code Verification
                      </span>
                    </div>
                    <div className="relative">
                      <Phone className="w-4 h-4 absolute left-3 top-3 text-emerald-400" />
                      <input
                        type="tel"
                        required
                        placeholder="+1 555 123 4567"
                        value={whatsappNumber}
                        onChange={(e) => setWhatsappNumber(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950/60 border border-slate-700/60 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-white placeholder-slate-500"
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Include country code (e.g. +1, +44, +256). A 6-digit WhatsApp verification code will be sent to this number.
                    </p>
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
                    <p className="text-[10px] text-slate-500 mt-1">Minimum 6 characters.</p>
                  </div>

                  <div className="pt-1">
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full py-2.5 px-4 text-xs font-semibold rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 shadow-md shadow-emerald-500/20 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {isSubmitting ? (
                        <span>Sending WhatsApp Code...</span>
                      ) : (
                        <>
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>Verify via WhatsApp & Continue</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                /* Step 2: WhatsApp Code Verification */
                <form onSubmit={handleVerifyCodeAndRegister} className="space-y-4">
                  <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-center space-y-2">
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <h3 className="text-sm font-bold text-white">Enter WhatsApp Verification Code</h3>
                    <p className="text-xs text-slate-300">
                      We sent a 6-digit verification code to:
                    </p>
                    <div className="inline-block font-mono text-xs font-bold text-emerald-300 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
                      {whatsappNumber}
                    </div>

                    {directWhatsAppLink && (
                      <div className="pt-1">
                        <a
                          href={directWhatsAppLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1 rounded-lg border border-emerald-500/30 transition"
                        >
                          <span>Open WhatsApp to Confirm</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1 text-center">
                      6-Digit Code
                    </label>
                    <input
                      type="text"
                      maxLength={6}
                      required
                      autoFocus
                      placeholder="000000"
                      value={whatsappCode}
                      onChange={(e) => setWhatsappCode(e.target.value.replace(/\D/g, ''))}
                      className="w-full text-center tracking-[0.5em] font-mono text-lg py-2.5 bg-slate-950 border border-emerald-500/50 rounded-xl focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/30 text-emerald-300 placeholder-slate-600 font-bold"
                    />
                  </div>

                  <div className="space-y-2 pt-1">
                    <button
                      type="submit"
                      disabled={isSubmitting || whatsappCode.length !== 6}
                      className="w-full py-2.5 px-4 text-xs font-semibold rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 shadow-md shadow-emerald-500/20 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {isSubmitting ? (
                        <span>Verifying & Creating Account...</span>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Verify Code & Complete Registration</span>
                        </>
                      )}
                    </button>

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setWhatsappStep('form');
                          setWhatsappError(null);
                        }}
                        className="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer transition"
                      >
                        <ArrowLeft className="w-3 h-3" />
                        <span>Change Number</span>
                      </button>

                      <button
                        type="button"
                        disabled={isSubmitting || resendCooldown > 0}
                        onClick={handleResendWhatsAppCode}
                        className="text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-40 flex items-center gap-1 cursor-pointer transition"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>{resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend Code'}</span>
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
