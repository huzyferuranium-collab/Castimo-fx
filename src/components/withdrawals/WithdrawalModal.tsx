import React, { useState, useEffect } from 'react';
import { tradingEngine } from '../../services/tradingEngine';
import {
  ArrowUpRight,
  ShieldAlert,
  AlertTriangle,
  Lock,
  CheckCircle2,
  DollarSign,
  Info,
  Clock,
} from 'lucide-react';

interface WithdrawalModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  userEmail: string;
}

export const WithdrawalModal: React.FC<WithdrawalModalProps> = ({
  isOpen,
  onClose,
  userId,
  userEmail,
}) => {
  const [calc, setCalc] = useState(tradingEngine.calculateWithdrawableAmount());
  const [amount, setAmount] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCalc(tradingEngine.calculateWithdrawableAmount());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        throw new Error('Please enter a valid withdrawal amount.');
      }

      tradingEngine.submitWithdrawalRequest(userId, userEmail, numAmount, destinationAddress);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setAmount('');
        setDestinationAddress('');
        onClose();
      }, 1800);
    } catch (err: any) {
      setErrorMsg(err.message || 'Withdrawal submission failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const setMaxAmount = () => {
    if (calc.withdrawable > 0) {
      setAmount(calc.withdrawable.toString());
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 bg-gradient-to-r from-emerald-600/20 via-slate-900 to-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <ArrowUpRight className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">Request TRC20 Withdrawal</h3>
              <p className="text-xs text-slate-400">Real-time margin safety lock (Section 10)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition"
          >
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          {success ? (
            <div className="p-6 text-center space-y-3">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h4 className="font-bold text-base text-white">Withdrawal Reserved</h4>
              <p className="text-xs text-slate-400">
                Amount has been atomically locked against your MT5 account. Status set to <span className="font-semibold text-amber-400">reserved</span> awaiting administrator signoff.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Dynamic Safety Calculator Card */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-400 font-medium">Estimated Withdrawable:</div>
                  <div className="text-2xl font-black text-emerald-400">
                    ${calc.withdrawable.toFixed(2)} <span className="text-xs text-slate-400 font-normal">USDT</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800 text-[11px]">
                  <div className="bg-slate-900/60 p-2 rounded-lg">
                    <span className="text-slate-500 block">Total MT5 Equity</span>
                    <span className="font-mono font-semibold text-slate-200">
                      ${calc.formulaDetails.equity.toFixed(2)}
                    </span>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded-lg">
                    <span className="text-slate-500 block">Free Margin</span>
                    <span className="font-mono font-semibold text-slate-200">
                      ${calc.formulaDetails.freeMargin.toFixed(2)}
                    </span>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded-lg">
                    <span className="text-slate-500 block">Open Trades Status</span>
                    <span className={`font-semibold ${calc.hasOpenTrades ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {calc.hasOpenTrades ? 'Active (50% Margin Cap)' : 'No Open Trades'}
                    </span>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded-lg">
                    <span className="text-slate-500 block">Pending Reservations</span>
                    <span className="font-mono font-semibold text-amber-300">
                      ${calc.formulaDetails.pendingReservations.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Formula Breakdown */}
                <div className="text-[10px] text-slate-400 bg-slate-900 p-2.5 rounded-lg border border-slate-800/80 space-y-1">
                  <div className="font-semibold text-slate-300 flex items-center gap-1">
                    <Info className="w-3 h-3 text-emerald-400" />
                    <span>Exact Safe Calculation Rule:</span>
                  </div>
                  {calc.hasOpenTrades ? (
                    <p className="font-mono text-[10px] text-slate-400">
                      MIN( (FreeMargin $ {calc.formulaDetails.freeMargin.toFixed(2)} × 50%) - Res ${calc.formulaDetails.pendingReservations.toFixed(2)}, Equity ${calc.formulaDetails.equity.toFixed(2)} - $200 )
                    </p>
                  ) : (
                    <p className="font-mono text-[10px] text-slate-400">
                      Free Margin (${calc.formulaDetails.freeMargin.toFixed(2)}) - Pending Reservations (${calc.formulaDetails.pendingReservations.toFixed(2)})
                    </p>
                  )}
                </div>
              </div>

              {calc.isBlocked && (
                <div className="p-3 text-xs rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{calc.reason}</span>
                </div>
              )}

              {errorMsg && (
                <div className="p-3 text-xs rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Warning Notice */}
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300/90 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  Notice: Market movement affects floating margin continuously. Withdrawable capacity is recomputed atomically at the exact millisecond of submission.
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Withdrawal Amount (USDT)
                </label>
                <div className="relative">
                  <DollarSign className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                  <input
                    type="number"
                    step="0.01"
                    min="10"
                    max={calc.withdrawable}
                    disabled={calc.isBlocked}
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-9 pr-16 py-2.5 text-xs bg-slate-950 border border-slate-700 rounded-xl focus:border-emerald-500 text-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={setMaxAmount}
                    disabled={calc.isBlocked || calc.withdrawable <= 0}
                    className="absolute right-2 top-2 px-2 py-1 text-[10px] font-bold rounded-md bg-slate-800 hover:bg-slate-700 text-emerald-400"
                  >
                    MAX
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Recipient TRC20 USDT Address
                </label>
                <input
                  type="text"
                  required
                  disabled={calc.isBlocked}
                  value={destinationAddress}
                  onChange={(e) => setDestinationAddress(e.target.value)}
                  placeholder="e.g. TXg8A2k9YvLmNpQrStUvWxYz0123456789"
                  className="w-full px-3 py-2.5 text-xs font-mono bg-slate-950 border border-slate-700 rounded-xl focus:border-emerald-500 text-white"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Must begin with 'T' (TRON network). Double check before requesting.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting || calc.isBlocked || calc.withdrawable <= 0}
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 font-semibold text-xs text-slate-950 shadow-md shadow-emerald-500/20 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Lock Atomic Reservation & Request Payout</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
