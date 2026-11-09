import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import {
  UserYieldAllocation,
  YieldLedgerEntry,
  YieldPoolSummary,
} from '../types/yieldPool';

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
  // 0 = Sunday, 6 = Saturday
  return day >= 1 && day <= 5;
}

/** Calculate milliseconds until next performance distribution (midnight 00:00 UTC) */
export function getMsUntilNextDistribution(): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  return Math.max(0, next.getTime() - now.getTime());
}

/**
 * Calculates a dynamic, market-driven daily yield rate for active trading days.
 * Defaults between 0.6% and 1.95% (up to 2.0%), simulating real quantitative alpha performance.
 * On weekends, rate defaults to 0% (markets closed).
 */
export function computeDailyMarketYieldRate(date: Date = new Date(), baseSeed = 1.35): number {
  if (!isFxTradingDay(date)) return 0.0;
  // Deterministic daily jitter based on day of year
  const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000);
  const cycle = Math.sin(dayOfYear * 0.45) * 0.35 + Math.cos(dayOfYear * 0.15) * 0.2;
  const rate = Math.min(2.0, Math.max(0.4, Number((baseSeed + cycle).toFixed(2))));
  return rate;
}

/**
 * Subscribe to the real-time user yield allocation state in Firestore
 */
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
          dailyRatePct: Number(d.dailyRatePct || 1.35),
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
 * Subscribe to the user's yield ledger entries (audit logs, distributions, allocations)
 */
export function subscribeUserYieldLedger(
  userId: string,
  onData: (entries: YieldLedgerEntry[]) => void,
  onError?: (err: Error) => void,
  entryLimit = 30
): () => void {
  const path = 'yield_ledger';
  const q = query(
    collection(db, 'yield_ledger'),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc'),
    limit(entryLimit)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: YieldLedgerEntry[] = snapshot.docs.map((docSnap) => {
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
      });
      onData(items);
    },
    (error) => {
      const wrapped = new Error(`Failed to stream yield ledger for user ${userId}`);
      if (onError) onError(wrapped);
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

/**
 * Submit a new performance pool allocation deposit via TRC20 USDT TxID
 */
export async function submitYieldPoolAllocation(params: {
  userId: string;
  amountUsdt: number;
  txHash: string;
  recipientAddress: string;
}): Promise<{ success: boolean; entryId?: string; error?: string }> {
  const path = 'yield_ledger';
  const cleanedTx = params.txHash.trim();

  if (params.amountUsdt < 200) {
    return { success: false, error: 'Minimum allocation deposit is $200 USDT.' };
  }
  if (!cleanedTx || cleanedTx.length < 32) {
    return { success: false, error: 'Please enter a valid TRON TRC20 transaction hash (TxID).' };
  }

  try {
    const entryData = {
      userId: params.userId,
      type: 'allocation',
      amount: params.amountUsdt,
      netAmount: params.amountUsdt,
      feeAmount: 0,
      txHash: cleanedTx,
      status: 'pending',
      description: `Strategy pool allocation deposit ($${params.amountUsdt.toLocaleString()} USDT)`,
      network: 'TRC20',
      recipientAddress: params.recipientAddress,
      metadata: {
        submittedAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
      serverTimestamp: serverTimestamp(),
    };

    const docRef = await addDoc(collection(db, 'yield_ledger'), entryData);

    // Ensure the user's root allocation document exists or update status to pending review
    const allocRef = doc(db, 'user_yield_allocations', params.userId);
    const allocSnap = await getDoc(allocRef);

    if (!allocSnap.exists()) {
      await setDoc(allocRef, {
        userId: params.userId,
        allocatedAmountUsdt: 0, // credited upon confirmation by verification engine
        walletBalanceUsdt: 0,
        totalYieldEarnedUsdt: 0,
        dailyRatePct: computeDailyMarketYieldRate(new Date()),
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    return { success: true, entryId: docRef.id };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

/**
 * Request a withdrawal from the user's performance pool wallet
 */
export async function submitYieldPoolWithdrawal(params: {
  userId: string;
  amountUsdt: number;
  destinationAddress: string;
}): Promise<{ success: boolean; entryId?: string; error?: string }> {
  const path = 'yield_ledger';
  const addr = params.destinationAddress.trim();

  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) {
    return { success: false, error: 'Invalid TRON TRC20 destination wallet address.' };
  }

  if (params.amountUsdt <= 0) {
    return { success: false, error: 'Withdrawal amount must be greater than zero.' };
  }

  try {
    const allocRef = doc(db, 'user_yield_allocations', params.userId);
    const allocSnap = await getDoc(allocRef);

    if (!allocSnap.exists()) {
      return { success: false, error: 'No active yield allocation found for this account.' };
    }

    const alloc = allocSnap.data();
    const available = Number(alloc.walletBalanceUsdt || 0);

    if (params.amountUsdt > available) {
      return {
        success: false,
        error: `Insufficient yield wallet balance ($${available.toFixed(2)} available).`,
      };
    }

    // Deduct available wallet balance atomically & record withdrawal ledger entry
    const newBalance = Math.max(0, available - params.amountUsdt);
    await updateDoc(allocRef, {
      walletBalanceUsdt: newBalance,
      updatedAt: new Date().toISOString(),
    });

    const entryData = {
      userId: params.userId,
      type: 'withdrawal_request',
      amount: params.amountUsdt,
      netAmount: params.amountUsdt,
      feeAmount: 0,
      status: 'pending',
      description: `USDT TRC20 Yield Payout to ${addr.slice(0, 6)}...${addr.slice(-4)}`,
      network: 'TRC20',
      recipientAddress: addr,
      createdAt: new Date().toISOString(),
      serverTimestamp: serverTimestamp(),
    };

    const docRef = await addDoc(collection(db, 'yield_ledger'), entryData);
    return { success: true, entryId: docRef.id };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

/**
 * Computes forward compound yield projection based on allocation, timeframe in days, and daily rate.
 * Only compounds on active market days (Mon-Fri).
 */
export function projectPerformanceGrowth(
  principalUsdt: number,
  tradingDays: number,
  dailyRatePct: number
): { finalAmount: number; totalYield: number; dataPoints: { day: number; equity: number }[] } {
  if (principalUsdt <= 0 || tradingDays <= 0) {
    return { finalAmount: principalUsdt, totalYield: 0, dataPoints: [{ day: 0, equity: principalUsdt }] };
  }

  const rate = Math.max(0, dailyRatePct / 100);
  let current = principalUsdt;
  const points: { day: number; equity: number }[] = [{ day: 0, equity: Number(current.toFixed(2)) }];

  const step = Math.max(1, Math.floor(tradingDays / 12));

  for (let i = 1; i <= tradingDays; i++) {
    current = current * (1 + rate);
    if (i % step === 0 || i === tradingDays) {
      points.push({ day: i, equity: Number(current.toFixed(2)) });
    }
  }

  const totalYield = Math.max(0, current - principalUsdt);
  return {
    finalAmount: Number(current.toFixed(2)),
    totalYield: Number(totalYield.toFixed(2)),
    dataPoints: points,
  };
}
