import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  TrendingUp,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Shield,
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

/** Deterministic visual QR matrix derived from the TRC20 address string for deposit verification UI. */
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
        aria-label="TRC20 Deposit Address QR Preview"
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
  // ---- Real-time State ----
  const [allocation, setAllocation] = useState<UserYieldAllocation | null>(null);
  const [positions, setPositions] = useState<ServerYieldPosition[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<YieldLedgerEntry[]>([]);
  const [serverTreasuryAddress, setServerTreasuryAddress] = useState<string>('');
  const [poolEnabled, setPoolEnabled] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [syncError, setSyncError] = useState<string | null>(null);

  const effectiveTreasuryAddress = (serverTreasuryAddress || CASTIMO_TREASURY_ADDRESS || '').trim();

  // ---- Payout Countdown State ----
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

  // ---- Subscriptions + Authoritative Server Hydration ----
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

  // ---- Deposit Bottom Sheet / Modal State ----
  const [showDepositDrawer, setShowDepositDrawer] = useState<boolean>(false);
  const [showQrCode, setShowQrCode] = useState<boolean>(false);
  const [depositAmount, setDepositAmount] = useState<string>('500');
  const [depositTxHash, setDepositTxHash] = useState<string>('');
  const [depositSubmitting, setDepositSubmitting] = useState<boolean>(false);
  const [depositMessage, setDepositMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedWallet, setCopiedWallet] = useState<boolean>(false);

  // ---- Withdrawal Bottom Sheet / Modal State ----
  const [showWithdrawDrawer, setShowWithdrawDrawer] = useState<boolean>(false);
  const [withdrawAmount, setWithdrawAmount] = useState<string>('');
  const [withdrawAddress, setWithdrawAddress] = useState<string>('');
  const [withdrawSubmitting, setWithdrawSubmitting] = useState<boolean>(false);
  const [withdrawMessage, setWithdrawMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ---- Fixed 100-Business-Day Calculator State (zero tabs) ----
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

  // Copy helper
  const handleCopyWallet = () => {
    if (!effectiveTreasuryAddress) return;
    navigator.clipboard?.writeText(effectiveTreasuryAddress);
    setCopiedWallet(true);
    setTimeout(() => setCopiedWallet(false), 2000);
  };

  // Submit Deposit
  const handleDepositSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDepositMessage(null);
    const amt = parseFloat(depositAmount);
    if (isNaN(amt) || amt < YIELD_POOL_MIN_ALLOCATION_USDT) {
      setDepositMessage({
        type: 'error',
        text: `Minimum fixed capital allocation is $${YIELD_POOL_MIN_ALLOCATION_USDT} USDT.`,
      });
      return;
    }
    const cleanTx = depositTxHash.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(cleanTx)) {
      setDepositMessage({
        type: 'error',
        text: 'Please enter a valid 64-character TRON (TRC20) Transaction Hash (TxID).',
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
          text: `TRC20 transfer verified ($${credited.toFixed(2)} USDT). Active 100-day 2.0% position created!`,
        });
        setDepositTxHash('');
        await refreshSummary();
        setTimeout(() => {
          setShowDepositDrawer(false);
          setDepositMessage(null);
        }, 2200);
      } else {
        setDepositMessage({ type: 'error', text: res.error || 'Failed to verify TRC20 allocation.' });
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
      setWithdrawMessage({
        type: 'error',
        text: `Insufficient balance. Available: $${walletBalanceUsdt.toFixed(2)} USDT`,
      });
      return;
    }
    if (!withdrawAddress || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(withdrawAddress.trim())) {
      setWithdrawMessage({
        type: 'error',
        text: 'Please enter a valid TRON (TRC20) USDT wallet address.',
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
          text: 'Withdrawal request queued. Your USDT TRC20 payout is being processed.',
        });
        setWithdrawAmount('');
        await refreshSummary();
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
    <div className="max-w-3xl mx-auto space-y-4 pb-10 animate-in fade-in duration-200">
      {/* 1. CLEAN HEADER BANNER */}
      <SectionBanner
        tone="mint"
        art="coins"
        title="Yield Pool"
        subtitle="Fixed capital plan · 2.0% daily (Mon–Fri) · 100 business days"
      />

      {/* 2. MOBILE-FIRST THUMB-FRIENDLY ACTIONS + STATUS METADATA */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
        <div className="grid grid-cols-2 sm:flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowDepositDrawer(true)}
            className="min-h-[48px] sm:min-h-[40px] px-4 py-2.5 sm:py-2 rounded-2xl sm:rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-slate-950 font-bold text-sm sm:text-xs transition cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <Layers className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
            <span>Allocate USDT</span>
          </button>

          <button
            type="button"
            onClick={() => setShowWithdrawDrawer(true)}
            disabled={walletBalanceUsdt <= 0}
            title={
              walletBalanceUsdt <= 0
                ? 'No withdrawable yield balance available yet'
                : 'Withdraw available wallet balance'
            }
            className="min-h-[48px] sm:min-h-[40px] px-4 py-2.5 sm:py-2 rounded-2xl sm:rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-[0.98] text-slate-800 dark:text-slate-200 font-semibold text-sm sm:text-xs transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <Wallet className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
            <span>Withdraw</span>
          </button>
        </div>

        <div className="flex items-center justify-center sm:justify-end gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums px-1">
          <span>{isMarketOpen ? 'Mon–Fri active' : 'Weekend pause'}</span>
          <span aria-hidden="true">·</span>
          <span>2.0% fixed daily</span>
          <span aria-hidden="true">·</span>
          <span>100 days</span>
        </div>
      </div>

      {syncError && (
        <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="break-words">{syncError}</span>
        </div>
      )}

      {/* 3. MOBILE-FRIENDLY 2x2 / DESKTOP 4-COLUMN SUMMARY GRID */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-4">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
            Fixed Capital
          </span>
          <div className="mt-1 font-display font-extrabold text-lg sm:text-xl text-slate-900 dark:text-white font-mono tabular-nums truncate">
            {isLoading ? '—' : <AnimatedNumber value={allocatedUsdt} prefix="$" decimals={2} />}
          </div>
          <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {allocation?.status === 'active'
              ? 'Active plan'
              : allocatedUsdt > 0
              ? 'Pending sync'
              : 'Min $200 USDT'}
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-4">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
            Daily Return
          </span>
          <div className="mt-1 font-display font-extrabold text-lg sm:text-xl text-emerald-600 dark:text-emerald-400 font-mono tabular-nums truncate">
            2.00%
          </div>
          <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
            {allocatedUsdt > 0 ? `$${dailyDollarPayout.toFixed(2)} Mon–Fri` : 'Mon–Fri payouts'}
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-4">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
            Withdrawable
          </span>
          <div className="mt-1 font-display font-extrabold text-lg sm:text-xl text-slate-900 dark:text-white font-mono tabular-nums truncate">
            {isLoading ? '—' : <AnimatedNumber value={walletBalanceUsdt} prefix="$" decimals={2} />}
          </div>
          <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
            Earned +${totalYieldEarnedUsdt.toFixed(2)}
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-4">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
            100-Day Term
          </span>
          <div className="mt-1 font-mono font-extrabold text-lg sm:text-xl text-amber-600 dark:text-amber-300 tabular-nums truncate">
            {daysCompleted} / {termDays}d
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${Math.max(daysCompleted > 0 ? 4 : 0, progressPct)}%` }}
            />
          </div>
          <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
            {isMarketOpen ? `Next ${formatTimer(msRemaining)}` : 'Resumes Mon 00:00 UTC'}
          </span>
        </div>
      </div>

      {/* 4. TWO CLEAN COLLAPSIBLE MENUS (NO INTERNAL TABS) */}
      <div className="space-y-2.5">
        {/* Collapsible 1: Simple 100-Business-Day Fixed Return Calculator */}
        <Collapsible
          adaptive
          title="100-Day Return Calculator"
          summary="Fixed 2.0% daily (Mon–Fri) · +200% total return"
          openLabel="Calculate"
          closeLabel="Hide"
        >
          <div className="space-y-4 pt-2">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="yield-calc-principal"
                  className="text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Fixed Capital (USDT)
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
                    className="w-full min-h-[44px] sm:min-h-[36px] pl-7 pr-2.5 py-1.5 text-base sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-emerald-400 font-mono font-bold tabular-nums focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <input
                type="range"
                aria-label="Simulate fixed capital amount"
                min="200"
                max="50000"
                step="100"
                value={Math.min(50000, Math.max(200, simulatedPrincipal || 200))}
                onChange={(e) => setSimulatedPrincipal(Number(e.target.value))}
                className="w-full accent-emerald-500 bg-slate-200 dark:bg-slate-800 h-2 rounded-lg cursor-pointer"
              />

              <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                <span>$200 min</span>
                <span>Mon–Fri × 100 business days</span>
                <span>$50k slider max</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex sm:block items-center justify-between">
                <div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                    Daily Return (Mon–Fri)
                  </span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 sm:hidden">
                    2.0% fixed per session
                  </span>
                </div>
                <span className="text-base sm:text-lg font-mono font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums sm:mt-0.5 block">
                  +${projection.dailyPayout.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex sm:block items-center justify-between">
                <div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                    100-Day Net Profit
                  </span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 sm:hidden">
                    +{projection.totalRoiPct}% return
                  </span>
                </div>
                <span className="text-base sm:text-lg font-mono font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums sm:mt-0.5 block">
                  +${projection.totalYield.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex sm:block items-center justify-between">
                <div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                    Total Payout Value
                  </span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 sm:hidden">
                    Capital + 100d yield
                  </span>
                </div>
                <span className="text-base sm:text-lg font-mono font-extrabold text-slate-900 dark:text-white tabular-nums sm:mt-0.5 block">
                  ${projection.finalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
        </Collapsible>

        {/* Collapsible 2: Transaction History & Plan Rules (no filter tabs, mobile row layout) */}
        <Collapsible
          adaptive
          title="Activity History & Plan Terms"
          summary={`${ledgerEntries.length} recorded event${ledgerEntries.length === 1 ? '' : 's'} · Mon–Fri schedule & TRC20 rules`}
          openLabel="View"
          closeLabel="Hide"
        >
          <div className="space-y-4 pt-2">
            {positions.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Active &amp; Past Fixed Tranches ({positions.length})
                </div>
                <div className="space-y-2">
                  {positions.map((pos) => (
                    <div
                      key={pos.id}
                      className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-mono font-bold text-slate-900 dark:text-white">
                          ${Number(pos.principalUsdt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                          +${Number(pos.dailyPayoutUsdt).toFixed(2)}/day · Day {pos.businessDaysCompleted}/{pos.termBusinessDays}
                        </div>
                      </div>
                      <div className="text-right shrink-0 font-mono tabular-nums">
                        <div className="font-bold text-emerald-600 dark:text-emerald-400">
                          +${Number(pos.totalEarnedUsdt).toFixed(2)}
                        </div>
                        <div
                          className={`text-[11px] font-sans font-semibold capitalize ${
                            pos.status === 'active'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : pos.status === 'completed'
                              ? 'text-cyan-600 dark:text-cyan-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {pos.status}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {ledgerEntries.length === 0 ? (
              <div className="py-6 text-center space-y-2.5">
                <p className="text-xs font-semibold text-slate-900 dark:text-white">
                  No pool transactions yet
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                  Allocations, daily 2% payouts, and TRC20 withdrawals appear here automatically.
                </p>
                <button
                  type="button"
                  onClick={() => setShowDepositDrawer(true)}
                  className="min-h-[44px] mt-1 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition cursor-pointer inline-flex items-center justify-center"
                >
                  Allocate USDT ($200 min)
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800/80">
                {ledgerEntries.map((tx) => {
                  const isYield = tx.type === 'yield_distribution';
                  const isDeposit = tx.type === 'allocation';
                  return (
                    <div
                      key={tx.id}
                      className="py-3 flex items-center justify-between gap-3 min-h-[56px]"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                          {isYield && <TrendingUp className="w-4 h-4 text-emerald-500" />}
                          {isDeposit && <ArrowDownRight className="w-4 h-4 text-cyan-500" />}
                          {!isYield && !isDeposit && (
                            <ArrowUpRight className="w-4 h-4 text-purple-400" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {isYield
                              ? 'Daily 2% Yield'
                              : isDeposit
                              ? 'Capital Allocation'
                              : 'TRC20 Withdrawal'}
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
                                  className="inline-flex items-center gap-1 hover:text-emerald-500 transition"
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

                      <div className="text-right shrink-0 font-mono tabular-nums">
                        <div
                          className={`text-xs sm:text-sm font-bold ${
                            isYield
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : isDeposit
                              ? 'text-cyan-600 dark:text-cyan-400'
                              : 'text-purple-600 dark:text-purple-400'
                          }`}
                        >
                          {isYield || isDeposit ? '+' : '-'}${tx.netAmount.toFixed(2)}
                        </div>
                        <div
                          className={`text-[11px] capitalize font-sans font-semibold ${
                            tx.status === 'confirmed' ||
                            tx.status === 'active' ||
                            tx.status === 'completed'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : tx.status === 'pending'
                              ? 'text-amber-600 dark:text-amber-300'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {tx.status}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Plan Terms Summary */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              <p>
                <b>Fixed 2.0% daily return:</b> Every confirmed capital allocation earns a fixed 2.0% per business day (Monday through Friday UTC) across 100 business days (+200% total return). Weekend days pause automatically.
              </p>
              <p>
                <b>Minimum &amp; payouts:</b> $200 USDT minimum via TRON (TRC20). Daily returns credit to your withdrawable wallet at 00:00 UTC; your MT5 mirror account stays separate.
              </p>
              {onNavigateToPositions && (
                <button
                  type="button"
                  onClick={onNavigateToPositions}
                  className="min-h-[44px] inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                >
                  <span>Return to Client Terminal</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </Collapsible>
      </div>

      {/* ========================================================
          5. MOBILE BOTTOM-SHEET DEPOSIT MODAL
          ======================================================== */}
      <AnimatePresence>
        {showDepositDrawer && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-md">
            <motion.div
              initial={{ y: 36, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 36, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="relative w-full sm:max-w-lg bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:p-6 space-y-4 text-slate-100 max-h-[92dvh] overflow-y-auto"
            >
              <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto -mt-1 sm:hidden" />

              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                    <Layers className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-display font-extrabold text-base text-white truncate">
                      Allocate to Yield Pool
                    </h3>
                    <p className="text-[11px] text-slate-400 truncate">
                      Min $200 USDT · 2% Mon–Fri × 100 business days
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDepositDrawer(false)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0"
                  aria-label="Close deposit modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Compact TRC20 Wallet + Optional QR */}
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-[11px] gap-2">
                  <span className="font-semibold text-slate-300">Official Castimo TRC20 Wallet</span>
                  <button
                    type="button"
                    onClick={() => setShowQrCode((v) => !v)}
                    className="inline-flex items-center gap-1 text-emerald-400 font-semibold cursor-pointer py-1 px-2 rounded-lg hover:bg-slate-900"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>{showQrCode ? 'Hide QR' : 'Show QR'}</span>
                  </button>
                </div>

                {showQrCode && (
                  <div className="flex justify-center pt-1">
                    <AddressQrPreview address={effectiveTreasuryAddress || 'CASTIMO_TREASURY'} />
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800 font-mono text-xs text-emerald-300 break-all select-all">
                  <span>{effectiveTreasuryAddress || 'Treasury wallet not configured on server'}</span>
                  <button
                    type="button"
                    onClick={handleCopyWallet}
                    disabled={!effectiveTreasuryAddress}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 transition shrink-0 cursor-pointer"
                    title="Copy Wallet Address"
                    aria-label="Copy TRC20 wallet address"
                  >
                    {copiedWallet ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {!poolEnabled && (
                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300">
                    Server verification requires <code>FIREBASE_SERVICE_ACCOUNT</code> and{' '}
                    <code>TREASURY_ADDRESS</code> to activate deposits automatically.
                  </div>
                )}
                <div className="flex items-start gap-2 text-[11px] text-slate-400">
                  <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>Send USDT on TRON (TRC20) only, then paste your TxID below for instant verification.</span>
                </div>
              </div>

              {/* Form Submission */}
              <form onSubmit={handleDepositSubmit} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Allocation Amount (USDT)
                  </label>
                  <div className="relative">
                    <DollarSign className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="number"
                      inputMode="decimal"
                      min="200"
                      step="1"
                      required
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      placeholder="500"
                      className="w-full min-h-[48px] pl-9 pr-3 py-2.5 text-base sm:text-sm bg-slate-950 border border-slate-700 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-white font-mono tabular-nums"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Minimum $200 USDT · Earns 2.0% daily Mon–Fri for 100 business days.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    TRON Transaction Hash (TxID)
                  </label>
                  <input
                    type="text"
                    required
                    value={depositTxHash}
                    onChange={(e) => setDepositTxHash(e.target.value)}
                    placeholder="Paste your 64-character TRC20 TxID..."
                    className="w-full min-h-[48px] px-3 py-2.5 text-base sm:text-sm bg-slate-950 border border-slate-700 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-white font-mono"
                  />
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
                  disabled={depositSubmitting || !poolEnabled}
                  className="w-full min-h-[48px] py-3 rounded-2xl sm:rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-slate-950 font-bold text-sm sm:text-xs transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {depositSubmitting ? (
                    <span>Verifying on TRON...</span>
                  ) : (
                    <>
                      <span>Verify &amp; Activate Position</span>
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
          6. MOBILE BOTTOM-SHEET WITHDRAWAL MODAL
          ======================================================== */}
      <AnimatePresence>
        {showWithdrawDrawer && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-md">
            <motion.div
              initial={{ y: 36, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 36, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="relative w-full sm:max-w-md bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:p-6 space-y-4 text-slate-100 max-h-[92dvh] overflow-y-auto"
            >
              <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto -mt-1 sm:hidden" />

              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                    <Wallet className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-display font-extrabold text-base text-white truncate">
                      Withdraw Yield Profits
                    </h3>
                    <p className="text-[11px] text-slate-400 font-mono tabular-nums truncate">
                      Available: ${walletBalanceUsdt.toFixed(2)} USDT
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowWithdrawDrawer(false)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0"
                  aria-label="Close withdraw modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleWithdrawSubmit} className="space-y-3.5">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-300">Amount (USDT)</label>
                    <button
                      type="button"
                      onClick={() => setWithdrawAmount(walletBalanceUsdt.toString())}
                      className="text-xs text-emerald-400 hover:underline font-bold cursor-pointer py-1 px-2"
                    >
                      Max Available
                    </button>
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    max={walletBalanceUsdt}
                    min="10"
                    step="0.01"
                    required
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder="e.g. 150"
                    className="w-full min-h-[48px] px-3 py-2.5 text-base sm:text-sm bg-slate-950 border border-slate-700 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-white font-mono tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Destination TRC20 Wallet Address
                  </label>
                  <input
                    type="text"
                    required
                    value={withdrawAddress}
                    onChange={(e) => setWithdrawAddress(e.target.value)}
                    placeholder="T..."
                    className="w-full min-h-[48px] px-3 py-2.5 text-base sm:text-sm bg-slate-950 border border-slate-700 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-white font-mono"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Must start with &apos;T&apos; and be 34 characters long.
                  </p>
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
                  disabled={withdrawSubmitting}
                  className="w-full min-h-[48px] py-3 rounded-2xl sm:rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-slate-950 font-bold text-sm sm:text-xs transition cursor-pointer disabled:opacity-50"
                >
                  {withdrawSubmitting ? 'Submitting Request...' : 'Request Withdrawal'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
