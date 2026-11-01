/**
 * CASTIMOFX - MT5 connection manager (Duplikium edition)
 *
 * Duplikium (trade-copier.com) does the copying: the master HFM account is registered there once, and every
 * client's MT5 account is added there as a "slave" built from a template. This manager is our side of that:
 *
 *  - connect:     add the client's account to Duplikium, wait until Duplikium has logged in and reported the
 *                 account's real figures, apply our rules, then switch copying on.
 *  - disconnect:  delete the client's account from Duplikium.
 *  - pause/resume and unpaid plans: set the account's copier status (on / close-only / frozen).
 *  - figures:     balance, equity and free margin are read from Duplikium (it refreshes them after each
 *                 trade and every 5 minutes), never invented.
 *  - restore:     after a restart, clients are found again by the name we gave their account.
 *
 * The client's broker password goes straight to Duplikium when the account is added. It is never kept by
 * this server, never logged and never written to the database.
 *
 * Nothing is simulated: when the copier service cannot be reached, the state says so.
 */

import {
  COPIER,
  DuplikiumClient,
  DuplikiumError,
  toIso,
  type CopierApi,
  type DuplikiumAccount,
  type DuplikiumPosition,
} from './duplikiumClient.ts';
import { ProvisionGate, HandedOff, friendlyHint, rejectsForGood, type Stage } from './clientBridge.ts';
import { DISCONNECT_GRACE_MS, decideLink, desiredCopierStatus, type LinkMemory } from './copierLink.ts';
import {
  BrokerVerificationError,
  checkConnectEligibility,
  classifyState,
  clientAccountName,
  countClientAccounts,
  DEFAULT_MIN_CONNECT_EQUITY,
  isOwnedBy,
  isPlatformClientAccount,
  normalizeBrokerServer,
  parseClientAccountName,
  readLimit,
  sameLogin,
  translateCopierError,
  verifyCopierAccount,
  type VerifiedBrokerAccount,
} from './brokerVerification.ts';

export interface ProvisionClientParams {
  userId: string;
  login: string;
  password: string;
  server: string;
  platform?: 'mt4' | 'mt5';
}

export type ConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'ERROR';

export interface ClientConnectionRecord {
  userId: string;
  /** The account's id at the copier service (Duplikium). */
  accountId: string;
  login: string;
  server: string;
  status: 'ACTIVE' | 'IDLE' | 'ERROR' | 'PROVISIONING';
  balance: number;
  equity: number;
  freeMargin: number;
  currency: string;
  /** 0 = not reported by the service, so none is shown. */
  leverage: number;
  lastSync: string;
  errorMessage?: string;
  accountHolderName?: string;
  brokerName?: string;
  isBrokerVerified: boolean;
  tradeAllowed?: boolean;
  investorMode?: boolean;
  accountType?: 'demo' | 'real';
  verificationTimestamp: string;
  /** True while the client has an overdue invoice or no paid plan: copying is held back. */
  billingBlocked?: boolean;
  connectionState?: ConnectionState;
  /** The service's own state word for the account, e.g. CONNECTED. */
  connectionStatus?: string;
  latencyMs?: number;
  /** When the copier service last updated the account's figures. */
  lastHeartbeat?: string;
  /** Internal bookkeeping; never sent to the browser. */
  copyApplied?: number;
  missedReads?: number;
}

export interface MasterAccountMetrics {
  accountId: string;
  login: string;
  server: string;
  balance: number;
  equity: number;
  freeMargin: number;
  marginLevel: number;
  currency: string;
  leverage: number;
  openPositionsCount: number;
  latencyMs: number;
  lastHeartbeat: string;
  state: ConnectionState;
  connectionStatus: string;
}

/** What the dashboard is told about a connection that is not finished yet (or that we gave up on). */
export interface PendingView {
  kind: 'working' | 'failed';
  label: string;
  minutesLeft?: number;
  login?: string;
  server?: string;
  error?: { code: string; message: string; hint: string; ref?: string };
}

interface PendingLink extends LinkMemory {
  userId: string;
  accountId: string;
  login: string;
  server: string;
  /** A client who was verified before (restored after a restart): never given up on, never removed. */
  verifiedBefore: boolean;
  label: string;
  failure?: { code: string; message: string; hint: string; ref?: string; at: number };
}

export interface MasterTrade {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  openPrice: number | null;
  openedAt: string | null;
}

export interface ClientTrades {
  open: DuplikiumPosition[];
  closed: DuplikiumPosition[];
}

export interface CheckStep {
  name: string;
  ok: boolean;
  detail: string;
  /** Optional lines to show under the detail, such as the accounts and templates the administrator can choose from. */
  lines?: string[];
}

const DEFAULT_MASTER_LOGIN = '261089492';
const eq = (a?: string, b?: string) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const mask = (id: string) => (id.length > 6 ? `${id.slice(0, 3)}…${id.slice(-3)}` : '***');

export class Mt5ConnectionManager {
  private static instance: Mt5ConnectionManager | null = null;

  private api: CopierApi | null = null;
  private masterId = '';
  private templateId = '';
  private masterState: ConnectionState = 'DISCONNECTED';
  private masterNote = '';
  private serviceError = '';
  private lastRefreshAt = 0;

  private masterMetrics: MasterAccountMetrics = {
    accountId: '',
    login: '',
    server: '',
    // Nothing is shown as real until the broker has reported it.
    balance: 0,
    equity: 0,
    freeMargin: 0,
    marginLevel: 0,
    currency: 'USD',
    leverage: 0,
    openPositionsCount: 0,
    latencyMs: 0,
    lastHeartbeat: '',
    state: 'DISCONNECTED',
    connectionStatus: 'DISCONNECTED',
  };

  /** Connected clients, keyed by both user id and account id. */
  private clientPool: Map<string, ClientConnectionRecord> = new Map();
  /** Connections that exist at the copier service but are not verified yet. */
  private pending: Map<string, PendingLink> = new Map();
  private lastAccounts: DuplikiumAccount[] = [];

  /** Called whenever a client's broker account is verified or restored (used to open the billing ledger). */
  public onClientVerified: ((record: ClientConnectionRecord) => void) | null = null;
  /** Called whenever a client's record is saved to the pool (connect, pause, resume). */
  public onClientSaved: ((record: ClientConnectionRecord) => void) | null = null;
  /** Looks up the pause/resume choice the client last made. */
  public loadSavedStatus: ((userId: string) => Promise<'ACTIVE' | 'IDLE' | null>) | null = null;
  /** True if the user has billing history; their account is then never cleaned up automatically. */
  public hasBillingHistory: ((userId: string) => Promise<boolean>) | null = null;
  /**
   * Whether this very account was verified for the user in the past, according to what we saved:
   * 'yes', 'no' (sure it was not), or 'unknown'. Anyone in doubt is treated as already connected.
   */
  public wasVerified: ((userId: string, accountId: string) => Promise<'yes' | 'no' | 'unknown'>) | null = null;
  /** Called once when a NEW connection completes (from the browser or in the background). */
  public onNewConnection: ((userId: string) => void) | null = null;

  private lastLazyRestore = new Map<string, number>();
  private provisionGate = new ProvisionGate(readLimit(process.env.CONNECT_MAX_PARALLEL, 3));
  /** Users whose connection, started from the browser, is running right now. */
  private connecting = new Set<string>();

  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshing = false;
  private reconciling = false;
  private lastReconcileAt = 0;
  private templateCache: { at: number; type?: number; value?: number } | null = null;
  private masterTradesCache: { at: number; trades: MasterTrade[] } | null = null;
  private tradesCache = new Map<string, { at: number; openAt: number; closedAt: number; data: ClientTrades }>();

  private constructor() {}

  public static getInstance(): Mt5ConnectionManager {
    if (!Mt5ConnectionManager.instance) Mt5ConnectionManager.instance = new Mt5ConnectionManager();
    return Mt5ConnectionManager.instance;
  }

  /** Tests only: a fresh manager that talks to the given (fake) service. */
  public static forTests(api: CopierApi, opts: { masterId?: string; templateId?: string } = {}): Mt5ConnectionManager {
    const m = new Mt5ConnectionManager();
    m.api = api;
    m.masterId = opts.masterId ?? 'MASTER';
    m.templateId = opts.templateId ?? 'TEMPLATE';
    return m;
  }

  // ---------- start-up and the periodic read ----------

  /**
   * Signs in to the copier service, reads the master and every client account once, brings clients back
   * after a restart, and keeps the figures fresh.
   */
  public async initialize(): Promise<boolean> {
    this.masterId = this.masterId || (process.env.DUPLIKIUM_MASTER_ID || '').trim();
    this.templateId = this.templateId || (process.env.DUPLIKIUM_TEMPLATE_ID || '').trim();
    if (!this.api) this.api = DuplikiumClient.fromEnv();

    if (!this.api) {
      this.markMasterUnavailable('DUPLIKIUM_API_USER / DUPLIKIUM_API_TOKEN are not set, so there is no live connection.');
      return false;
    }
    if (!this.masterId) this.masterNote = 'DUPLIKIUM_MASTER_ID is not set, so the master account cannot be read.';
    if (!this.templateId) console.error('❌ [COPIER] DUPLIKIUM_TEMPLATE_ID is not set. No client account can be connected until it is.');

    this.startTimer();
    const ok = await this.refreshAll();
    if (ok) {
      try {
        await this.restoreFromList(this.lastAccounts);
      } catch (e: any) {
        console.warn('⚠️ [COPIER] Could not bring back saved clients:', e?.message || e);
      }
      void this.reconcileCopyState(true);
    }
    return ok;
  }

  private startTimer(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    const secs = readLimit(process.env.DUPLIKIUM_REFRESH_SECONDS, 60) || 60;
    this.refreshTimer = setInterval(() => void this.refreshAll(), secs * 1000);
    (this.refreshTimer as any).unref?.();
  }

  public stop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  /** One read of every account at the copier service. Updates the master, the clients and pending connections. */
  public async refreshAll(): Promise<boolean> {
    if (!this.api || this.refreshing) return this.masterState === 'CONNECTED';
    this.refreshing = true;
    try {
      const accounts = await this.api.getAccounts();
      this.lastAccounts = accounts;
      this.serviceError = '';
      this.lastRefreshAt = Date.now();
      const byId = new Map(accounts.map((a) => [a.accountId, a]));

      this.applyMaster(this.masterId ? byId.get(this.masterId) : undefined);

      const seen = new Set<string>();
      for (const rec of Array.from(this.clientPool.values())) {
        if (seen.has(rec.accountId) || !rec.isBrokerVerified) continue;
        seen.add(rec.accountId);
        this.applyAccountToClient(rec, byId.get(rec.accountId), accounts.length > 0 && Boolean(byId.get(this.masterId)));
      }
      await this.tickPending(byId);
      void this.reconcileCopyState(false);
      return this.masterState === 'CONNECTED';
    } catch (e: any) {
      this.serviceError = e instanceof DuplikiumError ? `${e.kind}: ${e.message}` : String(e?.message || e);
      // Do not keep showing "connected" for a service we cannot read. Client figures stay as last read.
      this.masterState = 'ERROR';
      this.masterMetrics.state = 'ERROR';
      this.masterMetrics.connectionStatus = 'DISCONNECTED';
      this.masterNote = `The copier service could not be read: ${this.serviceError}`;
      console.error(`❌ [COPIER] Could not read accounts: ${this.serviceError}`);
      return false;
    } finally {
      this.refreshing = false;
    }
  }

  private markMasterUnavailable(reason: string): void {
    this.masterState = 'ERROR';
    this.masterMetrics.state = 'ERROR';
    this.masterMetrics.connectionStatus = 'DISCONNECTED';
    this.masterNote = reason;
    console.error(`❌ [COPIER] The master account is not connected: ${reason}`);
  }

  private stateFor(acc: DuplikiumAccount): ConnectionState {
    switch (classifyState(acc.state)) {
      case 'connected':
        return 'CONNECTED';
      case 'disconnected':
        return 'DISCONNECTED';
      case 'pending':
        return 'CONNECTING';
      default:
        return 'ERROR';
    }
  }

  private applyMaster(acc: DuplikiumAccount | undefined): void {
    const m = this.masterMetrics;
    if (!this.masterId) {
      this.masterState = 'ERROR';
      m.state = 'ERROR';
      return;
    }
    m.accountId = this.masterId;
    if (!acc) {
      this.masterState = 'ERROR';
      m.state = 'ERROR';
      m.connectionStatus = 'DISCONNECTED';
      this.masterNote = 'The master account was not found at the copier service. Check DUPLIKIUM_MASTER_ID.';
      return;
    }
    if (acc.type === 'slave') {
      this.masterNote = 'The account named as master is set up as a slave at the copier service.';
    } else {
      this.masterNote = '';
    }
    if (acc.login) m.login = acc.login;
    if (acc.server) m.server = acc.server;
    if (acc.balance !== null) m.balance = acc.balance;
    if (acc.equity !== null) m.equity = acc.equity;
    if (acc.freeMargin !== null) m.freeMargin = acc.freeMargin;
    if (acc.currency) m.currency = acc.currency;
    if (acc.openTrades !== null) m.openPositionsCount = acc.openTrades;
    m.lastHeartbeat = toIso(acc.lastUpdate) ?? m.lastHeartbeat;
    m.connectionStatus = acc.state || 'NONE';
    this.masterState = this.stateFor(acc);
    m.state = this.masterState;
  }

  /** Copies the service's latest figures onto a connected client's record. */
  private applyAccountToClient(rec: ClientConnectionRecord, acc: DuplikiumAccount | undefined, listTrusted: boolean): void {
    if (!acc) {
      // Only believe "gone" when the list itself looks healthy, and only after several reads in a row.
      if (!listTrusted) return;
      rec.missedReads = (rec.missedReads ?? 0) + 1;
      if (rec.missedReads >= 3) {
        console.warn(`⚠️ [COPIER] Account of ${mask(rec.userId)} #${rec.login} is no longer at the copier service; removing it from service.`);
        this.dropFromPool(rec.userId);
      }
      return;
    }
    rec.missedReads = 0;
    if (acc.balance !== null) rec.balance = acc.balance;
    if (acc.equity !== null) rec.equity = acc.equity;
    if (acc.freeMargin !== null) rec.freeMargin = acc.freeMargin;
    if (acc.currency) rec.currency = acc.currency;
    rec.connectionState = this.stateFor(acc);
    rec.connectionStatus = acc.state || 'NONE';
    rec.lastHeartbeat = toIso(acc.lastUpdate) ?? rec.lastHeartbeat;
    rec.lastSync = new Date().toISOString();
    const kind = classifyState(acc.state);
    rec.investorMode = kind === 'investor' ? true : rec.investorMode;
    rec.errorMessage =
      kind === 'investor'
        ? 'The password on file only allows viewing the account. Please reconnect with your trading password.'
        : kind === 'disconnected'
          ? 'The copier service cannot sign in to your account right now.'
          : undefined;
  }

  private dropFromPool(userId: string): void {
    for (const [key, rec] of Array.from(this.clientPool.entries())) {
      if (rec.userId === userId) this.clientPool.delete(key);
    }
  }

  // ---------- connecting a client ----------

  private isMasterAccount(login: string, server: string): boolean {
    const mLogin = this.masterMetrics.login || process.env.MASTER_LOGIN || DEFAULT_MASTER_LOGIN;
    const mServer = this.masterMetrics.server || process.env.MASTER_SERVER || '';
    return sameLogin(mLogin, login) && (!mServer || eq(mServer, server));
  }

  /** How long "not logged in" is tolerated before the login is judged wrong (milliseconds, default 45000). */
  private graceMs(): number {
    const raw = readLimit(process.env.CONNECT_DISCONNECT_GRACE_MS, DISCONNECT_GRACE_MS);
    return raw;
  }

  private minEquity(): number {
    return readLimit(process.env.MIN_CONNECT_EQUITY, DEFAULT_MIN_CONNECT_EQUITY);
  }

  /** For the admin page: the minimum equity a NEW client needs to connect, and whether it was set on Render or is the built-in default. */
  public getConnectMinimum(): { usd: number; source: 'setting' | 'default' } {
    const raw = process.env.MIN_CONNECT_EQUITY;
    const n = Number(raw);
    const isSet = raw !== undefined && raw !== '' && Number.isInteger(n) && n >= 0;
    return { usd: this.minEquity(), source: isSet ? 'setting' : 'default' };
  }

  /**
   * For the admin page: the copy size every new client gets, and where it comes from (Render, or the Duplikium template).
   * Null when it cannot be read right now, so nothing is ever shown that was not really read.
   */
  public async getCopySize(): Promise<{ type: number; value: number; source: 'setting' | 'template' } | null> {
    const fromEnv = this.envCopySize();
    if (fromEnv) return { type: fromEnv.riskFactorType, value: fromEnv.riskFactorValue, source: 'setting' };
    if (!this.api || !this.templateId) return null;
    const r = await this.riskSettings();
    if (r.riskFactorType === undefined || r.riskFactorValue === undefined) return null;
    return { type: r.riskFactorType, value: r.riskFactorValue, source: 'template' };
  }

  public async provisionClientTerminal(
    params: ProvisionClientParams,
    onStage: (stage: Stage) => void = () => {}
  ): Promise<ClientConnectionRecord> {
    const { userId } = params;
    if (!userId) throw new BrokerVerificationError('BAD_INPUT', 'You must be signed in to connect an account.');

    // FAIL CLOSED: without a live copier service we cannot ask the broker, so we accept nothing.
    const api = this.api;
    if (!api || !this.masterId || !this.templateId) {
      const e = new BrokerVerificationError(
        'VERIFICATION_UNAVAILABLE',
        'Account verification is temporarily unavailable, so no account was connected. Please try again later.'
      );
      e.ref = 'COPIER_NOT_CONFIGURED';
      throw e;
    }

    const login = String(params.login).trim();
    const server = normalizeBrokerServer(params.server);

    await this.restoreClientForUser(userId).catch(() => undefined);

    // Already connected with this very account: pass straight through, nothing to redo.
    const current = this.clientPool.get(userId);
    if (current && current.isBrokerVerified && sameLogin(current.login, login) && eq(current.server, server)) {
      onStage('verifying');
      void this.refreshClientFromBroker(userId).catch(() => undefined);
      return current;
    }

    const gate = this.provisionGate;
    let claimed = false;
    let createdId: string | undefined;
    let stage: Stage = 'checking';
    const go = (s: Stage) => {
      stage = s;
      onStage(s);
    };

    this.connecting.add(userId);
    this.pending.delete(userId); // a new attempt replaces an old "could not connect" notice
    try {
      go('checking');

      if (this.isMasterAccount(login, server)) {
        throw new BrokerVerificationError('IS_MASTER_ACCOUNT', "This is the platform's master account and cannot be connected as a client.");
      }
      for (const rec of this.clientPool.values()) {
        if (rec.userId !== userId && sameLogin(rec.login, login) && eq(rec.server, server)) {
          throw new BrokerVerificationError('ALREADY_LINKED', 'This broker account is already linked to another user.');
        }
      }

      // One connected account per client keeps profit-share records exact.
      const active = current && current.isBrokerVerified ? current : null;
      if (active) {
        throw new BrokerVerificationError(
          'ALREADY_CONNECTED',
          `You are already connected with account #${active.login}, and it keeps copying trades. To use a different account, disconnect this one from your Profile first. That keeps your records accurate.`
        );
      }

      const all = await api.getAccounts();
      const existing = all.find((a) => a.type !== 'master' && sameLogin(a.login, login) && eq(a.server, server));
      if (existing && !isOwnedBy(existing.name, userId)) {
        throw new BrokerVerificationError(
          'ALREADY_LINKED',
          'This broker account is already linked to another user or to the platform, so it cannot be connected here.'
        );
      }

      let accountId: string;
      let previouslyVerified = false;
      let resumed = false;

      if (existing) {
        // The user's own account from an earlier attempt: reuse it and give it the password they just typed.
        accountId = existing.accountId;
        resumed = true;
        previouslyVerified = this.wasVerified ? (await this.wasVerified(userId, accountId).catch(() => 'unknown')) === 'yes' : false;
        go('creating');
        await api.updateAccount(accountId, { password: params.password, enabled: true });
        await this.freeze(accountId);
      } else {
        const mine = all.filter((a) => a.type !== 'master' && isOwnedBy(a.name, userId));
        if (mine.length) {
          // Leftovers from an earlier attempt that never finished are cleared, so nobody is stuck behind an account they cannot see.
          if (await (this.hasBillingHistory?.(userId).catch(() => true) ?? false)) {
            throw new BrokerVerificationError(
              'ALREADY_CONNECTED',
              `You are already connected with account #${mine[0].login}. To use a different account, disconnect this one from your Profile first.`
            );
          }
          for (const a of mine) await api.deleteAccount(a.accountId);
        }
        const limit = readLimit(process.env.MAX_CLIENT_ACCOUNTS, 0);
        if (limit > 0) {
          const used = countClientAccounts(all) - mine.length + gate.pendingClaimsOf(userId, all.map((a) => ({ id: a.accountId })));
          if (used >= limit) {
            throw new BrokerVerificationError('CAPACITY', 'We have reached our limit for new connections right now. Please contact support to be added.');
          }
        }
        gate.reserve(userId);
        claimed = true;

        const created = await gate.run(
          async () => {
            go('creating');
            return api.addAccount({
              type: 'slave',
              name: clientAccountName(userId, login),
              broker: params.platform === 'mt4' ? 'mt4' : 'mt5',
              login,
              password: params.password,
              server,
              enabled: true,
              group: this.templateId,
              subscription: 'auto',
            });
          },
          () => go('queued')
        );
        createdId = created.accountId;
        accountId = created.accountId;
        gate.attach(userId, accountId);
        // Copying is held until the account is verified: freeze it at once. If that cannot be done, remove the account.
        await this.freeze(accountId);
      }

      const link: PendingLink = {
        userId,
        accountId,
        login,
        server,
        verifiedBefore: previouslyVerified,
        label: 'Connecting to your broker…',
        startedAt: Date.now(),
        deadlineAt: previouslyVerified ? 0 : Date.now() + readLimit(process.env.CONNECT_BACKGROUND_MINUTES, 20) * 60_000,
      };
      this.pending.set(userId, link);

      // --- wait for the broker to answer through the copier service ---
      go('syncing');
      const waitMs = (readLimit(process.env.CONNECT_SYNC_WAIT_SECONDS, 120) || 120) * 1000;
      const everyMs = readLimit(process.env.CONNECT_PROBE_MS, 4000) || 4000;
      const until = Date.now() + waitMs;
      for (;;) {
        const acc = (await api.getAccounts(accountId))[0] ?? null;
        const d = decideLink(acc, link, Date.now(), this.graceMs());
        if (d.action === 'VERIFY') {
          go('verifying');
          return await this.completeConnection(link, acc!);
        }
        if (d.action === 'REJECT') throw this.rejection(d.reason, link, acc);
        if (d.action === 'WAIT') {
          link.label = d.label;
          link.disconnectedSince = d.disconnectedSince;
        }
        if (Date.now() >= until) {
          throw new HandedOff('Still connecting', { stage: 'syncing', ref: 'SYNC_WAIT' });
        }
        await sleepMs(everyMs);
      }
    } catch (error: any) {
      if (error instanceof HandedOff) throw error; // the pending entry stays and is finished in the background

      const safe = translateCopierError(error, { login, server });
      safe.stage = safe.stage || stage;
      console.warn(`⚠️ [COPIER] Connect failed for #${login} at '${stage}' (${safe.code}); raw: ${String(error?.message || error).slice(0, 200)}`);

      const link = this.pending.get(userId);
      if (rejectsForGood.has(safe.code) || !link) {
        // Refused for good (or nothing exists yet): an account created by THIS attempt is removed.
        if (createdId && rejectsForGood.has(safe.code)) await this.api?.deleteAccount(createdId).catch(() => undefined);
        this.pending.delete(userId);
      } else if (safe.code === 'BROKER_SLOW' || safe.code === 'BROKER_UNREACHABLE' || safe.code === 'VERIFICATION_UNAVAILABLE') {
        // The account exists and the delay is not the client's doing: carry on in the background and say so calmly.
        throw new HandedOff(safe.message, { stage: safe.stage as Stage, ref: safe.ref, detail: safe.detail });
      } else {
        this.pending.delete(userId);
      }
      throw safe;
    } finally {
      if (claimed) gate.release(userId);
      this.connecting.delete(userId);
    }
  }

  private rejection(reason: 'TRADING_NOT_ALLOWED' | 'BROKER_AUTH_FAILED' | 'GONE', link: { login: string; server: string }, acc: DuplikiumAccount | null): BrokerVerificationError {
    if (reason === 'TRADING_NOT_ALLOWED') {
      try {
        verifyCopierAccount(acc, link);
      } catch (e) {
        if (e instanceof BrokerVerificationError) return e;
      }
      return new BrokerVerificationError('TRADING_NOT_ALLOWED', 'This login can only view the account. Please use your trading password.');
    }
    if (reason === 'BROKER_AUTH_FAILED') {
      return translateCopierError(new DuplikiumError('API', 'login failed'), link);
    }
    const e = new BrokerVerificationError('BROKER_UNREACHABLE', 'Your account could not be found at the copier service. Please press Connect again.');
    e.ref = 'ACCOUNT_GONE';
    return e;
  }

  /** Freezes copying for an account: nothing may be copied before the account is verified. */
  private async freeze(accountId: string): Promise<void> {
    try {
      await this.api!.setSettings({ idMaster: this.masterId, idSlave: accountId, copierStatus: COPIER.FROZEN });
    } catch (e: any) {
      await this.api!.deleteAccount(accountId).catch(() => undefined);
      this.pending.forEach((p, uid) => {
        if (p.accountId === accountId) this.pending.delete(uid);
      });
      const err = new BrokerVerificationError('VERIFICATION_UNAVAILABLE', 'Account verification is temporarily unavailable. Please try again in a few minutes.');
      err.ref = 'COPY_SETTINGS';
      err.detail = String(e?.message || e).slice(0, 200);
      throw err;
    }
  }

  /** The account is logged in and its figures are real: apply our rules and put it into service. */
  private async completeConnection(link: PendingLink, acc: DuplikiumAccount): Promise<ClientConnectionRecord> {
    const verified = verifyCopierAccount(acc, { login: link.login, server: link.server });
    // Minimum equity applies to NEW connections only; someone reconnecting is never judged again.
    if (!link.verifiedBefore) checkConnectEligibility(verified, this.minEquity());

    const status: 'ACTIVE' | 'IDLE' = link.verifiedBefore ? ((await this.loadSavedStatus?.(link.userId).catch(() => null)) ?? 'ACTIVE') : 'ACTIVE';
    const record = this.buildClientRecord(link, acc, verified, status);
    record.billingBlocked = this.clientPool.get(link.userId)?.billingBlocked;

    // Switch copying on (or leave it held back for a paused / unpaid client) and check that it really took.
    try {
      await this.applyCopyState(record);
    } catch (e: any) {
      const err = new BrokerVerificationError('VERIFICATION_UNAVAILABLE', 'Account verification is temporarily unavailable. Please try again in a few minutes.');
      err.ref = 'COPY_SETTINGS';
      err.detail = String(e?.message || e).slice(0, 200);
      throw err;
    }

    this.registerClient(record);
    this.pending.delete(link.userId);
    this.onClientVerified?.(record);
    if (!link.verifiedBefore) this.onNewConnection?.(link.userId);
    console.log(
      `${link.verifiedBefore ? '♻️' : '✅'} [COPIER] ${link.verifiedBefore ? 'Restored' : 'Connected'} #${record.login} (${record.status}): ${verified.accountType}, equity $${verified.equity.toFixed(2)}`
    );
    return record;
  }

  private buildClientRecord(link: PendingLink, acc: DuplikiumAccount, v: VerifiedBrokerAccount, status: 'ACTIVE' | 'IDLE'): ClientConnectionRecord {
    const now = new Date().toISOString();
    return {
      userId: link.userId,
      accountId: link.accountId,
      login: link.login,
      server: String(acc.server || link.server),
      status,
      balance: v.balance,
      equity: v.equity,
      freeMargin: v.freeMargin,
      currency: v.currency,
      leverage: v.leverage,
      lastSync: now,
      accountHolderName: v.accountHolderName,
      brokerName: v.brokerName,
      isBrokerVerified: true,
      tradeAllowed: v.tradeAllowed,
      investorMode: v.investorMode,
      accountType: v.accountType,
      verificationTimestamp: now,
      connectionState: 'CONNECTED',
      connectionStatus: acc.state || 'CONNECTED',
      lastHeartbeat: toIso(acc.lastUpdate) ?? now,
    };
  }

  /**
   * Called when the browser's overall time limit is reached while the account exists at the copier service:
   * the background check keeps going. Returns false if there is nothing to carry on with.
   */
  public continueInBackground(userId: string): boolean {
    return this.pending.has(userId) && !this.pending.get(userId)!.failure;
  }

  public isConnecting(userId: string): boolean {
    return this.connecting.has(userId);
  }

  // ---------- connections finishing in the background ----------

  private async tickPending(byId: Map<string, DuplikiumAccount>): Promise<void> {
    for (const link of Array.from(this.pending.values())) {
      if (link.failure || this.connecting.has(link.userId)) continue;
      const acc = byId.get(link.accountId) ?? null;
      const d = decideLink(acc, link, Date.now(), this.graceMs());
      try {
        if (d.action === 'VERIFY') {
          await this.completeConnection(link, acc!);
        } else if (d.action === 'WAIT') {
          link.label = d.label;
          link.disconnectedSince = d.disconnectedSince;
        } else if (d.action === 'REJECT') {
          await this.failPending(link, this.rejection(d.reason, link, acc));
        } else {
          const e = new BrokerVerificationError('BROKER_SLOW', 'We could not finish connecting your account in time. Nothing was changed, so please press Connect again.');
          e.ref = 'BACKGROUND_TIMEOUT';
          await this.failPending(link, e);
        }
      } catch (e: any) {
        if (e instanceof BrokerVerificationError) await this.failPending(link, e);
        else console.warn(`⚠️ [COPIER] Pending connection of ${mask(link.userId)} could not be finished:`, e?.message || e);
      }
    }
  }

  private async failPending(link: PendingLink, err: BrokerVerificationError): Promise<void> {
    link.failure = { code: err.code, message: err.message, hint: friendlyHint(err.code), ref: err.ref, at: Date.now() };
    // A new connection that was refused for good leaves nothing behind. A returning client's account is kept.
    if (!link.verifiedBefore && (rejectsForGood.has(err.code) || err.ref === 'BACKGROUND_TIMEOUT' || err.ref === 'ACCOUNT_GONE')) {
      await this.api?.deleteAccount(link.accountId).catch(() => undefined);
    }
    console.warn(`⚠️ [COPIER] Gave up on the pending connection of ${mask(link.userId)} #${link.login} (${err.code}).`);
  }

  /** What the dashboard is told about an unfinished connection. */
  public pendingView(userId: string): PendingView | null {
    const p = this.pending.get(userId);
    if (!p) return null;
    if (p.failure) {
      // A failure notice is kept for an hour.
      if (Date.now() - p.failure.at > 3_600_000) {
        this.pending.delete(userId);
        return null;
      }
      return { kind: 'failed', label: 'Could not connect', login: p.login, server: p.server, error: { code: p.failure.code, message: p.failure.message, hint: p.failure.hint, ref: p.failure.ref } };
    }
    const view: PendingView = { kind: 'working', label: p.label, login: p.login, server: p.server };
    if (p.deadlineAt > 0) view.minutesLeft = Math.max(0, Math.ceil((p.deadlineAt - Date.now()) / 60_000));
    return view;
  }

  // ---------- bringing clients back after a restart ----------

  /**
   * Looks through the account list for clients' accounts that are not in memory (after a restart) and puts
   * them back. Anything not yet verified is finished in the background. Nothing is put into service without
   * the broker's own answer.
   */
  private async restoreFromList(accounts: DuplikiumAccount[], onlyUserId?: string): Promise<void> {
    for (const acc of accounts) {
      if (acc.type === 'master' || acc.accountId === this.masterId) continue;
      const owner = parseClientAccountName(acc.name);
      if (!owner || (onlyUserId && owner.userId !== onlyUserId)) continue;
      if (this.clientPool.has(owner.userId) || this.pending.has(owner.userId) || this.connecting.has(owner.userId)) continue;

      const was = this.wasVerified ? await this.wasVerified(owner.userId, acc.accountId).catch(() => 'unknown' as const) : 'unknown';
      // Anyone in doubt is treated as already connected, so nobody is judged by the new-connection rules by mistake.
      const verifiedBefore = was !== 'no';
      const link: PendingLink = {
        userId: owner.userId,
        accountId: acc.accountId,
        login: owner.login,
        server: acc.server,
        verifiedBefore,
        label: 'Connecting to your broker…',
        startedAt: Date.now(),
        deadlineAt: verifiedBefore ? 0 : Date.now() + 20 * 60_000,
      };
      const d = decideLink(acc, link, Date.now(), this.graceMs());
      try {
        if (d.action === 'VERIFY') await this.completeConnection(link, acc);
        else this.pending.set(owner.userId, link);
      } catch (e: any) {
        if (e instanceof BrokerVerificationError) {
          this.pending.set(owner.userId, link);
          await this.failPending(link, e);
        } else {
          console.warn(`⚠️ [COPIER] Could not restore ${mask(owner.userId)}:`, e?.message || e);
          this.pending.set(owner.userId, link);
        }
      }
    }
  }

  public async rehydrateClients(): Promise<void> {
    if (!this.api) return;
    await this.restoreFromList(await this.api.getAccounts());
  }

  /**
   * Called when a signed-in client opens the dashboard but is not in memory (for example the server restarted
   * and the first restore has not finished). Looks for their account at the copier service.
   */
  public async restoreClientForUser(userId: string): Promise<ClientConnectionRecord | undefined> {
    const existing = this.clientPool.get(userId);
    if (existing) return existing;
    if (!this.api || this.connecting.has(userId) || this.pending.has(userId)) return undefined;
    const last = this.lastLazyRestore.get(userId) || 0;
    if (Date.now() - last < 30_000) return undefined;
    this.lastLazyRestore.set(userId, Date.now());
    try {
      const list = this.lastRefreshAt && Date.now() - this.lastRefreshAt < 30_000 ? this.lastAccounts : await this.api.getAccounts();
      await this.restoreFromList(list, userId);
    } catch (err: any) {
      console.warn('⚠️ [COPIER] Lazy restore failed:', err?.message);
    }
    return this.clientPool.get(userId);
  }

  // ---------- disconnecting ----------

  /**
   * Removes a user's account from the copier service and stops copying to it. Only accounts created for this
   * user are touched; the master and other users are never affected.
   */
  public async removeClientTerminal(userId: string): Promise<{ removed: number }> {
    if (!userId) return { removed: 0 };
    let removed = 0;
    if (this.api) {
      let all: DuplikiumAccount[];
      try {
        all = await this.api.getAccounts();
      } catch {
        throw new BrokerVerificationError('BROKER_UNREACHABLE', 'Could not disconnect the account right now. Please try again.');
      }
      const known = this.clientPool.get(userId)?.accountId;
      const targets = all.filter(
        (a) => a.type !== 'master' && a.accountId !== this.masterId && (isOwnedBy(a.name, userId) || (known && a.accountId === known))
      );
      for (const a of targets) {
        try {
          await this.api.deleteAccount(a.accountId);
          removed++;
        } catch (err: any) {
          console.warn('⚠️ [COPIER] Could not remove account', a.accountId, err?.message);
          throw new BrokerVerificationError('BROKER_UNREACHABLE', 'Could not disconnect the account right now. Please try again.');
        }
      }
    }
    this.dropFromPool(userId);
    this.pending.delete(userId);
    this.tradesCache.delete(userId);
    return { removed };
  }

  // ---------- pause / resume ----------

  /**
   * Switches copying on or off for a client at the copier service, and says whether it really changed.
   * ON copies everything; a paused (or unpaid) client is set to "close only", so positions already open keep
   * following the master's closes and nothing is left stranded, while no new trades are opened.
   */
  private async applyCopyState(rec: ClientConnectionRecord): Promise<void> {
    if (!this.api) throw new DuplikiumError('NOT_CONFIGURED', 'The copier service is not connected.');
    const want = desiredCopierStatus(rec);
    const risk = await this.riskSettings();
    await this.api.setSettings({ idMaster: this.masterId, idSlave: rec.accountId, copierStatus: want, ...risk });
    const rows = await this.api.getSettings({ idMaster: this.masterId, idSlave: rec.accountId });
    const got = rows.find((r) => r.idSlave === rec.accountId)?.copierStatus;
    if (got !== want) throw new DuplikiumError('API', `Copier status did not change (wanted ${want}, service reports ${got ?? 'nothing'}).`);
    rec.copyApplied = want;
  }

  /** The copy size set on Render (DUPLIKIUM_RISK_TYPE and DUPLIKIUM_RISK_VALUE), or null when it is not set. */
  private envCopySize(): { riskFactorType: number; riskFactorValue: number } | null {
    const envType = process.env.DUPLIKIUM_RISK_TYPE;
    const envValue = process.env.DUPLIKIUM_RISK_VALUE;
    if (envType !== undefined && envType !== '' && envValue !== undefined && envValue !== '') {
      const t = Number(envType);
      const v = Number(envValue);
      if (Number.isFinite(t) && Number.isFinite(v)) return { riskFactorType: t, riskFactorValue: v };
    }
    return null;
  }

  /** The copy size settings every client gets: from the environment if set, otherwise the template's own. */
  private async riskSettings(): Promise<{ riskFactorType?: number; riskFactorValue?: number }> {
    const fromEnv = this.envCopySize();
    if (fromEnv) return fromEnv;
    if (this.templateCache && Date.now() - this.templateCache.at < 300_000) {
      return { riskFactorType: this.templateCache.type, riskFactorValue: this.templateCache.value };
    }
    try {
      const rows = await this.api!.getSettings({ idGroup: this.templateId });
      const row = rows.find((r) => r.idMaster === this.masterId) ?? rows.find((r) => !r.idMaster) ?? rows[0];
      this.templateCache = { at: Date.now(), type: row?.riskFactorType ?? undefined, value: row?.riskFactorValue ?? undefined };
    } catch {
      this.templateCache = { at: Date.now() };
    }
    return { riskFactorType: this.templateCache.type, riskFactorValue: this.templateCache.value };
  }

  /** Pause or resume copying for a client. Throws if the copier service did not accept the change. */
  public async setCopyStatus(identifier: string, status: 'ACTIVE' | 'IDLE'): Promise<ClientConnectionRecord | undefined> {
    const rec = this.findRecord(identifier);
    if (!rec) return undefined;
    const before = rec.status;
    rec.status = status;
    try {
      await this.applyCopyState(rec);
    } catch (e) {
      rec.status = before;
      throw e;
    }
    rec.lastSync = new Date().toISOString();
    this.registerClient(rec);
    return rec;
  }

  /**
   * Makes the copier service match what each client should have. One read of all copy settings, then a change
   * only where they differ. Runs at start-up and every few minutes; it also catches changes that failed earlier.
   */
  private async reconcileCopyState(force: boolean): Promise<void> {
    if (!this.api || !this.masterId || this.reconciling) return;
    if (!force && Date.now() - this.lastReconcileAt < 5 * 60_000) return;
    this.reconciling = true;
    this.lastReconcileAt = Date.now();
    try {
      const rows = await this.api.getSettings({ idMaster: this.masterId });
      const bySlave = new Map<string, number | null>();
      for (const r of rows) if (r.idSlave) bySlave.set(r.idSlave, r.copierStatus);
      const seen = new Set<string>();
      for (const rec of Array.from(this.clientPool.values())) {
        if (seen.has(rec.accountId) || !rec.isBrokerVerified) continue;
        seen.add(rec.accountId);
        if (bySlave.get(rec.accountId) === desiredCopierStatus(rec)) {
          rec.copyApplied = desiredCopierStatus(rec);
          continue;
        }
        try {
          await this.applyCopyState(rec);
        } catch (e: any) {
          console.warn(`⚠️ [COPIER] Could not set copying for ${mask(rec.userId)}: ${String(e?.message || e).slice(0, 160)}`);
        }
      }
    } catch (e: any) {
      console.warn('⚠️ [COPIER] Copy settings could not be read:', String(e?.message || e).slice(0, 160));
    } finally {
      this.reconciling = false;
    }
  }

  public setBillingBlocked(userId: string, blocked: boolean): void {
    for (const rec of this.clientPool.values()) {
      if (rec.userId === userId) rec.billingBlocked = blocked;
    }
    // Held-back copying is applied at the service now (and retried by the periodic check if it fails).
    const rec = this.clientPool.get(userId);
    if (rec && this.api && rec.copyApplied !== desiredCopierStatus(rec)) {
      void this.applyCopyState(rec).catch((e: any) =>
        console.warn(`⚠️ [COPIER] Could not ${blocked ? 'hold back' : 'resume'} copying for ${mask(userId)}: ${String(e?.message || e).slice(0, 160)}`)
      );
    }
  }

  // ---------- the pool ----------

  private findRecord(identifier: string): ClientConnectionRecord | undefined {
    const direct = this.clientPool.get(identifier);
    if (direct) return direct;
    for (const rec of this.clientPool.values()) {
      if (rec.userId === identifier || rec.accountId === identifier || rec.login === identifier) return rec;
    }
    return undefined;
  }

  public getAllClientRecords(): ClientConnectionRecord[] {
    return Array.from(this.clientPool.values());
  }

  public getClientConnection(identifier: string): ClientConnectionRecord | undefined {
    return this.clientPool.get(identifier);
  }

  /** Register or update a client record in the memory pool. */
  public registerClient(record: ClientConnectionRecord): void {
    // Only accounts the broker itself has verified may ever enter the pool.
    if (!record.isBrokerVerified) {
      throw new BrokerVerificationError('BAD_BROKER_RESPONSE', 'Refusing to register an account the broker has not verified.');
    }
    if (!record.connectionState) record.connectionState = 'CONNECTED';
    if (!record.lastHeartbeat) record.lastHeartbeat = new Date().toISOString();
    this.clientPool.set(record.userId, record);
    this.clientPool.set(record.accountId, record);
    try {
      this.onClientSaved?.(record);
    } catch {
      // saving is best-effort
    }
  }

  /** Clients whose copying is on. */
  public getActiveClients(): ClientConnectionRecord[] {
    const unique = new Map<string, ClientConnectionRecord>();
    for (const record of this.clientPool.values()) {
      if (record.status === 'ACTIVE' && record.isBrokerVerified && !record.billingBlocked) unique.set(record.userId, record);
    }
    return Array.from(unique.values());
  }

  /** Re-reads one client's figures from the copier service (at most every 15 seconds per client). */
  public async refreshClientFromBroker(identifier: string): Promise<ClientConnectionRecord | null> {
    const rec = this.findRecord(identifier);
    if (!rec) return null;
    if (!this.api) return rec;
    if (Date.now() - Date.parse(rec.lastSync || '') < 15_000) return rec;
    try {
      const acc = (await this.api.getAccounts(rec.accountId))[0];
      this.applyAccountToClient(rec, acc, false);
    } catch (e: any) {
      console.warn(`⚠️ [COPIER] Could not refresh #${rec.login}:`, String(e?.message || e).slice(0, 160));
    }
    return rec;
  }

  // ---------- trades ----------

  /** The master's open positions (cached for a few seconds, so many dashboards cost the service one call). */
  public async getMasterTrades(): Promise<MasterTrade[]> {
    if (!this.api || !this.masterId) throw new DuplikiumError('NOT_CONFIGURED', 'The copier service is not connected.');
    if (this.masterTradesCache && Date.now() - this.masterTradesCache.at < 10_000) return this.masterTradesCache.trades;
    const res = await this.api.getOpenPositions(this.masterId);
    const trades = res.positions.map((p) => ({ id: p.id, symbol: p.symbol, side: p.side, volume: p.volume, openPrice: p.openPrice, openedAt: p.openTime }));
    this.masterTradesCache = { at: Date.now(), trades };
    return trades;
  }

  /** A client's own open and closed trades, as the copier service reports them. */
  public async getClientTrades(userId: string): Promise<ClientTrades | null> {
    const rec = this.clientPool.get(userId);
    if (!rec || !this.api) return null;
    const c = this.tradesCache.get(userId);
    const now = Date.now();
    const freshOpen = c && now - c.openAt < 15_000;
    const freshClosed = c && now - c.closedAt < 60_000;
    let open = c?.data.open ?? [];
    let closed = c?.data.closed ?? [];
    if (!freshOpen) open = (await this.api.getOpenPositions(rec.accountId)).positions;
    if (!freshClosed) closed = (await this.api.getClosedPositions(rec.accountId)).positions;
    this.tradesCache.set(userId, { at: now, openAt: freshOpen ? c!.openAt : now, closedAt: freshClosed ? c!.closedAt : now, data: { open, closed } });
    return { open, closed };
  }

  // ---------- administrator views ----------

  /** Admin view of how many client accounts exist at the copier service versus the limit. */
  public async getCapacity(): Promise<{ used: number; limit: number; perUserLimit: number }> {
    const limit = readLimit(process.env.MAX_CLIENT_ACCOUNTS, 0);
    const perUserLimit = readLimit(process.env.MAX_ACCOUNTS_PER_USER, 1);
    if (!this.api) return { used: 0, limit, perUserLimit };
    let all = this.lastAccounts;
    try {
      all = await this.api.getAccounts();
      this.lastAccounts = all;
    } catch {
      // fall back to the last list we read
    }
    return { used: countClientAccounts(all), limit, perUserLimit };
  }

  /** Every client account at the copier service and what we are doing about it. The master is never listed. */
  public async listCopierAccounts(): Promise<
    Array<{
      accountId: string;
      userId: string;
      login: string;
      server: string;
      state: string;
      enabled: boolean;
      balance: number | null;
      equity: number | null;
      live: boolean;
      tracked: 'PENDING' | 'FAILED' | null;
      copyApplied?: number;
    }>
  > {
    if (!this.api) throw new DuplikiumError('NOT_CONFIGURED', 'The copier service is not connected.');
    const all = await this.api.getAccounts();
    this.lastAccounts = all;
    const rows = [];
    for (const a of all) {
      if (a.type === 'master' || a.accountId === this.masterId) continue;
      const owner = parseClientAccountName(a.name);
      if (!owner) continue;
      const rec = this.clientPool.get(owner.userId);
      const p = this.pending.get(owner.userId);
      rows.push({
        accountId: a.accountId,
        userId: owner.userId,
        login: a.login || owner.login,
        server: a.server,
        state: a.state,
        enabled: a.enabled,
        balance: a.balance,
        equity: a.equity,
        live: Boolean(rec && rec.accountId === a.accountId && rec.isBrokerVerified),
        tracked: p ? (p.failure ? ('FAILED' as const) : ('PENDING' as const)) : null,
        copyApplied: rec?.copyApplied,
      });
    }
    return rows;
  }

  /** Removes one client account from the copier service. A connected client's account needs `force`. */
  public async removeCopierAccount(accountId: string, force: boolean): Promise<{ ok: boolean; reason?: 'NOT_FOUND' | 'PROTECTED' | 'NOT_A_CLIENT' }> {
    if (!this.api) throw new DuplikiumError('NOT_CONFIGURED', 'The copier service is not connected.');
    if (!accountId || accountId === this.masterId) return { ok: false, reason: 'NOT_A_CLIENT' };
    const all = await this.api.getAccounts();
    const a = all.find((x) => x.accountId === accountId);
    if (!a) return { ok: false, reason: 'NOT_FOUND' };
    const owner = parseClientAccountName(a.name);
    if (a.type === 'master' || !owner) return { ok: false, reason: 'NOT_A_CLIENT' };
    const live = this.clientPool.get(owner.userId)?.accountId === accountId;
    const billed = this.hasBillingHistory ? await this.hasBillingHistory(owner.userId).catch(() => true) : false;
    if ((live || billed) && !force) return { ok: false, reason: 'PROTECTED' };
    await this.api.deleteAccount(accountId);
    if (this.clientPool.get(owner.userId)?.accountId === accountId) this.dropFromPool(owner.userId);
    this.pending.delete(owner.userId);
    return { ok: true };
  }

  public async retryMasterConnection(): Promise<{ success: boolean; mode: string; message: string }> {
    if (!this.api) {
      return { success: false, mode: 'OFFLINE', message: 'DUPLIKIUM_API_USER and DUPLIKIUM_API_TOKEN are not set.' };
    }
    if (!this.masterId) return { success: false, mode: 'OFFLINE', message: 'DUPLIKIUM_MASTER_ID is not set.' };
    const ok = await this.refreshAll();
    return ok
      ? { success: true, mode: 'LIVE_DUPLIKIUM', message: 'The master account is connected at the copier service.' }
      : { success: false, mode: this.masterState, message: this.masterNote || this.serviceError || 'The master account is not connected at the copier service.' };
  }

  /**
   * The administrator's connection check: signs in, finds the master, reads the template, and asks for the
   * master's open positions. Every step says what was found. Secrets are never included.
   */
  public async runConnectionCheck(): Promise<{ ok: boolean; steps: CheckStep[] }> {
    const steps: CheckStep[] = [];
    const add = (name: string, ok: boolean, detail: string, lines?: string[]) =>
      steps.push(lines && lines.length ? { name, ok, detail, lines } : { name, ok, detail });

    const user = Boolean((process.env.DUPLIKIUM_API_USER || '').trim());
    const token = Boolean((process.env.DUPLIKIUM_API_TOKEN || '').trim());
    add('Settings on the server', user && token && Boolean(this.masterId) && Boolean(this.templateId), [
      `API user ${user ? 'set' : 'MISSING'}`,
      `API password ${token ? 'set' : 'MISSING'}`,
      `master id ${this.masterId ? 'set' : 'MISSING'}`,
      `template id ${this.templateId ? 'set' : 'MISSING'}`,
    ].join(', '));
    if (!this.api) return { ok: false, steps };

    try {
      if (this.api instanceof DuplikiumClient) {
        const s = await this.api.signIn();
        add('Sign in to the copier service', true, `Accepted. The access token is valid until ${s.expiresAt}.`);
      } else {
        add('Sign in to the copier service', true, 'Accepted.');
      }
    } catch (e: any) {
      add('Sign in to the copier service', false, e instanceof DuplikiumError && e.kind === 'AUTH' ? 'Duplikium did not accept the API user and password.' : String(e?.message || e));
      return { ok: false, steps };
    }

    let accounts: DuplikiumAccount[] = [];
    try {
      accounts = await this.api.getAccounts();
      this.lastAccounts = accounts;
      add('Read accounts', true, `${accounts.length} account(s) found, ${countClientAccounts(accounts)} of them clients.`);
    } catch (e: any) {
      add('Read accounts', false, String(e?.message || e));
      return { ok: false, steps };
    }

    // What the administrator can choose from, so the master and template ids do not have to be hunted for.
    // Only accounts that are not client accounts of ours are listed; ids are not secrets, passwords are never read.
    const choices = accounts.filter((a) => !isPlatformClientAccount(a.name));
    const CAP = 30;
    add(
      'Accounts you can choose from',
      true,
      choices.length
        ? 'Use the id of your master account as DUPLIKIUM_MASTER_ID. Each line: id | login on server | type | name | template.'
        : 'Nothing besides client accounts was found. Add your master account at Duplikium first.',
      choices
        .slice(0, CAP)
        .map((a) => `${a.accountId} | #${a.login || '?'} on ${a.server || '?'} | ${a.type} | ${a.name || 'no name'} | ${a.groupId ? `template ${a.groupId}` : 'no template'}`)
        .concat(choices.length > CAP ? [`...and ${choices.length - CAP} more not shown`] : [])
    );
    // Template ids come from the accounts that use them. A template no account uses yet cannot be seen this way.
    const byTemplate = new Map<string, string[]>();
    for (const a of accounts) {
      if (!a.groupId) continue;
      const label = isPlatformClientAccount(a.name) ? 'a client account' : `#${a.login || '?'} ${a.name || ''}`.trim();
      byTemplate.set(a.groupId, [...(byTemplate.get(a.groupId) ?? []), label]);
    }
    add(
      'Templates in use',
      true,
      byTemplate.size
        ? 'Use the id of the template your clients should get as DUPLIKIUM_TEMPLATE_ID.'
        : 'No account uses a template yet, so none can be listed here. Put one account on your default template in the Duplikium cockpit, run the check again, or ask Duplikium support for the template id.',
      Array.from(byTemplate.entries())
        .slice(0, CAP)
        .map(([id, who]) => {
          const clients = who.filter((w) => w === 'a client account').length;
          const others = who.filter((w) => w !== 'a client account');
          return `${id} | used by ${[...others.slice(0, 3), ...(clients ? [`${clients} client account(s)`] : [])].join(', ')}${others.length > 3 ? ' and others' : ''}`;
        })
    );

    const master = accounts.find((a) => a.accountId === this.masterId);
    if (!this.masterId) {
      add('Master account', false, 'DUPLIKIUM_MASTER_ID is not set yet. Choose your master account from the list above.');
    } else if (!master) {
      add('Master account', false, 'No account with the id in DUPLIKIUM_MASTER_ID was found. Compare it with the list above.');
    } else {
      const kind = classifyState(master.state);
      add(
        'Master account',
        master.type === 'master' && kind === 'connected' && master.enabled,
        [
          `#${master.login || '?'} on ${master.server || '?'}`,
          `type ${master.type}`,
          `state ${master.state || 'NONE'}`,
          master.enabled ? 'enabled' : 'DISABLED',
          master.balance !== null ? `balance ${master.balance}` : 'balance not reported yet',
          master.equity !== null ? `equity ${master.equity}` : 'equity not reported yet',
        ].join(', ')
      );
    }

    if (!this.templateId) {
      add('Client template', false, 'DUPLIKIUM_TEMPLATE_ID is not set yet. Choose the template from the list above.');
    } else try {
      const rows = await this.api.getSettings({ idGroup: this.templateId });
      if (!rows.length) {
        add('Client template', false, 'The template has no copy settings. Open it in the Duplikium cockpit and set the copy size you want clients to get.');
      } else {
        const r = rows.find((x) => x.idMaster === this.masterId) ?? rows[0];
        add(
          'Client template',
          r.riskFactorType !== null && r.riskFactorValue !== null,
          `copier status ${r.copierStatus ?? '?'}, copy size type ${r.riskFactorType ?? '?'}, value ${r.riskFactorValue ?? '?'}. Every client gets this copy size.`
        );
      }
    } catch (e: any) {
      add('Client template', false, String(e?.message || e));
    }

    if (this.masterId) {
      try {
        const res = await this.api.getOpenPositions(this.masterId);
        const first = res.positions[0];
        add(
          'Master open trades',
          true,
          `${res.positions.length} open trade(s) read${res.skipped ? `, ${res.skipped} could not be read` : ''}.` +
            (first ? ` First: ${first.side} ${first.volume} ${first.symbol}, opened "${first.rawOpenTime ?? 'no time'}" (check this matches your master's time zone).` : ' None open right now, so the trade format is not yet confirmed.')
        );
      } catch (e: any) {
        add('Master open trades', false, `${String(e?.message || e)} Trades will not show on the dashboard until this works.`);
      }
    }

    return { ok: steps.every((s) => s.ok), steps };
  }

  // ---------- getters ----------

  /**
   * Net deposits minus withdrawals (and credits) on a client's account between two moments, or null when they
   * cannot be known. Duplikium's API has not been confirmed to give balance operations, so this is null for now and
   * profit-share invoices are NOT created: billing profit without knowing the money paid in or out would be wrong
   * (a deposit would be billed as profit). Subscription clients are not affected.
   */
  public async getAccountFlows(_userId: string, _from: Date, _to: Date): Promise<number | null> {
    return null;
  }

  public getMasterMetrics(): MasterAccountMetrics {
    return { ...this.masterMetrics };
  }

  public isConnected(): boolean {
    return this.masterState === 'CONNECTED';
  }

  /** Why the master is not connected (for the administrator), or an empty string. */
  public getMasterNote(): string {
    return this.masterNote || this.serviceError;
  }
}

export default Mt5ConnectionManager;
