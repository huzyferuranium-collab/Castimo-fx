/**
 * Real profit-share billing, run on the server from the broker's own numbers.
 *
 *  - When a client's account is broker-verified, a ledger is opened (its start time is where counting begins).
 *  - Profit is the net result of the trades that CLOSED on the account (profitShareRealized.ts / profitShareRun.ts), so
 *    deposits and withdrawals can never be mistaken for profit. Every settlement period the server stores the closed
 *    trades, takes 50% of the NEW profit above the high-water mark of cumulative realised profit, and creates an invoice.
 *    If any closed trade cannot be read, nothing is invoiced for that client and the sweep says so in the log.
 *  - Each day, shortly after 00:15 GMT, every profit-share client gets a "Profit Share update" in their notifications:
 *    what closed the day before, the period so far, and the 50% share so far.
 *  - Clients pay USDT (TRC20) to the treasury wallet; the payment is checked on the TRON blockchain.
 *  - An invoice that stays unpaid past its due time stops copying for that client until it is paid.
 *
 * Money records live in Firestore and can only be written by this server (service account).
 */
import { Mt5ConnectionManager, type ClientConnectionRecord } from './MT5_CONNECTION_MANAGER.ts';
import {
  type ClientLedger,
  DEFAULT_FEE_PCT,
  DEFAULT_MIN_INVOICE_PROFIT_USD,
  DEFAULT_INVOICE_DUE_HOURS,
  type Invoice,
  isSettlementDue,
  round2,
} from './profitShare.ts';
import { type RunDeps, dailyUpdateFor, dailyWindowOpen, previewShare, previousUtcDay, settleClient } from './profitShareRun.ts';
import { settlementAllowed, upgradeLedger } from './profitShareRealized.ts';
import { readLimit } from './brokerVerification.ts';
import { accrueCommissions, accrueDailyEquityCommission, recordEvent } from './referralService.ts';
import { commissionBaseUsdt, isDailyCommissionDay } from './referrals.ts';
import {
  DEFAULT_SUBSCRIPTION_PERIOD_DAYS,
  DEFAULT_SUBSCRIPTION_PRICE_USDT,
  type PlanRecord,
  type ServiceModel,
  canSelectModel,
  billingStanding,
  daysLeft,
  isServiceModel,
  nextPeriod,
  subscriptionActive,
} from './servicePlan.ts';
import { TXID_PATTERN as HASH, checkUsdtPayment, fetchTxEvents, isTxFinalAndSuccessful, tronAddressToHex20 } from './tron.ts';
import * as firestore from './firestoreAdmin.ts';

const { DocExistsError } = firestore;

/** The Firestore functions billing uses. Tests swap in a fake with useBillingDbForTests; otherwise it is the real one. */
export type BillingDb = Pick<typeof firestore, 'createDoc' | 'getDoc' | 'isFirestoreAdminConfigured' | 'listAll' | 'queryEquals' | 'setDoc'>;
let db: BillingDb = firestore;
export function useBillingDbForTests(fake: BillingDb | null): void {
  db = fake ?? firestore;
}
const createDoc: BillingDb['createDoc'] = (c, id, data) => db.createDoc(c, id, data);
const getDoc: BillingDb['getDoc'] = (c, id) => db.getDoc(c, id);
const isFirestoreAdminConfigured = (): boolean => db.isFirestoreAdminConfigured();
const listAll: BillingDb['listAll'] = (c) => db.listAll(c);
const queryEquals: BillingDb['queryEquals'] = (c, f, v) => db.queryEquals(c, f, v);
const setDoc: BillingDb['setDoc'] = (c, id, d) => db.setDoc(c, id, d);

/** The earliest moment a payment can count: when the plan was chosen or the invoice was made, less 15 minutes for clock differences. 0 when unknown. */
export function sinceMs(iso: unknown): number {
  const t = Date.parse(String(iso ?? ''));
  return Number.isFinite(t) ? t - 15 * 60_000 : 0;
}

/** The smallest payment accepted for an invoice: the amount due less the tolerance, and never under 1 USDT. */
export function acceptedMinimum(amountDueUsdt: number, toleranceUsdt: number): number {
  const tol = Number.isFinite(toleranceUsdt) && toleranceUsdt > 0 ? toleranceUsdt : 0;
  return Math.max(1, Math.round((amountDueUsdt - tol) * 100) / 100);
}

export interface AdminClientMoney {
  userId: string;
  login: string;
  model: 'profit_share' | 'subscription';
  /** Net result of the trades closed since the last invoice (null when it could not be read). */
  periodPnl: number | null;
  /** The 50% built up on that profit, not invoiced yet. */
  accruedShareUsdt: number | null;
  /** Invoices made and not paid yet. */
  unpaidUsdt: number;
  trades: number;
  readError: string;
}

export interface PayableNow {
  canPay: boolean;
  /** Why paying is not possible yet (empty when it is). */
  reason: string;
  minProfitUsd: number;
  feePct: number;
  /** Net result of the closed trades since the last invoice. */
  periodPnl: number;
  /** New profit above the high-water mark: what the fee is taken on. */
  gain: number;
  fee: number;
  trades: number;
  openTrades: number;
}

export class BillingError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'BillingError';
    this.status = status;
  }
}

function treasury(): string {
  return (process.env.TREASURY_ADDRESS || process.env.VITE_TREASURY_ADDRESS || '').trim();
}

export function billingConfig() {
  return {
    feePct: readLimit(process.env.FEE_PCT, DEFAULT_FEE_PCT),
    // Settled every 24 hours by default; SETTLEMENT_PERIOD_DAYS can lengthen it.
    periodDays: Math.max(1, readLimit(process.env.SETTLEMENT_PERIOD_DAYS, 1)),
    minProfitUsd: Math.max(0, readLimit(process.env.MIN_INVOICE_PROFIT_USD, DEFAULT_MIN_INVOICE_PROFIT_USD)),
    dueHours: Math.max(1, readLimit(process.env.INVOICE_DUE_HOURS, DEFAULT_INVOICE_DUE_HOURS)),
    // How many USDT short of a profit-share invoice a payment may be and still pass (whole USDT).
    paymentToleranceUsdt: readLimit(process.env.PAYMENT_TOLERANCE_USDT, 4),
    treasury: treasury(),
    subscriptionPriceUsdt: Math.max(1, readLimit(process.env.SUBSCRIPTION_PRICE_USDT, DEFAULT_SUBSCRIPTION_PRICE_USDT)),
    subscriptionDays: Math.max(1, readLimit(process.env.SUBSCRIPTION_PERIOD_DAYS, DEFAULT_SUBSCRIPTION_PERIOD_DAYS)),
  };
}

/** Billing runs only when the database key and a valid wallet are both set. */
export function billingEnabled(): boolean {
  return isFirestoreAdminConfigured() && tronAddressToHex20(treasury()) !== null;
}


/** A practice (demo) account: by its type, or by a demo/trial server name in case the type was not kept. */
export function isDemoAccount(rec: { accountType?: string; server?: string }): boolean {
  return rec.accountType === 'demo' || /demo|trial/i.test(String(rec.server ?? ''));
}

/** Hours an account must have been connected before its referrers are paid. */
export const COMMISSION_WAIT_HOURS = 24;

/** True when the account was first connected at least COMMISSION_WAIT_HOURS ago. An unknown or unreadable time is not enough. */
export function connectedLongEnough(connectedAtIso: unknown, nowMs: number, hours = COMMISSION_WAIT_HOURS): boolean {
  const t = Date.parse(String(connectedAtIso ?? ''));
  return Number.isFinite(t) && nowMs - t >= hours * 3_600_000;
}

/**
 * Whether a connected account earns its referrers the daily equity commission. A demo (practice) account never does: its
 * equity is virtual and free to create, so paying 1% of it every day would reward fake accounts. Disconnected or errored
 * accounts, non-USD accounts and accounts with no readable equity earn nothing either.
 */
export function dailyCommissionEligible(rec: { connectionState?: string; equity?: unknown; currency?: unknown; accountType?: string; server?: string }): boolean {
  if (isDemoAccount(rec)) return false;
  if (rec.connectionState === 'DISCONNECTED' || rec.connectionState === 'ERROR') return false;
  const equity = Number(rec.equity);
  return Number.isFinite(equity) && equity > 0 && String(rec.currency).toUpperCase() === 'USD';
}

function uniqueVerifiedClients(manager: Mt5ConnectionManager): ClientConnectionRecord[] {
  const seen = new Set<string>();
  const out: ClientConnectionRecord[] = [];
  for (const rec of manager.getAllClientRecords()) {
    if (seen.has(rec.accountId) || !rec.isBrokerVerified) continue;
    seen.add(rec.accountId);
    out.push(rec);
  }
  return out;
}

export class BillingService {
  private static instance: BillingService | null = null;
  private manager = Mt5ConnectionManager.getInstance();
  private timer: NodeJS.Timeout | null = null;
  private firstSweepTimer: NodeJS.Timeout | null = null;
  private sweeping = false;
  /** Clients whose closed trades could not be read in the current sweep, with the reason (never billed on a guess). */
  private notBilled: string[] = [];
  /** Daily updates already written or found today, so the database is asked about each client once a day. */
  private dailyDone = new Set<string>();

  /** What the profit-share code needs: Firestore for storage and the copier service for closed trades. */
  private psDeps(): RunDeps {
    return {
      store: { getDoc, setDoc, createDoc },
      fetchClosed: (userId) => this.manager.getClosedPositionsForBilling(userId),
    };
  }

  static getInstance(): BillingService {
    if (!this.instance) this.instance = new BillingService();
    return this.instance;
  }

  /** Tests only: a billing service that works on the given (fake-backed) connection manager. */
  static forTests(manager: Mt5ConnectionManager): BillingService {
    const b = new BillingService();
    b.manager = manager;
    return b;
  }

  /** Starts the periodic sweep. Safe to call when billing is not configured (it then does nothing). */
  private dailyEquityDone = new Set<string>();

  /**
   * The daily equity commission: on every business day (Mon-Fri, UTC), for as long as it stays connected, every 50% Profit Share client
   * earns their three referrers 1% / 0.5% / 0.5% of the client's equity (as the copier service reports it at that moment). Runs every 10 minutes and credits
   * each client once a day (the credits have fixed ids). A disconnected account earns nothing that day.
   */
  async dailyEquityPass(now = Date.now()): Promise<void> {
    if (!isFirestoreAdminConfigured() || !isDailyCommissionDay(now)) return;
    const day = new Date(now).toISOString().slice(0, 10).replace(/-/g, '');
    for (const k of this.dailyEquityDone) if (!k.endsWith(`_${day}`)) this.dailyEquityDone.delete(k);
    let credited = 0;
    for (const rec of uniqueVerifiedClients(this.manager)) {
      const mark = `${rec.userId}_${day}`;
      if (this.dailyEquityDone.has(mark)) continue;
      if (!dailyCommissionEligible(rec)) continue;
      const equity = Number(rec.equity);
      try {
        if (!(await this.connectedLongEnoughFor(rec.userId, now))) continue; // not paid before 24 hours of being connected; asked again next round
        const plan = await this.getPlan(rec.userId);
        if (plan?.model !== 'profit_share') {
          this.dailyEquityDone.add(mark); // Monthly Plan clients earn their referrers the one-time plan commission instead
          continue;
        }
        credited += await accrueDailyEquityCommission(rec.userId, equity, day);
        this.dailyEquityDone.add(mark);
      } catch (e: any) {
        console.warn(`⚠️ [REFERRALS] Daily commission for ${rec.userId} not credited yet:`, e?.message);
      }
    }
    if (credited) console.log(`💸 [REFERRALS] Daily equity commission ${day}: ${credited} credit(s).`);
  }

  start(): void {
    if (isFirestoreAdminConfigured()) {
      const run = () => {
        void this.dailyEquityPass().catch((e) => console.warn('[REFERRALS] daily:', e?.message));
        void this.subscriptionCommissionPass().catch((e) => console.warn('[REFERRALS] plan:', e?.message));
      };
      const t = setInterval(run, 10 * 60_000);
      (t as any).unref?.();
      setTimeout(run, 90_000).unref?.();
    }
    if (!billingEnabled()) {
      console.warn('⚠️ [BILLING] Billing is OFF: set FIREBASE_SERVICE_ACCOUNT and TREASURY_ADDRESS to turn it on.');
      return;
    }
    this.manager.hasBillingHistory = async (userId) => Boolean(await getDoc('client_ledgers', userId));
    this.manager.onClientVerified = (rec) =>
      void (async () => {
        // Judge the client's payment standing first, so a client who connects or is restored while overdue is held back at once.
        const plan = await this.getPlan(rec.userId);
        await this.applyBlocking(rec.userId, plan).catch((e) => console.warn('[BILLING] standing:', e?.message));
        if (plan?.model === 'subscription' || isDemoAccount(rec)) return; // subscribers, and practice accounts, have no profit-share ledger
        await this.openLedger(rec);
      })().catch((e) => console.warn('[BILLING] ledger:', e?.message));
    // Hold back anyone who is overdue right away (a restart must not give them copying back while the first full sweep waits).
    void this.blockingPass().catch((e) => console.warn('[BILLING] first check:', e?.message));
    this.firstSweepTimer = setTimeout(() => void this.sweep(), 60_000);
    this.timer = setInterval(() => void this.sweep(), 10 * 60_000);
    console.log('💰 [BILLING] Profit-share billing is ON.');
  }

  /** Stops the periodic sweep (used by tests; the server never needs it). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.firstSweepTimer) clearTimeout(this.firstSweepTimer);
    this.timer = null;
    this.firstSweepTimer = null;
  }

  /** Whether this client's account was first connected at least 24 hours ago (as saved when it connected). */
  private async connectedLongEnoughFor(userId: string, now: number): Promise<boolean> {
    const doc = (await getDoc('mt5_accounts', userId).catch(() => null)) as any;
    return connectedLongEnough(doc?.connectedAt, now);
  }

  /**
   * The one-time Monthly Plan commission waits until the referred client's REAL account has been connected for 24 hours.
   * Paid here once that is true (the credit has a fixed id per client, so it can never be made twice).
   */
  async subscriptionCommissionPass(now = Date.now()): Promise<void> {
    if (!isFirestoreAdminConfigured() || !billingEnabled()) return;
    const cfg = billingConfig();
    for (const rec of uniqueVerifiedClients(this.manager)) {
      if (this.subscriptionCommissionDone.has(rec.userId) || isDemoAccount(rec)) continue;
      try {
        const plan = await this.getPlan(rec.userId);
        const paid = Number(plan?.subscription?.paidUsdt);
        if (plan?.model !== 'subscription' || !Number.isFinite(paid) || paid <= 0) continue;
        if (!(await this.connectedLongEnoughFor(rec.userId, now))) continue;
        await accrueCommissions(rec.userId, commissionBaseUsdt(cfg.subscriptionPriceUsdt, paid), 'subscription', `sub-first-${rec.userId}`);
        this.subscriptionCommissionDone.add(rec.userId);
      } catch (e: any) {
        console.warn(`⚠️ [REFERRALS] Plan commission for ${rec.userId} not credited yet:`, e?.message);
      }
    }
  }
  private subscriptionCommissionDone = new Set<string>();

  private async openLedger(rec: ClientConnectionRecord): Promise<ClientLedger> {
    const existing = (await getDoc('client_ledgers', rec.userId)) as ClientLedger | null;
    if (existing && !existing.closed) return existing;
    const now = new Date().toISOString();
    const ledger: ClientLedger = {
      userId: rec.userId,
      currency: rec.currency,
      startEquity: round2(rec.equity),
      hwm: round2(rec.equity),
      pnlCum: 0,
      pnlHwm: 0,
      settledThrough: now,
      createdAt: now,
    };
    try {
      if (existing?.closed) await setDoc('client_ledgers', rec.userId, ledger as any);
      else await createDoc('client_ledgers', rec.userId, ledger as any);
    } catch (e) {
      if (e instanceof DocExistsError) return ((await getDoc('client_ledgers', rec.userId)) as unknown as ClientLedger) ?? ledger;
      throw e;
    }
    console.log(`💰 [BILLING] Ledger opened for ${rec.userId}: starting equity ${ledger.startEquity} ${ledger.currency}`);
    return ledger;
  }

  /**
   * Pass 1 of every sweep, and fast on purpose (no calls to the copier service): applies each client's own plan terms,
   * so anyone whose invoice is unpaid past 24 hours is held back, and anyone who has paid is released. Returns the plans
   * it read (a client missing from the result could not be read and is tried again next time).
   */
  private async blockingPass(): Promise<Map<string, PlanRecord | null>> {
    const plans = new Map<string, PlanRecord | null>();
    let allJudged = true;
    for (const rec of uniqueVerifiedClients(this.manager)) {
      try {
        const plan = await this.getPlan(rec.userId);
        await this.applyBlocking(rec.userId, plan);
        plans.set(rec.userId, plan);
      } catch (e: any) {
        allJudged = false;
        console.warn(`⚠️ [BILLING] Could not check the payment standing of ${rec.userId}:`, e?.message);
      }
    }
    // Everyone present has now been judged: the start-up hold on switching copying ON is no longer needed.
    // (If anyone could not be read it stays, and the next sweep tries again.)
    if (allJudged) this.manager.holdCopyingUntilBillingKnown = false;
    return plans;
  }

  /** One sweep: first the payment-standing check for everyone, then the slower work (daily updates and settlements). */
  async sweep(): Promise<void> {
    if (this.sweeping || !billingEnabled()) return;
    this.sweeping = true;
    this.notBilled = [];
    try {
      const cfg = billingConfig();
      const plans = await this.blockingPass();
      for (const rec of uniqueVerifiedClients(this.manager)) {
        if (!plans.has(rec.userId)) continue;
        if (plans.get(rec.userId)?.model === 'subscription') continue; // subscribers have no profit-share ledger
        if (isDemoAccount(rec)) continue; // practice accounts are never invoiced
        try {
          let ledger = await this.openLedger(rec);
          const up = upgradeLedger(ledger, Date.now());
          if (up.changed) {
            ledger = up.ledger;
            await setDoc('client_ledgers', rec.userId, ledger as any);
            console.log(`💰 [BILLING] Ledger of ${rec.userId} moved to closed-trade billing; its first invoice is not made before ${ledger.settleAfter}.`);
          }
          // The daily update goes first, so it describes the period that is about to be closed.
          await this.dailyUpdate(ledger, cfg);
          if (isSettlementDue(ledger.settledThrough, Date.now(), cfg.periodDays) && settlementAllowed(ledger, Date.now())) {
            await this.settle(rec, ledger);
          }
        } catch (e: any) {
          console.warn(`⚠️ [BILLING] Sweep failed for ${rec.userId}:`, e?.message);
        }
      }
      if (this.notBilled.length > 0) {
        console.warn(
          `⚠️ [BILLING] ${this.notBilled.length} profit-share client(s) were NOT billed or updated this round because their closed trades could not be read safely: ${this.notBilled.slice(0, 10).join('; ')}${this.notBilled.length > 10 ? '; …' : ''}`
        );
      }
    } finally {
      this.lastSweepAt = new Date().toISOString();
      this.lastNotBilled = [...this.notBilled];
      this.sweeping = false;
    }
  }

  private lastSweepAt: string | null = null;
  private lastNotBilled: string[] = [];

  /** Runs a billing sweep now (the administrator's "Run sweep" button) and says what happened. */
  async runNow(): Promise<{ started: boolean; reason?: string; at: string | null; notBilled: string[] }> {
    if (!billingEnabled()) return { started: false, reason: 'Billing is not set up on the server yet.', at: this.lastSweepAt, notBilled: this.lastNotBilled };
    if (this.sweeping) return { started: false, reason: 'A billing run is already going. Try again in a minute.', at: this.lastSweepAt, notBilled: this.lastNotBilled };
    await this.sweep();
    return { started: true, at: this.lastSweepAt, notBilled: this.lastNotBilled };
  }

  /**
   * Writes yesterday's "Profit Share update" for one client, once a day, from 00:15 GMT. Nothing is written when the
   * closed trades cannot be read: the client is never shown a made-up figure.
   */
  private async dailyUpdate(ledger: ClientLedger, cfg: ReturnType<typeof billingConfig>): Promise<void> {
    const now = new Date();
    if (!dailyWindowOpen(now)) return;
    const dayIso = previousUtcDay(now);
    const mark = `${ledger.userId}_${dayIso.slice(0, 10)}`;
    if (this.dailyDone.has(mark)) return;
    const out = await dailyUpdateFor(this.psDeps(), ledger, { feePct: cfg.feePct, periodDays: cfg.periodDays, dayIso, now });
    if (typeof out === 'string') {
      // Forget older days so the set stays small.
      for (const k of this.dailyDone) if (!k.endsWith(dayIso.slice(0, 10))) this.dailyDone.delete(k);
      this.dailyDone.add(mark);
    } else {
      this.notBilled.push(`${ledger.userId.slice(0, 8)}…: ${out.skipped}`);
    }
  }

  /** Ends the period for one profit-share client: invoices 50% of the new profit made by the trades that closed. */
  private async settle(rec: ClientConnectionRecord, ledger: ClientLedger): Promise<void> {
    const cfg = billingConfig();
    if (String(rec.currency).toUpperCase() !== 'USD') {
      console.warn(`⚠️ [BILLING] ${rec.userId} trades in ${rec.currency}; only USD accounts are billed automatically.`);
      return;
    }
    const out = await settleClient(this.psDeps(), ledger, {
      accountLogin: rec.login,
      equity: Number(rec.equity),
      treasury: cfg.treasury,
      feePct: cfg.feePct,
      dueHours: cfg.dueHours,
      now: new Date(),
      minProfitUsd: cfg.minProfitUsd,
    });
    if (out.kind === 'skipped') {
      this.notBilled.push(`${rec.userId.slice(0, 8)}…: ${out.reason}`);
      return;
    }
    if (!out.invoice) console.log(`💰 [BILLING] ${rec.userId}: day settled, no invoice (${out.trades} closed trades, ${out.periodPnl} USD; under ${cfg.minProfitUsd} USD new profit is carried forward, copying continues).`);
    if (out.invoice) console.log(`🧾 [BILLING] Invoice ${out.invoice.id}: ${out.invoice.amountDueUsdt} USDT for ${rec.userId} (${out.trades} closed trades)`);
  }

  /** Applies the client's own plan terms: pauses copying when they are not met, resumes when they are. */
  async applyBlocking(userId: string, knownPlan?: PlanRecord | null): Promise<void> {
    // A practice (demo) account is never charged, so it is never held back for payment.
    const live = this.manager.getClientConnection(userId);
    if (live && isDemoAccount(live)) {
      this.manager.setBillingBlocked(userId, false);
      return;
    }
    const plan = knownPlan !== undefined ? knownPlan : await this.getPlan(userId);
    // A subscriber is never judged by profit-share invoices, so they are not even read.
    const invoices = plan?.model === 'subscription' ? [] : ((await queryEquals('profit_invoices', 'userId', userId)) as unknown as Invoice[]);
    this.manager.setBillingBlocked(userId, billingStanding(plan, invoices, Date.now()).blocked);
  }

  /** Throws if copying may not be switched on for this client under their plan (used before connecting or resuming). */
  async assertNotOverdue(userId: string): Promise<void> {
    if (!billingEnabled()) return;
    const plan = await this.getPlan(userId);
    const invoices = plan?.model === 'subscription' ? [] : ((await queryEquals('profit_invoices', 'userId', userId)) as unknown as Invoice[]);
    const standing = billingStanding(plan, invoices, Date.now());
    if (standing.blocked) throw new BillingError(standing.reason || 'Please bring your payment up to date to resume copying.', 402);
  }

  // ---------- Service plan (subscription or profit share) ----------

  async getPlan(userId: string): Promise<PlanRecord | null> {
    if (!isFirestoreAdminConfigured()) return null;
    const doc = (await getDoc('service_plans', userId)) as unknown as PlanRecord | null;
    return doc && isServiceModel(doc.model) ? doc : null;
  }

  /** Before connecting: a plan must be chosen, and it must be in good standing. */
  async assertMayConnect(userId: string): Promise<void> {
    if (!isFirestoreAdminConfigured()) return;
    const plan = await this.getPlan(userId);
    if (!plan) throw new BillingError('Please choose a service plan (Monthly or 50% Profit Share) before connecting an account.', 403);
    if (plan.model === 'subscription') {
      if (!subscriptionActive(plan, Date.now())) {
        throw new BillingError('Your monthly subscription is not active. Please pay for the plan to connect.', 402);
      }
      return;
    }
    await this.assertNotOverdue(userId);
  }

  private async isConnected(userId: string): Promise<boolean> {
    const c = this.manager.getClientConnection(userId) ?? (await this.manager.restoreClientForUser(userId));
    return !!(c && c.isBrokerVerified);
  }

  async selectModel(userId: string, modelRaw: unknown): Promise<PlanRecord> {
    if (!isFirestoreAdminConfigured()) throw new BillingError('Plans are not open yet. Please contact support.', 503);
    if (!isServiceModel(modelRaw)) throw new BillingError('Unknown service plan.');
    const model: ServiceModel = modelRaw;
    const current = await this.getPlan(userId);
    const invoices = (await queryEquals('profit_invoices', 'userId', userId)) as unknown as Invoice[];
    const verdict = canSelectModel(current, model, {
      connected: await this.isConnected(userId),
      hasPendingInvoice: invoices.some((i) => i.status === 'pending'),
      nowMs: Date.now(),
    });
    if (!verdict.ok) throw new BillingError(verdict.reason || 'You cannot change plan right now.', 409);
    if (current && current.model === model) return current;

    const plan: PlanRecord = { userId, model, selectedAt: new Date().toISOString() };
    await setDoc('service_plans', userId, plan as any);
    if (model === 'profit_share') await recordEvent('PROFIT_SHARE_SELECTED', userId, `ps-${userId}-${plan.selectedAt}`);
    if (model === 'subscription') {
      // Leaving profit share: close the ledger so profit made on a subscription is never billed later.
      const ledger = (await getDoc('client_ledgers', userId)) as unknown as ClientLedger | null;
      if (ledger && !ledger.closed) await setDoc('client_ledgers', userId, { ...ledger, closed: true } as any);
    }
    return plan;
  }

  /** Verifies a USDT payment on the TRON blockchain and starts or extends the monthly plan. */
  async paySubscription(userId: string, txHashRaw: string): Promise<PlanRecord> {
    if (!billingEnabled()) throw new BillingError('Payments are not open yet. Please contact support.', 503);
    const cfg = billingConfig();
    const txHash = String(txHashRaw || '').trim().toLowerCase();
    if (!HASH.test(txHash)) throw new BillingError('Please paste the 64-character transaction ID (TXID) of your USDT payment.');
    const plan = await this.getPlan(userId);
    if (!plan || plan.model !== 'subscription') throw new BillingError('Choose the Monthly plan first.', 409);
    const live = this.manager.getClientConnection(userId);
    if (live && isDemoAccount(live)) throw new BillingError('Your account is a practice (demo) account, so there is nothing to pay. The plan starts when you connect a real account.', 409);

    let events: any[];
    let final: boolean;
    try {
      [events, final] = await Promise.all([fetchTxEvents(txHash), isTxFinalAndSuccessful(txHash)]);
    } catch {
      throw new BillingError('Could not reach the TRON network to check this payment. Please try again in a minute.', 502);
    }
    const check = checkUsdtPayment(events, { treasury: cfg.treasury, minUsdt: cfg.subscriptionPriceUsdt, notBeforeMs: sinceMs(plan.subscription?.periodStart ?? plan.selectedAt) });
    if (!check.ok) throw new BillingError(check.error || 'Payment could not be verified.');
    if (!final) throw new BillingError('That payment is not fully confirmed on the network yet. Wait a few minutes and try again.', 409);

    // One transaction can pay one thing only, ever.
    try {
      await createDoc('used_tx_hashes', txHash, { invoiceId: `subscription-${userId}`, userId, at: new Date().toISOString() });
    } catch (e) {
      if (!(e instanceof DocExistsError)) throw e;
      const used: any = await getDoc('used_tx_hashes', txHash);
      if (!used || used.invoiceId !== `subscription-${userId}`) throw new BillingError('This transaction was already used for another payment.', 409);
      if (plan.subscription?.lastTxHash === txHash) return plan; // same payment pasted twice
    }

    const now = Date.now();
    const period = nextPeriod(plan.subscription?.periodEnd, now, cfg.subscriptionDays);
    const updated: PlanRecord = {
      ...plan,
      subscription: {
        periodStart: period.start,
        periodEnd: period.end,
        cancelAtPeriodEnd: false,
        lastTxHash: txHash,
        paidUsdt: check.amountUsdt,
      },
    };
    await setDoc('service_plans', userId, updated as any);
    await setDoc('subscription_payments', txHash, {
      userId,
      txHash,
      amountUsdt: check.amountUsdt,
      periodStart: period.start,
      periodEnd: period.end,
      at: new Date(now).toISOString(),
    });
    // Commission is a share of the plan fee, not of any extra the client happened to send, and is paid ONCE per client: on the
    // first Monthly Plan payment. The id is fixed per client, so a renewal can never credit it again.
    // It is paid now only when the account is real and has been connected for 24 hours; otherwise subscriptionCommissionPass pays it later.
    if (live && !isDemoAccount(live) && (await this.connectedLongEnoughFor(userId, now))) {
      await this.creditReferrers(userId, commissionBaseUsdt(cfg.subscriptionPriceUsdt, check.amountUsdt), 'subscription', `sub-first-${userId}`);
    }
    await recordEvent('SUBSCRIBED', userId, `sub-${txHash}`);
    await this.applyBlocking(userId);
    return updated;
  }

  /** Referral credits never block or undo a payment that was really received; a failure is logged and retried by the next identical call. */
  private async creditReferrers(userId: string, paidUsdt: number, type: 'profit_invoice' | 'subscription', sourceId: string): Promise<void> {
    try {
      await accrueCommissions(userId, paidUsdt, type, sourceId);
    } catch (e: any) {
      console.warn(`⚠️ [REFERRALS] Could not credit commissions for ${sourceId}:`, e?.message);
    }
  }

  /** Stops renewal. There are no automatic charges, so the plan simply ends on its date. */
  async cancelSubscription(userId: string): Promise<PlanRecord> {
    const plan = await this.getPlan(userId);
    if (!plan || plan.model !== 'subscription' || !plan.subscription) throw new BillingError('You have no monthly subscription to cancel.', 409);
    const updated: PlanRecord = { ...plan, subscription: { ...plan.subscription, cancelAtPeriodEnd: true } };
    await setDoc('service_plans', userId, updated as any);
    return updated;
  }

  /** Everything the plan page needs. Counts come only from real plan records. */
  async planView(userId: string) {
    const cfg = billingConfig();
    const now = Date.now();
    const plan = await this.getPlan(userId);
    let activeSubscribers = 0;
    let profitShareClients = 0;
    if (isFirestoreAdminConfigured()) {
      const all = (await listAll('service_plans').catch(() => [])) as unknown as PlanRecord[];
      for (const p of all) {
        if (p?.model === 'subscription' && subscriptionActive(p, now)) activeSubscribers++;
        else if (p?.model === 'profit_share') profitShareClients++;
      }
    }
    let canSwitch: { ok: boolean; reason?: string } = { ok: true };
    if (isFirestoreAdminConfigured() && plan) {
      const invoices = (await queryEquals('profit_invoices', 'userId', userId)) as unknown as Invoice[];
      const other: ServiceModel = plan.model === 'subscription' ? 'profit_share' : 'subscription';
      canSwitch = canSelectModel(plan, other, {
        connected: await this.isConnected(userId),
        hasPendingInvoice: invoices.some((i) => i.status === 'pending'),
        nowMs: now,
      });
    }
    return {
      available: isFirestoreAdminConfigured(),
      paymentsOpen: billingEnabled(),
      model: plan?.model ?? null,
      selectedAt: plan?.selectedAt ?? null,
      subscription: plan?.subscription
        ? {
            active: subscriptionActive(plan, now),
            periodEnd: plan.subscription.periodEnd,
            daysLeft: daysLeft(plan.subscription.periodEnd, now),
            cancelAtPeriodEnd: Boolean(plan.subscription.cancelAtPeriodEnd),
          }
        : null,
      price: { subscriptionUsdt: cfg.subscriptionPriceUsdt, periodDays: cfg.subscriptionDays, feePct: cfg.feePct, dueHours: cfg.dueHours },
      treasuryAddress: billingEnabled() ? cfg.treasury : '',
      canSwitch,
      stats: { activeSubscribers, profitShareClients },
    };
  }

  private payNowBusy = new Set<string>();
  private moneyCache = new Map<string, { at: number; row: AdminClientMoney }>();

  /**
   * For the administrator's Clients table: per client, the net profit of the trades closed since the last invoice, the 50% that
   * has built up on it, and the unpaid invoices. Each client's closed trades are read at most every 5 minutes (the copier
   * service allows few such reads), so opening the page often costs nothing extra.
   */
  async adminClientMoney(): Promise<AdminClientMoney[]> {
    if (!billingEnabled()) return [];
    const cfg = billingConfig();
    const out: AdminClientMoney[] = [];
    for (const rec of uniqueVerifiedClients(this.manager)) {
      const hit = this.moneyCache.get(rec.userId);
      if (hit && Date.now() - hit.at < 5 * 60_000) {
        out.push(hit.row);
        continue;
      }
      const row: AdminClientMoney = { userId: rec.userId, login: rec.login, model: 'profit_share', periodPnl: null, accruedShareUsdt: null, unpaidUsdt: 0, trades: 0, readError: '' };
      try {
        const plan = await this.getPlan(rec.userId);
        if (plan?.model === 'subscription') {
          row.model = 'subscription';
        } else {
          const invoices = await this.listInvoicesForUser(rec.userId);
          row.unpaidUsdt = round2(invoices.filter((i) => i.status !== 'paid').reduce((t, i) => t + (Number(i.amountDueUsdt) || 0), 0));
          const ledger = await this.openLedger(rec);
          const p = await previewShare(this.psDeps(), ledger, cfg.feePct, new Date());
          if (p.ok) {
            row.periodPnl = p.periodPnl;
            row.accruedShareUsdt = p.fee;
            row.trades = p.trades;
          } else row.readError = p.reason;
        }
        this.moneyCache.set(rec.userId, { at: Date.now(), row });
      } catch (e: any) {
        row.readError = String(e?.message || e).slice(0, 120);
      }
      out.push(row);
    }
    return out;
  }

  /**
   * The client's connected account, found the same way the dashboard finds it: from memory, or looked up again at the copier
   * service when the server has just restarted (after a deploy) and has not restored everyone yet.
   */
  private async connectedRecord(userId: string): Promise<ClientConnectionRecord | null> {
    const rec = this.manager.getClientConnection(userId) ?? (await this.manager.restoreClientForUser(userId).catch(() => undefined));
    return rec && rec.isBrokerVerified && rec.userId === userId ? rec : null;
  }

  /**
   * What a profit-share client can pay right now, before the daily settlement: 50% of the new profit from closed trades, allowed
   * when that profit is at least MIN_INVOICE_PROFIT_USD, no trade is open on the account, and no earlier invoice is still unpaid.
   */
  async payableNow(userId: string): Promise<PayableNow> {
    const cfg = billingConfig();
    const base = { minProfitUsd: cfg.minProfitUsd, feePct: cfg.feePct, periodPnl: 0, gain: 0, fee: 0, trades: 0, openTrades: 0 };
    if (!billingEnabled()) return { ...base, canPay: false, reason: 'Payments are not open yet.' };
    const rec = await this.connectedRecord(userId);
    if (!rec) return { ...base, canPay: false, reason: 'Your MT5 account is not connected right now. If it was just reconnected, wait a minute and this updates by itself.' };
    if (isDemoAccount(rec)) return { ...base, canPay: false, reason: 'Your account is a practice (demo) account, so nothing is charged. Billing starts when you connect a real account.' };
    const plan = await this.getPlan(userId);
    if (plan?.model === 'subscription') return { ...base, canPay: false, reason: 'You are on the monthly plan: there is no profit share to pay.' };
    if (String(rec.currency).toUpperCase() !== 'USD') return { ...base, canPay: false, reason: 'Only USD accounts can pay the profit share here.' };

    const unpaid = (await this.listInvoicesForUser(userId)).find((i) => i.status !== 'paid');
    let ledger = await this.openLedger(rec);
    const up = upgradeLedger(ledger, Date.now());
    if (up.changed) {
      ledger = up.ledger;
      await setDoc('client_ledgers', rec.userId, ledger as any);
    }
    const preview = await previewShare(this.psDeps(), ledger, cfg.feePct, new Date());
    if (!preview.ok) return { ...base, canPay: false, reason: 'Your closed trades could not be read just now. Please try again in a minute.' };

    const t = await this.manager.getClientTrades(userId).catch(() => null);
    const openTrades = Math.max(t?.open.length ?? 0, t?.openReported ?? 0);
    const out = { ...base, periodPnl: preview.periodPnl, gain: preview.gain, fee: preview.fee, trades: preview.trades, openTrades };
    if (!t) return { ...out, canPay: false, reason: 'Your open trades could not be checked just now. Please try again in a minute.' };
    if (unpaid) return { ...out, canPay: false, reason: 'Pay the invoice you already have first.' };
    if (openTrades > 0) return { ...out, canPay: false, reason: `You have ${openTrades} open trade${openTrades === 1 ? '' : 's'}. You can pay once all trades are closed.` };
    if (preview.gain < cfg.minProfitUsd) return { ...out, canPay: false, reason: `Payment opens when your new closed-trade profit reaches ${cfg.minProfitUsd} USD (now ${preview.gain.toFixed(2)} USD).` };
    if (!settlementAllowed(ledger, Date.now())) return { ...out, canPay: false, reason: `Your first invoice can be made from ${ledger.settleAfter}.` };
    return { ...out, canPay: true, reason: '' };
  }

  /** Makes the invoice now for what payableNow allows (all checks are run again). The client then pays it as any invoice. */
  async payNow(userId: string): Promise<Invoice> {
    if (this.payNowBusy.has(userId) || this.sweeping) throw new BillingError('Your invoice is being prepared. Please wait a moment and try again.', 409);
    this.payNowBusy.add(userId);
    try {
      const view = await this.payableNow(userId);
      if (!view.canPay) throw new BillingError(view.reason || 'Nothing can be paid right now.', 409);
      const rec = (await this.connectedRecord(userId))!;
      const cfg = billingConfig();
      const ledger = await this.openLedger(rec);
      const out = await settleClient(this.psDeps(), ledger, {
        accountLogin: rec.login,
        equity: Number(rec.equity),
        treasury: cfg.treasury,
        feePct: cfg.feePct,
        dueHours: cfg.dueHours,
        now: new Date(),
        minProfitUsd: cfg.minProfitUsd,
      });
      if (out.kind === 'skipped' || !out.invoice) throw new BillingError('The invoice could not be made just now. Please try again in a minute.', 409);
      console.log(`🧾 [BILLING] Pay-now invoice ${out.invoice.id}: ${out.invoice.amountDueUsdt} USDT for ${userId} (${out.trades} closed trades)`);
      return out.invoice;
    } finally {
      this.payNowBusy.delete(userId);
    }
  }

  async listInvoicesForUser(userId: string): Promise<Invoice[]> {
    if (!billingEnabled()) return [];
    const rows = (await queryEquals('profit_invoices', 'userId', userId)) as unknown as Invoice[];
    return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async listAllInvoices(): Promise<Invoice[]> {
    if (!billingEnabled()) return [];
    const rows = (await listAll('profit_invoices')) as unknown as Invoice[];
    return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  /** Verifies a USDT payment on the TRON blockchain and marks the invoice paid. */
  async payInvoice(userId: string, id: string, txHashRaw: string): Promise<Invoice> {
    if (!billingEnabled()) throw new BillingError('Payments are not open yet. Please contact support.', 503);
    const txHash = String(txHashRaw || '').trim().toLowerCase();
    if (!HASH.test(txHash)) throw new BillingError('Please paste the 64-character transaction ID (TXID) of your USDT payment.');

    const invoice = (await getDoc('profit_invoices', String(id))) as unknown as Invoice | null;
    if (!invoice || invoice.userId !== userId) throw new BillingError('Invoice not found.', 404);
    if (invoice.status === 'paid') return invoice;

    let events: any[];
    let final: boolean;
    try {
      [events, final] = await Promise.all([fetchTxEvents(txHash), isTxFinalAndSuccessful(txHash)]);
    } catch {
      throw new BillingError('Could not reach the TRON network to check this payment. Please try again in a minute.', 502);
    }
    // Up to PAYMENT_TOLERANCE_USDT (default 4) less than the invoice is accepted: an exchange withdrawal (Binance, say) often arrives
    // a little short after its fee. The shortfall is forgiven. Paying more is always accepted.
    const minUsdt = acceptedMinimum(invoice.amountDueUsdt, billingConfig().paymentToleranceUsdt);
    const check = checkUsdtPayment(events, { treasury: invoice.recipientAddress || treasury(), minUsdt, notBeforeMs: sinceMs(invoice.createdAt) });
    if (!check.ok) throw new BillingError(check.error || 'Payment could not be verified.');
    if (!final) throw new BillingError('That payment is not fully confirmed on the network yet. Wait a few minutes and try again.', 409);

    // One transaction can pay one invoice only, ever.
    try {
      await createDoc('used_tx_hashes', txHash, { invoiceId: invoice.id, userId, at: new Date().toISOString() });
    } catch (e) {
      if (!(e instanceof DocExistsError)) throw e;
      const used: any = await getDoc('used_tx_hashes', txHash);
      if (!used || used.invoiceId !== invoice.id) throw new BillingError('This transaction was already used for another invoice.', 409);
    }

    const received = Math.round((check.amountUsdt ?? invoice.amountDueUsdt) * 100) / 100;
    const paid: Invoice = { ...invoice, status: 'paid', paidAt: new Date().toISOString(), txHash, amountReceivedUsdt: received };
    await setDoc('profit_invoices', invoice.id, paid as any);
    if (received < invoice.amountDueUsdt) console.log(`💰 [BILLING] Invoice ${invoice.id} accepted with ${received} USDT of ${invoice.amountDueUsdt} (within the tolerance; the rest is forgiven).`);
    // Referral commission is earned on the $100 Monthly Plan only, never on a Profit Share invoice.
    await this.applyBlocking(userId);
    return paid;
  }

  /** Administrator marks an invoice paid by hand (for example, a payment from an exchange). */
  async adminConfirm(adminUid: string, id: string, note?: string): Promise<Invoice> {
    if (!isFirestoreAdminConfigured()) throw new BillingError('Billing is not set up on the server.', 503);
    const invoice = (await getDoc('profit_invoices', String(id))) as unknown as Invoice | null;
    if (!invoice) throw new BillingError('Invoice not found.', 404);
    if (invoice.status === 'paid') return invoice;
    const paid: Invoice = {
      ...invoice,
      status: 'paid',
      paidAt: new Date().toISOString(),
      confirmedBy: `${adminUid}${note ? `: ${String(note).slice(0, 200)}` : ''}`,
    };
    await setDoc('profit_invoices', invoice.id, paid as any);
    await this.applyBlocking(invoice.userId);
    return paid;
  }
}
