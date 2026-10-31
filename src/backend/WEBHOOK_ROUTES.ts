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

import { clientIpFrom } from './clientIp';
import { Router, Request, Response } from 'express';
import { Mt5ConnectionManager } from './MT5_CONNECTION_MANAGER';
import { ReplicationEngine } from './REPLICATION_ENGINE';
import { requireUser, requireAdmin, getAuthUser, isAdminUser } from './firebaseAuth';
import { hasAcceptedTermsServer } from './termsCheck';
import { recordEvent } from './referralService';
import { BrokerVerificationError, validateSubmittedCredentials, normalizeBrokerServer } from './brokerVerification';
import { ConnectJobs, pendingFor } from './clientBridge';
import { BillingService, BillingError, billingConfig, billingEnabled } from './billing';

export const tradeRouter = Router();

const connectionManager = Mt5ConnectionManager.getInstance();
const replicationEngine = ReplicationEngine.getInstance();
/**
 * One background connection per user, polled by the browser (see clientBridge.ts). If the overall time limit
 * is reached while the user's terminal exists, the terminal supervisor carries on and the job says so.
 */
export const connectJobs = new ConnectJobs<ReturnType<typeof toPublicClient>>({
  canContinueInBackground: (uid) => connectionManager.continueInBackground(uid),
});

// A new connection is announced once, and only because it really happened (from the browser or in the background).
connectionManager.onNewConnection = (uid) => void recordEvent('ACCOUNT_CONNECTED', uid, `connected-${uid}`);

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
    brokerName: c.brokerName,
    accountHolderName: c.accountHolderName,
    isBrokerVerified: Boolean(c.isBrokerVerified),
    tradeAllowed: c.tradeAllowed,
    investorMode: c.investorMode,
    accountType: c.accountType,
    verificationTimestamp: c.verificationTimestamp,
    lastSync: c.lastSync,
    billingBlocked: Boolean(c.billingBlocked),
    connectionState: c.connectionState,
    connectionStatus: c.connectionStatus,
    latencyMs: c.latencyMs,
    lastHeartbeat: c.lastHeartbeat,
  };
}

const STATUS_BY_CODE: Record<string, number> = {
  BAD_INPUT: 400,
  VERIFICATION_UNAVAILABLE: 503,
  BROKER_SERVER_NOT_FOUND: 400,
  BROKER_AUTH_FAILED: 400,
  BROKER_UNREACHABLE: 502,
  BROKER_SLOW: 504,
  BAD_BROKER_RESPONSE: 502,
  LOGIN_MISMATCH: 400,
  TRADING_NOT_ALLOWED: 400,
  ALREADY_LINKED: 409,
  ALREADY_CONNECTED: 409,
  IS_MASTER_ACCOUNT: 409,
  MIN_EQUITY: 422,
  UNSUPPORTED_CURRENCY: 422,
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

    return res.status(200).json({
      success: true,
      connected: isConnected,
      status: metrics.state,
      connectionStatus: metrics.connectionStatus,
      latencyMs: metrics.latencyMs,
      lastPing: metrics.lastHeartbeat,
      topUpNotice,
      mode: 'LIVE_METAAPI',
      master: {
        accountId: metrics.accountId || '',
        login: metrics.login || '',
        server: metrics.server || '',
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
    if (!client || !client.isBrokerVerified) {
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
      return res.status(error.status).json({ success: false, code: error.status === 403 ? 'PLAN_REQUIRED' : 'INVOICE_OVERDUE', error: error.message });
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

    // The email address must be confirmed first (administrators are exempt).
    if (!user.emailVerified && !(await isAdminUser(user))) {
      return res.status(403).json({
        success: false,
        code: 'EMAIL_NOT_VERIFIED',
        error: 'Please confirm your email address before connecting an account.',
      });
    }

    await BillingService.getInstance().assertMayConnect(user.uid);

    // Typing mistakes are reported straight away; the slow broker check then runs in the background.
    const checked = validateSubmittedCredentials({ login, password, server });
    const serverName = normalizeBrokerServer(checked.server);

    const { job, started } = connectJobs.start(
      user.uid,
      { login: checked.login, server: serverName, secrets: [checked.password] },
      async (report) => {
        const clientRecord = await connectionManager.provisionClientTerminal(
          {
            userId: user.uid,
            login: checked.login,
            password: checked.password,
            server: checked.server,
            platform: platform === 'mt4' ? 'mt4' : 'mt5',
          },
          report
        );
        return toPublicClient(clientRecord);
      }
    );

    return res.status(202).json({
      success: true,
      started,
      message: started ? 'Connecting. This can take a minute.' : 'A connection is already in progress.',
      job,
    });
  } catch (error: any) {
    if (error instanceof BillingError) {
      return res.status(error.status).json({ success: false, code: error.status === 403 ? 'PLAN_REQUIRED' : 'INVOICE_OVERDUE', error: error.message });
    }
    if (error instanceof BrokerVerificationError) {
      return res.status(STATUS_BY_CODE[error.code] ?? 400).json({ success: false, code: error.code, error: error.message });
    }
    console.error('❌ [API /api/trade/provision-client] Unexpected error:', error?.message || error);
    return res.status(500).json({ success: false, error: 'Could not verify this account. Nothing was connected.' });
  }
});

/**
 * GET /api/trade/connect-status  (signed-in users)
 * Progress of the caller's latest connection: stage, percent, and on failure a clear reason and next step.
 * The browser polls this while the Connect popup is open.
 */
tradeRouter.get('/connect-status', requireUser, (req: Request, res: Response) => {
  const user = getAuthUser(req);
  const live = connectionManager.getClientConnection(user.uid);
  return res.status(200).json({
    success: true,
    job: connectJobs.get(user.uid),
    // The terminal the supervisor is still looking after for this client (null when there is none).
    pending: pendingFor(connectionManager.getSupervisor()?.view(user.uid), connectJobs.get(user.uid)),
    connected: Boolean(live && live.isBrokerVerified),
  });
});

/**
 * GET /api/trade/admin/connect-failures  (administrators only)
 * The most recent failed connection attempts with the technical reason (passwords are scrubbed).
 */
tradeRouter.get('/admin/connect-failures', requireAdmin, (_req: Request, res: Response) => {
  return res.status(200).json({ success: true, failures: connectJobs.recentFailures(), successes: connectJobs.recentSuccesses() });
});

/**
 * Client terminals as MetaApi sees them, and what the supervisor is doing about each one (administrators only).
 * The master account is never listed and can never be touched from here.
 */
tradeRouter.get('/admin/terminals', requireAdmin, async (_req: Request, res: Response) => {
  const sup = connectionManager.getSupervisor();
  if (!sup) return res.status(503).json({ success: false, error: 'The terminal supervisor is not running (MetaApi is not connected).' });
  try {
    const rows = await sup.inventory();
    return res.status(200).json({ success: true, terminals: rows, supervisor: sup.stats, ...(await connectionManager.getCapacity().catch(() => ({}))) });
  } catch (e: any) {
    console.error('❌ [API /admin/terminals]', e?.message || e);
    return res.status(502).json({ success: false, error: 'Could not read the terminals from MetaApi.' });
  }
});

tradeRouter.post('/admin/terminals/redeploy', requireAdmin, async (req: Request, res: Response) => {
  const sup = connectionManager.getSupervisor();
  if (!sup) return res.status(503).json({ success: false, error: 'The terminal supervisor is not running.' });
  try {
    const r = await sup.redeployTerminal(String(req.body?.accountId ?? ''));
    return res.status(r.ok ? 200 : r.reason === 'NOT_FOUND' ? 404 : 400).json({ success: r.ok, reason: r.reason });
  } catch (e: any) {
    console.error('❌ [API /admin/terminals/redeploy]', e?.message || e);
    return res.status(502).json({ success: false, error: 'MetaApi did not accept the restart.' });
  }
});

tradeRouter.post('/admin/terminals/remove', requireAdmin, async (req: Request, res: Response) => {
  const sup = connectionManager.getSupervisor();
  if (!sup) return res.status(503).json({ success: false, error: 'The terminal supervisor is not running.' });
  try {
    const r = await sup.removeTerminal(String(req.body?.accountId ?? ''), { force: req.body?.force === true });
    return res.status(r.ok ? 200 : r.reason === 'NOT_FOUND' ? 404 : 409).json({ success: r.ok, reason: r.reason });
  } catch (e: any) {
    console.error('❌ [API /admin/terminals/remove]', e?.message || e);
    return res.status(502).json({ success: false, error: 'MetaApi did not remove the terminal.' });
  }
});

tradeRouter.post('/admin/terminals/cleanup', requireAdmin, async (_req: Request, res: Response) => {
  const sup = connectionManager.getSupervisor();
  if (!sup) return res.status(503).json({ success: false, error: 'The terminal supervisor is not running.' });
  try {
    return res.status(200).json({ success: true, ...(await sup.cleanupStale()) });
  } catch (e: any) {
    console.error('❌ [API /admin/terminals/cleanup]', e?.message || e);
    return res.status(502).json({ success: false, error: 'Could not clean up the terminals.' });
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

/**
 * Service plan: choose Monthly or 50% Profit Share, pay for the monthly plan, or stop renewing it.
 */
tradeRouter.get('/service-plan', requireUser, async (req: Request, res: Response) => {
  try {
    return res.status(200).json({ success: true, ...(await BillingService.getInstance().planView(getAuthUser(req).uid)) });
  } catch (error: any) {
    console.error('❌ [API /service-plan]', error?.message || error);
    return res.status(500).json({ success: false, error: 'Could not load your plan.' });
  }
});

function planError(res: Response, error: any, label: string) {
  if (error instanceof BillingError) return res.status(error.status).json({ success: false, error: error.message });
  console.error(`❌ [API ${label}]`, error?.message || error);
  return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
}

tradeRouter.post('/service-plan/select', requireUser, async (req: Request, res: Response) => {
  try {
    await BillingService.getInstance().selectModel(getAuthUser(req).uid, req.body?.model);
    return res.status(200).json({ success: true });
  } catch (e) {
    return planError(res, e, '/service-plan/select');
  }
});

tradeRouter.post('/service-plan/pay-subscription', requireUser, async (req: Request, res: Response) => {
  try {
    await BillingService.getInstance().paySubscription(getAuthUser(req).uid, String(req.body?.txHash ?? ''));
    return res.status(200).json({ success: true });
  } catch (e) {
    return planError(res, e, '/service-plan/pay-subscription');
  }
});

tradeRouter.post('/service-plan/cancel', requireUser, async (req: Request, res: Response) => {
  try {
    await BillingService.getInstance().cancelSubscription(getAuthUser(req).uid);
    return res.status(200).json({ success: true });
  } catch (e) {
    return planError(res, e, '/service-plan/cancel');
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
  if (!c || !c.isBrokerVerified) {
    // Not in service yet: if a terminal is still connecting (or could not), say so, so the dashboard can show it.
    return res
      .status(200)
      .json({ success: true, connected: false, client: null, pending: pendingFor(connectionManager.getSupervisor()?.view(user.uid), connectJobs.get(user.uid)) });
  }
  return res.status(200).json({ success: true, connected: true, client: toPublicClient(c) });
});

/**
 * GET /api/trade/robot-state
 * What the master terminal is actually doing right now.
 *  - UNAVAILABLE: the master feed is down or not live, so nothing can be said about trades.
 *  - NO_TRADE: the feed is live and the master has no open position.
 *  - TRADE: the feed is live and the master has at least one open position.
 */
tradeRouter.get('/robot-state', requireUser, (_req: Request, res: Response) => {
  const live = connectionManager.isConnected();
  if (!live) {
    return res.status(200).json({ success: true, state: 'UNAVAILABLE', trades: [], updatedAt: new Date().toISOString() });
  }
  const trades = replicationEngine.getMasterTradeSnapshot();
  return res.status(200).json({
    success: true,
    state: trades.length > 0 ? 'TRADE' : 'NO_TRADE',
    trades,
    updatedAt: new Date().toISOString(),
  });
});

/** GET /api/trade/my-ip: the address this request came from, so the person's own audit entries can show it. */
tradeRouter.get('/my-ip', requireUser, (req: Request, res: Response) => {
  return res.status(200).json({ success: true, ip: clientIpFrom(req.headers as any, req.socket?.remoteAddress) });
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
 * GET /api/trade/metrics  (administrators only)
 * Returns comprehensive performance and execution statistics. It lists recent copy results per client,
 * so it is not for the public.
 */
tradeRouter.get('/metrics', requireAdmin, (req: Request, res: Response) => {
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

export default tradeRouter;
