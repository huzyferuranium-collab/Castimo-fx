import React, { useEffect, useRef, useState } from 'react';
import { tradingEngine, ConnectError, type ConnectProgress } from '../../services/tradingEngine';
import { connectSteps, mayLeaveWindow } from '../../services/connectSteps';
import { TermsModal } from '../legal/TermsModal';
import { acceptTerms, recoverAcceptance } from '../../services/agreements';
import { useAuth } from '../../hooks/useAuth';
import { KeyRound, Server, CheckCircle2, Lock, AlertTriangle, ArrowRight, Eye, EyeOff, Loader2, Circle } from 'lucide-react';

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
    const [accountNumber, setAccountNumber] = useState('');
  const [brokerServer, setBrokerServer] = useState('');
  const [password, setPassword] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [success, setSuccess] = useState(false);
  // Set when the account connected but is below the minimum equity: nothing copies yet, and it starts by itself once it reaches it.
  const [heldMin, setHeldMin] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [errorRef, setErrorRef] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [progress, setProgress] = useState<ConnectProgress | null>(null);
  // The broker is slow: the server keeps connecting the terminal and the dashboard follows it.
  const [background, setBackground] = useState(false);
  // The server wants the Terms accepted first: the client is asked right here, and connecting carries on straight after.
  const [needTerms, setNeedTerms] = useState(false);
  // True once the client has just tapped "I Agree" in this window: if the server still says no, we tell them plainly instead of asking again and again.
  const justAgreed = useRef(false);
  // The server says the email is not confirmed: the client can send the link again, or say they have confirmed it, right here.
  const { sendVerificationEmail, refreshEmailVerified, userProfile } = useAuth();
  const [needEmail, setNeedEmail] = useState(false);
  const [emailNote, setEmailNote] = useState<string | null>(null);
  const [emailBusy, setEmailBusy] = useState<'send' | 'check' | null>(null);
  const [resendWaitUntil, setResendWaitUntil] = useState(0);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!needEmail || resendWaitUntil <= Date.now()) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [needEmail, resendWaitUntil]);
  const resendLeft = Math.max(0, Math.ceil((resendWaitUntil - Date.now()) / 1000));

  const resendEmail = async () => {
    if (emailBusy || resendLeft > 0) return;
    setEmailBusy('send');
    setEmailNote(null);
    const r = await sendVerificationEmail?.();
    setEmailBusy(null);
    if (r?.success) {
      setResendWaitUntil(Date.now() + 60_000); // one email a minute, so Firebase does not block the address
      setEmailNote(`We sent a new link to ${userProfile?.email || 'your email'}. Open it (check Spam too), then tap "I have confirmed".`);
    } else {
      setEmailNote(r?.error || 'Could not send the email just now. Please try again in a minute.');
    }
  };

  const confirmedAndRetry = async () => {
    if (emailBusy) return;
    setEmailBusy('check');
    setEmailNote(null);
    const ok = await refreshEmailVerified?.();
    setEmailBusy(null);
    if (!ok) {
      setEmailNote('Your email is not confirmed yet. Open the link we sent (check Spam too), then tap this button again.');
      return;
    }
    setNeedEmail(false);
    void runConnect();
  };

  // Opening the window again starts fresh (unless a connection is still running in it).
  useEffect(() => {
    if (isOpen && !isConnecting) setBackground(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const closeAndReset = () => {
    setBackground(false);
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    justAgreed.current = false;
    return runConnect();
  };

  const runConnect = async () => {
    if (isConnecting) return; // a second tap never starts a second connection
    setErrorMsg(null);
    setErrorHint(null);
    setErrorRef(null);
    setProgress({ stage: 'queued', label: 'Starting…', percent: 3, elapsedSeconds: 0 });
    setIsConnecting(true);

    try {
      if (!accountNumber || accountNumber.length < 5) {
        throw new Error('Please enter a valid MT5 account number.');
      }
      if (!password) {
        throw new Error('Please enter your trading password.');
      }

      let outcome: Awaited<ReturnType<typeof tradingEngine.connectMt5Account>>;
      try {
        outcome = await tradingEngine.connectMt5Account(userId, accountNumber.trim(), brokerServer.trim(), password, setProgress);
      } catch (first) {
        // Accepted before, but the record never reached the database: save it through the server and carry on, no questions.
        if (first instanceof ConnectError && first.code === 'TERMS_NOT_ACCEPTED' && (await recoverAcceptance(userId))) {
          outcome = await tradingEngine.connectMt5Account(userId, accountNumber.trim(), brokerServer.trim(), password, setProgress);
        } else if (first instanceof ConnectError && first.code === 'EMAIL_NOT_VERIFIED' && (await refreshEmailVerified?.())) {
          // Confirmed already, but the sign-in still carried the old "not confirmed" state: it was refreshed, so try once more.
          outcome = await tradingEngine.connectMt5Account(userId, accountNumber.trim(), brokerServer.trim(), password, setProgress);
        } else {
          throw first;
        }
      }
      // Password is immediately discarded from memory
      setPassword('');
      if (outcome === 'background') {
        // Not a failure: the server carries on and the dashboard shows the account as soon as it is ready.
        setBackground(true);
        return;
      }
      const connected = tradingEngine.getMt5Account();
      const held = connected.copyHeld === 'low_funds';
      setHeldMin(held ? (typeof connected.copyMinimumUsd === 'number' ? `$${connected.copyMinimumUsd.toFixed(2)}` : 'the minimum') : null);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setHeldMin(null);
        onClose();
      }, held ? 6000 : 1500);
    } catch (err: any) {
      if (err instanceof ConnectError && err.code === 'TERMS_NOT_ACCEPTED') {
        if (justAgreed.current) {
          justAgreed.current = false;
          setErrorMsg('We could not save your agreement just now. Nothing is wrong with your account. Please tap Try again in a minute.');
          return;
        }
        // Never a dead end: ask for the acceptance here. Their details stay filled in and connecting resumes once they agree.
        setNeedTerms(true);
        return;
      }
      if (err instanceof ConnectError && err.code === 'EMAIL_NOT_VERIFIED') {
        // Never a dead end: the details stay filled in, and the panel below lets them resend the link or carry on once confirmed.
        setNeedEmail(true);
        return;
      }
      setErrorMsg(err.message || 'Connection failed.');
      if (err instanceof ConnectError) {
        setErrorHint(err.hint || null);
        setErrorRef(err.ref || null);
      }
    } finally {
      setIsConnecting(false);
      setProgress(null);
    }
  };

  const inputCls =
    'w-full pl-9 pr-3 py-2.5 text-sm bg-slate-950 border border-slate-700 rounded-xl focus:border-blue-500 text-white';
  // Whole seconds since the connection started, as the server counts them.
  const waited = progress ? Math.max(0, Math.floor(Number(progress.elapsedSeconds) || 0)) : 0;

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 animate-in fade-in duration-200">
      <div className="relative w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto text-slate-100">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Server className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-base text-white">Connect your MT5 account</h3>
          </div>
          <button onClick={closeAndReset} className="text-slate-400 hover:text-white p-1 rounded-lg transition" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="p-5">
          {background ? (
            <div className="py-5 text-center space-y-3" aria-live="polite">
              <div className="w-14 h-14 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/40 flex items-center justify-center mx-auto">
                <Loader2 className="w-7 h-7 animate-spin" />
              </div>
              <h4 className="text-base font-bold text-white">Still connecting, no need to wait</h4>
              <p className="text-xs text-slate-300 leading-relaxed">
                Your broker is taking a little longer to accept the login. We will keep going in the background, and your
                dashboard will update by itself when it is ready.
              </p>
              <p className="text-[11px] text-slate-500">Your password was sent securely and is not kept on this page.</p>
              <button
                type="button"
                onClick={closeAndReset}
                className="btn-gold w-full py-3 px-4 rounded-xl font-semibold text-sm cursor-pointer"
              >
                Got it
              </button>
            </div>
          ) : success ? (
            <div className="py-6 text-center space-y-3">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h4 className="text-base font-bold text-white">Account connected</h4>
              {heldMin ? (
                <p className="text-xs text-slate-400">
                  #{accountNumber} is connected but not copying yet. Trades start by themselves as soon as the account has {heldMin}: add funds at your broker whenever you are ready.
                </p>
              ) : (
                <p className="text-xs text-slate-400">Trades from the master account now copy to #{accountNumber}.</p>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {needEmail && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-100 space-y-2.5" aria-live="polite">
                  <div className="flex items-start gap-2 text-xs">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <p>
                      Please confirm your email address first. We sent a link to <b>{userProfile?.email || 'your email'}</b> when you signed up.
                      Your account details below stay filled in.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      onClick={() => void resendEmail()}
                      disabled={!!emailBusy || resendLeft > 0}
                      className="flex-1 py-2 px-3 rounded-lg text-xs font-bold bg-slate-800 border border-slate-600 text-white disabled:opacity-50"
                    >
                      {emailBusy === 'send' ? 'Sending…' : resendLeft > 0 ? `Resend in ${resendLeft}s` : 'Resend confirmation email'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void confirmedAndRetry()}
                      disabled={!!emailBusy}
                      className="flex-1 py-2 px-3 rounded-lg text-xs font-bold btn-gold disabled:opacity-50"
                    >
                      {emailBusy === 'check' ? 'Checking…' : 'I have confirmed, connect'}
                    </button>
                  </div>
                  {emailNote && <p className="text-[11px] text-amber-200/90">{emailNote}</p>}
                </div>
              )}
              {errorMsg && (
                <div className="p-3 text-xs rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p>{errorMsg}</p>
                    {errorHint && <p className="text-rose-200/80">{errorHint}</p>}
                    {errorRef && <p className="text-[10px] text-rose-300/60 font-mono">Reference: {errorRef}</p>}
                  </div>
                </div>
              )}

              {/* While connecting, the form makes room for the progress (on a phone it would otherwise sit below the fold). The details stay as typed. */}
              {isConnecting && (
                <p className="text-xs text-slate-400 font-mono truncate" aria-label="Account being connected">
                  #{accountNumber.trim()} · {brokerServer.trim()}
                </p>
              )}

              <div className={isConnecting ? 'hidden' : 'space-y-4'}>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Account number</label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 absolute left-3 top-3.5 text-slate-500" />
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    disabled={isConnecting}
                    placeholder="e.g. 133227028"
                    className={inputCls + ' font-mono'}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Trading password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-3.5 text-slate-500" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={isConnecting}
                    className={inputCls + ' pr-10'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-3 text-slate-400 hover:text-blue-400"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {password !== password.trim() && (
                  <p className="text-[11px] text-amber-400 mt-1" role="status">
                    There is a space at the start or end of your password. If it is not part of your password, please remove it (phone keyboards sometimes add one).
                  </p>
                )}
                <p className="text-[11px] text-slate-500 mt-1">Not the investor (read-only) password.</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Broker server</label>
                <div className="relative">
                  <Server className="w-4 h-4 absolute left-3 top-3.5 text-slate-500" />
                  <input
                    type="text"
                    required
                    list="server-options"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={brokerServer}
                    onChange={(e) => setBrokerServer(e.target.value)}
                    disabled={isConnecting}
                    placeholder="e.g. HFMarketsGlobal-Live20"
                    className={inputCls + ' font-mono'}
                  />
                  <datalist id="server-options">
                    {COMMON_SERVERS.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">The exact server of your account, shown on your MT5 login screen. It can differ from account to account, even at the same broker.</p>
              </div>
              </div>

              {isConnecting && progress && (
                <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3 space-y-2.5" aria-live="polite">
                  <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-700"
                      style={{ width: `${Math.max(3, progress.percent)}%` }}
                    />
                  </div>
                  {/* A step is ticked only once it has really happened (see connectSteps). */}
                  <ul className="space-y-1.5">
                    {connectSteps(progress.stage).map((st) => (
                      <li
                        key={st.key}
                        className={`flex items-center gap-2 text-xs ${st.state === 'done' ? 'text-emerald-400' : st.state === 'active' ? 'text-white' : 'text-slate-500'}`}
                      >
                        {st.state === 'done' ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : st.state === 'active' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Circle className="w-3.5 h-3.5" />
                        )}
                        <span>{st.text}</span>
                      </li>
                    ))}
                  </ul>
                  {/* What is being waited for, and for how long: the window never sits silent. */}
                  {(progress.detail || waited >= 3) && (
                    <div className="flex items-start justify-between gap-3 text-[11px] text-slate-400">
                      <span>{progress.detail || ''}</span>
                      {waited >= 3 && <span className="tabular-nums shrink-0">{waited} s</span>}
                    </div>
                  )}
                  {mayLeaveWindow(progress.stage) && (
                    <div className="space-y-2 pt-0.5">
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Your account is added. Only your broker&apos;s answer is left, and you do not have to wait for it here: your
                        dashboard updates by itself the moment it is ready.
                      </p>
                      <button
                        type="button"
                        onClick={closeAndReset}
                        className="w-full py-2 px-3 rounded-lg border border-slate-700 text-xs font-semibold text-slate-200 hover:border-slate-500 hover:text-white transition cursor-pointer"
                      >
                        Continue on my dashboard
                      </button>
                    </div>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={isConnecting}
                className="btn-gold w-full py-3 px-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
              >
                {isConnecting ? (
                  <span>{progress?.label || 'Connecting…'}</span>
                ) : errorMsg ? (
                  <span>Try again</span>
                ) : (
                  <>
                    <span>Connect</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
    <TermsModal
      isOpen={needTerms}
      onAccept={async () => {
        const r = await acceptTerms(userId);
        if (r.success) {
          justAgreed.current = true;
          setNeedTerms(false);
          void runConnect();
        }
        return r;
      }}
    />
    </>
  );
};
