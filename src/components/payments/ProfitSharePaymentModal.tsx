import React, { useState, useEffect } from 'react';
import {
  CASTIMO_TREASURY_ADDRESS,
  TRC20_USDT_CONTRACT,
  tradingEngine,
} from '../../services/tradingEngine';
import { ProfitShareInvoice } from '../../types';
import {
  Wallet,
  Copy,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Zap,
} from 'lucide-react';

interface ProfitSharePaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
}

export const ProfitSharePaymentModal: React.FC<ProfitSharePaymentModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [invoice, setInvoice] = useState<ProfitShareInvoice | null>(
    tradingEngine.getActiveProfitInvoice()
  );
  const [txHash, setTxHash] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const unsub = tradingEngine.subscribe(() => {
      setInvoice(tradingEngine.getActiveProfitInvoice());
    });
    setInvoice(tradingEngine.getActiveProfitInvoice());
    return () => unsub();
  }, []);

  // Live 24h countdown
  useEffect(() => {
    if (!invoice?.dueAt) return;

    const updateTimer = () => {
      const diff = new Date(invoice.dueAt).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft('Expired (24h window elapsed)');
      } else {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        setTimeLeft(`${hours}h ${minutes}m ${seconds}s remaining`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [invoice?.dueAt]);

  if (!isOpen) return null;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!invoice) return;

    setErrorMsg(null);
    setIsVerifying(true);

    const result = await tradingEngine.payProfitShareInvoice(invoice.id, txHash);
    setIsVerifying(false);

    if (result.success) {
      setSuccess(true);
      setTimeout(() => {
        onClose();
        setSuccess(false);
        setTxHash('');
      }, 2000);
    } else {
      setErrorMsg(result.error || 'Verification failed.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 bg-gradient-to-r from-emerald-600/20 via-slate-900 to-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">50% Profit Share Settlement</h3>
              <p className="text-xs text-slate-400">TRC20 USDT On-Chain Remittance</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition"
          >
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {success ? (
            <div className="p-8 text-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 animate-bounce" />
              </div>
              <h4 className="text-lg font-bold text-white">50% Profit Share Settled!</h4>
              <p className="text-xs text-slate-300">
                Payment verified on TRC20 network. Your MT5 trade copying status is fully active and protected from the 24-hour disconnect timeout.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Due Details Card */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Realized Gross Profit:</span>
                  <span className="font-mono font-bold text-emerald-400 text-sm">
                    +${(invoice?.grossProfit || 300).toFixed(2)} USD
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Performance Share Rate:</span>
                  <span className="font-mono font-bold text-white">50% Split</span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-800/80 pt-2">
                  <span className="text-xs font-semibold text-slate-300">Castimofx Share Due:</span>
                  <span className="text-xl font-black text-amber-400 font-mono">
                    ${(invoice?.amountDueUsdt || 150).toFixed(2)} USDT
                  </span>
                </div>

                {/* 24h Countdown Banner */}
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
                  <Clock className="w-4 h-4 shrink-0 text-amber-400" />
                  <div className="flex-1">
                    <span className="font-semibold">24-Hour Settlement Window: </span>
                    <span className="font-mono font-bold text-white">{timeLeft || '24h window active'}</span>
                  </div>
                </div>
              </div>

              {/* TRC20 Wallet Address Copy Box (NO QR CODE) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">
                    Castimofx Treasury USDT Wallet (TRC20):
                  </label>
                  <span className="text-[10px] text-emerald-400 font-mono font-semibold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    TRON Network Only
                  </span>
                </div>

                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2.5">
                  <div className="p-3 bg-slate-900 rounded-lg border border-slate-800/80 text-center font-mono text-xs sm:text-sm text-emerald-300 break-all select-all font-bold">
                    {CASTIMO_TREASURY_ADDRESS}
                  </div>

                  <button
                    type="button"
                    onClick={() => copyToClipboard(CASTIMO_TREASURY_ADDRESS)}
                    className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-white font-semibold text-xs flex items-center justify-center gap-2 transition cursor-pointer border border-slate-700 shadow-sm"
                  >
                    {copied ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span className="text-emerald-400">Address Copied to Clipboard!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 text-slate-300" />
                        <span>Copy TRC20 USDT Address</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Send exactly ${(invoice?.amountDueUsdt || 150).toFixed(2)} USDT on the TRON (TRC20) network. Once paid, trade replication will remain uninterrupted.
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 text-xs rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* TXID Submission & Verification Form */}
              <form onSubmit={handleVerify} className="space-y-3 pt-1">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Transaction ID / TX Hash (Optional for Instant Verification):
                  </label>
                  <input
                    type="text"
                    value={txHash}
                    onChange={(e) => setTxHash(e.target.value)}
                    placeholder="Enter 64-char transaction hash from your wallet..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={isVerifying}
                    className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 font-bold text-xs text-slate-950 shadow-md shadow-emerald-500/20 transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{isVerifying ? 'Verifying...' : 'Confirm Remittance'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleVerify()}
                    disabled={isVerifying}
                    className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 font-semibold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>Instant Demo Settle</span>
                  </button>
                </div>
              </form>

              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  Accounts that fail to remit the 50% profit share within 24 hours of profit generation are automatically disconnected by the server-side watcher.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
