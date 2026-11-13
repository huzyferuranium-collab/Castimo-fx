/**
 * Server-authoritative Yield Pool service.
 *
 *  - Verifies client TRC20 USDT allocations directly on the TRON blockchain (TronGrid),
 *    prevents replay via `used_tx_hashes`, and creates active 100-business-day positions.
 *  - Accrues fixed 2.0% daily yield Monday–Friday UTC at 00:05 UTC (previous business day)
 *    with deterministic ledger IDs so no client can ever be double-paid.
 *  - Handles client withdrawal requests, admin rejection-with-refund, and TronGrid-verified
 *    payout completion.
 */
import { randomUUID } from 'node:crypto';
import * as firestore from './firestoreAdmin.ts';
import {
  TXID_PATTERN as HASH,
  checkUsdtPayment,
  fetchTxEvents,
  isTxFinalAndSuccessful,
  tronAddressToHex20,
} from './tron.ts';
import {
  DAILY_YIELD_RATE_PCT,
  DEPOSIT_TOLERANCE_USDT,
  MAX_ALLOCATION_USDT,
  MIN_ALLOCATION_USDT,
  MIN_WITHDRAWAL_USDT,
  TERM_BUSINESS_DAYS,
  type UserYieldAllocationSummary,
  type YieldPositionRecord,
  canRunDailyPayoutForPosition,
  dailyYieldForPrincipal,
  isUtcBusinessDay,
  previousUtcDayKey,
  round2,
  summarizeUserYield,
} from './yieldPool.ts';

const { DocExistsError } = firestore;

export type YieldPoolDb = Pick<
  typeof firestore,
  'createDoc' | 'getDoc' | 'isFirestoreAdminConfigured' | 'listAll' | 'queryEquals' | 'setDoc'
>;

export interface TronVerifier {
  fetchTxEvents: (txid: string) => Promise<any[]>;
  isTxFinalAndSuccessful: (txid: string) => Promise<boolean>;
}

let db: YieldPoolDb = firestore;
let tronVerifier: TronVerifier = { fetchTxEvents, isTxFinalAndSuccessful };

export function useYieldPoolDepsForTests(
  fakeDb: YieldPoolDb | null,
  fakeTron?: TronVerifier | null
): void {
  db = fakeDb ?? firestore;
  tronVerifier = fakeTron ?? { fetchTxEvents, isTxFinalAndSuccessful };
}

export class YieldPoolError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'YieldPoolError';
    this.status = status;
  }
}

const queues = new Map<string, Promise<unknown>>();
function locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(key, next.catch(() => undefined));
  return next;
}

export function treasuryAddress(): string {
  return (process.env.TREASURY_ADDRESS || process.env.VITE_TREASURY_ADDRESS || '').trim();
}

export function yieldPoolEnabled(): boolean {
  return db.isFirestoreAdminConfigured() && tronAddressToHex20(treasuryAddress()) !== null;
}

function needConfigured(): void {
  if (!db.isFirestoreAdminConfigured()) {
    throw new YieldPoolError(
      'Yield Pool service is not configured yet (FIREBASE_SERVICE_ACCOUNT is missing on the server).',
      503
    );
  }
}

function needTreasuryEnabled(): string {
  needConfigured();
  const addr = treasuryAddress();
  if (tronAddressToHex20(addr) === null) {
    throw new YieldPoolError(
      'Payment wallet is not configured on the server (TREASURY_ADDRESS is missing or invalid).',
      503
    );
  }
  return addr;
}

type Doc = Record<string, any>;

async function syncUserAllocationDoc(uid: string, walletOverride?: number, lastDistributionAt?: string): Promise<UserYieldAllocationSummary> {
  const existing = (await db.getDoc('user_yield_allocations', uid)) as Doc | null;
  const positions = (await db.queryEquals('yield_positions', 'userId', uid)) as unknown as YieldPositionRecord[];
  const wallet = walletOverride !== undefined ? walletOverride : Number(existing?.walletBalanceUsdt ?? 0);
  const summary = summarizeUserYield(uid, positions, wallet, {
    createdAt: existing?.createdAt ? String(existing.createdAt) : undefined,
    lastDistributionAt: lastDistributionAt || (existing?.lastDistributionAt ? String(existing.lastDistributionAt) : undefined),
  });
  await db.setDoc('user_yield_allocations', uid, summary as any);
  return summary;
}

/** Client summary: authoritative allocation, active positions, ledger, and official treasury wallet. */
export async function getClientSummary(uid: string) {
  const addr = treasuryAddress();
  const treasuryValid = tronAddressToHex20(addr) !== null;
  if (!db.isFirestoreAdminConfigured()) {
    return {
      enabled: false,
      treasuryAddress: treasuryValid ? addr : '',
      allocation: null,
      positions: [],
      ledger: [],
      rules: {
        dailyRatePct: DAILY_YIELD_RATE_PCT,
        termBusinessDays: TERM_BUSINESS_DAYS,
        minAllocationUsdt: MIN_ALLOCATION_USDT,
        minWithdrawalUsdt: MIN_WITHDRAWAL_USDT,
      },
    };
  }

  const [alloc, positions, ledger] = await Promise.all([
    db.getDoc('user_yield_allocations', uid),
    db.queryEquals('yield_positions', 'userId', uid),
    db.queryEquals('yield_ledger', 'userId', uid),
  ]);

  const sortedPositions = [...positions].sort((a, b) =>
    String(b.startedAt || '').localeCompare(String(a.startedAt || ''))
  );
  const sortedLedger = [...ledger]
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 50);

  return {
    enabled: yieldPoolEnabled(),
    treasuryAddress: treasuryValid ? addr : '',
    allocation: alloc,
    positions: sortedPositions,
    ledger: sortedLedger,
    rules: {
      dailyRatePct: DAILY_YIELD_RATE_PCT,
      termBusinessDays: TERM_BUSINESS_DAYS,
      minAllocationUsdt: MIN_ALLOCATION_USDT,
      minWithdrawalUsdt: MIN_WITHDRAWAL_USDT,
    },
  };
}

/** Verifies a TRC20 USDT transfer to the official treasury on TRON and activates a 100-business-day 2% position. */
export async function verifyAndAllocate(
  uid: string,
  amountRaw: unknown,
  txHashRaw: unknown
): Promise<{ position: YieldPositionRecord; allocation: UserYieldAllocationSummary; ledgerId: string }> {
  const treasury = needTreasuryEnabled();
  const requestedAmount = Number(amountRaw);
  if (!Number.isFinite(requestedAmount) || requestedAmount < MIN_ALLOCATION_USDT || requestedAmount > MAX_ALLOCATION_USDT) {
    throw new YieldPoolError(`Allocation amount must be between $${MIN_ALLOCATION_USDT} and $${MAX_ALLOCATION_USDT.toLocaleString()} USDT.`);
  }

  const txHash = String(txHashRaw ?? '').trim().toLowerCase();
  if (!HASH.test(txHash)) {
    throw new YieldPoolError('Please paste a valid 64-character TRON (TRC20) transaction ID (TxID).');
  }

  return locked(`yp:${uid}`, async () => {
    const existingHash = await db.getDoc('used_tx_hashes', txHash);
    if (existingHash) {
      throw new YieldPoolError('This transaction ID has already been claimed.', 409);
    }

    let events: any[];
    let final: boolean;
    try {
      [events, final] = await Promise.all([
        tronVerifier.fetchTxEvents(txHash),
        tronVerifier.isTxFinalAndSuccessful(txHash),
      ]);
    } catch {
      throw new YieldPoolError('Could not reach the TRON network to verify this transaction. Please try again in a minute.', 502);
    }

    const notBeforeMs = Date.now() - 14 * 86_400_000;
    const minAcceptable = Math.max(MIN_ALLOCATION_USDT, round2(requestedAmount - DEPOSIT_TOLERANCE_USDT));
    const check = checkUsdtPayment(events, {
      treasury,
      minUsdt: minAcceptable,
      notBeforeMs,
    });
    if (!check.ok || !check.amountUsdt) {
      throw new YieldPoolError(check.error || 'Payment could not be verified on the TRON network.');
    }
    if (!final) {
      throw new YieldPoolError(
        `Transfer of $${round2(check.amountUsdt).toFixed(2)} USDT found on TRON and still confirming. Wait 1–2 minutes and tap Submit again.`,
        409
      );
    }

    const creditedUsdt = round2(check.amountUsdt);
    const positionId = `pos-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const nowIso = new Date().toISOString();

    try {
      await db.createDoc('used_tx_hashes', txHash, {
        invoiceId: `yield-${positionId}`,
        userId: uid,
        at: nowIso,
      });
    } catch (e) {
      if (!(e instanceof DocExistsError)) throw e;
      throw new YieldPoolError('This transaction ID has already been claimed.', 409);
    }

    const position: YieldPositionRecord = {
      id: positionId,
      userId: uid,
      principalUsdt: creditedUsdt,
      dailyRatePct: DAILY_YIELD_RATE_PCT,
      dailyPayoutUsdt: dailyYieldForPrincipal(creditedUsdt),
      businessDaysCompleted: 0,
      termBusinessDays: TERM_BUSINESS_DAYS,
      totalEarnedUsdt: 0,
      txHash,
      status: 'active',
      lastPayoutDate: '',
      startedAt: nowIso,
      updatedAt: nowIso,
    };
    await db.createDoc('yield_positions', positionId, position as any);

    const ledgerId = `yp-alloc-${positionId}`;
    await db.createDoc('yield_ledger', ledgerId, {
      id: ledgerId,
      userId: uid,
      allocationId: positionId,
      type: 'allocation',
      amount: creditedUsdt,
      netAmount: creditedUsdt,
      feeAmount: 0,
      txHash,
      status: 'confirmed',
      description: `Fixed 2% Yield Pool allocation ($${creditedUsdt.toLocaleString()} USDT · 100 business days)`,
      network: 'TRC20',
      recipientAddress: treasury,
      createdAt: nowIso,
      confirmedAt: nowIso,
    });

    const allocation = await syncUserAllocationDoc(uid);
    return { position, allocation, ledgerId };
  });
}

/** Requests a TRC20 withdrawal from the user's authoritative earned wallet balance. */
export async function requestYieldWithdrawal(
  uid: string,
  amountRaw: unknown,
  destinationAddressRaw: unknown
): Promise<{ ledgerId: string; allocation: UserYieldAllocationSummary }> {
  needConfigured();
  const amount = round2(Number(amountRaw));
  if (!Number.isFinite(amount) || amount < MIN_WITHDRAWAL_USDT) {
    throw new YieldPoolError(`Minimum withdrawal is $${MIN_WITHDRAWAL_USDT} USDT.`);
  }
  const destination = String(destinationAddressRaw ?? '').trim();
  if (tronAddressToHex20(destination) === null) {
    throw new YieldPoolError('Please enter a valid TRON (TRC20) wallet address starting with T.');
  }

  return locked(`yp:${uid}`, async () => {
    const existing = (await db.getDoc('user_yield_allocations', uid)) as Doc | null;
    if (!existing) {
      throw new YieldPoolError('No yield pool account found yet.', 404);
    }
    const available = round2(Number(existing.walletBalanceUsdt ?? 0));
    if (amount > available) {
      throw new YieldPoolError(`Insufficient withdrawable balance ($${available.toFixed(2)} USDT available).`);
    }

    const newBalance = round2(Math.max(0, available - amount));
    const allocation = await syncUserAllocationDoc(uid, newBalance);

    const nowIso = new Date().toISOString();
    const ledgerId = `yp-wd-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await db.createDoc('yield_ledger', ledgerId, {
      id: ledgerId,
      userId: uid,
      type: 'withdrawal_request',
      amount,
      netAmount: amount,
      feeAmount: 0,
      status: 'pending',
      description: `USDT TRC20 Yield Payout to ${destination.slice(0, 6)}...${destination.slice(-4)}`,
      network: 'TRC20',
      recipientAddress: destination,
      createdAt: nowIso,
    });

    return { ledgerId, allocation };
  });
}

/**
 * Credits the fixed 2.0% payout for a single Mon–Fri UTC business date (`dateKey`, defaulting to yesterday UTC).
 * Idempotent per position + dateKey via deterministic `yield_ledger` ID (`yp-dist-{posId}-{dateKey}`).
 */
export async function runDailyPayoutSweep(opts?: {
  now?: Date;
  dateKey?: string;
}): Promise<{
  dateKey: string;
  skipped: boolean;
  reason?: string;
  creditedPositions: number;
  totalDistributedUsdt: number;
  completedPositions: number;
}> {
  if (!db.isFirestoreAdminConfigured()) {
    return {
      dateKey: opts?.dateKey || previousUtcDayKey(opts?.now),
      skipped: true,
      reason: 'FIREBASE_SERVICE_ACCOUNT not set',
      creditedPositions: 0,
      totalDistributedUsdt: 0,
      completedPositions: 0,
    };
  }

  const now = opts?.now || new Date();
  const dateKey = opts?.dateKey || previousUtcDayKey(now);

  if (!isUtcBusinessDay(dateKey)) {
    return {
      dateKey,
      skipped: true,
      reason: `${dateKey} is a weekend (Mon–Fri business days only)`,
      creditedPositions: 0,
      totalDistributedUsdt: 0,
      completedPositions: 0,
    };
  }

  const allPositions = (await db.listAll('yield_positions')) as unknown as YieldPositionRecord[];
  const active = allPositions.filter((p) => p && p.id && p.userId && p.status === 'active');

  let creditedPositions = 0;
  let totalDistributedUsdt = 0;
  let completedPositions = 0;

  for (const candidate of active) {
    await locked(`yp:${candidate.userId}`, async () => {
      const pos = (await db.getDoc('yield_positions', candidate.id)) as YieldPositionRecord | null;
      if (!pos || !canRunDailyPayoutForPosition(pos, dateKey)) return;

      const payout = dailyYieldForPrincipal(pos.principalUsdt, pos.dailyRatePct || DAILY_YIELD_RATE_PCT);
      if (payout <= 0) return;

      const ledgerId = `yp-dist-${pos.id}-${dateKey}`;
      const nowIso = now.toISOString();

      try {
        await db.createDoc('yield_ledger', ledgerId, {
          id: ledgerId,
          userId: pos.userId,
          allocationId: pos.id,
          type: 'yield_distribution',
          amount: payout,
          netAmount: payout,
          feeAmount: 0,
          status: 'confirmed',
          description: `Day ${pos.businessDaysCompleted + 1}/${pos.termBusinessDays} fixed 2.0% yield (${dateKey})`,
          network: 'TRC20',
          metadata: {
            dailyRatePct: pos.dailyRatePct || DAILY_YIELD_RATE_PCT,
            distributionDate: dateKey,
            tradingDay: true,
          },
          createdAt: nowIso,
          confirmedAt: nowIso,
        });
      } catch (e) {
        if (e instanceof DocExistsError) return; // already credited for this date
        throw e;
      }

      const nextDays = Number(pos.businessDaysCompleted || 0) + 1;
      const reachedEnd = nextDays >= Number(pos.termBusinessDays || TERM_BUSINESS_DAYS);
      const updatedPos: YieldPositionRecord = {
        ...pos,
        businessDaysCompleted: nextDays,
        totalEarnedUsdt: round2(Number(pos.totalEarnedUsdt || 0) + payout),
        lastPayoutDate: dateKey,
        status: reachedEnd ? 'completed' : 'active',
        ...(reachedEnd ? { completedAt: nowIso } : {}),
        updatedAt: nowIso,
      };
      await db.setDoc('yield_positions', pos.id, updatedPos as any);

      const currentAlloc = (await db.getDoc('user_yield_allocations', pos.userId)) as Doc | null;
      const nextWallet = round2(Number(currentAlloc?.walletBalanceUsdt ?? 0) + payout);
      await syncUserAllocationDoc(pos.userId, nextWallet, nowIso);

      creditedPositions++;
      totalDistributedUsdt = round2(totalDistributedUsdt + payout);
      if (reachedEnd) completedPositions++;
    });
  }

  return {
    dateKey,
    skipped: false,
    creditedPositions,
    totalDistributedUsdt,
    completedPositions,
  };
}

// ---------- Administrator Operations ----------

export async function adminGetOverview() {
  needConfigured();
  const [allocs, positions, ledger] = await Promise.all([
    db.listAll('user_yield_allocations'),
    db.listAll('yield_positions'),
    db.listAll('yield_ledger'),
  ]);

  const activePositions = positions.filter((p) => p.status === 'active');
  const completedPositions = positions.filter((p) => p.status === 'completed');
  const withdrawals = ledger
    .filter((l) => l.type === 'withdrawal_request')
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const pendingWithdrawals = withdrawals.filter((w) => w.status === 'pending');

  const totalActiveCapitalUsdt = round2(
    activePositions.reduce((sum, p) => sum + Number(p.principalUsdt || 0), 0)
  );
  const totalWalletLiabilityUsdt = round2(
    allocs.reduce((sum, a) => sum + Number(a.walletBalanceUsdt || 0), 0)
  );
  const totalYieldPaidUsdt = round2(
    positions.reduce((sum, p) => sum + Number(p.totalEarnedUsdt || 0), 0)
  );

  return {
    enabled: yieldPoolEnabled(),
    treasuryAddress: treasuryAddress(),
    stats: {
      totalActiveCapitalUsdt,
      totalWalletLiabilityUsdt,
      totalYieldPaidUsdt,
      activePositionsCount: activePositions.length,
      completedPositionsCount: completedPositions.length,
      pendingWithdrawalsCount: pendingWithdrawals.length,
    },
    positions: [...positions].sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || ''))),
    withdrawals: withdrawals.slice(0, 100),
    recentLedger: [...ledger]
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 50),
  };
}

/** Admin manually activates a fixed 2% position (e.g. for an exchange-batched payment verified out-of-band). */
export async function adminManualCreditAllocation(
  adminUid: string,
  params: { userId: string; amountUsdt: number; txHash?: string; note?: string }
) {
  needConfigured();
  const userId = String(params.userId ?? '').trim();
  const amount = round2(Number(params.amountUsdt));
  if (!userId) throw new YieldPoolError('Client User ID is required.');
  if (!Number.isFinite(amount) || amount < MIN_ALLOCATION_USDT || amount > MAX_ALLOCATION_USDT) {
    throw new YieldPoolError(`Amount must be between $${MIN_ALLOCATION_USDT} and $${MAX_ALLOCATION_USDT.toLocaleString()} USDT.`);
  }

  const userDoc = await db.getDoc('users', userId);
  if (!userDoc) throw new YieldPoolError(`No user account found with ID "${userId}".`, 404);

  const txHash = String(params.txHash ?? '').trim().toLowerCase();
  if (txHash && !HASH.test(txHash)) {
    throw new YieldPoolError('If supplying a TXID, it must be a 64-character hex hash.');
  }

  return locked(`yp:${userId}`, async () => {
    const positionId = `pos-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const nowIso = new Date().toISOString();

    if (txHash) {
      try {
        await db.createDoc('used_tx_hashes', txHash, {
          invoiceId: `yield-${positionId}`,
          userId,
          at: nowIso,
          confirmedBy: adminUid,
        });
      } catch (e) {
        if (!(e instanceof DocExistsError)) throw e;
        throw new YieldPoolError('This transaction ID has already been claimed.', 409);
      }
    }

    const position: YieldPositionRecord = {
      id: positionId,
      userId,
      principalUsdt: amount,
      dailyRatePct: DAILY_YIELD_RATE_PCT,
      dailyPayoutUsdt: dailyYieldForPrincipal(amount),
      businessDaysCompleted: 0,
      termBusinessDays: TERM_BUSINESS_DAYS,
      totalEarnedUsdt: 0,
      txHash: txHash || `manual-${adminUid.slice(0, 8)}-${Date.now()}`,
      status: 'active',
      lastPayoutDate: '',
      startedAt: nowIso,
      updatedAt: nowIso,
    };
    await db.createDoc('yield_positions', positionId, position as any);

    const ledgerId = `yp-alloc-${positionId}`;
    await db.createDoc('yield_ledger', ledgerId, {
      id: ledgerId,
      userId,
      allocationId: positionId,
      type: 'allocation',
      amount,
      netAmount: amount,
      feeAmount: 0,
      ...(txHash ? { txHash } : {}),
      status: 'confirmed',
      description: `Admin credited 2% Yield Pool ($${amount.toLocaleString()} USDT)${params.note ? ` · ${String(params.note).slice(0, 100)}` : ''}`,
      network: 'TRC20',
      recipientAddress: treasuryAddress() || 'MANUAL_ADMIN_CREDIT',
      createdAt: nowIso,
      confirmedAt: nowIso,
    });

    const allocation = await syncUserAllocationDoc(userId);
    return { position, allocation };
  });
}

/** Completes a client Yield Pool withdrawal only after TronGrid verifies the outgoing TRC20 payout. */
export async function adminCompleteWithdrawal(adminUid: string, ledgerId: string, txHashRaw: unknown) {
  needConfigured();
  const txHash = String(txHashRaw ?? '').trim().toLowerCase();
  if (!HASH.test(txHash)) {
    throw new YieldPoolError('Paste the 64-character TRON transaction ID of the payout you sent.');
  }

  const entry = (await db.getDoc('yield_ledger', ledgerId)) as Doc | null;
  if (!entry || entry.type !== 'withdrawal_request') {
    throw new YieldPoolError('Withdrawal request not found.', 404);
  }
  if (entry.status !== 'pending') {
    throw new YieldPoolError(`This withdrawal is already ${entry.status}.`, 409);
  }

  return locked(`yp:${entry.userId}`, async () => {
    const fresh = (await db.getDoc('yield_ledger', ledgerId)) as Doc | null;
    if (!fresh || fresh.status !== 'pending') {
      throw new YieldPoolError('Withdrawal status already changed.', 409);
    }

    let events: any[];
    let final: boolean;
    try {
      [events, final] = await Promise.all([
        tronVerifier.fetchTxEvents(txHash),
        tronVerifier.isTxFinalAndSuccessful(txHash),
      ]);
    } catch {
      throw new YieldPoolError('Could not reach TronGrid to verify payout. Try again in a minute.', 502);
    }

    const check = checkUsdtPayment(events, {
      treasury: String(fresh.recipientAddress || ''),
      minUsdt: Number(fresh.netAmount || fresh.amount),
      notBeforeMs: Date.parse(String(fresh.createdAt || '')) - 15 * 60_000,
    });
    if (!check.ok) {
      throw new YieldPoolError(check.error || 'That TRON transfer does not match the client withdrawal amount and address.');
    }
    if (!final) {
      throw new YieldPoolError('Transaction is not solidified yet. Wait 1–2 minutes and retry.', 409);
    }

    const nowIso = new Date().toISOString();
    try {
      await db.createDoc('used_tx_hashes', txHash, {
        invoiceId: `yield-wd-${ledgerId}`,
        userId: fresh.userId,
        at: nowIso,
        confirmedBy: adminUid,
      });
    } catch (e) {
      if (!(e instanceof DocExistsError)) throw e;
      const used = (await db.getDoc('used_tx_hashes', txHash)) as Doc | null;
      if (!used || used.invoiceId !== `yield-wd-${ledgerId}`) {
        throw new YieldPoolError('This transaction ID was already used for another record.', 409);
      }
    }

    await db.setDoc('yield_ledger', ledgerId, {
      ...fresh,
      status: 'completed',
      txHash,
      confirmedAt: nowIso,
      updatedBy: adminUid,
    });

    return { ...fresh, status: 'completed', txHash, confirmedAt: nowIso };
  });
}

/** Rejects a pending withdrawal with a reason and refunds the reserved USDT back into the user's wallet. */
export async function adminRejectWithdrawal(adminUid: string, ledgerId: string, reasonRaw: unknown) {
  needConfigured();
  const reason = String(reasonRaw ?? '').trim();
  if (!reason) throw new YieldPoolError('Please provide a rejection reason.');

  const entry = (await db.getDoc('yield_ledger', ledgerId)) as Doc | null;
  if (!entry || entry.type !== 'withdrawal_request') {
    throw new YieldPoolError('Withdrawal request not found.', 404);
  }
  if (entry.status !== 'pending') {
    throw new YieldPoolError(`This withdrawal is already ${entry.status}.`, 409);
  }

  return locked(`yp:${entry.userId}`, async () => {
    const fresh = (await db.getDoc('yield_ledger', ledgerId)) as Doc | null;
    if (!fresh || fresh.status !== 'pending') {
      throw new YieldPoolError('Withdrawal status already changed.', 409);
    }

    const nowIso = new Date().toISOString();
    await db.setDoc('yield_ledger', ledgerId, {
      ...fresh,
      status: 'rejected',
      description: `${fresh.description} · Rejected: ${reason.slice(0, 120)}`,
      confirmedAt: nowIso,
      updatedBy: adminUid,
    });

    const alloc = (await db.getDoc('user_yield_allocations', String(fresh.userId))) as Doc | null;
    const refundedWallet = round2(Number(alloc?.walletBalanceUsdt ?? 0) + Number(fresh.amount || 0));
    await syncUserAllocationDoc(String(fresh.userId), refundedWallet);

    return { ...fresh, status: 'rejected', refundedWallet };
  });
}

// ---------- Automated Daily Mon–Fri Scheduler ----------

export class YieldPoolScheduler {
  private static instance: YieldPoolScheduler;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  static getInstance(): YieldPoolScheduler {
    if (!this.instance) this.instance = new YieldPoolScheduler();
    return this.instance;
  }

  start(): void {
    if (this.timer) return;
    // Initial check 12s after boot, then every 15 minutes
    setTimeout(() => void this.tick(), 12_000);
    this.timer = setInterval(() => void this.tick(), 15 * 60_000);
    console.log('📈 [YIELD POOL] Automated Mon–Fri 2% daily payout scheduler active.');
  }

  async tick(): Promise<void> {
    if (this.running || !db.isFirestoreAdminConfigured()) return;
    const now = new Date();
    // Wait 5 minutes past midnight UTC before settling previous UTC day
    if (now.getUTCHours() === 0 && now.getUTCMinutes() < 5) return;

    this.running = true;
    try {
      const res = await runDailyPayoutSweep({ now });
      if (!res.skipped && res.creditedPositions > 0) {
        console.log(
          `✅ [YIELD POOL] ${res.dateKey}: credited $${res.totalDistributedUsdt.toFixed(2)} across ${res.creditedPositions} position(s) (${res.completedPositions} reached 100d completion).`
        );
      }
    } catch (err: any) {
      console.warn('⚠️ [YIELD POOL] Daily sweep notice:', err?.message || err);
    } finally {
      this.running = false;
    }
  }
}
