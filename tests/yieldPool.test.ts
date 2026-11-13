import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_YIELD_RATE_PCT,
  TERM_BUSINESS_DAYS,
  canRunDailyPayoutForPosition,
  dailyYieldForPrincipal,
  isUtcBusinessDay,
  previousUtcDayKey,
  summarizeUserYield,
} from '../src/backend/yieldPool.ts';
import {
  YieldPoolError,
  adminCompleteWithdrawal,
  adminGetOverview,
  adminManualCreditAllocation,
  adminRejectWithdrawal,
  requestYieldWithdrawal,
  runDailyPayoutSweep,
  useYieldPoolDepsForTests,
  verifyAndAllocate,
  type YieldPoolDb,
} from '../src/backend/yieldPoolService.ts';
import { DocExistsError } from '../src/backend/firestoreAdmin.ts';
import { USDT_TRC20_CONTRACT } from '../src/backend/tron.ts';

const TREASURY = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
const CLIENT_WALLET = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

function makeFakeDb() {
  const store = new Map<string, Record<string, any>>();
  const key = (col: string, id: string) => `${col}/${id}`;

  const db: YieldPoolDb = {
    isFirestoreAdminConfigured: () => true,
    async getDoc(col: string, id: string) {
      const val = store.get(key(col, id));
      return val ? structuredClone(val) : null;
    },
    async setDoc(col: string, id: string, data: Record<string, any>) {
      store.set(key(col, id), structuredClone(data));
    },
    async createDoc(col: string, id: string, data: Record<string, any>) {
      const k = key(col, id);
      if (store.has(k)) throw new DocExistsError();
      store.set(k, structuredClone(data));
    },
    async queryEquals(col: string, field: string, value: string | number | boolean) {
      const out: Record<string, any>[] = [];
      const prefix = `${col}/`;
      for (const [k, v] of store.entries()) {
        if (k.startsWith(prefix) && v[field] === value) out.push(structuredClone(v));
      }
      return out;
    },
    async listAll(col: string) {
      const out: Record<string, any>[] = [];
      const prefix = `${col}/`;
      for (const [k, v] of store.entries()) {
        if (k.startsWith(prefix)) out.push(structuredClone(v));
      }
      return out;
    },
  };

  return { store, db };
}

function makeFakeTron(opts?: {
  amountUsdt?: number;
  to?: string;
  final?: boolean;
  timestampMs?: number;
}) {
  return {
    async fetchTxEvents() {
      return [
        {
          event_name: 'Transfer',
          contract_address: USDT_TRC20_CONTRACT,
          block_timestamp: opts?.timestampMs ?? Date.now(),
          result: {
            from: '0x' + '11'.repeat(20),
            to: opts?.to ?? TREASURY,
            value: String(Math.round((opts?.amountUsdt ?? 500) * 1e6)),
          },
        },
      ];
    },
    async isTxFinalAndSuccessful() {
      return opts?.final ?? true;
    },
  };
}

test('pure fixed 2% Mon-Fri 100-business-day rules and summaries', () => {
  // 2026-11-13 is Friday, 2026-11-14 is Saturday, 2026-11-15 is Sunday, 2026-11-16 is Monday
  assert.equal(isUtcBusinessDay('2026-11-13'), true);
  assert.equal(isUtcBusinessDay('2026-11-14'), false);
  assert.equal(isUtcBusinessDay('2026-11-15'), false);
  assert.equal(isUtcBusinessDay('2026-11-16'), true);
  assert.equal(previousUtcDayKey(new Date('2026-11-14T00:05:00Z')), '2026-11-13');

  assert.equal(dailyYieldForPrincipal(500), 10);
  assert.equal(dailyYieldForPrincipal(1250), 25);
  assert.equal(dailyYieldForPrincipal(0), 0);

  const pos = {
    id: 'p1',
    userId: 'u1',
    principalUsdt: 1000,
    dailyRatePct: DAILY_YIELD_RATE_PCT,
    dailyPayoutUsdt: 20,
    businessDaysCompleted: 99,
    termBusinessDays: TERM_BUSINESS_DAYS,
    totalEarnedUsdt: 1980,
    txHash: 'a'.repeat(64),
    status: 'active' as const,
    lastPayoutDate: '2026-11-12',
    startedAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-11-12T00:05:00.000Z',
  };

  assert.equal(canRunDailyPayoutForPosition(pos, '2026-11-13'), true);
  assert.equal(canRunDailyPayoutForPosition(pos, '2026-11-12'), false, 'cannot double pay same date');
  assert.equal(canRunDailyPayoutForPosition(pos, '2026-11-14'), false, 'no payout on Saturday');
  assert.equal(canRunDailyPayoutForPosition({ ...pos, businessDaysCompleted: 100 }, '2026-11-13'), false, 'completed 100 days');

  const summary = summarizeUserYield('u1', [pos], 1980);
  assert.equal(summary.allocatedAmountUsdt, 1000);
  assert.equal(summary.walletBalanceUsdt, 1980);
  assert.equal(summary.totalYieldEarnedUsdt, 1980);
  assert.equal(summary.businessDaysCompleted, 99);
  assert.equal(summary.status, 'active');
});

test('verifyAndAllocate verifies TRC20 deposit, prevents TXID replay, and requires finality', async () => {
  const prevTreasury = process.env.TREASURY_ADDRESS;
  process.env.TREASURY_ADDRESS = TREASURY;
  const { db } = makeFakeDb();
  const tx1 = 'a'.repeat(64);
  const tx2 = 'b'.repeat(64);

  try {
    // 1. Unconfirmed TX returns 409
    useYieldPoolDepsForTests(db, makeFakeTron({ amountUsdt: 500, final: false }));
    await assert.rejects(
      () => verifyAndAllocate('user-1', 500, tx1),
      (err: any) => err instanceof YieldPoolError && err.status === 409
    );

    // 2. Confirmed TX creates active 100-day position & ledger with exact on-chain amount (e.g. $499 after 1 USDT fee)
    useYieldPoolDepsForTests(db, makeFakeTron({ amountUsdt: 499, final: true }));
    const res = await verifyAndAllocate('user-1', 500, tx1);
    assert.equal(res.position.principalUsdt, 499);
    assert.equal(res.position.dailyPayoutUsdt, 9.98);
    assert.equal(res.position.termBusinessDays, 100);
    assert.equal(res.allocation.allocatedAmountUsdt, 499);
    assert.equal(res.allocation.status, 'active');

    // 3. Replaying same TXID is blocked
    await assert.rejects(
      () => verifyAndAllocate('user-2', 499, tx1),
      (err: any) => err instanceof YieldPoolError && err.status === 409
    );

    // 4. Transfer too short beyond 4 USDT tolerance is rejected
    useYieldPoolDepsForTests(db, makeFakeTron({ amountUsdt: 400, final: true }));
    await assert.rejects(
      () => verifyAndAllocate('user-1', 500, tx2),
      (err: any) => err instanceof YieldPoolError && err.status === 400
    );
  } finally {
    useYieldPoolDepsForTests(null, null);
    if (prevTreasury === undefined) delete process.env.TREASURY_ADDRESS;
    else process.env.TREASURY_ADDRESS = prevTreasury;
  }
});

test('runDailyPayoutSweep credits 2% Mon-Fri, skips weekends, stays idempotent, and completes at day 100', async () => {
  const prevTreasury = process.env.TREASURY_ADDRESS;
  process.env.TREASURY_ADDRESS = TREASURY;
  const { db } = makeFakeDb();

  try {
    useYieldPoolDepsForTests(db, makeFakeTron({ amountUsdt: 1000, final: true }));
    await db.setDoc('users', 'u1', { uid: 'u1', role: 'client' });

    const { position } = await adminManualCreditAllocation('admin-1', {
      userId: 'u1',
      amountUsdt: 1000,
    });
    // Backdate position start to earlier month and simulate Day 99 already completed
    await db.setDoc('yield_positions', position.id, {
      ...position,
      startedAt: '2026-06-01T10:00:00.000Z',
      businessDaysCompleted: 99,
      totalEarnedUsdt: 1980,
      lastPayoutDate: '2026-11-12',
    });
    await db.setDoc('user_yield_allocations', 'u1', {
      userId: 'u1',
      allocatedAmountUsdt: 1000,
      walletBalanceUsdt: 1980,
      totalYieldEarnedUsdt: 1980,
      dailyRatePct: 2.0,
      businessDaysCompleted: 99,
      termBusinessDays: 100,
      activePositionsCount: 1,
      status: 'active',
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-11-12T00:05:00.000Z',
    });

    // Weekend sweep (Saturday 2026-11-14) skips
    const sat = await runDailyPayoutSweep({ dateKey: '2026-11-14' });
    assert.equal(sat.skipped, true);

    // Friday 2026-11-13 credits Day 100 ($20) and marks position completed
    const fri1 = await runDailyPayoutSweep({
      now: new Date('2026-11-14T00:05:00Z'),
      dateKey: '2026-11-13',
    });
    assert.equal(fri1.skipped, false);
    assert.equal(fri1.creditedPositions, 1);
    assert.equal(fri1.totalDistributedUsdt, 20);
    assert.equal(fri1.completedPositions, 1);

    // Re-running same Friday date credits 0
    const fri2 = await runDailyPayoutSweep({ dateKey: '2026-11-13' });
    assert.equal(fri2.creditedPositions, 0);

    // Next Monday 2026-11-16 credits 0 because 100-day term completed
    const mon = await runDailyPayoutSweep({ dateKey: '2026-11-16' });
    assert.equal(mon.creditedPositions, 0);

    const updatedPos = await db.getDoc('yield_positions', position.id);
    assert.equal(updatedPos?.status, 'completed');
    assert.equal(updatedPos?.businessDaysCompleted, 100);
    assert.equal(updatedPos?.totalEarnedUsdt, 2000);

    const updatedAlloc = await db.getDoc('user_yield_allocations', 'u1');
    assert.equal(updatedAlloc?.walletBalanceUsdt, 2000);
    assert.equal(updatedAlloc?.allocatedAmountUsdt, 0, 'completed principal no longer listed active');
    assert.equal(updatedAlloc?.status, 'completed');
  } finally {
    useYieldPoolDepsForTests(null, null);
    if (prevTreasury === undefined) delete process.env.TREASURY_ADDRESS;
    else process.env.TREASURY_ADDRESS = prevTreasury;
  }
});

test('withdrawals deduct balance atomically, refund cleanly on rejection, and require TronGrid proof on completion', async () => {
  const prevTreasury = process.env.TREASURY_ADDRESS;
  process.env.TREASURY_ADDRESS = TREASURY;
  const { db } = makeFakeDb();

  try {
    useYieldPoolDepsForTests(db, null);
    await db.setDoc('users', 'u1', { uid: 'u1', role: 'client' });
    await db.setDoc('user_yield_allocations', 'u1', {
      userId: 'u1',
      allocatedAmountUsdt: 1000,
      walletBalanceUsdt: 120,
      totalYieldEarnedUsdt: 120,
      dailyRatePct: 2.0,
      businessDaysCompleted: 6,
      termBusinessDays: 100,
      activePositionsCount: 1,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 1. Over-balance withdrawal rejected
    await assert.rejects(
      () => requestYieldWithdrawal('u1', 150, CLIENT_WALLET),
      (err: any) => err instanceof YieldPoolError && err.status === 400
    );

    // 2. Request $50 -> balance drops to $70, then admin rejects -> balance restored to $120
    const wd1 = await requestYieldWithdrawal('u1', 50, CLIENT_WALLET);
    assert.equal(wd1.allocation.walletBalanceUsdt, 70);
    const rejected = await adminRejectWithdrawal('admin-1', wd1.ledgerId, 'Incorrect wallet requested');
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.refundedWallet, 120);

    // 3. Request $80 -> admin tries completing with wrong recipient / missing TronGrid -> fails; with valid proof -> completes
    const wd2 = await requestYieldWithdrawal('u1', 80, CLIENT_WALLET);
    assert.equal(wd2.allocation.walletBalanceUsdt, 40);

    const payoutTx = 'c'.repeat(64);
    useYieldPoolDepsForTests(db, makeFakeTron({ amountUsdt: 80, to: TREASURY, final: true }));
    await assert.rejects(
      () => adminCompleteWithdrawal('admin-1', wd2.ledgerId, payoutTx),
      YieldPoolError
    );

    useYieldPoolDepsForTests(db, makeFakeTron({ amountUsdt: 80, to: CLIENT_WALLET, final: true }));
    const completed = await adminCompleteWithdrawal('admin-1', wd2.ledgerId, payoutTx);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.txHash, payoutTx);

    const overview = await adminGetOverview();
    assert.equal(overview.stats.pendingWithdrawalsCount, 0);
    assert.equal(overview.stats.totalWalletLiabilityUsdt, 40);
  } finally {
    useYieldPoolDepsForTests(null, null);
    if (prevTreasury === undefined) delete process.env.TREASURY_ADDRESS;
    else process.env.TREASURY_ADDRESS = prevTreasury;
  }
});
