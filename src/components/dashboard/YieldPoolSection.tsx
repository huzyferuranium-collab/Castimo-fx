import React, { useState, useEffect, useMemo, useId } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  TrendingUp,
  Wallet,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Shield,
  Copy,
  Check,
  QrCode,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Lock,
  Layers,
  Sparkles,
  Sliders,
  DollarSign,
  ChevronRight,
  ArrowRight,
  X,
  Info,
  Flame,
  Calendar,
} from 'lucide-react';
import { CASTIMO_TREASURY_ADDRESS } from '../../services/tradingEngine';
import {
  UserYieldAllocation,
  YieldLedgerEntry,
  YieldPoolSummary,
} from '../../types/yieldPool';
import {
  subscribeUserYieldAllocation,
  subscribeUserYieldLedger,
  submitYieldPoolAllocation,
  submitYieldPoolWithdrawal,
  computeDailyMarketYieldRate,
  isFxTradingDay,
  getMsUntilNextDistribution,
  projectPerformanceGrowth,
} from '../../services/yieldPoolService';
import { AnimatedNumber } from '../common/AnimatedNumber';

interface YieldPoolSectionProps {
  userId: string;
  userEmail?: string;
  onNavigateToPositions?: () => void;
}

export const YieldPoolSection: React.FC<YieldPoolSectionProps> = ({
  userId,
  userEmail,
  onNavigateToPositions,
}) => {
  // ---- Real-time State ----
  const [allocation, setAllocation] = useState<UserYieldAllocation | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<YieldLedgerEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [syncError, setSyncError] = useState<string | null>(null);

  // ---- Distribution Timer State ----
  const [msRemaining, setMsRemaining] = useState<number>(getMsUntilNextDistribution());
  const isMarketOpen = isFxTradingDay();

  useEffect(() => {
    const timer = setInterval(() => {
      setMsRemaining(getMsUntilNextDistribution());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTimer = (ms: number) => {
    const totalSecs = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSecs / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const seconds = totalSecs % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // ---- Subscriptions ----
  useEffect(() => {
    if (!userId) return;
    setIsLoading(true);

    const unsubAlloc = subscribeUserYieldAllocation(
      userId,
      (data) => {
        setAllocation(data);
        setIsLoading(false);
      },
      (err) => {
        setSyncError(err.message);
        setIsLoading(false);
      }
    );

    const unsubLedger = subscribeUserYieldLedger(
      userId,
      (entries) => {
        setLedgerEntries(entries);
      },
      (err) => {
        console.warn('⚠️ [YieldPool] Ledger sync notice:', err.message);
      }
    );

    return () => {
      unsubAlloc();
      unsubLedger();
    };
  }, [userId]);

  // Fallback demo defaults if new user has not allocated yet
  const allocatedUsdt = allocation?.allocatedAmountUsdt ?? 0;
  const walletBalanceUsdt = allocation?.walletBalanceUsdt ?? 0;
  const totalYieldEarnedUsdt = allocation?.totalYieldEarnedUsdt ?? 0;
  const currentDailyRate = allocation?.dailyRatePct ?? computeDailyMarketYieldRate(new Date(), 1.45);

  // ---- Deposit Drawer / Modal State ----
  const [showDepositDrawer, setShowDepositDrawer] = useState<boolean>(false);
  const [depositAmount, setDepositAmount] = useState<string>('500');
  const [depositTxHash, setDepositTxHash] = useState<string>('');
  const [depositSubmitting, setDepositSubmitting] = useState<boolean>(false);
  const [depositMessage, setDepositMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedWallet, setCopiedWallet] = useState<boolean>(false);

  // ---- Withdrawal Modal State ----
  const [showWithdrawDrawer, setShowWithdrawDrawer] = useState<boolean>(false);
  const [withdrawAmount, setWithdrawAmount] = useState<string>('');
  const [withdrawAddress, setWithdrawAddress] = useState<string>('');
  const [withdrawSubmitting, setWithdrawSubmitting] = useState<boolean>(false);
  const [withdrawMessage, setWithdrawMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ---- Performance Projection Visualizer State ----
  const [projectionTimeframeDays, setProjectionTimeframeDays] = useState<number>(30); // 7, 30, 90, 180, 365
  const [simulatedPrincipal, setSimulatedPrincipal] = useState<number>(allocatedUsdt > 0 ? allocatedUsdt : 1000);

  // Sync simulated principal if user has an active deposit
  useEffect(() => {
    if (allocatedUsdt > 0 && simulatedPrincipal === 1000) {
      setSimulatedPrincipal(allocatedUsdt);
    }
  }, [allocatedUsdt]);

  const projection = useMemo(() => {
    return projectPerformanceGrowth(simulatedPrincipal, projectionTimeframeDays, currentDailyRate);
  }, [simulatedPrincipal, projectionTimeframeDays, currentDailyRate]);

  // Copy helper
  const handleCopyWallet = () => {
    if (!CASTIMO_TREASURY_ADDRESS) return;
    navigator.clipboard.writeText(CASTIMO_TREASURY_ADDRESS);
    setCopiedWallet(true);
    setTimeout(() => setCopiedWallet(false), 2000);
  };

  // Submit Deposit
  const handleDepositSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDepositMessage(null);
    const amt = parseFloat(depositAmount);
    if (isNaN(amt) || amt < 200) {
      setDepositMessage({ type: 'error', text: 'Minimum pool allocation is $200 USDT.' });
      return;
    }
    if (!depositTxHash || depositTxHash.trim().length < 32) {
      setDepositMessage({ type: 'error', text: 'Please provide a valid 64-character TRC20 Transaction Hash (TxID).' });
      return;
    }

    setDepositSubmitting(true);
    try {
      const res = await submitYieldPoolAllocation({
        userId,
        amountUsdt: amt,
        txHash: depositTxHash.trim(),
        recipientAddress: CASTIMO_TREASURY_ADDRESS,
      });

      if (res.success) {
        setDepositMessage({
          type: 'success',
          text: 'Allocation TxID submitted successfully! Your allocation will be credited upon TRON blockchain validation.',
        });
        setDepositTxHash('');
        setTimeout(() => {
          setShowDepositDrawer(false);
          setDepositMessage(null);
        }, 2200);
      } else {
        setDepositMessage({ type: 'error', text: res.error || 'Failed to submit allocation.' });
      }
    } catch (err: any) {
      setDepositMessage({ type: 'error', text: err?.message || 'Transaction submission error.' });
    } finally {
      setDepositSubmitting(false);
    }
  };

  // Submit Withdrawal
  const handleWithdrawSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWithdrawMessage(null);
    const amt = parseFloat(withdrawAmount);
    if (isNaN(amt) || amt <= 0) {
      setWithdrawMessage({ type: 'error', text: 'Please enter a valid withdrawal amount.' });
      return;
    }
    if (amt > walletBalanceUsdt) {
      setWithdrawMessage({ type: 'error', text: `Insufficient balance. Available: $${walletBalanceUsdt.toFixed(2)} USDT` });
      return;
    }
    if (!withdrawAddress || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(withdrawAddress.trim())) {
      setWithdrawMessage({ type: 'error', text: 'Please enter a valid TRON (TRC20) USDT wallet address.' });
      return;
    }

    setWithdrawSubmitting(true);
    try {
      const res = await submitYieldPoolWithdrawal({
        userId,
        amountUsdt: amt,
        destinationAddress: withdrawAddress.trim(),
      });
      if (res.success) {
        setWithdrawMessage({
          type: 'success',
          text: 'Withdrawal request registered! Payout is being processed via TRC20 network.',
        });
        setWithdrawAmount('');
        setTimeout(() => {
          setShowWithdrawDrawer(false);
          setWithdrawMessage(null);
        }, 2200);
      } else {
        setWithdrawMessage({ type: 'error', text: res.error || 'Withdrawal request failed.' });
      }
    } catch (err: any) {
      setWithdrawMessage({ type: 'error', text: err?.message || 'Withdrawal processing error.' });
    } finally {
      setWithdrawSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* ========================================================
          1. HEADER SUMMARY CARDS GRID
          ======================================================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Allocated */}
        <motion.div
          whileHover={{ y: -2 }}
          className="relative overflow-hidden rounded-3xl bg-slate-900/90 dark:bg-slate-900 border border-slate-800 p-5 shadow-lg backdrop-blur-md"
        >
          <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-600/10 blur-xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Total Allocated</span>
            <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 font-display font-extrabold text-2xl sm:text-3xl text-white">
            <AnimatedNumber value={allocatedUsdt} prefix="$" decimals={2} />
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {allocation?.status === 'active' ? 'Strategy Active' : allocatedUsdt > 0 ? 'Pending Sync' : 'Ready to Allocate'}
            </span>
            <span>• TRC20 Pool</span>
          </div>
        </motion.div>

        {/* Card 2: Total Dynamic Yield Earned */}
        <motion.div
          whileHover={{ y: -2 }}
          className="relative overflow-hidden rounded-3xl bg-slate-900/90 dark:bg-slate-900 border border-slate-800 p-5 shadow-lg backdrop-blur-md"
        >
          <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-600/10 blur-xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Dynamic Yield Earned</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 font-display font-extrabold text-2xl sm:text-3xl text-emerald-400">
            <AnimatedNumber value={totalYieldEarnedUsdt} prefix="+$" decimals={2} signed={false} />
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            <span className="text-emerald-300 font-semibold flex items-center gap-0.5">
              <ArrowUpRight className="w-3.5 h-3.5" />
              {currentDailyRate.toFixed(2)}%
            </span>
            <span>Est. daily performance</span>
          </div>
        </motion.div>

        {/* Card 3: Current Wallet Balance */}
        <motion.div
          whileHover={{ y: -2 }}
          className="relative overflow-hidden rounded-3xl bg-slate-900/90 dark:bg-slate-900 border border-slate-800 p-5 shadow-lg backdrop-blur-md"
        >
          <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-gradient-to-br from-violet-500/20 to-purple-600/10 blur-xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Wallet Balance</span>
            <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 font-display font-extrabold text-2xl sm:text-3xl text-white">
            <AnimatedNumber value={walletBalanceUsdt} prefix="$" decimals={2} />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-slate-400">Available to withdraw</span>
            {walletBalanceUsdt > 0 && (
              <button
                type="button"
                onClick={() => setShowWithdrawDrawer(true)}
                className="text-violet-400 hover:text-violet-300 font-semibold cursor-pointer underline decoration-dotted"
              >
                Withdraw
              </button>
            )}
          </div>
        </motion.div>

        {/* Card 4: Next Distribution Countdown */}
        <motion.div
          whileHover={{ y: -2 }}
          className="relative overflow-hidden rounded-3xl bg-slate-900/90 dark:bg-slate-900 border border-slate-800 p-5 shadow-lg backdrop-blur-md"
        >
          <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-600/10 blur-xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Next Distribution</span>
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 font-mono font-extrabold text-2xl sm:text-3xl text-amber-300 tracking-wider">
            {formatTimer(msRemaining)}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            <span
              className={`inline-flex items-center gap-1 font-semibold ${
                isMarketOpen ? 'text-emerald-400' : 'text-slate-400'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isMarketOpen ? 'bg-emerald-400' : 'bg-slate-500'}`} />
              {isMarketOpen ? 'Active FX Session' : 'Weekend (Paused)'}
            </span>
            <span>• 00:00 UTC</span>
          </div>
        </motion.div>
      </div>

      {/* ========================================================
          2. CALL-TO-ACTION & STRATEGY QUICK BAR
          ======================================================== */}
      <div className="rounded-3xl bg-gradient-to-r from-cyan-950/40 via-slate-900 to-indigo-950/40 border border-cyan-500/30 p-5 sm:p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-5 shadow-xl">
        <div className="space-y-1.5 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>High-Frequency Quantitative Performance Allocation</span>
          </div>
          <h2 className="text-lg sm:text-xl font-display font-extrabold text-white">
            Variable Strategy Yield Pool (Up to 2.0% Daily)
          </h2>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            Non-custodial algorithmic capital strategy operating alongside your MT5 mirror. 
            Allocations earn dynamic performance on active market days (Monday to Friday). 
            Profits are credited daily to your wallet balance.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto shrink-0">
          <button
            type="button"
            onClick={() => setShowDepositDrawer(true)}
            className="flex-1 md:flex-none px-5 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-extrabold text-xs sm:text-sm shadow-lg shadow-emerald-500/25 transition cursor-pointer flex items-center justify-center gap-2"
          >
            <Layers className="w-4 h-4" />
            <span>Allocate USDT</span>
          </button>

          {walletBalanceUsdt > 0 && (
            <button
              type="button"
              onClick={() => setShowWithdrawDrawer(true)}
              className="px-4 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs sm:text-sm border border-slate-700 transition cursor-pointer"
            >
              Withdraw
            </button>
          )}
        </div>
      </div>

      {/* ========================================================
          3. PERFORMANCE PROJECTION VISUALIZER (MOTION)
          ======================================================== */}
      <div className="rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <h3 className="font-display font-extrabold text-base text-white">
                Interactive Growth Projection Visualizer
              </h3>
            </div>
            <p className="text-xs text-slate-400">
              Compound growth simulation based on current dynamic rate ({currentDailyRate.toFixed(2)}%/day) on trading days.
            </p>
          </div>

          {/* Timeframe Selector Pills */}
          <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-2xl border border-slate-800 self-start sm:self-auto">
            {[
              { label: '7D', days: 7 },
              { label: '30D', days: 30 },
              { label: '90D', days: 90 },
              { label: '180D', days: 180 },
              { label: '1 Year', days: 365 },
            ].map((tf) => (
              <button
                key={tf.days}
                type="button"
                onClick={() => setProjectionTimeframeDays(tf.days)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  projectionTimeframeDays === tf.days
                    ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>

        {/* Projection Controls & Result Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Slider Controls */}
          <div className="lg:col-span-5 space-y-5">
            <div>
              <div className="flex items-center justify-between text-xs font-semibold mb-2">
                <span className="text-slate-400">Simulated Principal (USDT)</span>
                <span className="font-mono text-cyan-400 font-bold text-sm">
                  ${simulatedPrincipal.toLocaleString()} USDT
                </span>
              </div>
              <input
                type="range"
                min="200"
                max="50000"
                step="100"
                value={simulatedPrincipal}
                onChange={(e) => setSimulatedPrincipal(Number(e.target.value))}
                className="w-full accent-cyan-500 bg-slate-800 h-2 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
                <span>$200 min</span>
                <span>$10,000</span>
                <span>$25,000</span>
                <span>$50,000 max</span>
              </div>
            </div>

            {/* Quick Presets */}
            <div className="flex flex-wrap gap-2 pt-1">
              {[500, 1000, 2500, 5000, 10000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setSimulatedPrincipal(preset)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition cursor-pointer ${
                    simulatedPrincipal === preset
                      ? 'bg-slate-700 text-cyan-300 border border-cyan-500/40'
                      : 'bg-slate-800/80 text-slate-400 hover:text-white border border-slate-700/60'
                  }`}
                >
                  ${preset >= 1000 ? `${preset / 1000}k` : preset}
                </button>
              ))}
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Trading Days Included:</span>
                <span className="font-mono font-bold text-white">
                  {Math.round(projectionTimeframeDays * (5 / 7))} days (Mon–Fri)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Compounding Rate:</span>
                <span className="font-mono font-bold text-emerald-400">
                  {currentDailyRate.toFixed(2)}% / active session
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Strategy Fee:</span>
                <span className="font-mono font-bold text-cyan-300">0% Upfront • High-Water Mark</span>
              </div>
            </div>
          </div>

          {/* Interactive Graphic & Projected Metrics */}
          <div className="lg:col-span-7 bg-slate-950 p-5 rounded-2xl border border-slate-800 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Projected Total Equity
                </span>
                <span className="text-xl sm:text-2xl font-display font-extrabold text-white mt-1 block">
                  ${projection.finalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-[11px] text-slate-500 mt-1 block">Principal + Compound Yield</span>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-emerald-500/20">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 block">
                  Estimated Net Profit
                </span>
                <span className="text-xl sm:text-2xl font-display font-extrabold text-emerald-400 mt-1 block">
                  +${projection.totalYield.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-[11px] text-emerald-500/80 mt-1 block">
                  +{((projection.totalYield / (simulatedPrincipal || 1)) * 100).toFixed(1)}% total ROI
                </span>
              </div>
            </div>

            {/* Sparkline Visualizer with Motion */}
            <div className="pt-2">
              <div className="h-28 w-full flex items-end gap-1.5 sm:gap-2 px-1 relative">
                {projection.dataPoints.map((pt, idx) => {
                  const maxEquity = projection.finalAmount || 1;
                  const minEquity = simulatedPrincipal || 1;
                  const range = Math.max(1, maxEquity - minEquity);
                  const normalizedPct = Math.max(12, Math.min(100, ((pt.equity - minEquity) / range) * 88 + 12));

                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-1 group relative">
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${normalizedPct}%` }}
                        transition={{ duration: 0.45, delay: idx * 0.03, ease: 'easeOut' }}
                        className="w-full rounded-t-md bg-gradient-to-t from-cyan-600 via-teal-500 to-emerald-400 group-hover:brightness-125 transition-all shadow-sm"
                      />
                      <span className="text-[9px] font-mono text-slate-500 opacity-60">
                        {idx === 0 ? 'D0' : idx === projection.dataPoints.length - 1 ? `D${pt.day}` : ''}
                      </span>

                      {/* Tooltip */}
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block bg-slate-800 text-white text-[10px] font-mono px-2 py-0.5 rounded shadow-lg z-20 pointer-events-none whitespace-nowrap border border-slate-700">
                        ${pt.equity.toLocaleString()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================
          4. AUDIT / TRANSACTION LOG TABLE
          ======================================================== */}
      <div className="rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
          <div className="space-y-0.5">
            <h3 className="font-display font-extrabold text-base text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-emerald-400" />
              <span>Pool Transaction & Yield Distribution Audit Log</span>
            </h3>
            <p className="text-xs text-slate-400">
              Immutable ledger history tracking allocations, automatic distributions, and withdrawals.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-500">
              {ledgerEntries.length} recorded event{ledgerEntries.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        {ledgerEntries.length === 0 ? (
          <div className="py-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto text-slate-400">
              <Layers className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-white">No pool transactions yet</p>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Allocate funds to begin recording automated market yield distributions every active trading day.
            </p>
            <button
              type="button"
              onClick={() => setShowDepositDrawer(true)}
              className="mt-2 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition cursor-pointer"
            >
              Start First Allocation ($200 min)
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-6 sm:mx-0">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-mono text-[10px] border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Date (UTC)</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">TxID / Reference</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Net Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {ledgerEntries.map((tx) => {
                  const isYield = tx.type === 'yield_distribution';
                  const isDeposit = tx.type === 'allocation';
                  const isWithdraw = tx.type === 'withdrawal_request';

                  return (
                    <tr key={tx.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4 whitespace-nowrap text-slate-400">
                        {new Date(tx.createdAt).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            isYield
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : isDeposit
                              ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                              : 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                          }`}
                        >
                          {isYield && <TrendingUp className="w-3 h-3" />}
                          {isDeposit && <ArrowDownRight className="w-3 h-3" />}
                          {isWithdraw && <ArrowUpRight className="w-3 h-3" />}
                          {isYield ? 'Yield Distribution' : isDeposit ? 'Pool Allocation' : 'Withdrawal Request'}
                        </span>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        {tx.txHash ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-300 font-mono" title={tx.txHash}>
                              {tx.txHash.slice(0, 8)}...{tx.txHash.slice(-6)}
                            </span>
                            <a
                              href={`https://tronscan.org/#/transaction/${tx.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-slate-500 hover:text-cyan-400 transition"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        ) : (
                          <span className="text-slate-500 text-[11px] font-sans italic">{tx.description || 'Internal Ledger'}</span>
                        )}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            tx.status === 'confirmed' || tx.status === 'active' || tx.status === 'completed'
                              ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800'
                              : tx.status === 'pending'
                              ? 'bg-amber-950/60 text-amber-300 border border-amber-800'
                              : 'bg-rose-950/60 text-rose-400 border border-rose-800'
                          }`}
                        >
                          {tx.status}
                        </span>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap text-right font-extrabold">
                        <span
                          className={
                            isYield
                              ? 'text-emerald-400'
                              : isDeposit
                              ? 'text-cyan-400'
                              : 'text-purple-400'
                          }
                        >
                          {isYield ? '+' : isDeposit ? '+' : '-'}${tx.netAmount.toFixed(2)} USDT
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ========================================================
          5. DEPOSIT MODAL / DRAWER
          ======================================================== */}
      <AnimatePresence>
        {showDepositDrawer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-6 space-y-5 text-slate-100 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                    <Layers className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-extrabold text-base text-white">Allocate to Strategy Pool</h3>
                    <p className="text-[11px] text-slate-400">Minimum Deposit: $200 USDT • TRC20 Network</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDepositDrawer(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* TRC20 Wallet Container */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-cyan-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold">
                    Official Castimo TRC20 Deposit Wallet
                  </span>
                  <span className="text-[10px] font-bold text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800">
                    TRON Network Only
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800 font-mono text-xs text-emerald-300 break-all select-all">
                  <span>{CASTIMO_TREASURY_ADDRESS || 'Awaiting Treasury Address Configuration'}</span>
                  <button
                    type="button"
                    onClick={handleCopyWallet}
                    className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition shrink-0 cursor-pointer"
                    title="Copy Wallet Address"
                  >
                    {copiedWallet ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>

                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <Shield className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>Send ONLY TRC20 USDT to this address. Funds are routed directly to quantitative pool smart contracts.</span>
                </div>
              </div>

              {/* Form Submission */}
              <form onSubmit={handleDepositSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Allocation Amount (USDT)
                  </label>
                  <div className="relative">
                    <DollarSign className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                    <input
                      type="number"
                      min="200"
                      step="1"
                      required
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      placeholder="500"
                      className="w-full pl-9 pr-3 py-2.5 text-xs bg-slate-950 border border-slate-700 rounded-xl focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 text-white font-mono"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">Minimum requirement is $200 USD equivalent.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    TRON Transaction Hash (TxID)
                  </label>
                  <input
                    type="text"
                    required
                    value={depositTxHash}
                    onChange={(e) => setDepositTxHash(e.target.value)}
                    placeholder="e.g. 7f9a2b890c1e45f9a..."
                    className="w-full px-3 py-2.5 text-xs bg-slate-950 border border-slate-700 rounded-xl focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 text-white font-mono"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Copy and paste the transaction hash from your wallet app.</p>
                </div>

                {depositMessage && (
                  <div
                    className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                      depositMessage.type === 'success'
                        ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                        : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                    }`}
                  >
                    {depositMessage.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                    )}
                    <span>{depositMessage.text}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={depositSubmitting}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-extrabold text-xs shadow-lg shadow-emerald-500/20 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {depositSubmitting ? (
                    <span>Verifying with Blockchain...</span>
                  ) : (
                    <>
                      <span>Submit Allocation TxID</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================
          6. WITHDRAWAL MODAL / DRAWER
          ======================================================== */}
      <AnimatePresence>
        {showWithdrawDrawer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-6 space-y-5 text-slate-100 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400">
                    <Wallet className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-extrabold text-base text-white">Withdraw Yield Profits</h3>
                    <p className="text-[11px] text-slate-400">Available: ${walletBalanceUsdt.toFixed(2)} USDT</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowWithdrawDrawer(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleWithdrawSubmit} className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-300">Amount (USDT)</label>
                    <button
                      type="button"
                      onClick={() => setWithdrawAmount(walletBalanceUsdt.toString())}
                      className="text-[10px] text-cyan-400 hover:underline font-bold"
                    >
                      Max Available
                    </button>
                  </div>
                  <input
                    type="number"
                    max={walletBalanceUsdt}
                    min="10"
                    step="0.01"
                    required
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder="e.g. 150"
                    className="w-full px-3 py-2.5 text-xs bg-slate-950 border border-slate-700 rounded-xl focus:border-purple-500 focus:ring-1 focus:ring-purple-500 text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Your Destination TRC20 Wallet Address
                  </label>
                  <input
                    type="text"
                    required
                    value={withdrawAddress}
                    onChange={(e) => setWithdrawAddress(e.target.value)}
                    placeholder="T..."
                    className="w-full px-3 py-2.5 text-xs bg-slate-950 border border-slate-700 rounded-xl focus:border-purple-500 focus:ring-1 focus:ring-purple-500 text-white font-mono"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Must start with 'T' and be 34 characters long.</p>
                </div>

                {withdrawMessage && (
                  <div
                    className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                      withdrawMessage.type === 'success'
                        ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                        : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                    }`}
                  >
                    {withdrawMessage.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                    )}
                    <span>{withdrawMessage.text}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={withdrawSubmitting || walletBalanceUsdt <= 0}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-extrabold text-xs shadow-lg shadow-purple-500/20 transition cursor-pointer disabled:opacity-50"
                >
                  {withdrawSubmitting ? 'Requesting Payout...' : 'Submit Withdrawal Request'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
