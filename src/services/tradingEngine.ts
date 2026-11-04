import {
  Mt5Account,
  MasterMt5Account,
  CopiedTrade,
  RiskSettings,
  WithdrawalRequest,
  ProfitShareSettlement,
  LedgerEntry,
  AuditLog,
  ReconciliationReport,
  ProfitShareInvoice,
} from '../types';
import { authHeaders } from './apiAuth';

export interface PayableNowView {
  canPay: boolean;
  reason: string;
  minProfitUsd: number;
  feePct: number;
  periodPnl: number;
  gain: number;
  fee: number;
  trades: number;
  openTrades: number;
}
import { liveDetail, normalizePending, type ConnectOutcome, type PendingConnectionView } from './pendingConnection';
import { needsCopyResume } from './connectSteps';
import { planSync, type OwnAnswer } from './clientSync';

export const TRC20_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
// The wallet that receives USDT. Set VITE_TREASURY_ADDRESS to YOUR real TRON (TRC20) address at build time.
// Until it is set (and looks like a valid TRON address) no payment address is shown and payments are refused.
const RAW_TREASURY = String((import.meta as any).env?.VITE_TREASURY_ADDRESS ?? '').trim();
export const CASTIMO_TREASURY_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(RAW_TREASURY) ? RAW_TREASURY : '';
export const PAYMENTS_ENABLED = CASTIMO_TREASURY_ADDRESS !== '';

export const DEFAULT_RISK_SETTINGS: RiskSettings = {
  minEquityToTrade: 100,
  maxLotSize: 2.0,
  maxExposureUsd: 10000,
  maxOpenPositions: 5,
  maxDailyLossUsd: 500,
  maxDrawdownPercent: 15,
  symbolWhitelist: ['XAUUSD'],
  lotSizeMultiplier: 1.0,
  maxDrawdownLimitUsd: 400,
  autoCloseOnDrawdown: true,
  copyStopLoss: true,
  copyTakeProfit: true,
};

// Initial Seed Data
export const INITIAL_MASTER_ACCOUNT: MasterMt5Account = {
  id: 'master-mt5-castimo-001',
  accountName: 'Castimo Master Bridge',
  accountNumber: 'Not Connected',
  brokerServer: 'Awaiting MT5 Bridge',
  status: 'disconnected',
  balance: 0.0,
  equity: 0.0,
  freeMargin: 0.0,
  floatingPL: 0.0,
  marginLevel: 0.0,
  leverage: 100,
  latencyMs: 0,
  activeCopiersCount: 0,
  signalBroadcasting: false,
  bridgePort: 8443,
  lastPing: new Date().toISOString(),
  connectedAt: new Date().toISOString(),
  openTradesCount: 0,
  activeTrades: [],
  tradeHistory: [],
};

const INITIAL_ACCOUNT: Mt5Account = {
  id: 'mt5-acc-initial',
  userId: 'verified-client-castimo-001',
  accountNumber: 'Not Connected',
  brokerServer: 'Awaiting MT5 Bridge',
  status: 'disconnected',
  balance: 0.0,
  equity: 0.0,
  freeMargin: 0.0,
  marginLevel: 0.0,
  leverage: 100,
  riskStatus: 'normal',
  profitShareStatus: 'up_to_date',
  unpaidProfitShareUsdt: 0.0,
  profitShareDueAt: undefined,
  lastProfitGenerated: 0.0,
  lastPing: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  copiedFromMasterAccount: undefined,
  masterAccountName: undefined,
};

const INITIAL_PROFIT_INVOICES: ProfitShareInvoice[] = [];

const INITIAL_SUPERVISED_ACCOUNTS: Mt5Account[] = [];

const INITIAL_TRADES: CopiedTrade[] = [];

const INITIAL_WITHDRAWALS: WithdrawalRequest[] = [];

const INITIAL_SETTLEMENTS: ProfitShareSettlement[] = [];

const INITIAL_LEDGER: LedgerEntry[] = [];

const INITIAL_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'audit-001',
    userId: 'verified-client-castimo-001',
    actor: 'System',
    action: 'TERMINAL_INITIALIZED',
    category: 'MT5',
    details: 'Castimo FX Terminal initialized in initial standby state ($0.00 balance, awaiting MT5 bridge).',
    ip: '',
    timestamp: new Date().toISOString(),
    status: 'SUCCESS',
  },
];

/** Progress of a connection, as reported by the server. */
export interface ConnectProgress {
  stage: string;
  label: string;
  percent: number;
  elapsedSeconds: number;
  /** What the server last learnt while waiting for the broker, when that says more than the step does (see liveDetail). */
  detail?: string;
}

/** A failed connection with a plain-language reason and what to do next. */
export class ConnectError extends Error {
  code?: string;
  hint?: string;
  ref?: string;
  retryable?: boolean;
  constructor(message: string) {
    super(message);
    this.name = 'ConnectError';
  }
}

class TradingEngine {
  private masterAccount: MasterMt5Account = INITIAL_MASTER_ACCOUNT;
  private mt5Account: Mt5Account = INITIAL_ACCOUNT;
  private supervisedAccounts: Mt5Account[] = INITIAL_SUPERVISED_ACCOUNTS;
  private profitInvoices: ProfitShareInvoice[] = INITIAL_PROFIT_INVOICES;
  private trades: CopiedTrade[] = INITIAL_TRADES;
  private riskSettings: RiskSettings = DEFAULT_RISK_SETTINGS;
  private withdrawals: WithdrawalRequest[] = INITIAL_WITHDRAWALS;
  private settlements: ProfitShareSettlement[] = INITIAL_SETTLEMENTS;
  private ledger: LedgerEntry[] = INITIAL_LEDGER;
  private auditLogs: AuditLog[] = INITIAL_AUDIT_LOGS;

  private listeners: (() => void)[] = [];

  /**
   * A connection the server is still looking after (or has given up on), as the server reports it.
   * It is null whenever the account is connected or nothing is being connected.
   */
  private pendingConnection: PendingConnectionView | null = null;

  constructor() {
    this.runRiskCheck();
  }

  public getPendingConnection(): PendingConnectionView | null {
    return this.pendingConnection;
  }

  /** What went wrong the last time the client's trades were loaded: 'failed' (could not be asked) or a count of trades that could not be read. */
  private tradesLoad: { failed: boolean; unreadable: number } = { failed: false, unreadable: 0 };

  /** A gentle line for the trade pages when the trade list could not be loaded or shown in full; null when everything is fine. */
  public getTradesNotice(): string | null {
    if (this.tradesLoad.failed) return "We couldn't load your trades just now. They will appear here as soon as the connection is back.";
    if (this.tradesLoad.unreadable > 0) return "Some of your trades couldn't be shown yet, so this list may be incomplete. We're working on it.";
    return null;
  }

  /** How many open trades the account has, as the copier service counts them (0 when not known). */
  private openReported = 0;
  public getOpenReported(): number {
    return this.openReported;
  }

  private setTradesLoad(failed: boolean, unreadable: number): void {
    if (this.tradesLoad.failed === failed && this.tradesLoad.unreadable === unreadable) return;
    this.tradesLoad = { failed, unreadable };
    this.notify();
  }

  /** Stores what the server says about an unfinished connection. Returns true when it changed. */
  private setPending(raw: unknown): boolean {
    const next = normalizePending(raw);
    if (JSON.stringify(next) === JSON.stringify(this.pendingConnection)) return false;
    this.pendingConnection = next;
    return true;
  }

  public subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  public getMt5Account(): Mt5Account {
    return this.mt5Account;
  }

  /**
   * Synchronizes the in-browser Master Account with what the copier service reports for the master
   */
  public syncMasterAccountFromCloud(masterData: any, activeClientsCount?: number): void {
    if (!masterData) return;
    this.masterAccount = {
      ...this.masterAccount,
      accountNumber: String(masterData.login || this.masterAccount.accountNumber),
      brokerServer: masterData.server || this.masterAccount.brokerServer,
      balance: masterData.balance != null ? Number(masterData.balance) : this.masterAccount.balance,
      equity: masterData.equity != null ? Number(masterData.equity) : this.masterAccount.equity,
      freeMargin: masterData.freeMargin != null ? Number(masterData.freeMargin) : this.masterAccount.freeMargin,
      marginLevel: masterData.marginLevel != null ? Number(masterData.marginLevel) : this.masterAccount.marginLevel,
      openTradesCount: masterData.openPositionsCount != null ? Number(masterData.openPositionsCount) : this.masterAccount.openTradesCount,
      activeCopiersCount: activeClientsCount != null ? activeClientsCount : this.masterAccount.activeCopiersCount,
      status: 'broadcasting',
      signalBroadcasting: true,
      lastPing: new Date().toISOString(),
    };
    this.notify();
  }

  public getSupervisedAccounts(): Mt5Account[] {
    return this.supervisedAccounts;
  }

  public getProfitInvoices(): ProfitShareInvoice[] {
    return this.profitInvoices;
  }

  public getActiveProfitInvoice(userId?: string): ProfitShareInvoice | null {
    const targetUserId = userId || this.mt5Account.userId;
    return this.profitInvoices.find(
      (inv) => inv.userId === targetUserId && inv.status === 'pending'
    ) || null;
  }

  public getTrades(): CopiedTrade[] {
    return this.trades;
  }

  public getOpenTrades(): CopiedTrade[] {
    return this.trades.filter((t) => t.status === 'OPEN');
  }

  public getTradeHistory(limit: number = 10): CopiedTrade[] {
    return this.trades
      .filter((t) => t.status === 'CLOSED')
      .sort(
        (a, b) =>
          new Date(b.closeTime || b.openTime).getTime() -
          new Date(a.closeTime || a.openTime).getTime()
      )
      .slice(0, limit);
  }

  public getSettlements(): ProfitShareSettlement[] {
    return this.settlements;
  }

  public getLedger(): LedgerEntry[] {
    return this.ledger;
  }

  public getAuditLogs(): AuditLog[] {
    return this.auditLogs;
  }

  // --- RISK ENGINE (Section 9) ---
  public runRiskCheck(): { riskStatus: 'normal' | 'warning' | 'blocked'; blockedReason?: string } {
    const openTrades = this.getOpenTrades();

    let status: 'normal' | 'warning' | 'blocked' = 'normal';
    let reason: string | undefined = undefined;

    if (this.mt5Account.status === 'disconnected') {
      this.mt5Account.riskStatus = 'normal';
      this.mt5Account.blockedReason = undefined;
      return { riskStatus: 'normal' };
    }

    // The minimum equity decides only whether a NEW account starts copying (the server holds it back and starts it by itself).
    // A connected account is never blocked or disconnected because its equity falls.

    if (openTrades.length >= this.riskSettings.maxOpenPositions) {
      if (status !== 'blocked') {
        status = 'warning';
        reason = `Max open positions reached (${openTrades.length}/${this.riskSettings.maxOpenPositions}).`;
      }
    }

    this.mt5Account.riskStatus = status;
    this.mt5Account.blockedReason = reason;

    if (status === 'blocked' && this.mt5Account.status === 'copying') {
      this.mt5Account.status = 'blocked';
      this.logAudit(
        this.mt5Account.userId,
        'SYSTEM_RISK_ENGINE',
        'TRADE_COPYING_BLOCKED',
        'RISK',
        reason || 'Equity fell below $100 safety floor.',
        'FAILED'
      );
    }

    return { riskStatus: status, blockedReason: reason };
  }

  // --- 50% PROFIT SHARE (real: invoices come from the server, payments are checked on the TRON blockchain) ---
  /** Loads this user's invoices (or all invoices for an administrator) from the server. */
  public async syncInvoicesFromBackend(asAdmin = false): Promise<void> {
    try {
      const headers = await authHeaders();
      if (!headers.Authorization) return;
      const res = await fetch(asAdmin ? '/api/trade/admin/invoices' : '/api/trade/invoices', { headers });
      if (!res.ok) return;
      const data = await res.json();
      const rows: any[] = Array.isArray(data.invoices) ? data.invoices : [];
      this.profitInvoices = rows.map((r) => ({
        id: String(r.id),
        userId: String(r.userId),
        accountNumber: String(r.accountLogin ?? ''),
        grossProfit: Number(r.grossProfit) || 0,
        profitSharePct: Number(r.feePct) || 50,
        amountDueUsdt: Number(r.amountDueUsdt) || 0,
        recipientAddress: String(r.recipientAddress || ''),
        status: r.status === 'paid' ? 'paid' : Date.parse(r.dueAt) <= Date.now() ? 'overdue_blocked' : 'pending',
        createdAt: String(r.createdAt),
        dueAt: String(r.dueAt),
        paidAt: r.paidAt,
        txHash: r.txHash,
      }));
      if (!asAdmin) {
        const open = this.profitInvoices.filter((i) => i.status !== 'paid');
        const due = open.reduce((t, i) => t + i.amountDueUsdt, 0);
        this.mt5Account.unpaidProfitShareUsdt = Math.round(due * 100) / 100;
        this.mt5Account.profitShareDueAt = open.length
          ? open.map((i) => i.dueAt).sort()[0]
          : undefined;
        this.mt5Account.profitShareStatus = open.some((i) => i.status === 'overdue_blocked') ? 'overdue_disconnected' : open.length ? 'payment_pending' : 'up_to_date';
      }
      this.notify();
    } catch {
      // keep what we had
    }
  }

  /** What can be paid now, before the daily settlement (50% of closed-trade profit, from the minimum, with no open trades). */
  public async getPayableNow(): Promise<PayableNowView | null> {
    try {
      const headers = await authHeaders();
      if (!headers.Authorization) return null;
      const res = await fetch('/api/trade/profit-share/payable', { headers });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) return null;
      return data as PayableNowView;
    } catch {
      return null;
    }
  }

  /** Makes the invoice now; it then shows as the share due and is paid like any invoice. */
  public async payProfitShareNow(): Promise<{ success: boolean; error?: string }> {
    try {
      const headers = await authHeaders();
      if (!headers.Authorization) return { success: false, error: 'Please sign in first.' };
      const res = await fetch('/api/trade/profit-share/pay-now', { method: 'POST', headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: data?.error || 'The invoice could not be made.' };
      await this.syncInvoicesFromBackend();
      return { success: true };
    } catch {
      return { success: false, error: 'Could not reach the server. Please try again.' };
    }
  }

  /** Sends the payment's transaction ID to the server, which checks it on the TRON blockchain. */
  public async payProfitShareInvoice(
    invoiceId: string,
    txHash?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const headers = await authHeaders();
      if (!headers.Authorization) return { success: false, error: 'Please sign in with a real account first.' };
      const res = await fetch('/api/trade/pay-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ invoiceId, txHash: txHash ?? '' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: data?.error || 'Payment could not be verified.' };
      await this.syncInvoicesFromBackend();
      await this.syncClientsFromBackend();
      return { success: true };
    } catch {
      return { success: false, error: 'Could not reach the server. Please try again.' };
    }
  }

  /** Administrator marks an invoice paid by hand. */
  public async adminConfirmInvoice(invoiceId: string, note?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/trade/admin/confirm-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ invoiceId, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: data?.error || 'Could not confirm the invoice.' };
      await this.syncInvoicesFromBackend(true);
      return { success: true };
    } catch {
      return { success: false, error: 'Could not reach the server.' };
    }
  }

  public async submitAndVerifyProfitShareHash(
    _accountNumber: string,
    txHash: string
  ): Promise<{
    success: boolean;
    message: string;
    amountSettled?: number;
    txHash?: string;
    invoiceId?: string;
    error?: string;
  }> {
    const cleanHash = txHash.trim();
    if (!cleanHash) {
      return { success: false, message: 'Transaction hash is required.', error: 'Please paste your TRC-20 Transaction Hash (TXID).' };
    }
    const pending = this.profitInvoices.find((i) => i.status !== 'paid');
    if (!pending) {
      return { success: false, message: 'No invoice is waiting for payment.', error: 'You have no unpaid invoice.' };
    }
    const r = await this.payProfitShareInvoice(pending.id, cleanHash);
    if (!r.success) return { success: false, message: r.error || 'Verification failed.', error: r.error };
    return {
      success: true,
      message: `Payment verified on the TRON network. Invoice of $${pending.amountDueUsdt.toFixed(2)} USDT is paid.`,
      amountSettled: pending.amountDueUsdt,
      txHash: cleanHash,
      invoiceId: pending.id,
    };
  }

  public reconnectAccount(accountNumber: string): void {
    if (this.mt5Account.accountNumber === accountNumber) {
      this.mt5Account.status = 'copying';
      this.mt5Account.riskStatus = 'normal';
      this.mt5Account.blockedReason = undefined;
      this.mt5Account.profitShareStatus = 'up_to_date';
      this.mt5Account.unpaidProfitShareUsdt = 0;
      this.mt5Account.profitShareDueAt = undefined;
    }
    const sup = this.supervisedAccounts.find((a) => a.accountNumber === accountNumber);
    if (sup) {
      sup.status = 'copying';
      sup.riskStatus = 'normal';
      sup.blockedReason = undefined;
      sup.profitShareStatus = 'up_to_date';
      sup.unpaidProfitShareUsdt = 0;
      sup.profitShareDueAt = undefined;
    }
    this.notify();
  }

  // --- TRC20 USDT SUBSCRIPTION & TRONGRID ENGINE (Section 5 & 6) ---
  // --- MT5 CONNECTION & ONBOARDING (Section 7) ---
  /**
   * Safe onboarding: Credentials are sent via secure HTTPS to the private bridge.
   * NEVER store password in plaintext or in frontend state!
   *
   * Resolves to 'connected' when the account is live, or to 'background' when the broker is slow and the
   * server keeps connecting it without the browser (the dashboard then follows it by itself).
   */
  public async connectMt5Account(
    userId: string,
    accountNumber: string,
    brokerServer: string,
    passwordSecure: string, // sent once over HTTPS to the server, never stored here
    onProgress?: (p: ConnectProgress) => void
  ): Promise<ConnectOutcome> {
    // Only a real, signed-in account can connect.
    const headers = await authHeaders();
    if (!headers.Authorization) {
      throw new Error(
        'Please sign in with your email account first.'
      );
    }

    this.mt5Account.status = 'connecting';
    // A new attempt replaces an old "could not connect" notice.
    if (this.pendingConnection?.kind === 'failed') this.pendingConnection = null;
    this.notify();

    // The server starts the connection in the background and we follow its progress.
    // We send credentials only: no balance, equity or names.
    const fail = (message: string, extra: Partial<ConnectError> = {}): never => {
      this.mt5Account.status = 'connection_failed';
      this.notify();
      throw Object.assign(new ConnectError(message), extra);
    };

    let res: Response;
    try {
      res = await fetch('/api/trade/provision-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          login: accountNumber.trim(),
          password: passwordSecure,
          server: brokerServer.trim(),
          platform: 'mt5',
        }),
      });
    } catch {
      return fail('Could not reach the server. Check your internet connection and try again.');
    }

    const started = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      return fail(started.error || 'The broker could not verify this account. Nothing was connected.', { code: started.code });
    }

    // Poll until the connection finishes. A dropped request does not stop the connection, so we just ask again.
    // (Once a second: the answer is only memory on the server, and the window then follows it closely.)
    const POLL_MS = 1000;
    const GIVE_UP_MS = 10 * 60_000;
    const began = Date.now();
    let job = started.job;
    let missing = 0;
    // The server also says whether it is still looking after a terminal for this client.
    let lastPending: unknown = null;
    while (job && job.status === 'running') {
      onProgress?.({
        stage: job.stage,
        label: job.label,
        percent: job.percent,
        elapsedSeconds: job.elapsedSeconds,
        detail: liveDetail(lastPending, job.label),
      });
      if (Date.now() - began > GIVE_UP_MS) {
        return fail('This is taking longer than expected. Close this window and press Connect again in a minute.', { retryable: true });
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
      try {
        const poll = await fetch('/api/trade/connect-status', { headers: await authHeaders() });
        if (poll.ok) {
          const body = await poll.json().catch(() => ({} as any));
          job = body.job;
          if (body.pending !== undefined) lastPending = body.pending;
          if (!job && ++missing >= 3) break;
        }
      } catch {
        // network blip: keep waiting
      }
    }

    if (job && job.status === 'background') {
      // Not a failure: the terminal exists and the server keeps connecting it by itself.
      // The dashboard follows it from here and shows the account as soon as it is ready.
      this.mt5Account.status = 'connecting';
      this.setPending(
        lastPending ?? { kind: 'working', label: 'Getting your terminal ready…', login: accountNumber.trim(), server: brokerServer.trim() }
      );
      this.notify();
      return 'background';
    }

    if (!job || job.status === 'failed') {
      const e = job?.error;
      return fail(e?.message || 'We lost track of this connection. Please press Connect again.', {
        code: e?.code,
        hint: e?.hint,
        ref: e?.ref,
        retryable: e ? Boolean(e.retryable) : true,
      });
    }

    const c = job.result;
    // Defence in depth: accept only an answer the broker verified.
    if (!c || c.isBrokerVerified !== true) {
      return fail('The broker could not verify this account. Nothing was connected.');
    }
    this.pendingConnection = null; // connected: there is nothing left to wait for
    onProgress?.({ stage: 'done', label: 'Connected', percent: 100, elapsedSeconds: job.elapsedSeconds });

    // The server has already put a new connection into service (it copies as the template says as soon as the copier has logged
    // the account in), so nothing more is asked of it here: a second round trip to the copier only kept this window waiting.
    // Only an account the server kept paused is asked to resume, as before (the server checks that this user owns a verified account).
    if (needsCopyResume(c.status)) {
      try {
        await fetch('/api/trade/toggle-mirror', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({ targetState: 'ACTIVE' }),
        });
      } catch (toggleErr: any) {
        console.warn('⚠️ [TRADING_ENGINE] Toggle mirror notice:', toggleErr?.message);
      }
    }

    const balance = Number(c.balance);
    const equity = Number(c.equity);
    this.mt5Account = {
      ...this.mt5Account,
      userId,
      accountNumber: String(c.login),
      brokerServer: String(c.server),
      status: 'copying',
      balance,
      equity,
      freeMargin: Number(c.freeMargin ?? equity),
      marginLevel: 0,
      leverage: Number(c.leverage) || 0,
      riskStatus: 'normal',
      brokerName: c.brokerName,
      accountHolderName: c.accountHolderName || '',
      isBrokerVerified: true,
      tradeAllowed: c.tradeAllowed,
      investorMode: c.investorMode,
      verificationTimestamp: c.verificationTimestamp,
      copyHeld: c.figuresPending ? 'reading_balance' : c.unsupportedCurrency ? 'currency' : c.lowFunds ? 'low_funds' : undefined,
      copyMinimumUsd: typeof c.copyMinimumUsd === 'number' ? c.copyMinimumUsd : undefined,
      copiedFromMasterAccount: this.masterAccount.accountNumber,
      masterAccountName: this.masterAccount.accountName,
      lastPing: new Date().toISOString(),
    };

    const existingIndex = this.supervisedAccounts.findIndex(
      (a) => a.userId === userId || a.accountNumber === String(c.login)
    );
    if (existingIndex >= 0) {
      this.supervisedAccounts[existingIndex] = { ...this.mt5Account };
    } else {
      this.supervisedAccounts.push({ ...this.mt5Account });
    }

    this.masterAccount.activeCopiersCount = Math.max(1, this.supervisedAccounts.length);

    this.logAudit(
      userId,
      `Client (${c.login})`,
      'CONNECTED_TO_MAIN_MASTER',
      'MT5',
      `Client MT5 #${c.login} verified by the broker (${c.brokerName}, ${c.accountType || 'account'}) and connected to the Castimofx master account. Broker-reported equity: $${equity.toFixed(2)}.`,
      'SUCCESS'
    );

    this.runRiskCheck();
    this.notify();
    return 'connected';
  }

  /**
   * Syncs broker-verified accounts from the server. Everybody is told their own account (and a connection still being brought
   * up for them); administrators are also sent every client, for the admin console. An administrator can use the Client Terminal
   * with their own account too, which is why their own account is asked for separately rather than looked for in that list
   * (see planSync). Nothing else is trusted.
   */
  public async syncClientsFromBackend(): Promise<void> {
    try {
      const headers = await authHeaders();
      if (!headers.Authorization) return; // demo / quick-start sessions have nothing to sync

      // Both at once. The second is for administrators only: everyone else is simply told no.
      const [mineRes, allRes] = await Promise.all([
        fetch('/api/trade/my-account', { headers }).catch(() => null),
        fetch('/api/trade/clients', { headers }).catch(() => null),
      ]);
      const mine: OwnAnswer | null = mineRes && mineRes.ok ? await mineRes.json().catch(() => null) : null;
      const listBody = allRes && allRes.ok ? await allRes.json().catch(() => null) : null;
      const list: unknown[] | null = allRes && allRes.ok ? (Array.isArray(listBody?.clients) ? listBody.clients : []) : null;
      const plan = planSync(mine, list);
      if (!plan.reachable) return;
      // Nothing is connected yet: the server may still be bringing the account up, or have given up on it.
      const pendingChanged = plan.pending ? this.setPending(plan.pending.value) : false;

      for (const { client: c, own } of plan.entries) {
        if (c.isBrokerVerified !== true) continue;
        const mappedAcc: Mt5Account = {
          id: c.accountId || `mt5-acc-${c.userId}`,
          userId: c.userId,
          accountNumber: String(c.login),
          brokerServer: c.server,
          status: c.status === 'ACTIVE' ? 'copying' : 'disconnected',
          balance: Number(c.balance),
          equity: Number(c.equity),
          freeMargin: Number(c.freeMargin ?? c.equity),
          marginLevel: 0,
          leverage: Number(c.leverage) || 0,
          riskStatus: 'normal',
          profitShareStatus: 'up_to_date',
          unpaidProfitShareUsdt: 0,
          lastProfitGenerated: 0,
          lastPing: c.lastSync || new Date().toISOString(),
          createdAt: new Date().toISOString(),
          brokerName: c.brokerName,
          accountHolderName: c.accountHolderName || '',
          isBrokerVerified: true,
          tradeAllowed: c.tradeAllowed,
          investorMode: c.investorMode,
          verificationTimestamp: c.verificationTimestamp,
          connectionState: c.connectionState,
          linkLatencyMs: c.latencyMs,
          copyHeld: c.figuresPending ? 'reading_balance' : c.unsupportedCurrency ? 'currency' : c.lowFunds ? 'low_funds' : undefined,
          copyMinimumUsd: typeof c.copyMinimumUsd === 'number' ? c.copyMinimumUsd : undefined,
          copiedFromMasterAccount: this.masterAccount.accountNumber,
          masterAccountName: this.masterAccount.accountName,
        };

        // The admin console lists what the server listed. An administrator's own account is not added to it from here
        // (it is in that list already whenever it is in service).
        if (!(own && plan.listed)) {
          const idx = this.supervisedAccounts.findIndex(
            (a) => a.userId === c.userId || a.accountNumber === String(c.login)
          );
          if (idx >= 0) {
            this.supervisedAccounts[idx] = { ...this.supervisedAccounts[idx], ...mappedAcc };
          } else {
            this.supervisedAccounts.push(mappedAcc);
          }
        }

        // Our own account answers for the signed-in user (administrators included), even after a page reload, when the
        // in-memory account does not know the user id yet.
        if (own || this.mt5Account.userId === c.userId) {
          this.mt5Account = {
            ...this.mt5Account,
            userId: c.userId,
            accountNumber: mappedAcc.accountNumber,
            brokerServer: mappedAcc.brokerServer,
            status: mappedAcc.status,
            balance: mappedAcc.balance,
            equity: mappedAcc.equity,
            freeMargin: mappedAcc.freeMargin,
            leverage: mappedAcc.leverage,
            brokerName: mappedAcc.brokerName,
            accountHolderName: mappedAcc.accountHolderName,
            isBrokerVerified: true,
            tradeAllowed: mappedAcc.tradeAllowed,
            investorMode: mappedAcc.investorMode,
            verificationTimestamp: mappedAcc.verificationTimestamp,
            connectionState: mappedAcc.connectionState,
            linkLatencyMs: mappedAcc.linkLatencyMs,
            copyHeld: mappedAcc.copyHeld,
            copyMinimumUsd: mappedAcc.copyMinimumUsd,
          };
        }
      }
      // The signed-in user's own trades come from the copier service. The list for an administrator has no trades of its own.
      if (plan.entries.some((e) => e.own)) await this.syncOwnTrades(headers);
      if (plan.entries.length > 0) {
        this.masterAccount.activeCopiersCount = this.supervisedAccounts.length;
        this.notify();
      } else if (pendingChanged) {
        this.notify();
      }
    } catch {
      // Non-blocking background sync
    }
  }

  /**
   * Loads the signed-in client's open and closed trades as the copier service reports them. When the server cannot
   * read them just now, the last list stays on screen rather than being replaced by a guess.
   */
  private async syncOwnTrades(headers: Record<string, string>): Promise<void> {
    try {
      const res = await fetch('/api/trade/my-trades', { headers });
      if (!res.ok) {
        this.setTradesLoad(true, 0);
        return;
      }
      const data = await res.json();
      if (data && data.success && data.connected !== false && Array.isArray(data.trades)) {
        this.trades = data.trades as CopiedTrade[];
        const reported = Number(data.openReported);
        const nextReported = Number.isFinite(reported) && reported > 0 ? reported : 0;
        if (nextReported !== this.openReported) {
          this.openReported = nextReported;
          this.notify();
        }
        this.setTradesLoad(false, Number(data.unreadable) > 0 ? Number(data.unreadable) : 0);
      }
    } catch {
      // Keep the last list, and say so on the trade pages.
      this.setTradesLoad(true, 0);
    }
  }

  /**
   * Asks the server to re-read balance and equity from the broker.
   * Figures can no longer be typed in by hand: only the broker's answer is used.
   */
  public async refreshAccountFromBroker(): Promise<boolean> {
    try {
      const headers = await authHeaders();
      if (!headers.Authorization) return false;
      const res = await fetch('/api/trade/reverify-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({}),
      });
      if (!res.ok) return false;
      await this.syncClientsFromBackend();
      return true;
    } catch {
      return false;
    }
  }

  // --- MT5 DISCONNECTION STATE MACHINE (Section 11) ---
  /**
   * copying -> disconnect_requested -> closing_positions -> disconnected
   * Failure state: disconnect_failed
   */
  public async requestMt5Disconnection(
    userId: string,
    onProgress?: (step: string) => void
  ): Promise<{ success: boolean; error?: string }> {
    if (this.mt5Account.status !== 'copying' && this.mt5Account.status !== 'connected') {
      return { success: false, error: 'Account is not currently actively copying.' };
    }

    // Step 1: disconnect_requested
    this.mt5Account.status = 'disconnect_requested';
    if (onProgress) onProgress('Disconnection requested. Halting new trade signals...');
    this.logAudit(
      userId,
      `Client (${this.mt5Account.accountNumber})`,
      'MT5_DISCONNECT_REQUESTED',
      'MT5',
      'Disconnection command dispatched. New trade copying halted immediately.',
      'SUCCESS'
    );
    this.notify();
    await new Promise((res) => setTimeout(res, 800));

    // Step 2: closing_positions
    this.mt5Account.status = 'closing_positions';
    if (onProgress) onProgress('Removing your account from the copier. Open trades stay open in your MT5 and are not closed for you...');
    this.logAudit(
      userId,
      'MT5 Copier Service',
      'REMOVING_FROM_COPIER',
      'MT5',
      'Removing the account from the copier. Trades already open stay open in the MT5 account.',
      'SUCCESS'
    );
    this.notify();
    await new Promise((res) => setTimeout(res, 1200));

    // Ask the server to stop copying and remove the account from the copier. Only continue if it worked.
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/trade/disconnect-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        this.mt5Account.status = 'disconnect_failed' as any;
        this.notify();
        return { success: false, error: data?.error || 'Could not disconnect right now. Please try again.' };
      }
    } catch {
      this.mt5Account.status = 'disconnect_failed' as any;
      this.notify();
      return { success: false, error: 'Could not reach the server. Please try again.' };
    }

    // The account is gone from the copier, so there is nothing of ours left to list. Trades that were open stay
    // open in the person's own MT5; we do not mark anything as closed that was not.
    this.trades = [];

    // Step 3: disconnected
    this.mt5Account = {
      ...this.mt5Account,
      status: 'disconnected',
      accountNumber: 'Not Connected',
      brokerServer: 'Awaiting MT5 Bridge',
      balance: 0.0,
      equity: 0.0,
      freeMargin: 0.0,
      marginLevel: 0.0,
      unpaidProfitShareUsdt: 0.0,
      profitShareDueAt: undefined,
      lastProfitGenerated: 0.0,
    };
    if (onProgress) onProgress('Disconnected. Copying has stopped and your account was removed.');
    this.logAudit(
      userId,
      'MT5 Bridge',
      'MT5_DISCONNECTED_SUCCESSFULLY',
      'MT5',
      'Copying stopped and account removed from the copier. Open trades on the broker account were not closed.',
      'SUCCESS'
    );

    this.runRiskCheck();
    this.notify();
    return { success: true };
  }

  // --- AUDIT LOGGING (Section 14) ---
  /** The signed-in person's address as the server sees it. Empty until the server has told us. */
  private clientIp = '';

  /** Asks the server for this person's address, once; later audit entries carry it. Never invented. */
  public async syncClientIp(): Promise<void> {
    if (this.clientIp) return;
    try {
      const headers = await authHeaders();
      if (!headers.Authorization) return;
      const res = await fetch('/api/trade/my-ip', { headers });
      if (!res.ok) return;
      const d = await res.json();
      if (d?.success && typeof d.ip === 'string') this.clientIp = d.ip;
    } catch {
      // keep it empty
    }
  }

  public logAudit(
    userId: string,
    actor: string,
    action: string,
    category: AuditLog['category'],
    details: string,
    status: 'SUCCESS' | 'WARNING' | 'FAILED'
  ) {
    const log: AuditLog = {
      id: `audit-${Date.now().toString().slice(-6)}`,
      userId,
      actor,
      action,
      category,
      details,
      ip: this.clientIp, // the address the server saw for this person; empty (hidden) until known
      timestamp: new Date().toISOString(),
      status,
    };
    this.auditLogs.unshift(log);
  }

  // --- RECONCILIATION REPORT (Section 13) ---
  public generateReconciliationReport(): ReconciliationReport {
    const openTrades = this.getOpenTrades();
    const report: ReconciliationReport = {
      id: `recon-${Date.now().toString().slice(-6)}`,
      timestamp: new Date().toISOString(),
      mt5EquityVsDb: this.mt5Account.equity,
      ledgerBalanceVsCash: this.ledger[0]?.balanceAfter || 0,
      openCopiedPositions: openTrades.length,
      pendingWithdrawalsCount: this.withdrawals.filter((w) => w.status === 'reserved').length,
      discrepancies: [],
      status: 'BALANCED',
    };

    if (this.mt5Account.equity < 100 && openTrades.length > 0) {
      report.status = 'DISCREPANCY_DETECTED';
      report.discrepancies.push('CRITICAL: Equity is below $100 while positions remain unhedged!');
    }

    return report;
  }
}

export const tradingEngine = new TradingEngine();
