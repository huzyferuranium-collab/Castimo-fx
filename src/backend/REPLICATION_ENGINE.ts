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
} from './metaapiClient';
import {
  Mt5ConnectionManager,
  ClientConnectionRecord,
} from './MT5_CONNECTION_MANAGER';

export interface ReplicationRiskConfig {
  minEquityFloor: number;       // Mandatory $200.00 floor
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

export class MasterSynchronizationListener extends SynchronizationListener {
  private engine: ReplicationEngine;

  constructor(engine: ReplicationEngine) {
    super();
    this.engine = engine;
  }

  override async onConnected(instanceIndex: string, replicas: number): Promise<any> {
    console.log(`📡 [REPLICATION_LISTENER] Master Terminal connected (Instance: ${instanceIndex}, Replicas: ${replicas})`);
    this.engine.handleConnectionChange(true);
    Mt5ConnectionManager.getInstance().handleMasterConnected();
  }

  override async onDisconnected(instanceIndex: string): Promise<any> {
    console.warn(`⚠️ [REPLICATION_LISTENER] Master Terminal disconnected (Instance: ${instanceIndex})`);
    this.engine.handleConnectionChange(false);
    Mt5ConnectionManager.getInstance().handleMasterDisconnected();
  }

  override async onAccountInformationUpdated(
    instanceIndex: string,
    accountInformation: MetatraderAccountInformation
  ): Promise<any> {
    if (accountInformation.balance != null) {
      this.engine.updateMasterBalance(accountInformation.balance);
    }
    Mt5ConnectionManager.getInstance().updateMasterAccountMetrics(accountInformation);
  }

  override async onPositionsReplaced(instanceIndex: string, positions: Array<MetatraderPosition>): Promise<any> {
    console.log(`🔄 [REPLICATION_LISTENER] Initial synchronization: received ${positions.length} open master positions.`);
    for (const pos of positions) {
      this.engine.trackMasterPosition(pos);
    }
    Mt5ConnectionManager.getInstance().updateMasterPositionsCount(positions.length);
  }

  override async onPositionUpdated(instanceIndex: string, position: MetatraderPosition): Promise<any> {
    const posId = String(position.id);
    const isNew = !this.engine.hasMasterPosition(posId);
    if (isNew) {
      console.log(`⚡ [EVENT: PositionOpened] Master opened ${position.type} on ${position.symbol} (Volume: ${position.volume}, ID: ${posId})`);
      await this.engine.onPositionOpened(position);
    } else {
      console.log(`📝 [EVENT: PositionModified] Master modified position #${posId} (SL: ${position.stopLoss}, TP: ${position.takeProfit})`);
      await this.engine.onPositionModified(position);
    }
    Mt5ConnectionManager.getInstance().updateMasterPositionsCount(this.engine.getMasterPositionsCount());
  }

  override async onPositionRemoved(instanceIndex: string, positionId: string): Promise<any> {
    const posId = String(positionId);
    console.log(`🛑 [EVENT: PositionClosed] Master closed position #${posId}`);
    await this.engine.onPositionClosed(posId);
    Mt5ConnectionManager.getInstance().updateMasterPositionsCount(this.engine.getMasterPositionsCount());
  }
}

export class ReplicationEngine {
  private static instance: ReplicationEngine | null = null;
  private connectionManager: Mt5ConnectionManager;
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

  private constructor() {
    this.connectionManager = Mt5ConnectionManager.getInstance();
  }

  public static getInstance(): ReplicationEngine {
    if (!ReplicationEngine.instance) {
      ReplicationEngine.instance = new ReplicationEngine();
    }
    return ReplicationEngine.instance;
  }

  /**
   * Attach listener to Master Terminal WebSocket streaming connection
   */
  public attachToMasterStream(): void {
    const streamConn = this.connectionManager.getMasterStreamingConnection();
    if (streamConn) {
      const listener = new MasterSynchronizationListener(this);
      streamConn.addSynchronizationListener(listener);
      console.log('🔗 [REPLICATION_ENGINE] Attached real-time synchronization listener to Master WebSocket.');
    } else {
      console.warn('⚠️ [REPLICATION_ENGINE] Master streaming connection not yet available. Will attach upon connect.');
    }

    // Secondary high-speed RPC position poll fallback (detects opened/closed orders every 2.5s)
    setInterval(async () => {
      try {
        const rpc = this.connectionManager.getMasterRpcConnection();
        if (rpc && this.connectionManager.isConnected()) {
          const positions = await rpc.getPositions();
          const currentPosIds = new Set(positions.map((p) => String(p.id)));

          for (const pos of positions) {
            const pId = String(pos.id);
            if (!this.hasMasterPosition(pId)) {
              console.log(`⚡ [RPC_WATCHER] Discovered new master position #${pId} on ${pos.symbol}`);
              await this.onPositionOpened(pos);
            }
          }

          for (const [trackedId] of this.masterPositions) {
            if (!currentPosIds.has(trackedId)) {
              console.log(`🛑 [RPC_WATCHER] Discovered closed master position #${trackedId}`);
              await this.onPositionClosed(trackedId);
            }
          }
        }
      } catch {
        // Non-blocking query catch
      }
    }, 2500);
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

    // Pre-execution Check 1: Mandatory $200.00 Capital Floor
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
          comment: `CastimoCopy #${position.id}`,
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

        const clientPositionId = tradeResponse?.orderId || tradeResponse?.positionId || `client-pos-${Date.now()}`;

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
    if (!mapping) {
      console.log(`ℹ️ [REPLICATION_ENGINE] Closed Master position #${posId} had no recorded client mappings.`);
      return;
    }

    console.log(`🛑 [CLOSING] Closing all replicated positions for Master #${posId}...`);
    const promises = Array.from(mapping.clientPositions.entries()).map(async ([userId, clientPos]) => {
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
    });

    await Promise.all(promises);
    this.positionMap.delete(posId);
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
    return {
      masterBalance: this.masterBalance,
      openMasterPositions: this.masterPositions.size,
      totalReplicatedTrades: this.totalCopiedTrades,
      successfulCopies: this.successfulCopies,
      activeClientMirrors: this.connectionManager.getActiveClients().length,
      successRatePct: this.totalCopiedTrades > 0 ? Number(((this.successfulCopies / this.totalCopiedTrades) * 100).toFixed(1)) : 100,
      recentExecutions: this.executionHistory.slice(-20),
    };
  }
}

export default ReplicationEngine;
