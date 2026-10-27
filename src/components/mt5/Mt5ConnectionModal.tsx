import React, { useEffect, useState } from 'react';
import { tradingEngine, ConnectError, type ConnectProgress } from '../../services/tradingEngine';
import { KeyRound, Server, CheckCircle2, Lock, AlertTriangle, ArrowRight, Eye, EyeOff, Loader2, Circle } from 'lucide-react';

const STEPS: Array<{ stage: string; text: string }> = [
  { stage: 'checking', text: 'Checking your details' },
  { stage: 'creating', text: 'Broker confirms your login' },
  { stage: 'deploying', text: 'Starting your trading terminal' },
  { stage: 'syncing', text: 'Syncing with your broker' },
  { stage: 'verifying', text: 'Reading your account' },
];
const stepIndex = (stage: string) => STEPS.findIndex((x) => x.stage === stage);

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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [errorRef, setErrorRef] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [progress, setProgress] = useState<ConnectProgress | null>(null);
  // The broker is slow: the server keeps connecting the terminal and the dashboard follows it.
  const [background, setBackground] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

      const outcome = await tradingEngine.connectMt5Account(userId, accountNumber.trim(), brokerServer.trim(), password, setProgress);
      // Password is immediately discarded from memory
      setPassword('');
      if (outcome === 'background') {
        // Not a failure: the server carries on and the dashboard shows the account as soon as it is ready.
        setBackground(true);
        return;
      }
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1500);
    } catch (err: any) {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100">
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
                Your trading terminal is taking a little longer to connect with your broker. We will keep going in the
                background, and your dashboard will update by itself when it is ready.
              </p>
              <p className="text-[11px] text-slate-500">Your password was sent securely and is not kept on this page.</p>
              <button
                type="button"
                onClick={closeAndReset}
                className="w-full py-3 px-4 rounded-xl bg-blue-500 hover:bg-blue-400 font-semibold text-sm text-white transition cursor-pointer"
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
              <p className="text-xs text-slate-400">Trades from the master account now copy to #{accountNumber}.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
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

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Account number</label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 absolute left-3 top-3.5 text-slate-500" />
                  <input
                    type="text"
                    inputMode="numeric"
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
                <p className="text-[11px] text-slate-500 mt-1">Shown in your MT5 login screen.</p>
              </div>

              {isConnecting && progress && (
                <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3 space-y-2.5" aria-live="polite">
                  <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-700"
                      style={{ width: `${Math.max(3, progress.percent)}%` }}
                    />
                  </div>
                  <ul className="space-y-1.5">
                    {STEPS.map((st, i) => {
                      const cur = stepIndex(progress.stage);
                      const done = cur > i;
                      const active = cur === i || (cur === -1 && i === 0);
                      return (
                        <li key={st.stage} className={`flex items-center gap-2 text-xs ${done ? 'text-emerald-400' : active ? 'text-white' : 'text-slate-500'}`}>
                          {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : active ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Circle className="w-3.5 h-3.5" />}
                          <span>{st.text}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-[11px] text-slate-400">
                    This usually takes under a minute, but some brokers need a few minutes. You can close this window at any
                    time: we keep connecting in the background and your dashboard updates by itself.
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={isConnecting}
                className="w-full py-3 px-4 rounded-xl bg-blue-500 hover:bg-blue-400 font-semibold text-sm text-white transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
  );
};
