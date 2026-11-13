import {
  collection,
  doc,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { authHeaders } from './apiAuth';
import {
  UserYieldAllocation,
  YieldLedgerEntry,
} from '../types/yieldPool';

export const YIELD_POOL_DAILY_RATE_PCT = 2.0;
export const YIELD_POOL_TERM_BUSINESS_DAYS = 100;
export const YIELD_POOL_MIN_ALLOCATION_USDT = 200;

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  };
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path,
  };
  console.error('🔥 [YieldPool Firestore Error]:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/** Check if current UTC day is an active FX market trading day (Monday to Friday) */
export function isFxTradingDay(date: Date = new Date()): boolean {
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

/** Calculate milliseconds until next payout cycle (midnight 00:00 UTC) */
export function getMsUntilNextDistribution(): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  return Math.max(0, next.getTime() - now.getTime());
}

/**
 * Fixed daily yield rate: 2.0% on active business days (Monday to Friday),
 * and 0.0% on weekends (markets closed).
 */
export function computeDailyMarketYieldRate(date: Date = new Date()): number {
  return isFxTradingDay(date) ? YIELD_POOL_DAILY_RATE_PCT : 0.0;
}

/** Subscribe to the real-time user yield allocation state in Firestore */
export function subscribeUserYieldAllocation(
  userId: string,
  onData: (data: UserYieldAllocation | null) => void,
  onError?: (err: Error) => void
): () => void {
  const path = `user_yield_allocations/${userId}`;
  const docRef = doc(db, 'user_yield_allocations', userId);

  return onSnapshot(
    docRef,
    (snapshot) => {
      if (snapshot.exists()) {
        const d = snapshot.data();
        onData({
          id: snapshot.id,
          userId: d.userId || userId,
          allocatedAmountUsdt: Number(d.allocatedAmountUsdt || 0),
          walletBalanceUsdt: Number(d.walletBalanceUsdt || 0),
          totalYieldEarnedUsdt: Number(d.totalYieldEarnedUsdt || 0),
          dailyRatePct: Number(d.dailyRatePct || YIELD_POOL_DAILY_RATE_PCT),
          businessDaysCompleted: Number(d.businessDaysCompleted || 0),
          termBusinessDays: Number(d.termBusinessDays || YIELD_POOL_TERM_BUSINESS_DAYS),
          status: d.status || 'active',
          lastDistributionAt: d.lastDistributionAt,
          createdAt: d.createdAt || new Date().toISOString(),
          updatedAt: d.updatedAt || new Date().toISOString(),
        });
      } else {
        onData(null);
      }
    },
    (error) => {
      const wrapped = new Error(`Failed to load yield allocation for user ${userId}`);
      if (onError) onError(wrapped);
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

/**
 * Subscribe to the user's yield ledger entries (single-field query sorted client-side
 * so no manual Firestore composite index is required).
 */
export function subscribeUserYieldLedger(
  userId: string,
  onData: (entries: YieldLedgerEntry[]) => void,
  onError?: (err: Error) => void,
  entryLimit = 40
): () => void {
  const path = 'yield_ledger';
  const q = query(collection(db, 'yield_ledger'), where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: YieldLedgerEntry[] = snapshot.docs
        .map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            userId: d.userId,
            allocationId: d.allocationId,
            type: d.type,
            amount: Number(d.amount || 0),
            netAmount: Number(d.netAmount ?? d.amount ?? 0),
            feeAmount: Number(d.feeAmount || 0),
            txHash: d.txHash,
            status: d.status || 'pending',
            description: d.description || '',
            network: d.network || 'TRC20',
            recipientAddress: d.recipientAddress,
            metadata: d.metadata || {},
            createdAt: d.createdAt || new Date().toISOString(),
            confirmedAt: d.confirmedAt,
          };
        })
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, entryLimit);
      onData(items);
    },
    (error) => {
      const wrapped = new Error(`Failed to stream yield ledger for user ${userId}`);
      if (onError) onError(wrapped);
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export interface ServerYieldPosition {
  id: string;
  userId: string;
  principalUsdt: number;
  dailyRatePct: number;
  dailyPayoutUsdt: number;
  businessDaysCompleted: number;
  termBusinessDays: number;
  totalEarnedUsdt: number;
  txHash: string;
  status: 'active' | 'completed' | 'paused';
  startedAt: string;
  completedAt?: string;
}

export interface ServerYieldSummary {
  enabled: boolean;
  treasuryAddress: string;
  allocation: UserYieldAllocation | null;
  positions: ServerYieldPosition[];
  ledger: YieldLedgerEntry[];
}

export async function fetchYieldPoolSummary(): Promise<{ ok: boolean; data?: ServerYieldSummary; error?: string }> {
  try {
    const res = await fetch('/api/yield-pool/summary', { headers: await authHeaders() });
    const d = await res.json().catch(() => null);
    if (res.ok && d?.success) return { ok: true, data: d as ServerYieldSummary };
    return { ok: false, error: d?.error || `Error (${res.status})` };
  } catch {
    return { ok: false, error: 'Could not reach the server.' };
  }
}

/**
 * Verifies a TRC20 USDT transfer on the TRON blockchain via the backend and activates
 * the client's 100-business-day 2.0% position immediately upon confirmation.
 */
export async function submitYieldPoolAllocation(params: {
  userId: string;
  amountUsdt: number;
  txHash: string;
  recipientAddress: string;
}): Promise<{ success: boolean; entryId?: string; creditedUsdt?: number; error?: string }> {
  const cleanedTx = params.txHash.trim();
  if (params.amountUsdt < YIELD_POOL_MIN_ALLOCATION_USDT) {
    return { success: false, error: `Minimum allocation deposit is $${YIELD_POOL_MIN_ALLOCATION_USDT} USDT.` };
  }
  if (!/^[0-9a-fA-F]{64}$/.test(cleanedTx)) {
    return { success: false, error: 'Please enter a valid 64-character TRON TRC20 transaction hash (TxID).' };
  }

  try {
    const res = await fetch('/api/yield-pool/allocate', {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountUsdt: params.amountUsdt, txHash: cleanedTx }),
    });
    const d = await res.json().catch(() => null);
    if (res.ok && d?.success) {
      return {
        success: true,
        entryId: d.ledgerId,
        creditedUsdt: Number(d.position?.principalUsdt || params.amountUsdt),
      };
    }
    return { success: false, error: d?.error || `Verification failed (${res.status}).` };
  } catch {
    return { success: false, error: 'Could not reach the server to verify your TRC20 deposit.' };
  }
}

/**
 * Requests a TRC20 withdrawal from the client's server-verified yield wallet balance.
 */
export async function submitYieldPoolWithdrawal(params: {
  userId: string;
  amountUsdt: number;
  destinationAddress: string;
}): Promise<{ success: boolean; entryId?: string; error?: string }> {
  const addr = params.destinationAddress.trim();
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) {
    return { success: false, error: 'Invalid TRON TRC20 destination wallet address.' };
  }
  if (params.amountUsdt < 10) {
    return { success: false, error: 'Minimum withdrawal is $10 USDT.' };
  }

  try {
    const res = await fetch('/api/yield-pool/withdraw', {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountUsdt: params.amountUsdt, destinationAddress: addr }),
    });
    const d = await res.json().catch(() => null);
    if (res.ok && d?.success) {
      return { success: true, entryId: d.ledgerId };
    }
    return { success: false, error: d?.error || `Withdrawal request failed (${res.status}).` };
  } catch {
    return { success: false, error: 'Could not reach the server to submit withdrawal.' };
  }
}

// ---------- Admin API Helpers ----------

export interface AdminYieldPoolOverview {
  enabled: boolean;
  treasuryAddress: string;
  stats: {
    totalActiveCapitalUsdt: number;
    totalWalletLiabilityUsdt: number;
    totalYieldPaidUsdt: number;
    activePositionsCount: number;
    completedPositionsCount: number;
    pendingWithdrawalsCount: number;
  };
  positions: ServerYieldPosition[];
  withdrawals: YieldLedgerEntry[];
  recentLedger: YieldLedgerEntry[];
}

export async function adminGetYieldPoolOverview() {
  const res = await fetch('/api/yield-pool/admin/overview', { headers: await authHeaders() });
  const d = await res.json().catch(() => null);
  return res.ok && d?.success ? { ok: true as const, data: d as AdminYieldPoolOverview } : { ok: false as const, error: d?.error || `Error (${res.status})` };
}

export async function adminRunYieldPoolPayout(dateKey?: string) {
  const res = await fetch('/api/yield-pool/admin/run-payout', {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(dateKey ? { dateKey } : {}),
  });
  const d = await res.json().catch(() => null);
  return res.ok && d?.success ? { ok: true as const, data: d } : { ok: false as const, error: d?.error || `Error (${res.status})` };
}

export async function adminManualCreditYieldAllocation(params: {
  userId: string;
  amountUsdt: number;
  txHash?: string;
  note?: string;
}) {
  const res = await fetch('/api/yield-pool/admin/credit-allocation', {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const d = await res.json().catch(() => null);
  return res.ok && d?.success ? { ok: true as const, data: d } : { ok: false as const, error: d?.error || `Error (${res.status})` };
}

export async function adminCompleteYieldPoolWithdrawal(id: string, txHash: string) {
  const res = await fetch(`/api/yield-pool/admin/withdrawals/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ txHash }),
  });
  const d = await res.json().catch(() => null);
  return res.ok && d?.success ? { ok: true as const, data: d } : { ok: false as const, error: d?.error || `Error (${res.status})` };
}

export async function adminRejectYieldPoolWithdrawal(id: string, reason: string) {
  const res = await fetch(`/api/yield-pool/admin/withdrawals/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  const d = await res.json().catch(() => null);
  return res.ok && d?.success ? { ok: true as const, data: d } : { ok: false as const, error: d?.error || `Error (${res.status})` };
}

/**
 * Computes fixed capital return projection:
 * 2.0% daily (Monday–Friday) across 100 business days (+200% total return on fixed principal).
 */
export function projectPerformanceGrowth(
  principalUsdt: number,
  businessDays = YIELD_POOL_TERM_BUSINESS_DAYS,
  dailyRatePct = YIELD_POOL_DAILY_RATE_PCT
): {
  dailyPayout: number;
  finalAmount: number;
  totalYield: number;
  totalRoiPct: number;
  dataPoints: { day: number; equity: number }[];
} {
  if (principalUsdt <= 0 || businessDays <= 0) {
    return {
      dailyPayout: 0,
      finalAmount: principalUsdt,
      totalYield: 0,
      totalRoiPct: 0,
      dataPoints: [{ day: 0, equity: principalUsdt }],
    };
  }

  const dailyPayout = principalUsdt * (dailyRatePct / 100);
  const totalYield = dailyPayout * businessDays;
  const finalAmount = principalUsdt + totalYield;
  const totalRoiPct = dailyRatePct * businessDays;
  const points: { day: number; equity: number }[] = [
    { day: 0, equity: Number(principalUsdt.toFixed(2)) },
    { day: 25, equity: Number((principalUsdt + dailyPayout * 25).toFixed(2)) },
    { day: 50, equity: Number((principalUsdt + dailyPayout * 50).toFixed(2)) },
    { day: 75, equity: Number((principalUsdt + dailyPayout * 75).toFixed(2)) },
    { day: businessDays, equity: Number(finalAmount.toFixed(2)) },
  ];

  return {
    dailyPayout: Number(dailyPayout.toFixed(2)),
    finalAmount: Number(finalAmount.toFixed(2)),
    totalYield: Number(totalYield.toFixed(2)),
    totalRoiPct: Number(totalRoiPct.toFixed(0)),
    dataPoints: points,
  };
}
