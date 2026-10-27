/**
 * Real profit-share billing, run on the server from the broker's own numbers.
 *
 *  - When a client's account is broker-verified, a ledger is opened with their equity as the starting
 *    high-water mark (HWM).
 *  - Every settlement period the server asks the broker for the account's equity and its deposits and
 *    withdrawals, works out 50% of NEW profit, and creates an invoice.
 *  - Clients pay USDT (TRC20) to the treasury wallet; the payment is checked on the TRON blockchain.
 *  - An invoice that stays unpaid past its due time stops copying for that client until it is paid.
 *
 * Money records live in Firestore and can only be written by this server (service account).
 */
import { Mt5ConnectionManager, ClientConnectionRecord } from './MT5_CONNECTION_MANAGER';
import {
  ClientLedger,
  DEFAULT_FEE_PCT,
  Invoice,
  MIN_INVOICE_USDT,
  computeSettlement,
  invoiceId,
  isOverdue,
  isSettlementDue,
  round2,
  sumAccountFlows,
} from './profitShare';
import { readLimit } from './brokerVerification';
import {
  DEFAULT_SUBSCRIPTION_PERIOD_DAYS,
  DEFAULT_SUBSCRIPTION_PRICE_USDT,
  PlanRecord,
  ServiceModel,
  canSelectModel,
  daysLeft,
  isServiceModel,
  nextPeriod,
  subscriptionActive,
} from './servicePlan';
import { checkUsdtPayment, fetchTxEvents, isTxFinalAndSuccessful, tronAddressToHex20 } from './tron';
import {
  DocExistsError,
  createDoc,
  getDoc,
  isFirestoreAdminConfigured,
  listAll,
  queryEquals,
  setDoc,
} from './firestoreAdmin';

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
    periodDays: Math.max(1, readLimit(process.env.SETTLEMENT_PERIOD_DAYS, 7)),
    dueHours: Math.max(1, readLimit(process.env.INVOICE_DUE_HOURS, 72)),
    treasury: treasury(),
    subscriptionPriceUsdt: Math.max(1, readLimit(process.env.SUBSCRIPTION_PRICE_USDT, DEFAULT_SUBSCRIPTION_PRICE_USDT)),
    subscriptionDays: Math.max(1, readLimit(process.env.SUBSCRIPTION_PERIOD_DAYS, DEFAULT_SUBSCRIPTION_PERIOD_DAYS)),
  };
}

/** Billing runs only when the database key and a valid wallet are both set. */
export function billingEnabled(): boolean {
  return isFirestoreAdminConfigured() && tronAddressToHex20(treasury()) !== null;
}

const HASH = /^[0-9a-fA-F]{64}$/;

function uniqueVerifiedClients(manager: Mt5ConnectionManager): ClientConnectionRecord[] {
  const seen = new Set<string>();
  const out: ClientConnectionRecord[] = [];
  for (const rec of manager.getAllClientRecords()) {
    if (seen.has(rec.accountId) || !rec.isBrokerVerified || rec.isSimulated) continue;
    seen.add(rec.accountId);
    out.push(rec);
  }
  return out;
}

export class BillingService {
  private static instance: BillingService | null = null;
  private manager = Mt5ConnectionManager.getInstance();
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  static getInstance(): BillingService {
    if (!this.instance) this.instance = new BillingService();
    return this.instance;
  }

  /** Starts the periodic sweep. Safe to call when billing is not configured (it then does nothing). */
  start(): void {
    if (!billingEnabled()) {
      console.warn('⚠️ [BILLING] Billing is OFF: set FIREBASE_SERVICE_ACCOUNT and TREASURY_ADDRESS to turn it on.');
      return;
    }
    this.manager.onClientVerified = (rec) =>
      void (async () => {
        const plan = await this.getPlan(rec.userId);
        if (plan?.model === 'subscription') return; // subscribers have no profit-share ledger
        await this.openLedger(rec);
      })().catch((e) => console.warn('[BILLING] ledger:', e?.message));
    setTimeout(() => void this.sweep(), 60_000);
    this.timer = setInterval(() => void this.sweep(), 10 * 60_000);
    console.log('💰 [BILLING] Profit-share billing is ON.');
  }

  private async openLedger(rec: ClientConnectionRecord): Promise<ClientLedger> {
    const existing = (await getDoc('client_ledgers', rec.userId)) as ClientLedger | null;
    if (existing && !existing.closed) return existing;
    const now = new Date().toISOString();
    const ledger: ClientLedger = {
      userId: rec.userId,
      currency: rec.currency,
      startEquity: round2(rec.equity),
      hwm: round2(rec.equity),
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

  /** One pass: settle clients whose period is up, then apply blocks for overdue invoices. */
  async sweep(): Promise<void> {
    if (this.sweeping || !billingEnabled()) return;
    this.sweeping = true;
    try {
      const cfg = billingConfig();
      for (const rec of uniqueVerifiedClients(this.manager)) {
        try {
          const plan = await this.getPlan(rec.userId);
          if (plan?.model === 'subscription') {
            await this.applyBlocking(rec.userId);
            continue;
          }
          const ledger = await this.openLedger(rec);
          if (isSettlementDue(ledger.settledThrough, Date.now(), cfg.periodDays)) {
            await this.settle(rec, ledger);
          }
          await this.applyBlocking(rec.userId);
        } catch (e: any) {
          console.warn(`⚠️ [BILLING] Sweep failed for ${rec.userId}:`, e?.message);
        }
      }
    } finally {
      this.sweeping = false;
    }
  }

  private async settle(rec: ClientConnectionRecord, ledger: ClientLedger): Promise<void> {
    const cfg = billingConfig();
    const rpc: any = rec.rpcConnection;
    if (!rpc) return;
    if (String(rec.currency).toUpperCase() !== 'USD') {
      console.warn(`⚠️ [BILLING] ${rec.userId} trades in ${rec.currency}; only USD accounts are billed automatically.`);
      return;
    }
    const now = new Date();
    const info = await rpc.getAccountInformation();
    const equity = Number(info?.equity);
    if (!Number.isFinite(equity)) return;
    const dealsRes = await rpc.getDealsByTimeRange(new Date(ledger.settledThrough), now);
    const flows = sumAccountFlows(Array.isArray(dealsRes?.deals) ? dealsRes.deals : []);

    const r = computeSettlement({ hwm: ledger.hwm, equity, flows, feePct: cfg.feePct });
    const nowIso = now.toISOString();
    let hwm = r.adjustedHwm; // small fees roll into the next period, so the HWM is not raised yet
    let lastInvoiceId = ledger.lastInvoiceId;

    if (r.fee >= MIN_INVOICE_USDT) {
      const id = invoiceId(rec.userId, nowIso);
      const invoice: Invoice = {
        id,
        userId: rec.userId,
        accountLogin: rec.login,
        currency: 'USD',
        periodStart: ledger.settledThrough,
        periodEnd: nowIso,
        startHwm: ledger.hwm,
        flows,
        equityAtSettlement: round2(equity),
        grossProfit: r.gain,
        feePct: cfg.feePct,
        amountDueUsdt: r.fee,
        recipientAddress: cfg.treasury,
        status: 'pending',
        createdAt: nowIso,
        dueAt: new Date(now.getTime() + cfg.dueHours * 3600 * 1000).toISOString(),
      };
      try {
        await createDoc('profit_invoices', id, invoice as any);
        console.log(`🧾 [BILLING] Invoice ${id}: ${r.fee} USDT for ${rec.userId}`);
      } catch (e) {
        if (!(e instanceof DocExistsError)) throw e;
      }
      hwm = r.newHwm;
      lastInvoiceId = id;
    }

    await setDoc('client_ledgers', rec.userId, { ...ledger, hwm, settledThrough: nowIso, lastInvoiceId } as any);
  }

  /** Stops copying while any invoice is overdue; resumes when none are. */
  async applyBlocking(userId: string): Promise<void> {
    const plan = await this.getPlan(userId);
    if (plan?.model === 'subscription') {
      this.manager.setBillingBlocked(userId, !subscriptionActive(plan, Date.now()));
      return;
    }
    const invoices = (await queryEquals('profit_invoices', 'userId', userId)) as unknown as Invoice[];
    const overdue = invoices.some((i) => isOverdue(i, Date.now()));
    this.manager.setBillingBlocked(userId, overdue);
  }

  /** Throws if the user has an overdue invoice (used before connecting or resuming copying). */
  async assertNotOverdue(userId: string): Promise<void> {
    if (!billingEnabled()) return;
    const invoices = (await queryEquals('profit_invoices', 'userId', userId)) as unknown as Invoice[];
    if (invoices.some((i) => isOverdue(i, Date.now()))) {
      throw new BillingError('You have an overdue profit-share invoice. Please pay it to resume copying.', 402);
    }
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
    return !!(c && c.isBrokerVerified && !c.isSimulated);
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

    let events: any[];
    let final: boolean;
    try {
      [events, final] = await Promise.all([fetchTxEvents(txHash), isTxFinalAndSuccessful(txHash)]);
    } catch {
      throw new BillingError('Could not reach the TRON network to check this payment. Please try again in a minute.', 502);
    }
    const check = checkUsdtPayment(events, { treasury: cfg.treasury, minUsdt: cfg.subscriptionPriceUsdt });
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
    await this.applyBlocking(userId);
    return updated;
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
      price: { subscriptionUsdt: cfg.subscriptionPriceUsdt, periodDays: cfg.subscriptionDays, feePct: cfg.feePct },
      treasuryAddress: billingEnabled() ? cfg.treasury : '',
      canSwitch,
      stats: { activeSubscribers, profitShareClients },
    };
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
    const check = checkUsdtPayment(events, { treasury: invoice.recipientAddress || treasury(), minUsdt: invoice.amountDueUsdt });
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

    const paid: Invoice = { ...invoice, status: 'paid', paidAt: new Date().toISOString(), txHash };
    await setDoc('profit_invoices', invoice.id, paid as any);
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
