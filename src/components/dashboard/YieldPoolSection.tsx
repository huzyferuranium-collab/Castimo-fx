import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  TrendingUp,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Copy,
  Check,
  QrCode,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Layers,
  DollarSign,
  ArrowRight,
  X,
} from 'lucide-react';
import { CASTIMO_TREASURY_ADDRESS } from '../../services/tradingEngine';
import { UserYieldAllocation, YieldLedgerEntry } from '../../types/yieldPool';
import {
  YIELD_POOL_DAILY_RATE_PCT,
  YIELD_POOL_TERM_BUSINESS_DAYS,
  YIELD_POOL_MIN_ALLOCATION_USDT,
  ServerYieldPosition,
  fetchYieldPoolSummary,
  subscribeUserYieldAllocation,
  subscribeUserYieldLedger,
  submitYieldPoolAllocation,
  submitYieldPoolWithdrawal,
  isFxTradingDay,
  getMsUntilNextDistribution,
  projectPerformanceGrowth,
} from '../../services/yieldPoolService';
import { AnimatedNumber } from '../common/AnimatedNumber';
import { Collapsible } from '../common/Collapsible';
import { SectionBanner } from './DashboardVisuals';

interface YieldPoolSectionProps {
  userId: string;
  userEmail?: string;
  onNavigateToPositions?: () => void;
}

const AddressQrPreview: React.FC<{ address: string }> = ({ address }) => {
  const size = 21;
  const cells = useMemo(() => {
    const grid: boolean[] = [];
    const seedStr = address || 'CASTIMO_TRC20_TREASURY';
    const isFinder = (r: number, c: number) => {
      const topLeft = r < 7 && c < 7;
      const topRight = r < 7 && c >= size - 7;
      const bottomLeft = r >= size - 7 && c < 7;
      if (!topLeft && !topRight && !bottomLeft) return null;
      const lr = r >= size - 7 ? r - (size - 7) : r;
      const lc = c >= size - 7 ? c - (size - 7) : c;
      if (lr === 0 || lr === 6 || lc === 0 || lc === 6) return true;
      if (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4) return true;
      return false;
    };

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const finder = isFinder(r, c);
        if (finder !== null) {
          grid.push(finder);
        } else {
          const ch = seedStr.charCodeAt((r * size + c) % seedStr.length);
          grid.push(((ch + r * 7 + c * 13) % 5) < 2);
        }
      }
    }
    return grid;
  }, [address]);

  return (
    <div className="inline-flex flex-col items-center gap-1 p-2 rounded-xl bg-white border border-slate-200 dark:border-slate-700 shrink-0">
      <svg
        width={80}
        height={80}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="TRC20 Address QR"
        className="block"
      >
        {cells.map((filled, i) =>
          filled ? (
            <rect
              key={i}
              x={i % size}
              y={Math.floor(i / size)}
              width={0.92}
              height={0.92}
              fill="#0f172a"
            />
          ) : null
        )}
      </svg>
      <span className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold text-slate-600">
        <QrCode className="w-3 h-3" />
        TRC20
      </span>
    </div>
  );
};

export const YieldPoolSection: React.FC<YieldPoolSectionProps> = ({
  userId,
  onNavigateToPositions,
}) => {
  const [allocation, setAllocation] = useState<UserYieldAllocation | null>(null);
  const [positions, setPositions] = useState<ServerYieldPosition[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<YieldLedgerEntry[]>([]);
  const [serverTreasuryAddress, setServerTreasuryAddress] = useState<string>('');
  const [poolEnabled, setPoolEnabled] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [syncError, setSyncError] = useState<string | null>(null);

  const effectiveTreasuryAddress = (serverTreasuryAddress || CASTIMO_TREASURY_ADDRESS || '').trim();

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

  const refreshSummary = async () => {
    if (!userId) return;
    const res = await fetchYieldPoolSummary();
    if (res.ok && res.data) {
      setPoolEnabled(res.data.enabled);
      if (res.data.treasuryAddress) {
        setServerTreasuryAddress(res.data.treasuryAddress);
      }
      if (res.data.allocation) {
        setAllocation(res.data.allocation);
      }
      if (Array.isArray(res.data.positions)) {
        setPositions(res.data.positions);
      }
      if (Array.isArray(res.data.ledger) && res.data.ledger.length > 0) {
        setLedgerEntries(res.data.ledger);
      }
    }
  };

  useEffect(() => {
    if (!userId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setSyncError(null);
    void refreshSummary();

    const unsubAlloc = subscribeUserYieldAllocation(
      userId,
      (data) => {
        if (data) setAllocation(data);
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
        console.warn('[YieldPool] Ledger sync notice:', err.message);
      }
    );

    return () => {
      unsubAlloc();
      unsubLedger();
    };
  }, [userId]);

  const allocatedUsdt = allocation?.allocatedAmountUsdt ?? 0;
  const walletBalanceUsdt = allocation?.walletBalanceUsdt ?? 0;
  const totalYieldEarnedUsdt = allocation?.totalYieldEarnedUsdt ?? 0;
  const termDays = allocation?.termBusinessDays ?? YIELD_POOL_TERM_BUSINESS_DAYS;
  const daysCompleted = Math.min(termDays, allocation?.businessDaysCompleted ?? 0);
  const progressPct = termDays > 0 ? Math.min(100, (daysCompleted / termDays) * 100) : 0;
  const dailyDollarPayout = Number(((allocatedUsdt * YIELD_POOL_DAILY_RATE_PCT) / 100).toFixed(2));

  // Modals
  const [showDepositDrawer, setShowDepositDrawer] = useState<boolean>(false);
  const [showQrCode, setShowQrCode] = useState<boolean>(false);
  const [depositAmount, setDepositAmount] = useState<string>('500');
  const [depositTxHash, setDepositTxHash] = useState<string>('');
  const [depositSubmitting, setDepositSubmitting] = useState<boolean>(false);
  const [depositMessage, setDepositMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedWallet, setCopiedWallet] = useState<boolean>(false);

  const [showWithdrawDrawer, setShowWithdrawDrawer] = useState<boolean>(false);
  const [withdrawAmount, setWithdrawAmount] = useState<string>('');
  const [withdrawAddress, setWithdrawAddress] = useState<string>('');
  const [withdrawSubmitting, setWithdrawSubmitting] = useState<boolean>(false);
  const [withdrawMessage, setWithdrawMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [simulatedPrincipal, setSimulatedPrincipal] = useState<number>(allocatedUsdt > 0 ? allocatedUsdt : 1000);

  useEffect(() => {
    if (allocatedUsdt > 0 && simulatedPrincipal === 1000) {
      setSimulatedPrincipal(allocatedUsdt);
    }
  }, [allocatedUsdt]);

  const projection = useMemo(() => {
    return projectPerformanceGrowth(
      simulatedPrincipal,
      YIELD_POOL_TERM_BUSINESS_DAYS,
      YIELD_POOL_DAILY_RATE_PCT
    );
  }, [simulatedPrincipal]);

  const handleCopyWallet = () => {
    if (!effectiveTreasuryAddress) return;
    navigator.clipboard?.writeText(effectiveTreasuryAddress);
    setCopiedWallet(true);
    setTimeout(() => setCopiedWallet(false), 2000);
  };

  const handleDepositSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDepositMessage(null);
    const amt = parseFloat(depositAmount);
    if (isNaN(amt) || amt < YIELD_POOL_MIN_ALLOCATION_USDT) {
      setDepositMessage({
        type: 'error',
        text: `Min $${YIELD_POOL_MIN_ALLOCATION_USDT} USDT.`,
      });
      return;
    }
    const cleanTx = depositTxHash.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(cleanTx)) {
      setDepositMessage({
        type: 'error',
        text: 'Enter valid 64-char TRC20 TxID.',
      });
      return;
    }

    setDepositSubmitting(true);
    try {
      const res = await submitYieldPoolAllocation({
        userId,
        amountUsdt: amt,
        txHash: cleanTx,
        recipientAddress: effectiveTreasuryAddress,
      });

      if (res.success) {
        const credited = res.creditedUsdt ?? amt;
        setDepositMessage({
          type: 'success',
          text: `Activated $${credited.toFixed(2)} USDT (2%/day · 100d).`,
        });
        setDepositTxHash('');
        await refreshSummary();
        setTimeout(() => {
          setShowDepositDrawer(false);
          setDepositMessage(null);
        }, 2000);
      } else {
        setDepositMessage({ type: 'error', text: res.error || 'Verification failed.' });
      }
    } catch (err: any) {
      setDepositMessage({ type: 'error', text: err?.message || 'Submission failed.' });
    } finally {
      setDepositSubmitting(false);
    }
  };

  const handleWithdrawSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWithdrawMessage(null);
    const amt = parseFloat(withdrawAmount);
    if (isNaN(amt) || amt < 10) {
      setWithdrawMessage({ type: 'error', text: 'Min withdrawal $10 USDT.' });
      return;
    }
    if (amt > walletBalanceUsdt) {
      setWithdrawMessage({
        type: 'error',
        text: `Available: $${walletBalanceUsdt.toFixed(2)} USDT.`,
      });
      return;
    }
    if (!withdrawAddress || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(withdrawAddress.trim())) {
      setWithdrawMessage({
        type: 'error',
        text: 'Invalid TRC20 address.',
      });
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
          text: 'Withdrawal queued.',
        });
        setWithdrawAmount('');
        await refreshSummary();
        setTimeout(() => {
          setShowWithdrawDrawer(false);
          setWithdrawMessage(null);
        }, 2000);
      } else {
        setWithdrawMessage({ type: 'error', text: res.error || 'Withdrawal failed.' });
      }
    } catch (err: any) {
      setWithdrawMessage({ type: 'error', text: err?.message || 'Withdrawal error.' });
    } finally {
      setWithdrawSubmitting(false);
    }
  };

  const collapsedSummary = isLoading
    ? 'Loading pool metrics…'
    : `Capital $${allocatedUsdt.toFixed(2)} · Earned $${totalYieldEarnedUsdt.toFixed(2)} · ${daysCompleted}/${termDays}d`;

  return (
    <div className="max-w-3xl mx-auto space-y-3.5 pb-10 animate-in fade-in duration-200">
      {/* 1. COMPACT HEADER */}
      <SectionBanner
        tone="gold"
        art="coins"
        title="Yield Pool"
        subtitle="2.0% daily · Mon–Fri · 100 business days"
      />

      {/* 2. PRIMARY ACTION ROW ONLY: GOLDEN ALLOCATE + ONE RELEVANT ACTION */}
      <div className="grid grid-cols-1 min-[360px]:grid-cols-[minmax(0,1.22fr)_minmax(0,0.88fr)] sm:grid-cols-2 gap-2 sm:gap-2.5">
        <button
          type="button"
          onClick={() => setShowDepositDrawer(true)}
          className="keep-ink btn-gold min-h-[48px] px-3 sm:px-4 py-3 rounded-2xl font-display font-extrabold tracking-tight text-xs sm:text-sm active:scale-[0.98] transition cursor-pointer inline-flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap min-w-0"
        >
          <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
          <span className="truncate">Allocate Investment</span>
        </button>

        <button
          type="button"
          onClick={() => setShowWithdrawDrawer(true)}
          disabled={walletBalanceUsdt <= 0}
          title={walletBalanceUsdt <= 0 ? 'No withdrawable balance yet' : 'Withdraw profits'}
          className="min-h-[48px] px-3 sm:px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700/90 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-[0.98] text-slate-900 dark:text-white font-display font-bold tracking-tight text-xs sm:text-sm transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap min-w-0"
        >
          <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 text-amber-500" />
          <span>Withdraw</span>
          <span className="font-mono text-[11px] sm:text-xs font-bold tabular-nums text-slate-500 dark:text-slate-400 truncate">
            ${walletBalanceUsdt.toFixed(2)}
          </span>
        </button>
      </div>

      {syncError && (
        <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="break-words">{syncError}</span>
        </div>
      )}

      {/* 3. EVERYTHING ELSE MINIMIZED INSIDE ONE CLEAN COLLAPSIBLE MENU */}
      <Collapsible
        adaptive
        title="Pool Menu"
        summary={collapsedSummary}
        openLabel="Expand"
        closeLabel="Minimize"
      >
        <div className="space-y-4 pt-2">
          {/* Metrics 2x2 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5">
            <div className="keep-border rounded-xl border border-slate-200/90 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-800/40 p-3 min-w-0">
              <span className="font-display text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400 block">
                Capital
              </span>
              <div className="mt-1 font-display font-extrabold tracking-tight text-base sm:text-lg text-slate-900 dark:text-white tabular-nums truncate">
                {isLoading ? '—' : <AnimatedNumber value={allocatedUsdt} prefix="$" decimals={2} />}
              </div>
            </div>

            <div className="keep-border rounded-xl border border-slate-200/90 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-800/40 p-3 min-w-0">
              <span className="font-display text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400 block">
                Daily 2%
              </span>
              <div className="mt-1 font-display font-extrabold tracking-tight text-base sm:text-lg text-emerald-600 dark:text-emerald-400 tabular-nums truncate">
                +${dailyDollarPayout.toFixed(2)}
              </div>
            </div>

            <div className="keep-border rounded-xl border border-slate-200/90 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-800/40 p-3 min-w-0">
              <span className="font-display text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400 block">
                Withdrawable
              </span>
              <div className="mt-1 font-display font-extrabold tracking-tight text-base sm:text-lg text-slate-900 dark:text-white tabular-nums truncate">
                {isLoading ? '—' : <AnimatedNumber value={walletBalanceUsdt} prefix="$" decimals={2} />}
              </div>
            </div>

            <div className="keep-border rounded-xl border border-slate-200/90 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-800/40 p-3 min-w-0 flex flex-col justify-between">
              <span className="font-mono text-[10px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums truncate block">
                {daysCompleted}/{termDays}d · {isMarketOpen ? formatTimer(msRemaining) : 'Mon UTC'}
              </span>
              <div className="mt-2 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all duration-500"
                  style={{ width: `${Math.max(daysCompleted > 0 ? 4 : 0, progressPct)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowDepositDrawer(true)}
              className="keep-ink btn-gold flex-auto sm:flex-initial min-h-[44px] sm:min-h-[40px] px-3.5 py-2 rounded-xl font-display font-bold tracking-tight text-xs cursor-pointer inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              <Layers className="w-3.5 h-3.5 shrink-0" />
              <span>New Allocation</span>
            </button>

            <button
              type="button"
              onClick={handleCopyWallet}
              disabled={!effectiveTreasuryAddress}
              className="flex-auto sm:flex-initial min-h-[44px] sm:min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 font-display font-semibold tracking-tight text-xs cursor-pointer disabled:opacity-40 inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              {copiedWallet ? <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> : <Copy className="w-3.5 h-3.5 shrink-0" />}
              <span>{copiedWallet ? 'Copied TRC20' : 'Copy TRC20 Wallet'}</span>
            </button>

            {onNavigateToPositions && (
              <button
                type="button"
                onClick={onNavigateToPositions}
                className="flex-auto sm:flex-initial min-h-[44px] sm:min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 font-display font-semibold tracking-tight text-xs cursor-pointer inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <span>Client Terminal</span>
                <ArrowRight className="w-3.5 h-3.5 shrink-0" />
              </button>
            )}
          </div>

          {/* Compact 100-Day Return Calculator */}
          <div className="keep-border p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/90 dark:border-slate-700/80 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="yield-calc-principal"
                className="font-display text-xs sm:text-sm font-bold tracking-tight text-slate-900 dark:text-white"
              >
                100-Day Calculator
              </label>
              <div className="relative w-36 sm:w-40">
                <DollarSign className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  id="yield-calc-principal"
                  type="number"
                  inputMode="decimal"
                  min="200"
                  max="100000"
                  step="50"
                  value={simulatedPrincipal || ''}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setSimulatedPrincipal(Number.isFinite(val) ? Math.max(0, val) : 0);
                  }}
                  className="w-full min-h-[42px] pl-7 pr-2.5 py-1 text-base sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-amber-400 font-mono font-bold tabular-nums focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <input
              type="range"
              aria-label="Simulate investment amount"
              min="200"
              max="50000"
              step="100"
              value={Math.min(50000, Math.max(200, simulatedPrincipal || 200))}
              onChange={(e) => setSimulatedPrincipal(Number(e.target.value))}
              className="w-full accent-amber-500 bg-slate-200 dark:bg-slate-700 h-2 rounded-lg cursor-pointer"
            />

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="keep-border p-2 sm:p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-700/80 min-w-0">
                <span className="font-display text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block truncate">
                  Daily 2%
                </span>
                <span className="mt-0.5 block font-display text-xs sm:text-sm font-extrabold tracking-tight tabular-nums text-emerald-600 dark:text-emerald-400 truncate">
                  +${projection.dailyPayout.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="keep-border p-2 sm:p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-700/80 min-w-0">
                <span className="font-display text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block truncate">
                  100d Profit
                </span>
                <span className="mt-0.5 block font-display text-xs sm:text-sm font-extrabold tracking-tight tabular-nums text-emerald-600 dark:text-emerald-400 truncate">
                  +${projection.totalYield.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="keep-border p-2 sm:p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-700/80 min-w-0">
                <span className="font-display text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block truncate">
                  Total Value
                </span>
                <span className="mt-0.5 block font-display text-xs sm:text-sm font-extrabold tracking-tight tabular-nums text-slate-900 dark:text-white truncate">
                  ${projection.finalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          {/* Active & Completed Positions */}
          {positions.length > 0 && (
            <div className="space-y-1.5">
              <div className="font-display text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Positions ({positions.length})
              </div>
              <div className="space-y-1.5">
                {positions.map((pos) => (
                  <div
                    key={pos.id}
                    className="keep-border p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/90 dark:border-slate-700/80 flex items-center justify-between gap-3 text-xs min-h-[48px]"
                  >
                    <div className="min-w-0">
                      <div className="font-display font-extrabold tracking-tight tabular-nums text-slate-900 dark:text-white">
                        ${Number(pos.principalUsdt).toFixed(2)} USDT
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        +${Number(pos.dailyPayoutUsdt).toFixed(2)}/d · {pos.businessDaysCompleted}/{pos.termBusinessDays}d
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-display font-extrabold tracking-tight tabular-nums text-emerald-600 dark:text-emerald-400">
                        +${Number(pos.totalEarnedUsdt).toFixed(2)}
                      </div>
                      <div className="text-[11px] capitalize text-slate-500 dark:text-slate-400">
                        {pos.status}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Compact Activity List */}
          <div className="space-y-1">
            <div className="font-display text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Activity ({ledgerEntries.length})
            </div>
            {ledgerEntries.length === 0 ? (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 py-2">No transactions yet.</p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800/80">
                {ledgerEntries.map((tx) => {
                  const isYield = tx.type === 'yield_distribution';
                  const isDeposit = tx.type === 'allocation';
                  return (
                    <div
                      key={tx.id}
                      className="py-2.5 flex items-center justify-between gap-3 min-h-[48px]"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                          {isYield && <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />}
                          {isDeposit && <ArrowDownRight className="w-3.5 h-3.5 text-cyan-500" />}
                          {!isYield && !isDeposit && (
                            <ArrowUpRight className="w-3.5 h-3.5 text-purple-400" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="font-display text-xs font-bold tracking-tight text-slate-900 dark:text-slate-100 truncate">
                            {isYield ? '2% Payout' : isDeposit ? 'Allocation' : 'Withdrawal'}
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                            <span>
                              {new Date(tx.createdAt).toLocaleDateString([], {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                            {tx.txHash && (
                              <>
                                <span aria-hidden="true">·</span>
                                <a
                                  href={`https://tronscan.org/#/transaction/${tx.txHash}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 hover:text-amber-500 transition"
                                >
                                  <span>
                                    {tx.txHash.slice(0, 6)}...{tx.txHash.slice(-4)}
                                  </span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div
                          className={`font-display text-xs font-extrabold tracking-tight tabular-nums ${
                            isYield
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : isDeposit
                              ? 'text-cyan-600 dark:text-cyan-400'
                              : 'text-purple-600 dark:text-purple-400'
                          }`}
                        >
                          {isYield || isDeposit ? '+' : '-'}${tx.netAmount.toFixed(2)}
                        </div>
                        <div className="text-[10px] capitalize text-slate-500 dark:text-slate-400">
                          {tx.status}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Collapsible>

      {/* COMPACT ALLOCATE MODAL */}
      <AnimatePresence>
        {showDepositDrawer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="keep-border relative w-full max-w-sm bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-4 space-y-3 text-slate-100 max-h-[85dvh] overflow-y-auto"
            >
              <div className="flex items-center justify-between gap-2 pb-1">
                <h3 className="font-display font-extrabold tracking-tight text-sm sm:text-base text-white truncate">
                  Allocate USDT <span className="font-mono font-medium text-xs text-slate-400">· 2% · 100d</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setShowDepositDrawer(false)}
                  className="w-10 h-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="keep-border p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-display font-bold tracking-tight text-slate-400">TRC20 Wallet</span>
                  <button
                    type="button"
                    onClick={() => setShowQrCode((v) => !v)}
                    className="inline-flex items-center gap-1 min-h-[28px] px-1.5 text-amber-400 font-display font-bold cursor-pointer"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>{showQrCode ? 'Hide' : 'QR'}</span>
                  </button>
                </div>

                {showQrCode && (
                  <div className="flex justify-center">
                    <AddressQrPreview address={effectiveTreasuryAddress || 'CASTIMO_TREASURY'} />
                  </div>
                )}

                <div className="keep-border flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-800 font-mono text-[11px] text-amber-300 break-all select-all">
                  <span>{effectiveTreasuryAddress || 'Wallet not configured'}</span>
                  <button
                    type="button"
                    onClick={handleCopyWallet}
                    disabled={!effectiveTreasuryAddress}
                    className="w-9 h-9 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 transition shrink-0 cursor-pointer"
                    aria-label="Copy address"
                  >
                    {copiedWallet ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                {!poolEnabled && (
                  <div className="text-[11px] text-amber-300">
                    Missing <code>TREASURY_ADDRESS</code> / <code>FIREBASE_SERVICE_ACCOUNT</code>.
                  </div>
                )}
              </div>

              <form onSubmit={handleDepositSubmit} className="space-y-2.5">
                <div className="relative">
                  <DollarSign className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="number"
                    inputMode="decimal"
                    min="200"
                    step="1"
                    required
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="Amount (min $200)"
                    aria-label="Amount in USDT"
                    className="w-full h-11 pl-8 pr-3 text-base sm:text-sm bg-slate-950 border border-slate-700 rounded-xl focus:border-amber-500 text-white font-mono tabular-nums"
                  />
                </div>

                <input
                  type="text"
                  required
                  value={depositTxHash}
                  onChange={(e) => setDepositTxHash(e.target.value)}
                  placeholder="Paste TRC20 TxID"
                  aria-label="TRC20 TxID"
                  className="w-full h-11 px-3 text-base sm:text-sm bg-slate-950 border border-slate-700 rounded-xl focus:border-amber-500 text-white font-mono"
                />

                {depositMessage && (
                  <div
                    className={`px-2.5 py-2 rounded-xl text-xs flex items-center gap-1.5 ${
                      depositMessage.type === 'success'
                        ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                        : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                    }`}
                  >
                    {depositMessage.type === 'success' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                    )}
                    <span>{depositMessage.text}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={depositSubmitting || !poolEnabled}
                  className="keep-ink btn-gold w-full h-11 rounded-xl font-display font-extrabold tracking-tight text-sm transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {depositSubmitting ? (
                    <span>Verifying…</span>
                  ) : (
                    <>
                      <span>Verify &amp; Activate</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* COMPACT WITHDRAW MODAL */}
      <AnimatePresence>
        {showWithdrawDrawer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="keep-border relative w-full max-w-sm bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-4 space-y-3 text-slate-100 max-h-[85dvh] overflow-y-auto"
            >
              <div className="flex items-center justify-between gap-2 pb-1">
                <h3 className="font-display font-extrabold tracking-tight text-sm sm:text-base text-white truncate">
                  Withdraw{' '}
                  <span className="font-mono text-xs text-amber-400 tabular-nums">
                    · ${walletBalanceUsdt.toFixed(2)}
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={() => setShowWithdrawDrawer(false)}
                  className="w-10 h-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleWithdrawSubmit} className="space-y-2.5">
                <div className="relative">
                  <input
                    type="number"
                    inputMode="decimal"
                    max={walletBalanceUsdt}
                    min="10"
                    step="0.01"
                    required
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder="Amount (min $10)"
                    aria-label="Withdraw amount"
                    className="w-full h-11 pl-3 pr-14 text-base sm:text-sm bg-slate-950 border border-slate-700 rounded-xl focus:border-amber-500 text-white font-mono tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() => setWithdrawAmount(walletBalanceUsdt.toString())}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-amber-400 font-display font-bold cursor-pointer px-2 py-1.5"
                  >
                    Max
                  </button>
                </div>

                <input
                  type="text"
                  required
                  value={withdrawAddress}
                  onChange={(e) => setWithdrawAddress(e.target.value)}
                  placeholder="TRC20 Wallet (T...)"
                  aria-label="TRC20 Address"
                  className="w-full h-11 px-3 text-base sm:text-sm bg-slate-950 border border-slate-700 rounded-xl focus:border-amber-500 text-white font-mono"
                />

                {withdrawMessage && (
                  <div
                    className={`px-2.5 py-2 rounded-xl text-xs flex items-center gap-1.5 ${
                      withdrawMessage.type === 'success'
                        ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                        : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                    }`}
                  >
                    {withdrawMessage.type === 'success' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                    )}
                    <span>{withdrawMessage.text}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={withdrawSubmitting}
                  className="keep-ink btn-gold w-full h-11 rounded-xl font-display font-extrabold tracking-tight text-sm transition cursor-pointer disabled:opacity-50"
                >
                  {withdrawSubmitting ? 'Submitting…' : 'Request Payout'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
