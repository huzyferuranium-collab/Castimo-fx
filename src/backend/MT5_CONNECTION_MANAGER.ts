/**
 * CASTIMOFX - Institutional MetaTrader 5 Connection Manager
 * 
 * Production-grade connection service for MetaApi SDK.
 * Handles Master Terminal streaming WebSocket connection, auto-reconnects,
 * health checks, latency monitoring, and provisioning new client terminals.
 * 
 * Includes billing & quota detection (e.g. MetaApi top-up requirements). When the master cannot connect, it says so;
 * nothing is simulated or invented.
 */

import MetaApi, {
  type MetaApiInstance,
  type MetatraderAccount,
  type StreamingMetaApiConnectionInstance,
  type RpcMetaApiConnectionInstance,
} from './metaapiClient';
import { connectClient, HandedOff, ProvisionGate, type BridgeDeps, type Stage } from './clientBridge';
import { metaApiGateway } from './metaApiGateway';
import { checkClientHealth, newHealthState, type HealthState } from './clientHealth';
import { TerminalSupervisor, type VerifiedClient } from './terminalSupervisor';
import { MemoryConnectionStore, type ConnectionStore } from './connectionStore';
import {
  BrokerVerificationError,
  clientAccountName,
  isOwnedBy,
  sameLogin,
  translateBrokerError,
  validateSubmittedCredentials,
  normalizeBrokerServer,
  pickServerAlias,
  countClientAccounts,
  readLimit,
  DEFAULT_MIN_CONNECT_EQUITY,
  type VerifiedBrokerAccount,
} from './brokerVerification';

/** Rejects if the promise takes longer than ms. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

export interface ProvisionClientParams {
  userId: string;
  login: string;
  password: string;
  server: string;
  magic?: number;
  platform?: 'mt4' | 'mt5';
  region?: string;
  reliability?: 'regular' | 'high';
}

export interface ClientConnectionRecord {
  userId: string;
  accountId: string;
  login: string;
  server: string;
  status: 'ACTIVE' | 'IDLE' | 'ERROR' | 'PROVISIONING';
  account?: MetatraderAccount;
  rpcConnection?: RpcMetaApiConnectionInstance;
  balance: number;
  equity: number;
  freeMargin: number;
  currency: string;
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
  /** True while the client has an overdue profit-share invoice: copying is paused. */
  billingBlocked?: boolean;
  /** Link health, reported the same way as the master's: state, MetaApi's own status, latency, last heartbeat. */
  connectionState?: ConnectionState;
  connectionStatus?: string;
  latencyMs?: number;
  lastHeartbeat?: string;
  /** Internal bookkeeping for the health checker; never sent to the browser. */
  health?: HealthState;
}

export type ConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'ERROR';

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

export interface TopUpNotice {
  required: boolean;
  accountId?: string;
  accountName?: string;
  message: string;
  topUpUrl: string;
}

export class Mt5ConnectionManager {
  private static instance: Mt5ConnectionManager | null = null;
  private api: MetaApiInstance | null = null;
  private apiToken: string = '';
  
  // Master Terminal State
  private masterAccountId: string = '';
  private masterAccount: MetatraderAccount | null = null;
  private masterStreamingConnection: StreamingMetaApiConnectionInstance | null = null;
  private masterRpcConnection: RpcMetaApiConnectionInstance | null = null;
  private masterState: ConnectionState = 'DISCONNECTED';
  private topUpNotice: TopUpNotice | null = null;

  private masterMetrics: MasterAccountMetrics = {
    accountId: 'eac52c91-a258-4aed-97de-4d7cd83a405a',
    login: '261089492',
    server: 'HFMarketsGlobal-Live20',
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

  // Client Connections Pool (keyed by userId or accountId)
  private clientPool: Map<string, ClientConnectionRecord> = new Map();
  /** Called whenever a client's broker account is verified or restored (used to open the billing ledger). */
  public onClientVerified: ((record: ClientConnectionRecord) => void) | null = null;
  /** Called whenever a client's record is saved to the pool (connect, pause, resume). */
  public onClientSaved: ((record: ClientConnectionRecord) => void) | null = null;
  /** Looks up the pause/resume choice the client last made. */
  public loadSavedStatus: ((userId: string) => Promise<'ACTIVE' | 'IDLE' | null>) | null = null;
  /** True if the user has billing history; their terminals are then never cleaned up automatically. */
  public hasBillingHistory: ((userId: string) => Promise<boolean>) | null = null;
  /**
   * Whether this very terminal was verified for the user in the past, according to what we saved:
   * 'yes', 'no' (sure it was not), or 'unknown'. Anyone in doubt is treated as already connected.
   */
  public wasVerified: ((userId: string, accountId: string) => Promise<'yes' | 'no' | 'unknown'>) | null = null;
  /** Called once when a NEW connection completes (from the browser or in the background). */
  public onNewConnection: ((userId: string) => void) | null = null;
  private lastLazyRestore = new Map<string, number>();

  /** Looks after terminals that are not yet (or no longer) a verified, live connection. */
  private supervisor: TerminalSupervisor | null = null;
  /** Where unfinished connections are remembered, so a restart loses nothing. Memory-only until set. */
  private connectionStore: ConnectionStore = new MemoryConnectionStore();
  /** Keeps a burst of clients from overloading MetaApi and from overshooting the account limit. */
  private provisionGate = new ProvisionGate(readLimit(process.env.CONNECT_MAX_PARALLEL, 3));
  /** Users whose connection, started from the browser, is running right now. */
  private connecting = new Set<string>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectIntervalMs = 5000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.apiToken = process.env.METAAPI_TOKEN || process.env.VITE_METAAPI_TOKEN || '';
    this.masterAccountId = process.env.MASTER_ACCOUNT_ID || process.env.VITE_MASTER_ACCOUNT_ID || '';
  }

  public static getInstance(): Mt5ConnectionManager {
    if (!Mt5ConnectionManager.instance) {
      Mt5ConnectionManager.instance = new Mt5ConnectionManager();
    }
    return Mt5ConnectionManager.instance;
  }

  /**
   * Helper to detect MetaApi billing or account quota errors (e.g. top-up required)
   */
  private isTopUpRequiredError(error: any): boolean {
    const msg = (error?.message || '').toLowerCase();
    return (
      msg.includes('top up your account') ||
      msg.includes('top up') ||
      msg.includes('insufficient funds') ||
      msg.includes('payment required') ||
      (error?.status === 403 && msg.includes('deployment')) ||
      error?.status === 402
    );
  }

  /**
   * Updates real-time account metrics directly from streaming events (zero-latency)
   */
  public updateMasterAccountMetrics(info: {
    balance?: number;
    equity?: number;
    freeMargin?: number;
    marginLevel?: number;
    currency?: string;
    leverage?: number;
  }): void {
    if (info.balance != null) this.masterMetrics.balance = Number(info.balance);
    if (info.equity != null) this.masterMetrics.equity = Number(info.equity);
    if (info.freeMargin != null) this.masterMetrics.freeMargin = Number(info.freeMargin);
    if (info.marginLevel != null) this.masterMetrics.marginLevel = Number(info.marginLevel);
    if (info.currency) this.masterMetrics.currency = info.currency;
    if (info.leverage != null) this.masterMetrics.leverage = Number(info.leverage);
    this.masterMetrics.lastHeartbeat = new Date().toISOString();
  }

  public updateMasterPositionsCount(count: number): void {
    this.masterMetrics.openPositionsCount = count;
  }

  public handleMasterDisconnected(): void {
    console.warn('⚠️ [MT5_CONNECTION_MANAGER] Master streaming connection dropped. Allowing MetaApi SDK automatic session recovery...');
    this.masterState = 'RECONNECTING';
    this.masterMetrics.state = 'RECONNECTING';
    this.scheduleMasterFallbackRecovery(25000);
  }

  public handleMasterConnected(): void {
    console.log('✅ [MT5_CONNECTION_MANAGER] Master streaming connection restored.');
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.masterState = 'CONNECTED';
    this.masterMetrics.state = 'CONNECTED';
    this.reconnectAttempts = 0;
    this.refreshMasterAccountMetrics().catch(() => {});
  }

  /**
   * The master terminal cannot be reached. Nothing is made up: the state says so and no figures are invented.
   */
  private markMasterUnavailable(accountId: string, reason: string): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.masterState = 'ERROR';
    this.masterMetrics.state = 'ERROR';
    this.masterMetrics.connectionStatus = 'DISCONNECTED';
    if (accountId) this.masterMetrics.accountId = accountId;
    console.error(`❌ [MT5_CONNECTION_MANAGER] The master terminal is not connected: ${reason}`);
  }

  /**
   * Initialize MetaApi SDK client
   */
  public async initialize(customToken?: string, customMasterAccountId?: string): Promise<boolean> {
    try {
      if (customToken) this.apiToken = customToken;
      if (customMasterAccountId) this.masterAccountId = customMasterAccountId;

      if (!this.apiToken) {
        this.markMasterUnavailable(this.masterAccountId, 'no METAAPI_TOKEN is set, so there is no live connection.');
        this.startHeartbeatMonitor();
        return false;
      }

      console.log('🚀 [MT5_CONNECTION_MANAGER] Initializing MetaApi SDK...');
      try {
        if (typeof (MetaApi as any)?.enableLog4jsLogging === 'function') {
          (MetaApi as any).enableLog4jsLogging();
        }
      } catch {
        // Ignored
      }

      this.api = new MetaApi(this.apiToken, {
        requestTimeout: 60,
        connectTimeout: 60,
        retryOpts: {
          retries: 5,
          minDelayInSeconds: 1,
          maxDelayInSeconds: 15,
        },
        useSharedClientApi: true,
      });

      if (this.masterAccountId) {
        await this.connectMasterTerminal(this.masterAccountId);
      }

      this.startHeartbeatMonitor();
      // Bring back clients that were connected before a restart, and carry on with any connection that was
      // still in progress (their MetaApi terminals still exist and their records were saved).
      void this.startSupervisor();
      return true;
    } catch (error: any) {
      console.error('❌ [MT5_CONNECTION_MANAGER] Initialization failed:', error?.message || error);
      this.masterState = 'ERROR';
      this.masterMetrics.state = 'ERROR';
      this.scheduleMasterFallbackRecovery(15000);
      return false;
    }
  }

  /**
   * Keep an active WebSocket streaming synchronization connection open for Master MT5 account
   */
  public async connectMasterTerminal(accountId: string): Promise<StreamingMetaApiConnectionInstance | null> {
    if (!this.api) {
      console.warn('⚠️ [MT5_CONNECTION_MANAGER] MetaApi client not initialized. Call initialize() first.');
      this.markMasterUnavailable(accountId, 'the MetaApi client is not initialised.');
      return null;
    }

    try {
      this.masterState = 'CONNECTING';
      this.masterMetrics.state = 'CONNECTING';
      this.masterAccountId = accountId;

      console.log(`🔌 [MT5_CONNECTION_MANAGER] Fetching Master Account: ${accountId}`);
      this.masterAccount = await this.api.metatraderAccountApi.getAccount(accountId);
      if (!this.masterAccount) {
        throw new Error(`Master account ${accountId} could not be resolved from MetaApi.`);
      }

      // Check if deployment is needed
      if (this.masterAccount.state !== 'DEPLOYED') {
        console.log(`⏳ [MT5_CONNECTION_MANAGER] Checking deployment for Master Account ${accountId} (current state: ${this.masterAccount.state})...`);
        try {
          await this.masterAccount.deploy();
          await this.masterAccount.waitDeployed(300, 2000);
        } catch (deployErr: any) {
          if (this.isTopUpRequiredError(deployErr)) {
            console.warn(
              `⚠️ [MT5_CONNECTION_MANAGER] MetaApi cloud deployment requires account top-up (Account: ${accountId}, Name: ${this.masterAccount?.name || 'Castimo-fx'}). The master stays disconnected until it is topped up.`
            );
            this.topUpNotice = {
              required: true,
              accountId,
              accountName: this.masterAccount?.name || 'Castimo-fx',
              message:
                'MetaApi Cloud requires an account top-up to deploy live cloud terminals. Copying from the master is paused until then.',
              topUpUrl: 'https://app.metaapi.cloud',
            };
            this.markMasterUnavailable(accountId, 'MetaApi needs a top-up to deploy the terminal.');
            return null;
          }
          throw deployErr;
        }
      }

      // Clean up any existing connection handles before establishing new session
      if (this.masterStreamingConnection) {
        try {
          await this.masterStreamingConnection.close();
        } catch {
          // Ignore close error on stale socket
        }
        this.masterStreamingConnection = null;
      }

      if (this.masterRpcConnection) {
        try {
          await this.masterRpcConnection.close();
        } catch {
          // Ignore close error on stale socket
        }
        this.masterRpcConnection = null;
      }

      // 1. Establish RPC connection first (instant zero-delay account metrics & position queries)
      console.log(`⚡ [MT5_CONNECTION_MANAGER] Opening high-speed RPC connection to Master Terminal...`);
      this.masterRpcConnection = this.masterAccount.getRPCConnection();
      await withTimeout(this.masterRpcConnection.connect(), 20000, 'Master RPC connect timed out after 20s');
      try {
        await withTimeout(this.masterRpcConnection.waitSynchronized(15), 18000, 'Master RPC sync timed out');
      } catch (syncErr: any) {
        console.warn('ℹ️ [MT5_CONNECTION_MANAGER] Master RPC synchronization note:', syncErr?.message || syncErr);
      }

      // Initial account metrics sync directly from live MT5 terminal
      await this.refreshMasterAccountMetrics();

      this.masterState = 'CONNECTED';
      this.masterMetrics.state = 'CONNECTED';
      this.masterMetrics.connectionStatus = this.masterAccount.connectionStatus;
      this.topUpNotice = null;
      this.reconnectAttempts = 0;

      // 2. Attach WebSocket streaming connection in non-blocking manner for live push events
      try {
        console.log(`⚡ [MT5_CONNECTION_MANAGER] Attaching WebSocket streaming connection to Master Terminal...`);
        this.masterStreamingConnection = this.masterAccount.getStreamingConnection();
        await this.masterStreamingConnection.connect();
        // Wait up to 5 seconds for streaming synchronization; if it needs longer, it continues in background
        await Promise.race([
          this.masterStreamingConnection.waitSynchronized({ timeoutInSeconds: 5 }),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
      } catch (streamErr: any) {
        console.warn('ℹ️ [MT5_CONNECTION_MANAGER] WebSocket streaming synchronization note:', streamErr?.message || streamErr);
      }

      console.log('✅ [MT5_CONNECTION_MANAGER] Master MT5 Terminal live connection established successfully!');
      return this.masterStreamingConnection;
    } catch (error: any) {
      if (this.isTopUpRequiredError(error)) {
        console.warn(`⚠️ [MT5_CONNECTION_MANAGER] MetaApi account top-up required for ${accountId}: ${error?.message}`);
        this.topUpNotice = {
          required: true,
          accountId,
          accountName: this.masterAccount?.name || 'Castimo-fx',
          message:
            'MetaApi Cloud requires an account top-up to deploy live cloud terminals. Copying from the master is paused until then.',
          topUpUrl: 'https://app.metaapi.cloud',
        };
        this.markMasterUnavailable(accountId, 'MetaApi needs a top-up to deploy the terminal.');
        return null;
      }

      console.error(`❌ [MT5_CONNECTION_MANAGER] Failed to connect Master Terminal (${accountId}):`, error?.message || error);
      this.masterState = 'ERROR';
      this.masterMetrics.state = 'ERROR';
      this.scheduleMasterFallbackRecovery(20000);
      return null;
    }
  }

  /**
   * Refreshes Master account equity, balance, and open position metrics
   */
  public async refreshMasterAccountMetrics(): Promise<MasterAccountMetrics> {
    const startTime = Date.now();
    try {
      if (this.masterAccountId) {
        // 1. Instant Zero-Latency Check: streaming connection terminalState
        const streamInfo = this.masterStreamingConnection?.terminalState?.accountInformation;
        const streamPositions = this.masterStreamingConnection?.terminalState?.positions;

        if (streamInfo && streamInfo.balance != null) {
          const latency = Date.now() - startTime;
          this.masterMetrics = {
            ...this.masterMetrics,
            accountId: this.masterAccount?.id || this.masterAccountId,
            login: String(this.masterAccount?.login || this.masterMetrics.login || '261089492'),
            server: this.masterAccount?.server || this.masterMetrics.server || 'HFMarketsGlobal-Live20',
            balance: Number(streamInfo.balance),
            equity: Number(streamInfo.equity ?? streamInfo.balance),
            freeMargin: Number(streamInfo.freeMargin ?? streamInfo.balance),
            marginLevel: Number(streamInfo.marginLevel ?? 0),
            currency: streamInfo.currency || 'USD',
            leverage: Number(streamInfo.leverage || 500),
            openPositionsCount: streamPositions ? streamPositions.length : this.masterMetrics.openPositionsCount,
            latencyMs: Math.max(1, latency),
            lastHeartbeat: new Date().toISOString(),
            state: 'CONNECTED',
            connectionStatus: this.masterAccount?.connectionStatus || 'CONNECTED',
          };
          this.masterState = 'CONNECTED';
          return this.masterMetrics;
        }

        // 2. RPC Connection Check
        if (this.masterRpcConnection && this.masterAccount) {
          try {
            const info = await this.masterRpcConnection.getAccountInformation();
            const positions = await this.masterRpcConnection.getPositions();
            const latency = Date.now() - startTime;

            this.masterMetrics = {
              ...this.masterMetrics,
              accountId: this.masterAccount.id,
              login: String(this.masterAccount.login),
              server: this.masterAccount.server,
              balance: Number(info.balance ?? this.masterMetrics.balance),
              equity: Number(info.equity ?? this.masterMetrics.equity),
              freeMargin: Number(info.freeMargin ?? this.masterMetrics.freeMargin),
              marginLevel: Number(info.marginLevel ?? this.masterMetrics.marginLevel),
              currency: info.currency || 'USD',
              leverage: Number(info.leverage ?? 500),
              openPositionsCount: positions.length,
              latencyMs: latency,
              lastHeartbeat: new Date().toISOString(),
              state: 'CONNECTED',
              connectionStatus: this.masterAccount.connectionStatus,
            };
            this.masterState = 'CONNECTED';
            return this.masterMetrics;
          } catch (rpcErr: any) {
            console.warn('⚠️ [MT5_CONNECTION_MANAGER] RPC metrics check failed, falling back to REST:', rpcErr?.message || rpcErr);
          }
        }

        // 3. Direct REST Fallback via MetaApi Cloud endpoint
        if (this.apiToken && this.masterAccountId) {
          try {
            const res = await fetch(
              `https://mt-client-api-v1.london.agiliumtrade.ai/users/current/accounts/${this.masterAccountId}/account-information`,
              {
                headers: { 'auth-token': this.apiToken },
                signal: AbortSignal.timeout(6000),
              }
            );
            if (res.ok) {
              const restInfo: any = await res.json();
              const latency = Date.now() - startTime;
              this.masterMetrics = {
                ...this.masterMetrics,
                accountId: this.masterAccountId,
                login: String(restInfo.login || this.masterMetrics.login),
                server: restInfo.server || this.masterMetrics.server,
                balance: Number(restInfo.balance ?? this.masterMetrics.balance),
                equity: Number(restInfo.equity ?? restInfo.equity ?? this.masterMetrics.equity),
                freeMargin: Number(restInfo.freeMargin ?? restInfo.balance),
                marginLevel: Number(restInfo.marginLevel ?? 0),
                currency: restInfo.currency || 'USD',
                leverage: Number(restInfo.leverage || 500),
                latencyMs: latency,
                lastHeartbeat: new Date().toISOString(),
                state: 'CONNECTED',
                connectionStatus: 'CONNECTED',
              };
              this.masterState = 'CONNECTED';
              return this.masterMetrics;
            }
          } catch (restErr: any) {
            console.warn('⚠️ [MT5_CONNECTION_MANAGER] REST fallback failed:', restErr?.message || restErr);
          }
        }
      }
    } catch (err: any) {
      console.warn('⚠️ [MT5_CONNECTION_MANAGER] Error refreshing metrics:', err?.message || err);
    }
    return this.masterMetrics;
  }

  /**
   * Connects a client's broker account. The pipeline itself lives in clientBridge.ts (and is tested with
   * a fake broker); this method supplies the live MetaApi connection and the platform's own rules, then
   * puts the broker-verified account into the copy pool.
   *
   * If the terminal is still starting when the browser's patience runs out, it is handed to the supervisor
   * (terminalSupervisor.ts) to finish in the background, and the caller receives a HandedOff instead of a failure.
   */
  public async provisionClientTerminal(
    params: ProvisionClientParams,
    onStage?: (stage: Stage) => void
  ): Promise<ClientConnectionRecord> {
    const { userId, magic, platform = 'mt5', reliability = 'high' } = params;
    // MetaApi region for client terminals (new-york, london or singapore); pick the one nearest your brokers.
    const region = params.region || process.env.METAAPI_CLIENT_REGION || 'london';
    if (!userId) throw new BrokerVerificationError('BAD_INPUT', 'You must be signed in to connect an account.');

    // FAIL CLOSED: without a live MetaApi connection we cannot ask the broker, so we accept nothing.
    if (!this.api) {
      throw new BrokerVerificationError(
        'VERIFICATION_UNAVAILABLE',
        'Account verification is temporarily unavailable, so no account was connected. Please try again later.'
      );
    }

    const eq = (a?: string, b?: string) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

    // Make sure the live pool reflects reality (for example after a restart) before judging "already connected".
    await this.restoreClientForUser(userId).catch(() => undefined);

    // Already connected with this very account: pass straight through, nothing to redo.
    const current = this.clientPool.get(userId);
    if (
      current &&
      current.isBrokerVerified &&
      sameLogin(current.login, params.login) &&
      eq(current.server, normalizeBrokerServer(params.server))
    ) {
      onStage?.('verifying');
      void this.refreshClientFromBroker(userId).catch(() => undefined);
      console.log(`✅ [CLIENT_BRIDGE] #${current.login} is already connected for user ${userId}; passing straight through.`);
      return current;
    }
    const secs = (name: string, fallback: number) => readLimit(process.env[name], fallback) || fallback;
    const sup = this.supervisor;

    const deps: BridgeDeps = {
      gateway: metaApiGateway(this.api as any),
      // The master account can never be attached as a client.
      isMaster: (login, server) =>
        Boolean(this.masterAccount && sameLogin(this.masterAccount.login, login) && eq(this.masterAccount.server, server)) ||
        (sameLogin(this.masterMetrics.login, login) && eq(this.masterMetrics.server, server)),
      activeAccountOf: (uid) => {
        const rec = this.clientPool.get(uid);
        return rec && rec.isBrokerVerified ? { login: rec.login, server: rec.server } : null;
      },
      hasBillingHistory: async (uid) => (this.hasBillingHistory ? this.hasBillingHistory(uid) : false),
      // A client verified on this very terminal before is being reconnected, not connecting for the first time.
      wasVerified: async (uid, accountId) => (this.wasVerified ? (await this.wasVerified(uid, accountId)) === 'yes' : false),
      // An account that another user already linked cannot be linked again.
      linkedToOtherUser: (login, server, uid) => {
        for (const rec of this.clientPool.values()) {
          if (rec.userId !== uid && sameLogin(rec.login, login) && eq(rec.server, server)) return true;
        }
        return false;
      },
      gate: this.provisionGate,
      // From the moment the terminal exists it is remembered, so a restart (or a slow broker) never loses it.
      onTerminalCreated: async (e) => {
        await sup?.track({ userId: e.userId, accountId: e.accountId, login: e.login, server: e.server, verifiedBefore: e.previouslyVerified });
      },
      onTerminalRemoved: async (e) => {
        await sup?.untrack(e.userId, e.accountId);
      },
      limits: {
        // Cost guard: MetaApi charges per account, so limits are set by you (0 = no limit).
        maxTotal: readLimit(process.env.MAX_CLIENT_ACCOUNTS, 5),
        maxPerUser: readLimit(process.env.MAX_ACCOUNTS_PER_USER, 1),
        minEquity: readLimit(process.env.MIN_CONNECT_EQUITY, DEFAULT_MIN_CONNECT_EQUITY),
      },
      timeouts: {
        createSeconds: secs('CONNECT_CREATE_WAIT_SECONDS', 120),
        deploySeconds: secs('CONNECT_DEPLOY_WAIT_SECONDS', 120),
        syncSeconds: secs('CONNECT_SYNC_WAIT_SECONDS', 90),
      },
      log: (level, msg) => {
        const line = `[CLIENT_BRIDGE] ${msg}`;
        if (level === 'error') console.error('❌', line);
        else if (level === 'warn') console.warn('⚠️', line);
        else console.log('🔐', line);
      },
    };

    // A new attempt replaces an old "could not connect" notice.
    await sup?.clearFailure(userId).catch(() => undefined);

    this.connecting.add(userId);
    try {
      const r = await connectClient(
        deps,
        { userId, login: params.login, password: params.password, server: params.server, platform, magic, region, reliability },
        onStage
      );

      // Someone reconnecting keeps the copy on/off choice they made before; a new connection starts ON.
      const saved = r.previouslyVerified ? ((await this.loadSavedStatus?.(userId).catch(() => null)) ?? 'ACTIVE') : 'ACTIVE';
      const record = this.buildClientRecord({
        userId,
        accountId: r.account.id,
        login: String(params.login).trim(),
        server: r.server,
        status: saved,
        account: r.account.raw,
        rpc: r.rpc.raw,
        verified: r.verified,
      });
      this.registerClient(record);
      this.onClientVerified?.(record);
      if (!r.previouslyVerified) this.onNewConnection?.(userId);
      await sup?.untrack(userId, r.account.id);
      console.log(
        `✅ [CLIENT_BRIDGE] Broker verified #${record.login}: ${r.verified.brokerName} (${r.verified.accountType}), equity $${r.verified.equity.toFixed(2)}${r.resumed ? ' [resumed]' : ''}`
      );
      return record;
    } catch (error) {
      throw await this.handOffIfSlow(userId, error);
    } finally {
      this.connecting.delete(userId);
    }
  }

  /** The record that goes into the copy pool once the broker has answered for the account. */
  private buildClientRecord(a: {
    userId: string;
    accountId: string;
    login: string;
    server: string;
    status: 'ACTIVE' | 'IDLE';
    account: unknown;
    rpc: unknown;
    verified: VerifiedBrokerAccount;
  }): ClientConnectionRecord {
    const now = new Date().toISOString();
    return {
      userId: a.userId,
      accountId: a.accountId,
      login: a.login,
      server: a.server,
      status: a.status,
      account: a.account as MetatraderAccount,
      rpcConnection: a.rpc as RpcMetaApiConnectionInstance,
      balance: a.verified.balance,
      equity: a.verified.equity,
      freeMargin: a.verified.freeMargin,
      currency: a.verified.currency,
      leverage: a.verified.leverage,
      lastSync: now,
      accountHolderName: a.verified.accountHolderName,
      brokerName: a.verified.brokerName,
      isBrokerVerified: true,
      tradeAllowed: a.verified.tradeAllowed,
      investorMode: a.verified.investorMode,
      accountType: a.verified.accountType,
      verificationTimestamp: now,
      connectionState: 'CONNECTED',
      connectionStatus: (a.account as any)?.connectionStatus,
      lastHeartbeat: now,
    };
  }

  /**
   * A slow terminal is not a failure. If the terminal exists, the supervisor finishes the job in the
   * background and the browser is told so calmly. Anything else is passed on unchanged.
   */
  private async handOffIfSlow(userId: string, error: unknown): Promise<unknown> {
    if (!(error instanceof BrokerVerificationError)) return error;
    const slow = error.code === 'BROKER_SLOW' || error.code === 'BROKER_UNREACHABLE';
    if (!slow || !error.accountId || !this.supervisor) return error;
    try {
      if (await this.supervisor.handOff(userId)) {
        console.log(`🔐 [CLIENT_BRIDGE] ${userId}: still starting at '${error.stage}'; the supervisor will finish it in the background.`);
        return new HandedOff(error.message, { stage: error.stage as Stage | undefined, ref: error.ref, detail: error.detail });
      }
    } catch {
      // fall through: report the original problem
    }
    return error;
  }

  /**
   * Called when the browser's overall time limit is reached while the terminal exists: the supervisor
   * keeps going. Returns false if there is nothing to carry on with.
   */
  public continueInBackground(userId: string): boolean {
    const sup = this.supervisor;
    if (!sup || !sup.isTracked(userId)) return false;
    void sup.handOff(userId).catch(() => undefined);
    return true;
  }

  /** Puts a client the supervisor has just verified into service (the same record the browser flow builds). */
  private async adoptVerifiedClient(c: VerifiedClient): Promise<void> {
    const { rec, handle, rpc, verified } = c;
    const live = this.clientPool.get(rec.userId);
    if (live && live.isBrokerVerified) {
      // Already in service (for example the browser's connection finished first): keep that one.
      try {
        await rpc.close?.();
      } catch {
        // nothing to close
      }
      return;
    }
    const status = rec.verifiedBefore ? ((await this.loadSavedStatus?.(rec.userId).catch(() => null)) ?? 'ACTIVE') : 'ACTIVE';
    const record = this.buildClientRecord({
      userId: rec.userId,
      accountId: rec.accountId,
      login: rec.login,
      server: String(handle.server || rec.server),
      status,
      account: handle.raw,
      rpc: rpc.raw,
      verified,
    });
    this.registerClient(record);
    this.onClientVerified?.(record);
    if (!rec.verifiedBefore) this.onNewConnection?.(rec.userId);
    console.log(
      `${rec.verifiedBefore ? '♻️' : '✅'} [CLIENT_BRIDGE] ${rec.verifiedBefore ? 'Restored' : 'Connected in the background'} #${rec.login} (${status}): ${verified.brokerName}, equity $${verified.equity.toFixed(2)}`
    );
  }

  /**
   * Removes a user's broker account from MetaApi (stops the per-account charge) and stops copying to it.
   * Only accounts created for this user are touched; the master and other users are never affected.
   */
  public async removeClientTerminal(userId: string): Promise<{ removed: number }> {
    if (!userId) return { removed: 0 };
    let removed = 0;
    if (this.api) {
      const all = await this.api.metatraderAccountApi.getAccountsWithInfiniteScrollPagination();
      for (const a of all.filter((x) => isOwnedBy(x.name, userId))) {
        try {
          const acc = await this.api.metatraderAccountApi.getAccount(a.id);
          await acc.remove();
          removed++;
        } catch (err: any) {
          console.warn('⚠️ [MT5_CONNECTION_MANAGER] Could not remove account', a.id, err?.message);
          throw new BrokerVerificationError('BROKER_UNREACHABLE', 'Could not disconnect the account right now. Please try again.');
        }
      }
    }
    for (const [key, rec] of Array.from(this.clientPool.entries())) {
      if (rec.userId === userId) {
        this.clientPool.delete(key);
        try {
          await rec.rpcConnection?.close();
        } catch {
          // the terminal is gone; nothing left to close
        }
      }
    }
    // Nothing is left to look after for this user.
    await this.supervisor?.untrack(userId).catch(() => undefined);
    return { removed };
  }

  /** Admin view of how many client accounts exist in MetaApi versus the limit. */
  public async getCapacity(): Promise<{ used: number; limit: number; perUserLimit: number }> {
    const limit = readLimit(process.env.MAX_CLIENT_ACCOUNTS, 5);
    const perUserLimit = readLimit(process.env.MAX_ACCOUNTS_PER_USER, 1);
    if (!this.api) return { used: 0, limit, perUserLimit };
    const all = await this.api.metatraderAccountApi.getAccountsWithInfiniteScrollPagination();
    return { used: countClientAccounts(all), limit, perUserLimit };
  }

  /**
   * Allows manual retry to re-check MetaApi deployment after user tops up their account
   */
  public async retryMasterConnection(): Promise<{ success: boolean; mode: string; message: string; topUpRequired?: boolean }> {
    console.log('🔄 [MT5_CONNECTION_MANAGER] Manually re-checking Master Terminal connection...');
    if (!this.masterAccountId) {
      return { success: false, mode: 'OFFLINE', message: 'No Master Account ID configured.' };
    }

    this.topUpNotice = null;
    const conn = await this.connectMasterTerminal(this.masterAccountId);

    if (conn) {
      return {
        success: true,
        mode: 'LIVE_METAAPI',
        message: 'Master MT5 Terminal successfully deployed and connected via live WebSocket streaming!',
      };
    }

    const currentNotice = this.topUpNotice as TopUpNotice | null;
    if (currentNotice?.required) {
      return {
        success: false,
        topUpRequired: true,
        mode: 'DISCONNECTED',
        message: 'MetaApi Cloud account still requires top-up at app.metaapi.cloud to deploy live cloud terminals. The master stays disconnected until then.',
      };
    }

    return {
      success: false,
      mode: this.masterState,
      message: 'Failed to connect Master Terminal. Please review credentials.',
    };
  }

  /**
   * Retrieves an active client RPC connection by userId or accountId
   */
  public getAllClientRecords(): ClientConnectionRecord[] {
    return Array.from(this.clientPool.values());
  }

  public setBillingBlocked(userId: string, blocked: boolean): void {
    for (const rec of this.clientPool.values()) {
      if (rec.userId === userId) rec.billingBlocked = blocked;
    }
  }

  public getClientConnection(identifier: string): ClientConnectionRecord | undefined {
    return this.clientPool.get(identifier);
  }

  /**
   * Register or update client terminal record directly in memory pool
   */
  public registerClient(record: ClientConnectionRecord): void {
    // Only accounts the broker itself has verified may ever enter the copy pool.
    if (!record.isBrokerVerified) {
      throw new BrokerVerificationError('BAD_BROKER_RESPONSE', 'Refusing to register an account the broker has not verified.');
    }
    if (!record.health) record.health = newHealthState(Date.now());
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

  /**
   * Get all currently connected active client terminals
   */
  public getActiveClients(): ClientConnectionRecord[] {
    const unique = new Map<string, ClientConnectionRecord>();
    for (const record of this.clientPool.values()) {
      if (record.status === 'ACTIVE' && record.isBrokerVerified && !record.billingBlocked) {
        unique.set(record.userId, record);
      }
    }
    return Array.from(unique.values());
  }

  /**
   * Pause or resume a client's copying. This is the ONLY thing that may be changed by hand:
   * balance, equity and identity come from the broker and can never be written from outside.
   */
  public updateClientMetrics(
    identifier: string,
    updates: { status?: 'ACTIVE' | 'IDLE' }
  ): ClientConnectionRecord | undefined {
    let client = this.clientPool.get(identifier);
    if (!client) {
      for (const rec of this.clientPool.values()) {
        if (rec.userId === identifier || rec.accountId === identifier || rec.login === identifier) {
          client = rec;
          break;
        }
      }
    }
    if (client && updates.status) {
      client.status = updates.status;
      client.lastSync = new Date().toISOString();
      this.clientPool.set(client.userId, client);
      this.clientPool.set(client.accountId, client);
    }
    return client;
  }

  /**
   * Re-queries live broker metrics (balance, equity, free margin) for a client terminal via RPC
   */
  public async refreshClientFromBroker(identifier: string): Promise<ClientConnectionRecord | null> {
    let client = this.clientPool.get(identifier);
    if (!client) {
      for (const rec of this.clientPool.values()) {
        if (rec.userId === identifier || rec.accountId === identifier || rec.login === identifier) {
          client = rec;
          break;
        }
      }
    }
    if (!client) return null;
    const rec = client;

    const region = process.env.METAAPI_CLIENT_REGION || 'london';
    const result = await checkClientHealth(
      {
        // 1. RPC, like the master
        rpcInfo: () =>
          withTimeout(rec.rpcConnection ? rec.rpcConnection.getAccountInformation() : Promise.reject(new Error('no RPC link')), 8000, 'RPC refresh timed out') as Promise<any>,
        // 2. REST fallback, the same safety net the master uses
        restInfo: this.apiToken
          ? async () => {
              const res = await fetch(
                `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${rec.accountId}/account-information`,
                { headers: { 'auth-token': this.apiToken }, signal: AbortSignal.timeout(6000) }
              );
              return res.ok ? ((await res.json()) as any) : null;
            }
          : undefined,
        // 3. Rebuild the RPC link, the master's recovery steps
        reconnect: () => this.rebuildClientLink(rec),
        log: (level, msg) => (level === 'warn' ? console.warn : console.log)(`[CLIENT_LINK #${rec.login}] ${msg}`),
      },
      rec.health ?? newHealthState(Date.now())
    );

    rec.health = result.state;
    rec.connectionState = result.state.connectionState;
    rec.latencyMs = result.state.latencyMs;
    try {
      rec.connectionStatus = (rec.account as any)?.connectionStatus || rec.connectionStatus;
    } catch {
      // status is informational only
    }
    if (result.info) {
      rec.balance = result.info.balance;
      rec.equity = result.info.equity;
      if (result.info.freeMargin != null) rec.freeMargin = result.info.freeMargin;
      if (result.info.leverage != null) rec.leverage = result.info.leverage;
      if (result.info.broker) rec.brokerName = result.info.broker;
      if (result.info.name) rec.accountHolderName = result.info.name;
      rec.isBrokerVerified = true;
      rec.lastSync = new Date().toISOString();
      rec.lastHeartbeat = rec.lastSync;
    }
    this.clientPool.set(rec.userId, rec);
    this.clientPool.set(rec.accountId, rec);
    return rec;
  }

  /**
   * Rebuilds a client's RPC link the way the master's is rebuilt: start the terminal if MetaApi left it
   * undeployed, reconnect, and wait for sync only as a best effort.
   */
  private async rebuildClientLink(rec: ClientConnectionRecord): Promise<void> {
    if (!this.api) throw new Error('MetaApi is not available');
    const entity = await this.api.metatraderAccountApi.getAccount(rec.accountId);
    if (entity.state !== 'DEPLOYED') {
      if (entity.state === 'UNDEPLOYED' || entity.state === 'DRAFT') await entity.deploy();
      await entity.waitDeployed(60, 1000);
    }
    try {
      await rec.rpcConnection?.close();
    } catch {
      // stale socket
    }
    const rpc = entity.getRPCConnection();
    await withTimeout(rpc.connect(), 20000, 'RPC connect timed out after 20s');
    try {
      await withTimeout(rpc.waitSynchronized(15), 18000, 'RPC sync timed out');
    } catch (syncErr: any) {
      console.warn(`ℹ️ [CLIENT_LINK #${rec.login}] RPC synchronization note:`, syncErr?.message || syncErr);
    }
    rec.account = entity;
    rec.rpcConnection = rpc;
    rec.connectionStatus = entity.connectionStatus;
    this.clientPool.set(rec.userId, rec);
    this.clientPool.set(rec.accountId, rec);
  }

  /**
   * Master Terminal fallback reconnection schedule.
   * Gives MetaApi SDK's built-in socket recovery 20-30s to re-establish before rebuilding connections.
   */
  private scheduleMasterFallbackRecovery(delayMs: number = 25000): void {
    if (this.reconnectTimer) return;
    if (this.topUpNotice?.required) {
      console.log('ℹ️ [MT5_CONNECTION_MANAGER] Master recovery timer bypassed: Top-up required.');
      return;
    }

    const delay = Math.min(Math.max(delayMs, this.reconnectIntervalMs * Math.pow(1.2, Math.min(this.reconnectAttempts, 6))), 45000);
    console.log(`🔄 [MT5_CONNECTION_MANAGER] MetaApi SDK auto-recovery active. Fallback reconnection check in ${Math.round(delay / 1000)}s...`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      // Reconnect only if still in RECONNECTING or ERROR state
      if (this.masterState === 'RECONNECTING' || this.masterState === 'ERROR') {
        this.reconnectAttempts++;
        console.log(`🔄 [MT5_CONNECTION_MANAGER] Auto-recovery timed out. Performing clean reconnect attempt #${this.reconnectAttempts}...`);
        if (this.masterAccountId && !this.topUpNotice?.required) {
          try {
            await this.connectMasterTerminal(this.masterAccountId);
          } catch (err: any) {
            console.warn('⚠️ [MT5_CONNECTION_MANAGER] Clean reconnect failed, will re-schedule:', err?.message || err);
            this.scheduleMasterFallbackRecovery(30000);
          }
        }
      }
    }, delay);
  }

  /**
   * Start periodic heartbeat checks to verify socket health and live metrics
   */
  private clientRefreshTimer: NodeJS.Timeout | null = null;
  private refreshingClients = false;

  /**
   * Keeps every connected client's balance, equity and free margin in step with their broker account,
   * so deposits, withdrawals and floating profit show up on the dashboard and in lot sizing.
   */
  public async refreshAllClients(): Promise<void> {
    if (this.refreshingClients || !this.api) return;
    this.refreshingClients = true;
    try {
      const seen = new Set<string>();
      const batch: ClientConnectionRecord[] = [];
      for (const rec of Array.from(this.clientPool.values())) {
        if (seen.has(rec.accountId) || !rec.isBrokerVerified) continue;
        seen.add(rec.accountId);
        batch.push(rec);
      }
      // Check several clients at once so one slow broker never delays the rest.
      const CONCURRENCY = 5;
      for (let i = 0; i < batch.length; i += CONCURRENCY) {
        await Promise.allSettled(
          batch.slice(i, i + CONCURRENCY).map((rec) =>
            withTimeout<unknown>(this.refreshClientFromBroker(rec.accountId), 40000, 'refresh timed out')
          )
        );
      }
    } finally {
      this.refreshingClients = false;
    }
  }

  // ---------- terminals that are not yet (or no longer) a live connection ----------

  /** Where unfinished connections are remembered. Call before initialize(); until then they live in memory only. */
  public setConnectionStore(store: ConnectionStore): void {
    this.connectionStore = store;
  }

  public getSupervisor(): TerminalSupervisor | null {
    return this.supervisor;
  }

  /** Users whose connection from the browser is running right now (the supervisor leaves them alone). */
  public isConnecting(userId: string): boolean {
    return this.connecting.has(userId);
  }

  private buildSupervisor(): TerminalSupervisor {
    return new TerminalSupervisor({
      gateway: metaApiGateway(this.api as any),
      store: this.connectionStore,
      limits: { minEquity: readLimit(process.env.MIN_CONNECT_EQUITY, DEFAULT_MIN_CONNECT_EQUITY) },
      isActive: (uid) => {
        const rec = this.clientPool.get(uid);
        return Boolean(rec && rec.isBrokerVerified);
      },
      isConnecting: (uid) => this.connecting.has(uid),
      wasVerified: async (uid, accountId) => (this.wasVerified ? this.wasVerified(uid, accountId) : 'unknown'),
      hasBillingHistory: async (uid) => (this.hasBillingHistory ? this.hasBillingHistory(uid) : false),
      onVerified: (c) => this.adoptVerifiedClient(c),
      activeLinks: () => {
        const seen = new Set<string>();
        const out: Array<{ userId: string; accountId: string; login: string; connectionState?: string }> = [];
        for (const rec of this.clientPool.values()) {
          if (seen.has(rec.accountId) || !rec.isBrokerVerified) continue;
          seen.add(rec.accountId);
          out.push({ userId: rec.userId, accountId: rec.accountId, login: rec.login, connectionState: rec.connectionState });
        }
        return out;
      },
      maxParallel: readLimit(process.env.SUPERVISOR_MAX_PARALLEL, 4) || 4,
      log: (level, msg) => {
        const line = `[TERMINAL_SUPERVISOR] ${msg}`;
        if (level === 'error') console.error('❌', line);
        else if (level === 'warn') console.warn('⚠️', line);
        else console.log('🛰️', line);
      },
    });
  }

  /**
   * Starts the supervisor: reads the saved records, adopts any client terminal that exists in MetaApi but
   * is not being looked after (this is how clients are brought back after a restart), and keeps going.
   */
  private async startSupervisor(): Promise<void> {
    if (!this.api) return;
    try {
      const sup = this.buildSupervisor();
      this.supervisor = sup;
      const saved = await sup.load();
      const found = await sup.discover();
      console.log(`🛰️ [TERMINAL_SUPERVISOR] Started: ${saved} saved connection(s), ${found.adopted} terminal(s) found in MetaApi.`);
      await sup.tick();
      sup.start();
    } catch (err: any) {
      console.warn('⚠️ [TERMINAL_SUPERVISOR] Could not start:', err?.message || err);
    }
  }

  /** Re-attaches client accounts that already exist in MetaApi (after a server restart). Kept for callers; the supervisor does the work. */
  public async rehydrateClients(): Promise<void> {
    const sup = this.supervisor;
    if (!sup) return;
    await sup.discover();
    await sup.tick();
  }

  /**
   * Called when a signed-in client opens the dashboard but is not in memory (for example the server
   * restarted and the first restore has not finished). Looks for their terminal in MetaApi and lets the
   * supervisor bring it back. The same rules apply as for any connection: nothing is put into service
   * without the broker's own answer.
   */
  public async restoreClientForUser(userId: string): Promise<ClientConnectionRecord | undefined> {
    const existing = this.clientPool.get(userId);
    if (existing) return existing;
    const sup = this.supervisor;
    if (!sup || !this.api) return undefined;
    if (this.connecting.has(userId)) return undefined;
    const last = this.lastLazyRestore.get(userId) || 0;
    if (Date.now() - last < 30_000) return undefined;
    this.lastLazyRestore.set(userId, Date.now());
    try {
      if (!sup.isTracked(userId)) await sup.discover({ userId });
      if (sup.isTracked(userId)) await sup.stepNow(userId, 20_000);
    } catch (err: any) {
      console.warn('⚠️ [MT5_CONNECTION_MANAGER] Lazy restore failed:', err?.message);
    }
    return this.clientPool.get(userId);
  }

  private startHeartbeatMonitor(): void {
    if (this.clientRefreshTimer) clearInterval(this.clientRefreshTimer);
    this.clientRefreshTimer = setInterval(() => void this.refreshAllClients(), 10000);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(async () => {
      if (this.masterState === 'CONNECTED') {
        await this.refreshMasterAccountMetrics();
      }
    }, 4000);
  }

  // Getters
  public getMasterStreamingConnection(): StreamingMetaApiConnectionInstance | null {
    return this.masterStreamingConnection;
  }

  public getMasterRpcConnection(): RpcMetaApiConnectionInstance | null {
    return this.masterRpcConnection;
  }

  public getMasterMetrics(): MasterAccountMetrics {
    return { ...this.masterMetrics };
  }

  public isConnected(): boolean {
    return this.masterState === 'CONNECTED';
  }

  public getTopUpNotice(): TopUpNotice | null {
    return this.topUpNotice ? { ...this.topUpNotice } : null;
  }

  public getMetaApi(): MetaApiInstance | null {
    return this.api;
  }
}

export default Mt5ConnectionManager;
