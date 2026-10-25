import React, { useState } from 'react';
import { tradingEngine } from '../../services/tradingEngine';
import { KeyRound, Server, CheckCircle2, Lock, AlertTriangle, ArrowRight } from 'lucide-react';

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

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
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
      <div className="relative w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Server className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-base text-white">Connect your MT5 account</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg transition" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="p-5">
          {success ? (
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
                  <span>{errorMsg}</span>
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
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className={inputCls}
                  />
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

              <button
                type="submit"
                disabled={isConnecting}
                className="w-full py-3 px-4 rounded-xl bg-blue-500 hover:bg-blue-400 font-semibold text-sm text-white transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isConnecting ? (
                  <span>Connecting...</span>
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
