/**
 * CASTIMOFX - Webhook & Trade API Routes
 * 
 * Express API endpoints providing communication between the frontend client dashboard
 * and the MetaApi backend replication engine.
 * 
 * - POST /api/trade/toggle-mirror: Toggles user terminal copy relationship state (ACTIVE <-> IDLE).
 * - GET  /api/trade/account-status: Checks MetaApi terminal synchronization connection status for UI banners.
 * - POST /api/trade/provision-client: Provisions new client MT5 terminals.
 * - GET  /api/trade/metrics: Returns execution statistics and replication telemetry.
 */

import { Router, Request, Response } from 'express';
import { Mt5ConnectionManager } from './MT5_CONNECTION_MANAGER';
import { ReplicationEngine } from './REPLICATION_ENGINE';

export const tradeRouter = Router();

const connectionManager = Mt5ConnectionManager.getInstance();
const replicationEngine = ReplicationEngine.getInstance();

/**
 * GET /api/trade/account-status
 * Checks if the MetaApi terminal synchronization is currently connected or disconnected
 * to supply real-time connection status to the frontend UI banner.
 */
tradeRouter.get('/account-status', async (req: Request, res: Response) => {
  try {
    const metrics = connectionManager.getMasterMetrics();
    const isConnected = connectionManager.isConnected();
    const activeClients = connectionManager.getActiveClients();
    const replicationStats = replicationEngine.getReplicationMetrics();

    const topUpNotice = connectionManager.getTopUpNotice();
    const isSimulated = connectionManager.isSimulated();

    return res.status(200).json({
      success: true,
      connected: isConnected,
      status: metrics.state,
      connectionStatus: metrics.connectionStatus,
      latencyMs: metrics.latencyMs,
      lastPing: metrics.lastHeartbeat,
      topUpNotice,
      isSimulated,
      mode: isSimulated ? 'SIMULATED_BRIDGE' : 'LIVE_METAAPI',
      master: {
        accountId: metrics.accountId || 'master-castimo-001',
        login: metrics.login || '9827361',
        server: metrics.server || 'MetaQuotes-Demo',
        balance: metrics.balance,
        equity: metrics.equity,
        freeMargin: metrics.freeMargin,
        marginLevel: metrics.marginLevel,
        currency: metrics.currency,
        openPositionsCount: metrics.openPositionsCount,
      },
      activeClientsCount: activeClients.length,
      replication: {
        totalCopiedTrades: replicationStats.totalReplicatedTrades,
        successfulCopies: replicationStats.successfulCopies,
        successRatePct: replicationStats.successRatePct,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('❌ [API /api/trade/account-status] Failed to fetch account status:', error?.message || error);
    return res.status(500).json({
      success: false,
      connected: false,
      status: 'ERROR',
      error: error?.message || 'Internal server error while querying terminal status',
    });
  }
});

/**
 * POST /api/trade/toggle-mirror
 * Changes the state of a user's terminal copy relationship from idle to active (or vice versa).
 * 
 * Body: {
 *   userId: string;
 *   accountId?: string;
 *   targetState?: 'ACTIVE' | 'IDLE';
 * }
 */
tradeRouter.post('/toggle-mirror', async (req: Request, res: Response) => {
  try {
    const { userId, accountId, targetState } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: userId is required.',
      });
    }

    // Lookup client terminal in connection manager pool
    let client = connectionManager.getClientConnection(userId);
    if (!client && accountId) {
      client = connectionManager.getClientConnection(accountId);
    }

    // If client is not yet registered in pool, register a baseline record
    if (!client) {
      const defaultBal = req.body.balance != null ? Number(req.body.balance) : 100.0;
      client = {
        userId,
        accountId: accountId || `client-acc-${userId}`,
        login: 'Awaiting Credentials',
        server: 'Awaiting Server',
        status: 'IDLE',
        balance: defaultBal,
        equity: defaultBal,
        currency: 'USD',
        leverage: 100,
        lastSync: new Date().toISOString(),
      };
      connectionManager.registerClient(client);
    }

    // Determine new state
    const newState: 'ACTIVE' | 'IDLE' = targetState
      ? targetState
      : client.status === 'ACTIVE'
      ? 'IDLE'
      : 'ACTIVE';

    // Safety Validation when activating: Verify capital floor ($25.00)
    if (newState === 'ACTIVE' && client.equity < 25.0) {
      return res.status(403).json({
        success: false,
        error: `Cannot activate trade copying: client equity ($${client.equity.toFixed(2)}) is below the required safety floor ($25.00).`,
        code: 'EQUITY_BELOW_MINIMUM_FLOOR',
        equity: client.equity,
        minimumRequired: 25.0,
      });
    }

    // Update status in pool
    client.status = newState;
    client.lastSync = new Date().toISOString();
    connectionManager.registerClient(client);

    console.log(`🔄 [API /api/trade/toggle-mirror] User ${userId} copy relationship changed to: ${newState}`);

    return res.status(200).json({
      success: true,
      userId: client.userId,
      accountId: client.accountId,
      status: client.status,
      message:
        newState === 'ACTIVE'
          ? 'Trade mirroring activated. Orders on the master account will now be replicated with lot scaling.'
          : 'Trade mirroring paused. New master orders will not be executed on this account.',
      updatedAt: client.lastSync,
    });
  } catch (error: any) {
    console.error('❌ [API /api/trade/toggle-mirror] Error:', error?.message || error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to toggle mirror state',
    });
  }
});

/**
 * POST /api/trade/provision-client
 * Provisions a new client MT5 terminal using Login, Password, Broker Server, and live balance
 */
tradeRouter.post('/provision-client', async (req: Request, res: Response) => {
  try {
    const { userId, login, password, server, name, platform, balance, equity } = req.body;

    if (!userId || !login || !password || !server) {
      return res.status(400).json({
        success: false,
        error: 'Missing required credentials: userId, login, password, and server are required.',
      });
    }

    console.log(`🔐 [API /api/trade/provision-client] Provisioning terminal for user: ${userId}`);

    const clientRecord = await connectionManager.provisionClientTerminal({
      userId,
      login: String(login),
      password: String(password),
      server: String(server),
      name,
      platform: platform === 'mt4' ? 'mt4' : 'mt5',
      balance: balance != null ? Number(balance) : (equity != null ? Number(equity) : undefined),
    });

    return res.status(201).json({
      success: true,
      message: 'Client MT5 terminal provisioned and synchronized successfully.',
      client: {
        userId: clientRecord.userId,
        accountId: clientRecord.accountId,
        login: clientRecord.login,
        server: clientRecord.server,
        status: clientRecord.status,
        balance: clientRecord.balance,
        equity: clientRecord.equity,
        freeMargin: clientRecord.freeMargin,
        leverage: clientRecord.leverage,
        currency: clientRecord.currency,
        isSimulated: clientRecord.isSimulated,
        brokerName: clientRecord.brokerName,
        accountHolderName: clientRecord.accountHolderName,
        isBrokerVerified: clientRecord.isBrokerVerified,
        tradeAllowed: clientRecord.tradeAllowed,
        investorMode: clientRecord.investorMode,
        verificationTimestamp: clientRecord.verificationTimestamp,
      },
    });
  } catch (error: any) {
    console.error('❌ [API /api/trade/provision-client] Provisioning error:', error?.message || error);
    return res.status(400).json({
      success: false,
      error: error?.message || 'Failed to authenticate and verify MT5 terminal with broker.',
    });
  }
});

/**
 * POST /api/trade/update-client
 * Updates a client's live balance, equity, or status in real time
 */
tradeRouter.post('/update-client', async (req: Request, res: Response) => {
  try {
    const { userId, accountId, login, server, balance, equity, status } = req.body;
    const targetId = userId || accountId || login;

    if (!targetId) {
      return res.status(400).json({
        success: false,
        error: 'userId, accountId, or login is required to update client metrics.',
      });
    }

    const updated = connectionManager.updateClientMetrics(targetId, {
      balance: balance != null ? Number(balance) : undefined,
      equity: equity != null ? Number(equity) : undefined,
      status: status || undefined,
      server: server || undefined,
      login: login ? String(login) : undefined,
    });

    if (!updated) {
      // Create if doesn't exist
      const newRecord = {
        userId: userId || targetId,
        accountId: accountId || `client-acc-${targetId}`,
        login: login || 'Live Account',
        server: server || 'HFMarketsGlobal-Live20',
        status: (status as any) || 'ACTIVE',
        balance: balance != null ? Number(balance) : 100.0,
        equity: equity != null ? Number(equity) : (balance != null ? Number(balance) : 100.0),
        currency: 'USD',
        leverage: 100,
        lastSync: new Date().toISOString(),
      };
      connectionManager.registerClient(newRecord);
      return res.status(200).json({ success: true, client: newRecord });
    }

    return res.status(200).json({
      success: true,
      client: {
        userId: updated.userId,
        accountId: updated.accountId,
        login: updated.login,
        server: updated.server,
        status: updated.status,
        balance: updated.balance,
        equity: updated.equity,
        currency: updated.currency,
        lastSync: updated.lastSync,
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to update client metrics',
    });
  }
});

/**
 * POST /api/trade/reverify-client
 * Re-queries the live MT5 broker via RPC for an active client terminal,
 * refreshing live balance, equity, freeMargin, leverage, and broker details.
 */
tradeRouter.post('/reverify-client', async (req: Request, res: Response) => {
  try {
    const { userId, accountId, login } = req.body;
    const targetId = userId || accountId || login;
    if (!targetId) {
      return res.status(400).json({ success: false, error: 'userId, accountId, or login is required.' });
    }
    const updated = await connectionManager.refreshClientFromBroker(String(targetId));
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Client terminal not found in active pool.' });
    }
    return res.status(200).json({
      success: true,
      client: {
        userId: updated.userId,
        accountId: updated.accountId,
        login: updated.login,
        server: updated.server,
        status: updated.status,
        balance: updated.balance,
        equity: updated.equity,
        freeMargin: updated.freeMargin,
        leverage: updated.leverage,
        currency: updated.currency,
        brokerName: updated.brokerName,
        accountHolderName: updated.accountHolderName,
        isBrokerVerified: updated.isBrokerVerified,
        tradeAllowed: updated.tradeAllowed,
        investorMode: updated.investorMode,
        lastSync: updated.lastSync,
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to reverify client account with broker',
    });
  }
});

/**
 * GET /api/trade/clients
 * Returns all active client accounts connected to the replication pipeline
 */
tradeRouter.get('/clients', (req: Request, res: Response) => {
  try {
    const clients = connectionManager.getActiveClients();
    return res.status(200).json({
      success: true,
      count: clients.length,
      clients: clients.map((c) => ({
        userId: c.userId,
        accountId: c.accountId,
        login: c.login,
        server: c.server,
        status: c.status,
        balance: c.balance,
        equity: c.equity,
        freeMargin: c.freeMargin,
        leverage: c.leverage,
        currency: c.currency,
        isSimulated: c.isSimulated,
        brokerName: c.brokerName,
        accountHolderName: c.accountHolderName,
        isBrokerVerified: c.isBrokerVerified,
        tradeAllowed: c.tradeAllowed,
        investorMode: c.investorMode,
        verificationTimestamp: c.verificationTimestamp,
        lastSync: c.lastSync,
      })),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to fetch clients',
    });
  }
});

/**
 * GET /api/trade/metrics
 * Returns comprehensive performance and execution statistics
 */
tradeRouter.get('/metrics', (req: Request, res: Response) => {
  try {
    const metrics = replicationEngine.getReplicationMetrics();
    return res.status(200).json({
      success: true,
      metrics,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to fetch metrics',
    });
  }
});

/**
 * POST /api/trade/retry-master
 * Manually retries connection & deployment to Master Terminal once user tops up account.
 */
tradeRouter.post('/retry-master', async (req: Request, res: Response) => {
  try {
    const result = await connectionManager.retryMasterConnection();
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Error retrying master connection',
    });
  }
});

/**
 * POST /api/trade/simulate-trade
 * Programmatically triggers a test trade on Master terminal to test balance-ratio lot scaling across clients
 */
tradeRouter.post('/simulate-trade', async (req: Request, res: Response) => {
  try {
    const { symbol = 'XAUUSD', type = 'BUY', volume = 1.0, openPrice = 2650.5 } = req.body || {};
    const results = await replicationEngine.simulateMasterTrade(symbol, type, Number(volume), Number(openPrice));
    return res.status(200).json({
      success: true,
      replicatedOrders: results,
      count: results.length,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Error simulating master trade',
    });
  }
});

export default tradeRouter;
