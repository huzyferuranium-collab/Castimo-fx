import React, { useState, useEffect } from 'react';
import { tradingEngine } from '../../services/tradingEngine';
import { useAuth } from '../../hooks/useAuth';
import { requestWhatsAppOtp, submitWhatsAppOtp } from '../../services/whatsappVerification';
import {
  KeyRound,
  Server,
  CheckCircle2,
  Lock,
  AlertTriangle,
  ArrowRight,
  Mail,
  Phone,
  MessageSquare,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

interface Mt5ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
}

const COMMON_SERVERS = [
  'Exness-MT5Real9',
  'Exness-MT5Real14',
  'Exness-MT5Real7',
  'Exness-MT5Real10',
  'Exness-MT5Real8',
  'Exness-MT5Real',
  'Exness-Real9',
  'HFMarketsGlobal-Live20',
  'HFMarketsSC-Live2',
  'ICMarketsSC-Live02',
  'ICMarketsSC-Live05',
  'ICMarketsAU-Live',
  'Deriv-Server',
  'XMGlobal-MT5',
  'FTMO-Server-Live',
  'Tickmill-Live01',
  'Pepperstone-Edge-Live',
];

export const Mt5ConnectionModal: React.FC<Mt5ConnectionModalProps> = ({
  isOpen,
  onClose,
  userId,
}) => {
  const {
    user,
    userProfile,
    isEmailVerified,
    sendVerificationEmail,
    refreshEmailVerified,
    updateWhatsAppNumber,
    isAdmin,
  } = useAuth();

  const isUserAdmin = isAdmin ?? (userProfile?.role === 'admin');
  const isWhatsAppVerified = !!userProfile?.whatsappVerified;
  const isVerifiedToConnect = isUserAdmin || (isEmailVerified && isWhatsAppVerified);

  // Email verification helper states
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailNote, setEmailNote] = useState<string | null>(null);

  // WhatsApp verification helper states
  const [whatsappPhone, setWhatsappPhone] = useState(userProfile?.whatsappNumber || userProfile?.phone || '');
  const [whatsappCode, setWhatsappCode] = useState('');
  const [whatsappStep, setWhatsappStep] = useState<'phone' | 'code'>('phone');
  const [whatsappBusy, setWhatsappBusy] = useState(false);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);
  const [whatsappSuccess, setWhatsappSuccess] = useState<string | null>(null);
  const [whatsappDirectLink, setWhatsappDirectLink] = useState<string>('');
  const [whatsappCooldown, setWhatsappCooldown] = useState(0);

  // MT5 Connection form states
  const [accountNumber, setAccountNumber] = useState('');
  const [brokerServer, setBrokerServer] = useState('');
  const [password, setPassword] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Cooldown timer
  useEffect(() => {
    if (whatsappCooldown <= 0) return;
    const t = setInterval(() => setWhatsappCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [whatsappCooldown]);

  if (!isOpen) return null;

  const handleSendEmailLink = async () => {
    setEmailBusy(true);
    setEmailNote(null);
    const res = await sendVerificationEmail();
    setEmailNote(
      res.success
        ? 'Verification email sent. Check your inbox and spam folder, then click "I have verified".'
        : res.error || 'Could not send verification email.'
    );
    setEmailBusy(false);
  };

  const handleCheckEmailVerified = async () => {
    setEmailBusy(true);
    const ok = await refreshEmailVerified();
    setEmailNote(ok ? 'Email verified successfully!' : 'Email is not verified yet. Please open the link in your email first.');
    setEmailBusy(false);
  };

  const handleSendWhatsAppOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setWhatsappError(null);
    setWhatsappSuccess(null);

    const clean = whatsappPhone.trim().replace(/[\s\-\(\)]/g, '');
    const formatted = clean.startsWith('+') ? clean : '+' + clean;

    if (!/^\+[1-9]\d{6,14}$/.test(formatted)) {
      setWhatsappError('Please enter a valid phone number with country code (e.g. +1 555 123 4567).');
      return;
    }

    setWhatsappBusy(true);
    try {
      const res = await requestWhatsAppOtp(formatted);
      if (res.success) {
        setWhatsappStep('code');
        setWhatsappDirectLink(res.directLink || '');
        setWhatsappCooldown(60);
        setWhatsappSuccess('Verification code sent to your WhatsApp.');
      } else {
        setWhatsappError(res.error || 'Failed to dispatch WhatsApp code.');
      }
    } catch (err: any) {
      setWhatsappError(err?.message || 'Failed to send WhatsApp code.');
    } finally {
      setWhatsappBusy(false);
    }
  };

  const handleVerifyWhatsAppOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setWhatsappError(null);
    setWhatsappSuccess(null);

    const cleanCode = whatsappCode.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      setWhatsappError('Please enter the 6-digit WhatsApp code.');
      return;
    }

    const clean = whatsappPhone.trim().replace(/[\s\-\(\)]/g, '');
    const formatted = clean.startsWith('+') ? clean : '+' + clean;

    setWhatsappBusy(true);
    try {
      const verifyRes = await submitWhatsAppOtp(formatted, cleanCode);
      if (!verifyRes.success) {
        setWhatsappError(verifyRes.error || 'Invalid or expired WhatsApp code.');
        setWhatsappBusy(false);
        return;
      }

      const saveRes = await updateWhatsAppNumber(formatted, true);
      if (saveRes.success) {
        setWhatsappSuccess('WhatsApp verified and linked to your account!');
        setWhatsappCode('');
      } else {
        setWhatsappError(saveRes.error || 'Failed to save verified WhatsApp status.');
      }
    } catch (err: any) {
      setWhatsappError(err?.message || 'Error verifying WhatsApp code.');
    } finally {
      setWhatsappBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!isVerifiedToConnect) {
      setErrorMsg('Both Email Verification and WhatsApp Verification are required before connecting an account.');
      return;
    }

    setIsConnecting(true);

    try {
      if (!accountNumber || accountNumber.length < 5) {
        throw new Error('Please enter a valid MT5 account number.');
      }
      if (!password) {
        throw new Error('Please enter your trading password.');
      }

      await tradingEngine.connectMt5Account(userId, accountNumber, brokerServer, password);
      // Password is immediately discarded from memory
      setPassword('');
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err.message || 'Connection failed.');
    } finally {
      setIsConnecting(false);
    }
  };

  const inputCls =
    'w-full pl-9 pr-3 py-2.5 text-sm bg-slate-950 border border-slate-700 rounded-xl focus:border-blue-500 text-white';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">Connect MT5 Trading Account</h3>
              <p className="text-[11px] text-slate-400">Direct broker replication with zero latency</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg transition" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {success ? (
            <div className="py-6 text-center space-y-3">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h4 className="text-base font-bold text-white">Account connected</h4>
              <p className="text-xs text-slate-400">Trades from the master account now copy to #{accountNumber}.</p>
            </div>
          ) : (
            <>
              {/* Security & Verification Gate Status */}
              {!isVerifiedToConnect ? (
                <div className="space-y-3.5">
                  <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-white">Account Verification Required</p>
                      <p className="text-[11px] text-amber-200/80 mt-0.5">
                        To protect trade replication equity, client accounts must complete both <strong>Email Verification</strong> and <strong>WhatsApp Verification</strong> before connecting.
                      </p>
                    </div>
                  </div>

                  {/* Step 1: Email Verification Card */}
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs font-bold text-white">1. Email Verification</span>
                      </div>
                      {isEmailVerified ? (
                        <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2 py-0.5 rounded-md flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> VERIFIED
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono font-bold text-amber-400 bg-amber-950/60 border border-amber-800/80 px-2 py-0.5 rounded-md">
                          REQUIRED
                        </span>
                      )}
                    </div>

                    {!isEmailVerified && (
                      <div className="space-y-2 text-xs">
                        <p className="text-[11px] text-slate-400">
                          Target email: <strong className="text-slate-200">{user?.email || userProfile?.email}</strong>
                        </p>
                        {emailNote && (
                          <div className="p-2 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-slate-300">
                            {emailNote}
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={emailBusy}
                            onClick={handleSendEmailLink}
                            className="flex-1 py-1.5 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs transition cursor-pointer disabled:opacity-50"
                          >
                            Send Verification Link
                          </button>
                          <button
                            type="button"
                            disabled={emailBusy}
                            onClick={handleCheckEmailVerified}
                            className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs transition cursor-pointer disabled:opacity-50"
                          >
                            I Have Verified
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Step 2: WhatsApp Verification Card */}
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs font-bold text-white">2. WhatsApp Verification</span>
                      </div>
                      {isWhatsAppVerified ? (
                        <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2 py-0.5 rounded-md flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> VERIFIED
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono font-bold text-amber-400 bg-amber-950/60 border border-amber-800/80 px-2 py-0.5 rounded-md">
                          REQUIRED
                        </span>
                      )}
                    </div>

                    {!isWhatsAppVerified && (
                      <div className="space-y-2 text-xs">
                        {whatsappError && (
                          <div className="p-2 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[11px]">
                            {whatsappError}
                          </div>
                        )}
                        {whatsappSuccess && (
                          <div className="p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px]">
                            {whatsappSuccess}
                          </div>
                        )}

                        {whatsappStep === 'phone' ? (
                          <form onSubmit={handleSendWhatsAppOtp} className="space-y-2">
                            <div>
                              <div className="relative">
                                <Phone className="w-3.5 h-3.5 absolute left-3 top-2.5 text-emerald-400" />
                                <input
                                  type="tel"
                                  required
                                  value={whatsappPhone}
                                  onChange={(e) => setWhatsappPhone(e.target.value)}
                                  placeholder="+1 555 123 4567"
                                  className="w-full pl-8 pr-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-emerald-500"
                                />
                              </div>
                              <p className="text-[10px] text-slate-500 mt-1">Include country code. A 6-digit WhatsApp code will be sent.</p>
                            </div>
                            <button
                              type="submit"
                              disabled={whatsappBusy}
                              className="w-full py-1.5 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs transition cursor-pointer disabled:opacity-50"
                            >
                              {whatsappBusy ? 'Sending Code...' : 'Send WhatsApp Code'}
                            </button>
                          </form>
                        ) : (
                          <form onSubmit={handleVerifyWhatsAppOtp} className="space-y-2">
                            <div className="p-2 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-[11px] text-slate-300 flex items-center justify-between">
                              <span>Enter 6-digit code sent to {whatsappPhone}:</span>
                              {whatsappDirectLink && (
                                <a
                                  href={whatsappDirectLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-emerald-400 hover:underline flex items-center gap-1 font-semibold"
                                >
                                  <span>Open WhatsApp</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                            <input
                              type="text"
                              maxLength={6}
                              required
                              placeholder="000000"
                              value={whatsappCode}
                              onChange={(e) => setWhatsappCode(e.target.value.replace(/\D/g, ''))}
                              className="w-full text-center tracking-[0.4em] font-mono text-sm py-1.5 bg-slate-900 border border-emerald-500/60 rounded-lg text-emerald-300 font-bold"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                type="submit"
                                disabled={whatsappBusy || whatsappCode.length !== 6}
                                className="flex-1 py-1.5 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs transition cursor-pointer disabled:opacity-50"
                              >
                                {whatsappBusy ? 'Verifying...' : 'Verify WhatsApp Code'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setWhatsappStep('phone');
                                  setWhatsappError(null);
                                }}
                                className="py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
                              >
                                Change
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Verified Banner */
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Email & WhatsApp Verified. You are authorized to connect MT5.</span>
                </div>
              )}

              {/* MT5 Connection Form */}
              <form onSubmit={handleSubmit} className="space-y-4 pt-1">
                {errorMsg && (
                  <div className="p-3 text-xs rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">MT5 Account Number</label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 absolute left-3 top-3.5 text-slate-500" />
                    <input
                      type="text"
                      inputMode="numeric"
                      required
                      disabled={!isVerifiedToConnect}
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value)}
                      placeholder="e.g. 133227028"
                      className={`${inputCls} font-mono ${!isVerifiedToConnect ? 'opacity-50 cursor-not-allowed' : ''}`}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Trading Password</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3 top-3.5 text-slate-500" />
                    <input
                      type="password"
                      required
                      disabled={!isVerifiedToConnect}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className={`${inputCls} ${!isVerifiedToConnect ? 'opacity-50 cursor-not-allowed' : ''}`}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">Trading password (not investor/read-only).</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Broker Server</label>
                  <div className="relative">
                    <Server className="w-4 h-4 absolute left-3 top-3.5 text-slate-500" />
                    <input
                      type="text"
                      required
                      list="server-options"
                      disabled={!isVerifiedToConnect}
                      value={brokerServer}
                      onChange={(e) => setBrokerServer(e.target.value)}
                      placeholder="e.g. HFMarketsGlobal-Live20"
                      className={`${inputCls} font-mono ${!isVerifiedToConnect ? 'opacity-50 cursor-not-allowed' : ''}`}
                    />
                    <datalist id="server-options">
                      {COMMON_SERVERS.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">Shown in your MT5 broker registration email.</p>
                </div>

                <button
                  type="submit"
                  disabled={isConnecting || !isVerifiedToConnect}
                  className="w-full py-3 px-4 rounded-xl bg-blue-500 hover:bg-blue-400 font-semibold text-sm text-white transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-blue-500/20"
                >
                  {isConnecting ? (
                    <span>Verifying Broker & Connecting...</span>
                  ) : (
                    <>
                      <span>{isVerifiedToConnect ? 'Connect MT5 Account' : 'Complete Verification to Connect'}</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
