import React, { useState } from 'react';
import { tradingEngine } from '../../services/tradingEngine';
import { Shield, KeyRound, Server, CheckCircle2, Lock, AlertTriangle, ArrowRight, Radio } from 'lucide-react';

interface Mt5ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
}

const COMMON_SERVERS = [
  'ICMarketsSC-Live02',
  'ICMarketsSC-Live05',
  'FTMO-Server-Live',
  'Tickmill-Live01',
  'Exness-Real10',
  'Pepperstone-Edge-Live',
];

export const Mt5ConnectionModal: React.FC<Mt5ConnectionModalProps> = ({
  isOpen,
  onClose,
  userId,
}) => {
  const masterAccount = tradingEngine.getMasterAccount();
  const [accountNumber, setAccountNumber] = useState('');
  const [brokerServer, setBrokerServer] = useState(COMMON_SERVERS[0]);
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
        throw new Error('Please enter MT5 account password.');
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100">
        <div className="p-5 border-b border-slate-800 bg-gradient-to-r from-blue-600/20 via-slate-900 to-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">Connect MT5 Terminal</h3>
              <p className="text-xs text-slate-400">Direct low-latency bridge synchronization</p>
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
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h4 className="text-base font-bold text-white">Connected to Main Master MT5</h4>
              <p className="text-xs text-slate-300">
                Your MT5 Account #{accountNumber} is now successfully bound to <strong>Main Master MT5 #{masterAccount.accountNumber} ({masterAccount.accountName})</strong>.
              </p>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-emerald-400 font-mono">
                All trades placed on Main Master will replicate directly into your terminal.
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3.5">
              {/* Target Main Master Account Banner */}
              <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/30 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-purple-300">
                    <Radio className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
                    <span>Copying From: Main Master MT5</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    Broadcasting Live
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div>
                    <span className="text-white font-mono font-bold">#{masterAccount.accountNumber}</span>
                    <span className="text-slate-400 text-[11px] block">{masterAccount.accountName}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-400 text-[11px] block font-mono">{masterAccount.brokerServer}</span>
                    <span className="text-[10px] text-emerald-400 font-mono">{masterAccount.latencyMs}ms Latency</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed border-t border-purple-500/20 pt-1.5">
                  Connecting your MT5 terminal allows it to replicate every trade executed by this Main Master account with zero-delay execution.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-400">
                  <Shield className="w-3.5 h-3.5" />
                  <span>Security Guarantee (Section 3 & 7)</span>
                </div>
                <p>
                  Your credentials are transmitted directly over encrypted TLS to the isolated Node.js MT5 bridge.
                  The public web server <strong>never stores your password</strong> in the database or logs.
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 text-xs rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Broker Server Name
                </label>
                <div className="relative">
                  <Server className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                  <input
                    type="text"
                    required
                    list="server-options"
                    value={brokerServer}
                    onChange={(e) => setBrokerServer(e.target.value)}
                    placeholder="e.g. ICMarketsSC-Live02"
                    className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-xl focus:border-blue-500 text-white font-mono"
                  />
                  <datalist id="server-options">
                    {COMMON_SERVERS.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  MT5 Account Login ID
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                  <input
                    type="text"
                    required
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder="e.g. 8829104"
                    className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-xl focus:border-blue-500 text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  MT5 Password (Master or Investor)
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-xl focus:border-blue-500 text-white"
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Forwarded in-memory to MT5 copier process.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isConnecting}
                  className="w-full py-2.5 px-4 rounded-xl bg-blue-500 hover:bg-blue-400 font-semibold text-xs text-white shadow-md shadow-blue-500/20 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isConnecting ? (
                    <span>Establishing Bridge Handshake...</span>
                  ) : (
                    <>
                      <span>Connect & Synchronize Copier</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
