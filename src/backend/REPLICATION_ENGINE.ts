/**
 * CASTIMOFX - High-Frequency MT5 Trade Replication Engine
 * 
 * Ultra-low latency trade copying engine hooking into Master terminal events.
 * Listens for PositionOpened, PositionModified, and PositionClosed.
 * Executes proportional lot-scaled market orders concurrently via Promise.all
 * across all active client terminals with extensive institutional risk guards.
 */

import {
  SynchronizationListener,
  type MetatraderPosition,
  type MetatraderAccountInformation,
  type StreamingMetaApiConnectionInstance,
  type RpcMetaApiConnectionInstance,
} from './metaapiClient';
import { Mt5ConnectionManager, type ClientConnectionRecord } from './MT5_CONNECTION_MANAGER';
import {
  copyComment,
  parseCopyComment,
  planReconcile,
  knownFromTable,
  suspectKey,
  closeBackoffMs,
  type Adoption,
  type ClientPosition,
  type Closure,
} from './copyMemory';

export interface ReplicationRiskConfig {
  minEquityFloor: number;       // Technical floor only: below this, lots cannot be sized. Never disconnects anyone.
  maxLotCap: number;            // Absolute safety lot ceiling
  minLotSize: number;           // Standard broker floor (0.01)
  lotStep: number;              // Lot rounding increment (0.01)
  maxSlippagePoints: number;    // Maximum tolerable slippage
  allowedSymbols: string[];     // Whitelist (e.g. XAUUSD, EURUSD, GBPUSD)
}

export const DEFAULT_REPLICATION_CONFIG: ReplicationRiskConfig = {
  minEquityFloor: 25.0,        // Standard safety floor ($25.00)
  maxLotCap: 5.0,
  minLotSize: 0.01,
  lotStep: 0.01,
  maxSlippagePoints: 15,
  allowedSymbols: ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD'],
};

export interface PositionMapping {
  masterPositionId: string;
  clientPositions: Map<string, {
    clientAccountId: string;
    clientPositionId: string;
    symbol: string;
    volume: number;
    openPrice: number;
    openTime: string;
  }>;
}

export interface ReplicatedOrderResult {
  clientUserId: string;
  clientAccountId: string;
  masterPositionId: string;
  clientPositionId?: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  masterVolume: number;
  clientVolume: number;
  status: 'EXECUTED' | 'REJECTED' | 'INSUFFICIENT_MARGIN' | 'FLOOR_BLOCKED' | 'ERROR';
  executionLatencyMs: number;
  error?: string;
}

/**
 * What the engine needs from the connection manager. The real manager fits as it is; a test can pass a stand-in.
 */
export interface EngineHost {
  getMasterStreamingConnection(): StreamingMetaApiConnectionInstance | null;
  getMasterRpcConnection(): RpcMetaApiConnectionInstance | null;
  isConnected(): boolean;
  getActiveClients(): ClientConnectionRecord[];
  getAllClientRecords(): ClientConnectionRecord[];
  getClientConnection(identifier: string): ClientConnectionRecord | undefined;
  getMasterMetrics(): { balance: number };
  handleMasterConnected?(): void;
  handleMasterDisconnected?(): void;
  updateMasterAccountMetrics?(info: {
    balance?: number;
    equity?: number;
    freeMargin?: number;
    marginLevel?: number;
    currency?: string;
    leverage?: number;
  }): void;
  updateMasterPositionsCount?(count: number): void;
}

/** How often the master's open trades are checked (new and closed trades), in case a live message is missed. */
const POLL_MS = 2_500;
/** How often every client's open positions are compared with the master's (the copy memory is rebuilt from this). */
const RECONCILE_MS = 30_000;
/** A leftover copy must look wrong on two checks at least this far apart before it is closed. */
const CONFIRM_MS = 20_000;
/** If the start-up look has not been possible after this long, the engine goes live anyway rather than stay silent. */
const SEED_GRACE_MS = 30_000;
const READ_TIMEOUT_MS = 12_000;
const CLOSE_TIMEOUT_MS = 15_000;
const READ_CONCURRENCY = 5;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export class MasterSynchronizationListener extends SynchronizationListener {
  private engine: ReplicationEngine;

  constructor(engine: ReplicationEngine) {
    super();
    this.engine = engine;
  }

  override async onConnected(instanceIndex: string, replicas: number): Promise<any> {
    console.log(`📡 [REPLICATION_LISTENER] Master Terminal connected (Instance: ${instanceIndex}, Replicas: ${replicas})`);
    this.engine.handleConnectionChange(true);
    this.engine.host.handleMasterConnected?.();
  }

  override async onDisconnected(instanceIndex: string): Promise<any> {
    console.warn(`⚠️ [REPLICATION_LISTENER] Master Terminal disconnected (Instance: ${instanceIndex})`);
    this.engine.handleConnectionChange(false);
    this.engine.host.handleMasterDisconnected?.();
  }

  override async onAccountInformationUpdated(
    instanceIndex: string,
    accountInformation: MetatraderAccountInformation
  ): Promise<any> {
    if (accountInformation.balance != null) {
      this.engine.updateMasterBalance(accountInformation.balance);
    }
    this.engine.host.updateMasterAccountMetrics?.(accountInformation);
  }

  override async onPositionsReplaced(instanceIndex: string, positions: Array<MetatraderPosition>): Promise<any> {
    console.log(`🔄 [REPLICATION_LISTENER] Initial synchronization: received ${positions.length} open master positions.`);
    for (const pos of positions) {
      this.engine.trackMasterPosition(pos);
    }
    // Trades that are open when we first look were not opened "just now": they are remembered, never copied again.
    this.engine.markSeeded(positions.length);
    this.engine.host.updateMasterPositionsCount?.(positions.length);
  }

  override async onPositionUpdated(instanceIndex: string, position: MetatraderPosition): Promise<any> {
    const posId = String(position.id);
    const isNew = !this.engine.hasMasterPosition(posId);
    if (isNew && !this.engine.isSeeded()) {
      // Heard before the start-up look finished: it was already open, so it is remembered, not copied again.
      this.engine.trackMasterPosition(position);
      console.log(`🧭 [COPY_MEMORY] Master trade #${posId} was already open when the server started: remembered, not copied again.`);
    } else if (isNew) {
      console.log(`⚡ [EVENT: PositionOpened] Master opened ${position.type} on ${position.symbol} (Volume: ${position.volume}, ID: ${posId})`);
      await this.engine.onPositionOpened(position);
    } else {
      console.log(`📝 [EVENT: PositionModified] Master modified position #${posId} (SL: ${position.stopLoss}, TP: ${position.takeProfit})`);
      await this.engine.onPositionModified(position);
    }
    this.engine.host.updateMasterPositionsCount?.(this.engine.getMasterPositionsCount());
  }

  override async onPositionRemoved(instanceIndex: string, positionId: string): Promise<any> {
    const posId = String(positionId);
    console.log(`🛑 [EVENT: PositionClosed] Master closed position #${posId}`);
    await this.engine.onPositionClosed(posId);
    this.engine.host.updateMasterPositionsCount?.(this.engine.getMasterPositionsCount());
  }
}

export class ReplicationEngine {
  private static instance: ReplicationEngine | null = null;
  private connectionManager: EngineHost;
  private riskConfig: ReplicationRiskConfig = DEFAULT_REPLICATION_CONFIG;

  // Master Account Baseline State (Live HFMarkets account: 261089492)
  private masterBalance: number = 100.97;
  private masterPositions: Map<string, MetatraderPosition> = new Map();

  // Position Mapping Table (Master position ID -> Client position IDs)
  private positionMap: Map<string, PositionMapping> = new Map();

  // Execution logs & statistics
  private executionHistory: ReplicatedOrderResult[] = [];
  private totalCopiedTrades = 0;
  private successfulCopies = 0;

  // ---- Copy memory: the table above is rebuilt from the brokers after a restart (see copyMemory.ts) ----
  /** True once the master's already-open trades have been looked at (they are remembered, never copied again). */
  private seeded = false;
  private attachedAt = 0;
  private polling = false;
  private emptyPolls = 0;
  private pollTimer: NodeJS.Timeout | null = null;
  private reconcileTimer: NodeJS.Timeout | null = null;
  private soonTimer: NodeJS.Timeout | null = null;
  private reconciling = false;
  /** The master stream connection our live listener is attached to (the manager builds a new one after a drop). */
  private attachedStream: unknown = null;
  private lastAttachWarnAt = 0;
  /** Copies that looked wrong on an earlier check: "userId|positionId" -> when first seen. */
  private suspects: Map<string, number> = new Map();
  private closeNotBefore: Map<string, number> = new Map();
  private closeFailures: Map<string, number> = new Map();
  /** Master trade id -> users whose broker account was already searched for a copy of it. */
  private lookedUp: Map<string, Set<string>> = new Map();
  private copyStats = { lastCheckAt: 0, remembered: 0, leftoversClosed: 0, doublesClosed: 0 };
  private confirmMs = CONFIRM_MS;

  private constructor(host: EngineHost, options: { confirmMs?: number } = {}) {
    this.connectionManager = host;
    if (options.confirmMs !== undefined) this.confirmMs = options.confirmMs;
  }

  public static getInstance(): ReplicationEngine {
    if (!ReplicationEngine.instance) {
      ReplicationEngine.instance = new ReplicationEngine(Mt5ConnectionManager.getInstance());
    }
    return ReplicationEngine.instance;
  }

  /** An engine of its own on a stand-in host (tests). It is not shared with anything. */
  public static createFor(host: EngineHost, options: { confirmMs?: number } = {}): ReplicationEngine {
    return new ReplicationEngine(host, options);
  }

  public get host(): EngineHost {
    return this.connectionManager;
  }

  public isSeeded(): boolean {
    return this.seeded;
  }

  /** The master's already-open trades have been seen: from now on only trades that appear are copied. */
  public markSeeded(openTrades: number = this.masterPositions.size): void {
    if (this.seeded) return;
    this.seeded = true;
    console.log(`🧭 [COPY_MEMORY] Start-up look done: the master has ${openTrades} trade(s) open. They were open already, so they are remembered but not copied again.`);
    this.reconcileSoon(2_000);
  }

  /**
   * Attach listener to Master Terminal WebSocket streaming connection, and start the checks that keep the copy
   * engine honest: a quick look at the master's trades and a slower comparison with every client's account.
   */
  public attachToMasterStream(): void {
    this.attachListenerIfNeeded();
    if (!this.attachedStream) {
      console.warn('⚠️ [REPLICATION_ENGINE] Master streaming connection not yet available. It is attached as soon as it exists.');
    }
    if (this.pollTimer) return; // already running: never start a second loop
    this.attachedAt = Date.now();

    // Secondary high-speed RPC position poll fallback (detects opened/closed orders every 2.5s)
    this.pollTimer = setInterval(() => void this.pollMaster(), POLL_MS);
    this.pollTimer.unref?.();
    this.reconcileTimer = setInterval(() => void this.reconcileClients().catch(() => undefined), RECONCILE_MS);
    this.reconcileTimer.unref?.();
  }

  /** Stops the engine's timers (tests, shutdown). */
  public stop(): void {
    for (const t of [this.pollTimer, this.reconcileTimer, this.soonTimer]) if (t) clearTimeout(t);
    this.pollTimer = this.reconcileTimer = this.soonTimer = null;
  }

  /**
   * The manager builds a NEW streaming connection whenever it rebuilds the master link (after a long drop, or on
   * a manual retry), and a listener on the old one hears nothing. Look again on every check and attach to
   * whichever connection is current, once.
   */
  private attachListenerIfNeeded(): void {
    const conn = this.connectionManager.getMasterStreamingConnection();
    if (!conn || conn === this.attachedStream) return;
    try {
      conn.addSynchronizationListener(new MasterSynchronizationListener(this));
      const first = this.attachedStream === null;
      this.attachedStream = conn;
      console.log(
        first
          ? '🔗 [REPLICATION_ENGINE] Attached real-time synchronization listener to Master WebSocket.'
          : '🔗 [REPLICATION_ENGINE] The master connection was rebuilt: live listener attached to the new connection.'
      );
    } catch (err: any) {
      if (Date.now() - this.lastAttachWarnAt > 60_000) {
        this.lastAttachWarnAt = Date.now();
        console.warn('⚠️ [REPLICATION_ENGINE] Could not attach the live listener yet (will keep trying):', err?.message || err);
      }
    }
  }

  /**
   * The start-up look could not be made in time (the master's trades could not be read). Rather than stay silent
   * for good, use what the live feed already knows and go live; the comparison with the clients' accounts still
   * closes any double copy this might cause.
   */
  private seedWithoutLook(): void {
    const known = (this.attachedStream as any)?.terminalState?.positions;
    if (Array.isArray(known)) for (const p of known) this.trackMasterPosition(p);
    console.warn("⚠️ [COPY_MEMORY] The master's open trades could not be read at start-up. Going live with what the live feed has shown so far.");
    this.markSeeded();
  }

  /** One look at the master's open trades: copies new ones, closes copies of finished ones. */
  private async pollMaster(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      this.attachListenerIfNeeded();
      if (!this.seeded && this.attachedAt && Date.now() - this.attachedAt > SEED_GRACE_MS) this.seedWithoutLook();
      const rpc = this.connectionManager.getMasterRpcConnection();
      if (!rpc || !this.connectionManager.isConnected()) return;

      const positions: MetatraderPosition[] = await rpc.getPositions();
      const currentPosIds = new Set(positions.map((p: MetatraderPosition) => String(p.id)));

      if (!this.seeded) {
        // First look after start-up: whatever is open now was opened before we got here.
        for (const pos of positions) this.trackMasterPosition(pos);
        this.markSeeded(positions.length);
        return;
      }

      for (const pos of positions) {
        const pId = String(pos.id);
        if (!this.hasMasterPosition(pId)) {
          console.log(`⚡ [RPC_WATCHER] Discovered new master position #${pId} on ${pos.symbol}`);
          await this.onPositionOpened(pos);
        }
      }

      // Every trade vanishing at once is more likely a bad read than a real close: confirm with a second look.
      if (positions.length === 0 && this.masterPositions.size > 0) {
        this.emptyPolls++;
        if (this.emptyPolls < 2) return;
      } else {
        this.emptyPolls = 0;
      }

      for (const [trackedId] of this.masterPositions) {
        if (!currentPosIds.has(trackedId)) {
          console.log(`🛑 [RPC_WATCHER] Discovered closed master position #${trackedId}`);
          await this.onPositionClosed(trackedId);
        }
      }
    } catch {
      // Non-blocking query catch
    } finally {
      this.polling = false;
    }
  }

  /**
   * The master's real open positions as last reported by the broker terminal.
   * Prices and sizes only; nothing is estimated.
   */
  public getMasterTradeSnapshot(): Array<{ id: string; symbol: string; side: 'BUY' | 'SELL'; volume: number; openPrice: number; openedAt: string | null }> {
    const out: Array<{ id: string; symbol: string; side: 'BUY' | 'SELL'; volume: number; openPrice: number; openedAt: string | null }> = [];
    for (const [id, p] of this.masterPositions) {
      const t = String((p as any).type || '').toUpperCase();
      const side = t.includes('SELL') ? 'SELL' : t.includes('BUY') ? 'BUY' : null;
      if (!side) continue;
      const opened = (p as any).time ? new Date((p as any).time) : null;
      out.push({
        id,
        symbol: String(p.symbol || ''),
        side,
        volume: Number((p as any).volume) || 0,
        openPrice: Number((p as any).openPrice) || 0,
        openedAt: opened && !isNaN(opened.getTime()) ? opened.toISOString() : null,
      });
    }
    return out;
  }

  /**
   * =========================================================================
   * LOT SCALING MATH (Strict Institutional Balance Ratio Calculation)
   * 
   * Ratio = Client Balance / Master Balance
   * Client Lot = Master Volume * Ratio
   * Example:
   *   Master Balance = $100,000.00, Master Volume = 1.00 lot
   *   Client Balance = $1,000.00
   *   Ratio = 1,000 / 100,000 = 0.01
   *   Client Lot = 1.00 * 0.01 = 0.01 lots
   * =========================================================================
   */
  public calculateScaledLot(clientBalance: number, masterVolume: number): number {
    const liveMasterBalance = this.connectionManager.getMasterMetrics().balance || this.masterBalance;
    const safeMasterBalance = Math.max(liveMasterBalance, 10.0);
    const balanceRatio = clientBalance / safeMasterBalance;
    const rawLot = masterVolume * balanceRatio;

    // Apply lot step quantization (e.g. 0.01 increments)
    const step = this.riskConfig.lotStep;
    let quantizedLot = Math.floor(rawLot / step) * step;

    // Clamp between minimum allowed broker lot and safety ceiling cap
    quantizedLot = Math.max(this.riskConfig.minLotSize, Math.min(this.riskConfig.maxLotCap, quantizedLot));

    // Round cleanly to 2 decimal places to avoid floating point anomalies (e.g. 0.010000000000000002)
    return Number(quantizedLot.toFixed(2));
  }

  /**
   * EVENT: PositionOpened
   * Concurrently duplicates open order across all active client terminals
   */
  public async onPositionOpened(position: MetatraderPosition): Promise<ReplicatedOrderResult[]> {
    const posId = String(position.id);
    this.masterPositions.set(posId, position);

    // Initialize mapping container
    if (!this.positionMap.has(posId)) {
      this.positionMap.set(posId, {
        masterPositionId: posId,
        clientPositions: new Map(),
      });
    }

    // 1. Fetch active client connections (status: 'ACTIVE')
    const activeClients = this.connectionManager.getActiveClients();
    if (activeClients.length === 0) {
      console.log('ℹ️ [REPLICATION_ENGINE] No active client accounts to mirror this trade.');
      return [];
    }

    console.log(`🚀 [REPLICATION_ENGINE] Broadcasting order for Master #${posId} across ${activeClients.length} active client(s)...`);

    // 2. Concurrently execute across all client terminals using Promise.all
    const executionPromises = activeClients.map(client => this.executeClientCopyOrder(client, position));
    const results = await Promise.all(executionPromises);

    // Update operational telemetry
    this.totalCopiedTrades += results.length;
    this.successfulCopies += results.filter(r => r.status === 'EXECUTED').length;
    this.executionHistory.push(...results);

    return results;
  }

  /**
   * Execute copy order on an individual client terminal with deep error catching
   */
  private async executeClientCopyOrder(
    client: ClientConnectionRecord,
    position: MetatraderPosition
  ): Promise<ReplicatedOrderResult> {
    const startMs = Date.now();
    const posId = String(position.id);
    const isBuy = position.type === 'POSITION_TYPE_BUY' || position.type.includes('BUY');

    // Pre-execution Check 1: technical floor (the $200 minimum applies only when a client first connects)
    if (client.equity < this.riskConfig.minEquityFloor || client.balance < this.riskConfig.minEquityFloor) {
      console.warn(`🛑 [RISK_GUARD] Client ${client.userId} blocked from copying: equity ($${client.equity.toFixed(2)}) is below the $${this.riskConfig.minEquityFloor} safety floor.`);
      return {
        clientUserId: client.userId,
        clientAccountId: client.accountId,
        masterPositionId: posId,
        symbol: position.symbol,
        type: isBuy ? 'BUY' : 'SELL',
        masterVolume: position.volume,
        clientVolume: 0,
        status: 'FLOOR_BLOCKED',
        executionLatencyMs: Date.now() - startMs,
        error: `Account equity ($${client.equity.toFixed(2)}) below mandatory $${this.riskConfig.minEquityFloor} threshold.`,
      };
    }

    // Pre-execution Check 2: Calculate Scaled Lot Size
    const clientLot = this.calculateScaledLot(client.balance, position.volume);

    // If client RPC connection is live, submit the order directly through MetaApi
    if (client.rpcConnection) {
      try {
        console.log(`⚡ [EXECUTING] Mirroring trade to client terminal ${client.accountId} (${clientLot} lots on ${position.symbol})...`);

        let tradeResponse: any;
        const tradeOptions = {
          // This label is how the copy is found again after a restart (see copyMemory.ts).
          comment: copyComment(position.id),
          slippage: this.riskConfig.maxSlippagePoints,
        };

        if (isBuy) {
          tradeResponse = await client.rpcConnection.createMarketBuyOrder(
            position.symbol,
            clientLot,
            position.stopLoss || undefined,
            position.takeProfit || undefined,
            tradeOptions
          );
        } else {
          tradeResponse = await client.rpcConnection.createMarketSellOrder(
            position.symbol,
            clientLot,
            position.stopLoss || undefined,
            position.takeProfit || undefined,
            tradeOptions
          );
        }

        // The position's own id is what closing and modifying need; the order id is only the fallback.
        // (If neither comes back, the next comparison with the broker's open positions fills in the real id.)
        const clientPositionId = String(tradeResponse?.positionId || tradeResponse?.orderId || `client-pos-${Date.now()}`);

        // Store into tracking mapping table
        const mapping = this.positionMap.get(posId);
        if (mapping) {
          mapping.clientPositions.set(client.userId, {
            clientAccountId: client.accountId,
            clientPositionId,
            symbol: position.symbol,
            volume: clientLot,
            openPrice: tradeResponse?.openPrice || position.openPrice,
            openTime: new Date().toISOString(),
          });
        }

        const latency = Date.now() - startMs;
        console.log(`✅ [REPLICATION_SUCCESS] Client ${client.userId} executed ${clientLot} lots in ${latency}ms!`);

        return {
          clientUserId: client.userId,
          clientAccountId: client.accountId,
          masterPositionId: posId,
          clientPositionId,
          symbol: position.symbol,
          type: isBuy ? 'BUY' : 'SELL',
          masterVolume: position.volume,
          clientVolume: clientLot,
          status: 'EXECUTED',
          executionLatencyMs: latency,
        };
      } catch (err: any) {
        const errorMsg = err?.message || 'Broker trade execution error';
        console.error(`❌ [REPLICATION_ERROR] Client ${client.userId} trade execution failed:`, errorMsg);

        // Catch specific broker error codes
        let classifiedStatus: ReplicatedOrderResult['status'] = 'ERROR';
        if (errorMsg.includes('ERR_NOT_ENOUGH_MONEY') || errorMsg.includes('10019') || errorMsg.includes('margin')) {
          classifiedStatus = 'INSUFFICIENT_MARGIN';
        } else if (errorMsg.includes('OFFQUOTES') || errorMsg.includes('REQUOTE') || errorMsg.includes('REJECTED')) {
          classifiedStatus = 'REJECTED';
        }

        return {
          clientUserId: client.userId,
          clientAccountId: client.accountId,
          masterPositionId: posId,
          symbol: position.symbol,
          type: isBuy ? 'BUY' : 'SELL',
          masterVolume: position.volume,
          clientVolume: clientLot,
          status: classifiedStatus,
          executionLatencyMs: Date.now() - startMs,
          error: errorMsg,
        };
      }
    } else {
      // In simulated / test mode, record simulated instantaneous execution
      const simPositionId = `sim-pos-${client.userId}-${Date.now()}`;
      const mapping = this.positionMap.get(posId);
      if (mapping) {
        mapping.clientPositions.set(client.userId, {
          clientAccountId: client.accountId,
          clientPositionId: simPositionId,
          symbol: position.symbol,
          volume: clientLot,
          openPrice: position.openPrice,
          openTime: new Date().toISOString(),
        });
      }

      return {
        clientUserId: client.userId,
        clientAccountId: client.accountId,
        masterPositionId: posId,
        clientPositionId: simPositionId,
        symbol: position.symbol,
        type: isBuy ? 'BUY' : 'SELL',
        masterVolume: position.volume,
        clientVolume: clientLot,
        status: 'EXECUTED',
        executionLatencyMs: Date.now() - startMs,
      };
    }
  }

  /**
   * EVENT: PositionModified (SL / TP Update)
   * Propagate updated Stop Loss and Take Profit levels to all matching client positions
   */
  public async onPositionModified(position: MetatraderPosition): Promise<void> {
    const posId = String(position.id);
    this.masterPositions.set(posId, position);
    // A client whose copy we do not remember (for example after a restart) is looked up at their broker, once.
    await this.adoptMissingCopies(posId).catch(() => undefined);
    const mapping = this.positionMap.get(posId);
    if (!mapping) {
      console.warn(`⚠️ [REPLICATION_ENGINE] No client positions found for modified Master #${posId}`);
      return;
    }

    const promises = Array.from(mapping.clientPositions.entries()).map(async ([userId, clientPos]) => {
      const client = this.connectionManager.getClientConnection(userId);
      if (client?.rpcConnection) {
        try {
          console.log(`📝 [MODIFYING] Updating SL/TP for client ${userId} on position #${clientPos.clientPositionId}...`);
          await client.rpcConnection.modifyPosition(
            clientPos.clientPositionId,
            position.stopLoss || undefined,
            position.takeProfit || undefined
          );
        } catch (err: any) {
          console.error(`❌ [MODIFY_ERROR] Failed to modify position for client ${userId}:`, err?.message || err);
        }
      }
    });

    await Promise.all(promises);
  }

  /**
   * EVENT: PositionClosed
   * Immediately close corresponding replicated positions on all client accounts
   */
  public async onPositionClosed(positionId: string): Promise<void> {
    const posId = String(positionId);
    this.masterPositions.delete(posId);
    const mapping = this.positionMap.get(posId);

    // Clients whose copy we do not remember (a restart wipes the table; an order that timed out may still have
    // filled): their broker account is searched for a copy of this trade, so nothing is left open behind the master.
    const unremembered = this.copyTargets().filter((c) => !mapping?.clientPositions.has(c.userId));

    if (!mapping && unremembered.length === 0) {
      console.log(`ℹ️ [REPLICATION_ENGINE] Closed Master position #${posId} had no recorded client mappings.`);
      return;
    }

    const promises: Array<Promise<void>> = [];
    if (mapping) {
      console.log(`🛑 [CLOSING] Closing all replicated positions for Master #${posId}...`);
      for (const [userId, clientPos] of Array.from(mapping.clientPositions.entries())) {
        promises.push(
          (async () => {
            const client = this.connectionManager.getClientConnection(userId);
            if (client?.rpcConnection) {
              try {
                console.log(`🔒 [CLOSE] Closing position #${clientPos.clientPositionId} on client terminal ${client.accountId}...`);
                await client.rpcConnection.closePosition(clientPos.clientPositionId, {
                  slippage: this.riskConfig.maxSlippagePoints,
                });
              } catch (err: any) {
                console.error(`❌ [CLOSE_ERROR] Could not close client ${userId} position:`, err?.message || err);
              }
            }
          })()
        );
      }
    }
    for (const client of unremembered) {
      promises.push(this.closeUnremembered(client, posId).catch(() => undefined));
    }

    await Promise.all(promises);
    this.positionMap.delete(posId);
    this.lookedUp.delete(posId);
  }

  // ---------------------------------------------------------------------------------------------
  // Copy memory: the link "this client trade belongs to that master trade" is rebuilt from the brokers
  // ---------------------------------------------------------------------------------------------

  /** Connected, broker-verified clients that have a live link, once each. */
  private copyTargets(): ClientConnectionRecord[] {
    const byUser = new Map<string, ClientConnectionRecord>();
    for (const c of this.connectionManager.getAllClientRecords()) {
      if (!c.isBrokerVerified || c.isSimulated || !c.rpcConnection) continue;
      byUser.set(c.userId, c);
    }
    return Array.from(byUser.values());
  }

  /** A client's open positions as their broker reports them now; null when they cannot be read right now. */
  private async readClientPositions(client: ClientConnectionRecord): Promise<ClientPosition[] | null> {
    const rpc = client.rpcConnection;
    if (!rpc) return null;
    try {
      const list = await withTimeout(rpc.getPositions(), READ_TIMEOUT_MS, 'reading the client positions');
      return Array.isArray(list) ? (list as unknown as ClientPosition[]) : null;
    } catch {
      return null;
    }
  }

  private rememberCopy(a: Adoption): void {
    let mapping = this.positionMap.get(a.masterId);
    if (!mapping) {
      mapping = { masterPositionId: a.masterId, clientPositions: new Map() };
      this.positionMap.set(a.masterId, mapping);
    }
    mapping.clientPositions.set(a.userId, {
      clientAccountId: a.accountId,
      clientPositionId: a.positionId,
      symbol: a.symbol,
      volume: a.volume,
      openPrice: a.openPrice,
      openTime: a.openedAt,
    });
    this.copyStats.remembered++;
    console.log(
      `🧠 [COPY_MEMORY] Found client ${a.userId}'s copy #${a.positionId} of master trade #${a.masterId} (${a.volume} lots on ${a.symbol}). It follows that trade again.`
    );
  }

  /** Closes one copy at the client's broker. Returns true when the broker accepted it. */
  private async closeCopy(
    client: ClientConnectionRecord,
    masterId: string,
    positionId: string,
    reason: Closure['reason']
  ): Promise<boolean> {
    const rpc = client.rpcConnection;
    if (!rpc) return false;
    try {
      console.log(
        `🔒 [CLOSE] Closing ${reason === 'duplicate' ? 'a double' : 'a leftover'} copy #${positionId} of master trade #${masterId} on client terminal ${client.accountId}...`
      );
      await withTimeout(rpc.closePosition(positionId, { slippage: this.riskConfig.maxSlippagePoints }), CLOSE_TIMEOUT_MS, 'closing the copy');
      if (reason === 'duplicate') this.copyStats.doublesClosed++;
      else this.copyStats.leftoversClosed++;
      return true;
    } catch (err: any) {
      console.error(`❌ [CLOSE_ERROR] Could not close client ${client.userId} position #${positionId}:`, err?.message || err);
      return false;
    }
  }

  /** The master trade just closed: close any copy of it at this client's broker that we did not remember. */
  private async closeUnremembered(client: ClientConnectionRecord, masterId: string): Promise<void> {
    const list = await this.readClientPositions(client);
    if (!list) return; // cannot be read now: the next comparison with this account finds any leftover
    for (const p of list) {
      if (parseCopyComment(p.comment) !== masterId) continue;
      await this.closeCopy(client, masterId, String(p.id), 'master-closed');
    }
  }

  /** The master changed a trade: make sure copies we do not remember yet are known before passing the change on. */
  private async adoptMissingCopies(masterId: string): Promise<void> {
    const searched = this.lookedUp.get(masterId) ?? new Set<string>();
    this.lookedUp.set(masterId, searched);
    const remembered = this.positionMap.get(masterId)?.clientPositions;
    const targets = this.copyTargets().filter((c) => !remembered?.has(c.userId) && !searched.has(c.userId));
    if (targets.length === 0) return;
    for (const c of targets) searched.add(c.userId);

    const reads = await mapLimit(targets, READ_CONCURRENCY, async (c) => ({
      userId: c.userId,
      accountId: c.accountId,
      positions: await this.readClientPositions(c),
    }));
    for (const r of reads) if (r.positions === null) searched.delete(r.userId); // try again next time
    const plan = planReconcile({
      masterOpen: new Set(this.masterPositions.keys()),
      clients: reads,
      known: knownFromTable(this.positionMap),
      suspects: new Map(),
      now: Date.now(),
      confirmMs: this.confirmMs,
    });
    for (const a of plan.adopt) this.rememberCopy(a);
  }

  /** Looks again soon (debounced) at what every client holds. */
  public reconcileSoon(delayMs: number = 2_000): void {
    if (this.soonTimer) return;
    this.soonTimer = setTimeout(() => {
      this.soonTimer = null;
      void this.reconcileClients().catch(() => undefined);
    }, delayMs);
    this.soonTimer.unref?.();
  }

  private async closeLeftover(c: Closure): Promise<boolean> {
    const key = suspectKey(c.userId, c.positionId);
    // Last look before closing: the master trade must still be gone as far as this engine knows.
    if (c.reason === 'master-closed' && this.masterPositions.has(c.masterId)) return false;
    const client = this.connectionManager.getClientConnection(c.userId);
    const ok = client?.rpcConnection ? await this.closeCopy(client, c.masterId, c.positionId, c.reason) : false;
    if (!ok) {
      const failures = (this.closeFailures.get(key) ?? 0) + 1;
      this.closeFailures.set(key, failures);
      this.closeNotBefore.set(key, Date.now() + closeBackoffMs(failures));
    }
    return ok;
  }

  /**
   * Compares every client's open positions with the master's open trades:
   *  - a copy the engine does not remember is remembered again (so it follows the master trade after a restart);
   *  - a copy whose master trade is gone, or a second copy of the same trade, is closed, but only after it has
   *    looked wrong on two checks at least 20 seconds apart, and never when the master's trades are not known.
   * Copies are recognised only by their exact label "CastimoCopy #<master trade id>"; nothing else is touched.
   */
  public async reconcileClients(): Promise<{ ran: boolean; clients: number; remembered: number; closed: number; waiting: number }> {
    const idle = { ran: false, clients: 0, remembered: 0, closed: 0, waiting: 0 };
    if (this.reconciling || !this.seeded) return idle;
    const rpc = this.connectionManager.getMasterRpcConnection();
    if (!rpc || !this.connectionManager.isConnected()) return idle;

    this.reconciling = true;
    try {
      let live: Set<string>;
      try {
        const fresh = await withTimeout<MetatraderPosition[]>(rpc.getPositions(), READ_TIMEOUT_MS, "reading the master's trades");
        live = new Set(fresh.map((p: MetatraderPosition) => String(p.id)));
      } catch {
        return idle; // the master's trades cannot be read: decide nothing
      }

      const targets = this.copyTargets();
      const reads = await mapLimit(targets, READ_CONCURRENCY, async (c) => ({
        userId: c.userId,
        accountId: c.accountId,
        positions: await this.readClientPositions(c),
      }));

      const now = Date.now();
      // A master trade counts as gone only when the live read AND this engine's own list both say so.
      const masterOpen = new Set<string>([...live, ...this.masterPositions.keys()]);
      const plan = planReconcile({
        masterOpen,
        clients: reads,
        known: knownFromTable(this.positionMap),
        suspects: this.suspects,
        notBefore: this.closeNotBefore,
        now,
        confirmMs: this.confirmMs,
      });

      for (const a of plan.adopt) this.rememberCopy(a);

      const results = await mapLimit(plan.close, READ_CONCURRENCY, (c) => this.closeLeftover(c));
      const next = new Map(plan.suspects);
      let closed = 0;
      plan.close.forEach((c, i) => {
        if (results[i]) {
          closed++;
          next.delete(suspectKey(c.userId, c.positionId));
        }
      });
      this.suspects = next;
      for (const k of Array.from(this.closeNotBefore.keys())) if (!next.has(k)) this.closeNotBefore.delete(k);
      for (const k of Array.from(this.closeFailures.keys())) if (!next.has(k)) this.closeFailures.delete(k);

      this.copyStats.lastCheckAt = now;
      if (plan.waiting > 0) this.reconcileSoon(Math.min(this.confirmMs + 2_000, RECONCILE_MS));
      return { ran: true, clients: reads.length, remembered: plan.adopt.length, closed, waiting: plan.waiting };
    } finally {
      this.reconciling = false;
    }
  }

  // Helper Methods
  public getMasterPositionsCount(): number {
    return this.masterPositions.size;
  }

  public updateMasterBalance(balance: number): void {
    if (balance > 0) {
      this.masterBalance = balance;
    }
  }

  public trackMasterPosition(position: MetatraderPosition): void {
    this.masterPositions.set(String(position.id), position);
  }

  public hasMasterPosition(positionId: string | number): boolean {
    return this.masterPositions.has(String(positionId));
  }

  public handleConnectionChange(connected: boolean): void {
    console.log(`📡 [REPLICATION_ENGINE] Master synchronization state changed: ${connected ? 'ONLINE' : 'OFFLINE'}`);
  }

  /**
   * Programmatically simulate a Master position open event (e.g. for testing or UI simulation bridge)
   */
  public async simulateMasterTrade(
    symbol: string = 'XAUUSD',
    type: 'BUY' | 'SELL' = 'BUY',
    volume: number = 1.0,
    openPrice: number = 2650.50
  ): Promise<ReplicatedOrderResult[]> {
    const mockPos: MetatraderPosition = {
      id: Math.floor(Date.now() % 1000000000),
      type: type === 'BUY' ? 'POSITION_TYPE_BUY' : 'POSITION_TYPE_SELL',
      symbol,
      magic: 889900,
      time: new Date(),
      brokerTime: new Date().toISOString(),
      updateTime: new Date(),
      openPrice,
      currentPrice: openPrice,
      currentTickValue: 1,
      volume,
      swap: 0,
      realizedSwap: 0,
      unrealizedSwap: 0,
      profit: 0,
      realizedProfit: 0,
      unrealizedProfit: 0,
      commission: 0,
      realizedCommission: 0,
      unrealizedCommission: 0,
      stopLoss: type === 'BUY' ? openPrice - 15 : openPrice + 15,
      takeProfit: type === 'BUY' ? openPrice + 30 : openPrice - 30,
      comment: 'Castimo Master Signal',
      accountCurrencyExchangeRate: 1,
      reason: 'POSITION_REASON_CLIENT',
    } as unknown as MetatraderPosition;
    return await this.onPositionOpened(mockPos);
  }

  public getReplicationMetrics() {
    let copiesTracked = 0;
    for (const m of this.positionMap.values()) copiesTracked += m.clientPositions.size;
    return {
      masterBalance: this.masterBalance,
      openMasterPositions: this.masterPositions.size,
      totalReplicatedTrades: this.totalCopiedTrades,
      successfulCopies: this.successfulCopies,
      activeClientMirrors: this.connectionManager.getActiveClients().length,
      successRatePct: this.totalCopiedTrades > 0 ? Number(((this.successfulCopies / this.totalCopiedTrades) * 100).toFixed(1)) : 100,
      recentExecutions: this.executionHistory.slice(-20),
      // Real counts since the server started: nothing here is estimated.
      copyMemory: {
        ready: this.seeded,
        lastCheckAt: this.copyStats.lastCheckAt ? new Date(this.copyStats.lastCheckAt).toISOString() : null,
        copiesTracked,
        foundAfterRestart: this.copyStats.remembered,
        leftoversClosed: this.copyStats.leftoversClosed,
        doublesClosed: this.copyStats.doublesClosed,
        underWatch: this.suspects.size,
      },
    };
  }
}

export default ReplicationEngine;
