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
        setTimeLeft('Overdue: pay now to resume copying');
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

  const money = (n: number | undefined, plus = false) =>
    typeof n === 'number' && Number.isFinite(n) ? `${plus ? '+' : ''}$${n.toFixed(2)}` : '—';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100 max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <Wallet className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm text-white">Pay your profit share</h3>
              <p className="text-[11px] text-slate-400">USDT on TRON (TRC20)</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg transition cursor-pointer" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {success ? (
            <div className="p-6 text-center space-y-2">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h4 className="text-base font-semibold text-white">Payment verified</h4>
              <p className="text-xs text-slate-300">Thank you. Your copying continues.</p>
            </div>
          ) : (
            <>
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Profit this period</span>
                  <span className="font-mono font-semibold text-emerald-400">{money(invoice?.grossProfit, true)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-800/80 pt-2.5">
                  <span className="text-xs font-medium text-slate-300">Your 50% share</span>
                  <span className="text-lg font-bold text-amber-400 font-mono">
                    {invoice ? `${money(invoice.amountDueUsdt)} USDT` : '—'}
                  </span>
                </div>
                {invoice && (
                  <div className="flex items-center gap-2 text-[11px] text-amber-300">
                    <Clock className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                    <span className="font-mono">{timeLeft || 'Due within 24 hours'}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-300">Payment address</label>
                  <span className="text-[10px] text-slate-400 font-mono">TRON only</span>
                </div>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2.5">
                  <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800/80 text-center font-mono text-xs text-emerald-300 break-all select-all">
                    {(invoice?.recipientAddress || CASTIMO_TREASURY_ADDRESS) || 'Payment address not set yet'}
                  </div>
                  <button
                    type="button"
                    disabled={!(invoice?.recipientAddress || CASTIMO_TREASURY_ADDRESS)}
                    onClick={() => copyToClipboard(invoice?.recipientAddress || CASTIMO_TREASURY_ADDRESS)}
                    className="w-full py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs flex items-center justify-center gap-2 transition cursor-pointer border border-slate-700 disabled:opacity-50"
                  >
                    {copied ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 text-slate-300" />
                        <span>Copy address</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  {invoice ? `Send exactly ${money(invoice.amountDueUsdt)} USDT, TRC20 only.` : 'Send TRC20 USDT only.'}
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 text-xs rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <form onSubmit={handleVerify} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Transaction ID (TXID)</label>
                  <input
                    type="text"
                    value={txHash}
                    onChange={(e) => setTxHash(e.target.value)}
                    placeholder="64-character ID from your wallet"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isVerifying || !invoice}
                  className="btn-gold w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{isVerifying ? 'Verifying…' : 'Verify payment'}</span>
                </button>
              </form>

              <p className="text-[11px] text-slate-400 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 -mt-0.5" />
                <span>If an invoice is still unpaid after 24 hours, copying pauses until you pay it.</span>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
