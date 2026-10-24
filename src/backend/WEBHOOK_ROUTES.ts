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
import { requireUser, requireAdmin, getAuthUser, isAdminUser } from './firebaseAuth';
import { hasAcceptedTermsServer } from './termsCheck';
import { BrokerVerificationError } from './brokerVerification';
import { BillingService, BillingError, billingConfig, billingEnabled } from './billing';

export const tradeRouter = Router();

const connectionManager = Mt5ConnectionManager.getInstance();
const replicationEngine = ReplicationEngine.getInstance();

/** Only fields that are safe to show. Never expose connection objects or credentials. */
function toPublicClient(c: any) {
  return {
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
    isSimulated: Boolean(c.isSimulated),
    brokerName: c.brokerName,
    accountHolderName: c.accountHolderName,
    isBrokerVerified: Boolean(c.isBrokerVerified),
    tradeAllowed: c.tradeAllowed,
    investorMode: c.investorMode,
    accountType: c.accountType,
    verificationTimestamp: c.verificationTimestamp,
    lastSync: c.lastSync,
    billingBlocked: Boolean(c.billingBlocked),
  };
}

const STATUS_BY_CODE: Record<string, number> = {
  BAD_INPUT: 400,
  VERIFICATION_UNAVAILABLE: 503,
  BROKER_SERVER_NOT_FOUND: 400,
  BROKER_AUTH_FAILED: 400,
  BROKER_UNREACHABLE: 502,
  BAD_BROKER_RESPONSE: 502,
  LOGIN_MISMATCH: 400,
  TRADING_NOT_ALLOWED: 400,
  ALREADY_LINKED: 409,
  IS_MASTER_ACCOUNT: 409,
  CAPACITY: 503,
};

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
tradeRouter.post('/toggle-mirror', requireUser, async (req: Request, res: Response) => {
  try {
    // The user comes from the verified sign-in token, never from the request body.
    const user = getAuthUser(req);
    const { targetState } = req.body || {};
    if (targetState !== undefined && targetState !== 'ACTIVE' && targetState !== 'IDLE') {
      return res.status(400).json({ success: false, error: 'targetState must be ACTIVE or IDLE.' });
    }

    // Only a broker-verified account that THIS user connected can be switched on.
    const client = connectionManager.getClientConnection(user.uid);
    if (!client || !client.isBrokerVerified || client.isSimulated) {
      return res.status(409).json({
        success: false,
        code: 'NO_VERIFIED_ACCOUNT',
        error: 'Connect a broker-verified MT5 account first.',
      });
    }

    const newState: 'ACTIVE' | 'IDLE' = targetState ? targetState : client.status === 'ACTIVE' ? 'IDLE' : 'ACTIVE';

    if (newState === 'ACTIVE') {
      await BillingService.getInstance().assertNotOverdue(user.uid); // throws BillingError when overdue
    }

    if (newState === 'ACTIVE') {
      if (client.tradeAllowed === false || client.investorMode) {
        return res.status(403).json({
          success: false,
          code: 'TRADING_NOT_ALLOWED',
          error: 'This login cannot place trades, so copying cannot be activated.',
        });
      }
      // Safety floor, using the equity the broker reported.
      if (client.equity < 25.0) {
        return res.status(403).json({
          success: false,
          error: `Cannot activate trade copying: account equity ($${client.equity.toFixed(2)}) is below the required safety floor ($25.00).`,
          code: 'EQUITY_BELOW_MINIMUM_FLOOR',
          equity: client.equity,
          minimumRequired: 25.0,
        });
      }
    }

    client.status = newState;
    client.lastSync = new Date().toISOString();
    connectionManager.registerClient(client);

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
    if (error instanceof BillingError) {
      return res.status(error.status).json({ success: false, code: 'INVOICE_OVERDUE', error: error.message });
    }
    console.error('❌ [API /api/trade/toggle-mirror] Error:', error?.message || error);
    return res.status(500).json({ success: false, error: 'Failed to toggle mirror state' });
  }
});

/**
 * POST /api/trade/provision-client  (signed-in users only)
 * Connects the caller's own broker account. The server asks the broker to confirm the login,
 * password and server, and every figure returned comes from the broker. Anything the browser
 * sends besides login, password and server is ignored.
 */
tradeRouter.post('/provision-client', requireUser, async (req: Request, res: Response) => {
  try {
    const user = getAuthUser(req);
    const { login, password, server, platform } = req.body || {};

    if (!(await hasAcceptedTermsServer(user))) {
      return res.status(403).json({
        success: false,
        code: 'TERMS_NOT_ACCEPTED',
        error: 'Please read and accept the Terms and Risk Warning before connecting an account.',
      });
    }

    await BillingService.getInstance().assertNotOverdue(user.uid);

    const clientRecord = await connectionManager.provisionClientTerminal({
      userId: user.uid,
      login: String(login ?? ''),
      password: typeof password === 'string' ? password : '',
      server: String(server ?? ''),
      platform: platform === 'mt4' ? 'mt4' : 'mt5',
    });

    return res.status(201).json({
      success: true,
      message: 'Broker account verified and connected.',
      client: toPublicClient(clientRecord),
    });
  } catch (error: any) {
    if (error instanceof BillingError) {
      return res.status(error.status).json({ success: false, code: 'INVOICE_OVERDUE', error: error.message });
    }
    if (error instanceof BrokerVerificationError) {
      return res.status(STATUS_BY_CODE[error.code] ?? 400).json({ success: false, code: error.code, error: error.message });
    }
    console.error('❌ [API /api/trade/provision-client] Unexpected error:', error?.message || error);
    return res.status(500).json({ success: false, error: 'Could not verify this account. Nothing was connected.' });
  }
});

/**
 * POST /api/trade/update-client  (administrators only)
 * Pause or resume a client's copying. It cannot create clients or change balance, equity or identity.
 */
tradeRouter.post('/update-client', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId, accountId, status } = req.body || {};
    const targetId = userId || accountId;
    if (!targetId) {
      return res.status(400).json({ success: false, error: 'userId or accountId is required.' });
    }
    if (status !== 'ACTIVE' && status !== 'IDLE') {
      return res.status(400).json({ success: false, error: 'status must be ACTIVE or IDLE.' });
    }
    const updated = connectionManager.updateClientMetrics(String(targetId), { status });
    if (!updated) {
      return res.status(404).json({ success: false, error: 'No verified client with that id.' });
    }
    return res.status(200).json({ success: true, client: toPublicClient(updated) });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: 'Failed to update client' });
  }
});

/**
 * POST /api/trade/reverify-client  (signed-in users; administrators may name any user)
 * Re-asks the broker for live balance and equity.
 */
tradeRouter.post('/reverify-client', requireUser, async (req: Request, res: Response) => {
  try {
    const user = getAuthUser(req);
    let targetId = user.uid;
    const requested = req.body?.userId;
    if (requested && requested !== user.uid) {
      if (!(await isAdminUser(user))) {
        return res.status(403).json({ success: false, error: 'You can only refresh your own account.' });
      }
      targetId = String(requested);
    }
    const updated = await connectionManager.refreshClientFromBroker(targetId);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'No connected account found. Connect your MT5 account first.' });
    }
    return res.status(200).json({ success: true, client: toPublicClient(updated) });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: 'Failed to refresh account from broker' });
  }
});

/**
 * POST /api/trade/disconnect-client  (signed-in users; administrators may name any user)
 * Removes the broker account from the platform and from MetaApi, which stops its monthly charge.
 */
tradeRouter.post('/disconnect-client', requireUser, async (req: Request, res: Response) => {
  try {
    const user = getAuthUser(req);
    let targetId = user.uid;
    const requested = req.body?.userId;
    if (requested && requested !== user.uid) {
      if (!(await isAdminUser(user))) {
        return res.status(403).json({ success: false, error: 'You can only disconnect your own account.' });
      }
      targetId = String(requested);
    }
    const result = await connectionManager.removeClientTerminal(targetId);
    return res.status(200).json({ success: true, removed: result.removed });
  } catch (error: any) {
    if (error instanceof BrokerVerificationError) {
      return res.status(STATUS_BY_CODE[error.code] ?? 400).json({ success: false, code: error.code, error: error.message });
    }
    return res.status(500).json({ success: false, error: 'Failed to disconnect the account' });
  }
});

/**
 * Billing: a client's own invoices, paying one (checked on the TRON blockchain), and admin tools.
 */
tradeRouter.get('/invoices', requireUser, async (req: Request, res: Response) => {
  try {
    const user = getAuthUser(req);
    const cfg = billingConfig();
    const invoices = await BillingService.getInstance().listInvoicesForUser(user.uid);
    return res.status(200).json({
      success: true,
      billingEnabled: billingEnabled(),
      feePct: cfg.feePct,
      periodDays: cfg.periodDays,
      treasuryAddress: billingEnabled() ? cfg.treasury : '',
      invoices,
    });
  } catch {
    return res.status(500).json({ success: false, error: 'Could not load invoices.' });
  }
});

tradeRouter.post('/pay-invoice', requireUser, async (req: Request, res: Response) => {
  try {
    const user = getAuthUser(req);
    const invoice = await BillingService.getInstance().payInvoice(user.uid, String(req.body?.invoiceId ?? ''), String(req.body?.txHash ?? ''));
    return res.status(200).json({ success: true, invoice });
  } catch (error: any) {
    if (error instanceof BillingError) return res.status(error.status).json({ success: false, error: error.message });
    console.error('❌ [API /pay-invoice]', error?.message || error);
    return res.status(500).json({ success: false, error: 'Could not verify the payment. Please try again.' });
  }
});

tradeRouter.get('/admin/invoices', requireAdmin, async (_req: Request, res: Response) => {
  try {
    return res.status(200).json({ success: true, invoices: await BillingService.getInstance().listAllInvoices() });
  } catch {
    return res.status(500).json({ success: false, error: 'Could not load invoices.' });
  }
});

tradeRouter.post('/admin/confirm-invoice', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = getAuthUser(req);
    const invoice = await BillingService.getInstance().adminConfirm(admin.uid, String(req.body?.invoiceId ?? ''), req.body?.note);
    return res.status(200).json({ success: true, invoice });
  } catch (error: any) {
    if (error instanceof BillingError) return res.status(error.status).json({ success: false, error: error.message });
    return res.status(500).json({ success: false, error: 'Could not confirm the invoice.' });
  }
});

/** GET /api/trade/capacity  (administrators only): accounts used versus your limit. */
tradeRouter.get('/capacity', requireAdmin, async (_req: Request, res: Response) => {
  try {
    return res.status(200).json({ success: true, ...(await connectionManager.getCapacity()) });
  } catch {
    return res.status(500).json({ success: false, error: 'Could not read capacity' });
  }
});

/**
 * GET /api/trade/my-account  (signed-in users)
 * The caller's own broker-verified account, or connected:false.
 */
tradeRouter.get('/my-account', requireUser, async (req: Request, res: Response) => {
  const user = getAuthUser(req);
  const c = connectionManager.getClientConnection(user.uid) ?? (await connectionManager.restoreClientForUser(user.uid));
  if (!c || !c.isBrokerVerified || c.isSimulated) {
    return res.status(200).json({ success: true, connected: false, client: null });
  }
  return res.status(200).json({ success: true, connected: true, client: toPublicClient(c) });
});

/**
 * GET /api/trade/clients  (administrators only)
 * Every broker-verified client in the replication pipeline.
 */
tradeRouter.get('/clients', requireAdmin, (req: Request, res: Response) => {
  try {
    const clients = connectionManager.getActiveClients();
    return res.status(200).json({ success: true, count: clients.length, clients: clients.map(toPublicClient) });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: 'Failed to fetch clients' });
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
 * POST /api/trade/retry-master  (administrators only)
 */
tradeRouter.post('/retry-master', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await connectionManager.retryMasterConnection();
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: 'Error retrying master connection' });
  }
});

/**
 * POST /api/trade/simulate-trade  (administrators only, and OFF unless ALLOW_SIMULATED_TRADES=true)
 * A test trade on the master terminal. It must never be reachable on a production server.
 */
tradeRouter.post('/simulate-trade', requireAdmin, async (req: Request, res: Response) => {
  try {
    if (process.env.ALLOW_SIMULATED_TRADES !== 'true') {
      return res.status(403).json({ success: false, error: 'Test trades are disabled on this server.' });
    }
    const { symbol = 'XAUUSD', type = 'BUY', volume = 1.0, openPrice = 2650.5 } = req.body || {};
    const results = await replicationEngine.simulateMasterTrade(symbol, type, Number(volume), Number(openPrice));
    return res.status(200).json({ success: true, replicatedOrders: results, count: results.length });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: 'Error simulating master trade' });
  }
});

export default tradeRouter;
