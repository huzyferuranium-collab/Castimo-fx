/**
 * CASTIMOFX - Webhook & Trade API Routes
 * 
 * Express API endpoints providing communication between the frontend client dashboard
 * and the Duplikium copier service (Duplikium does the copying; we connect accounts and read results).
 *
 * - POST /api/trade/toggle-mirror: Pauses or resumes a client's copying (ACTIVE <-> IDLE).
 * - GET  /api/trade/account-status: Master account connection status for UI banners (signed-in users; identifiers admin-only).
 * - POST /api/trade/provision-client: Connects a client's MT5 account.
 * - GET  /api/trade/my-trades: The caller's own open and closed trades, as the copier service reports them.
 * - GET  /api/trade/admin/copier-check: Administrator's connection check of the copier service.
 * - GET  /api/trade/admin/risk-rules: The rules the server really enforces (connection minimum, copy size). Read-only.
 */

import { clientIpFrom } from './clientIp';
import { Router, Request, Response } from 'express';
import { Mt5ConnectionManager } from './MT5_CONNECTION_MANAGER';
import { requireUser, requireAdmin, getAuthUser, isAdminUser } from './firebaseAuth';
import { shapeMasterStatus } from './masterStatus';
import { hasAcceptedTermsServer, recordTermsAcceptanceServer } from './termsCheck';
import { recordEvent } from './referralService';
import { BrokerVerificationError, validateSubmittedCredentials, normalizeBrokerServer } from './brokerVerification';
import { ConnectJobs, pendingFor } from './clientBridge';
import { BillingService, BillingError, billingConfig, billingEnabled } from './billing';

export const tradeRouter = Router();

const connectionManager = Mt5ConnectionManager.getInstance();
/**
 * One background connection per user, polled by the browser (see clientBridge.ts). If the overall time limit
 * is reached while the user's account exists at the copier service, the server carries on and the job says so.
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
 * Whether the master account is connected at the copier service, for the status banners in the UI.
 * Needs a signed-in user. The master's account number, broker server and copier id are returned to administrators only.
 */
tradeRouter.get('/account-status', requireUser, async (req: Request, res: Response) => {
  try {
    const admin = await isAdminUser(getAuthUser(req));

    const metrics = connectionManager.getMasterMetrics();
    const isConnected = connectionManager.isConnected();
    const activeClients = connectionManager.getActiveClients();

    return res.status(200).json(shapeMasterStatus(metrics, isConnected, activeClients.length, admin, new Date().toISOString()));
  } catch (error: any) {
    console.error('❌ [API /api/trade/account-status] Failed to fetch account status:', error?.message || error);
    return res.status(500).json({
      success: false,
      connected: false,
      status: 'ERROR',
      error: 'Could not read the master account status.',
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

    // The change is made at the copier service and checked there; the answer is only "ok" if it really took.
    let updated;
    try {
      updated = await connectionManager.setCopyStatus(user.uid, newState);
    } catch (e: any) {
      console.error('❌ [API /api/trade/toggle-mirror] copier service:', String(e?.message || e).slice(0, 200));
      return res.status(502).json({
        success: false,
        code: 'COPIER_UNAVAILABLE',
        error: 'We could not change copying just now, so nothing was changed. Please try again in a minute.',
      });
    }
    if (!updated) {
      return res.status(409).json({ success: false, code: 'NO_VERIFIED_ACCOUNT', error: 'Connect a broker-verified MT5 account first.' });
    }

    return res.status(200).json({
      success: true,
      userId: updated.userId,
      accountId: updated.accountId,
      status: updated.status,
      message:
        newState === 'ACTIVE'
          ? 'Trade copying activated. New trades on the master account will now be copied to your account.'
          : 'Trade copying paused. New master trades will not be opened on your account. Trades already open still follow the master\'s closes.',
      updatedAt: updated.lastSync,
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
 * POST /api/trade/accept-terms  (signed-in users only)
 * Records, on the server, that the caller tapped "I Agree" to the current Terms. The browser tries to save this itself, but
 * if that fails (for example the database rules refuse it) the client would be stuck, so the server keeps the record too.
 */
tradeRouter.post('/accept-terms', requireUser, async (req: Request, res: Response) => {
  try {
    const user = getAuthUser(req);
    const saved = await recordTermsAcceptanceServer(user, String(req.headers['user-agent'] || ''));
    if (!saved) return res.status(503).json({ success: false, error: 'Your acceptance could not be saved right now. Please try again in a moment.' });
    return res.json({ success: true });
  } catch (error: any) {
    console.error('❌ [API /api/trade/accept-terms] Error:', error?.message || error);
    return res.status(500).json({ success: false, error: 'Your acceptance could not be saved right now. Please try again in a moment.' });
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
    // The connection the server is still looking after for this client (null when there is none).
    pending: pendingFor(connectionManager.pendingView(user.uid), connectJobs.get(user.uid)),
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
 * Client accounts as the copier service holds them, and what we are doing about each one (administrators only).
 * The master account is never listed and can never be touched from here.
 */
tradeRouter.get('/admin/copier-accounts', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const accounts = await connectionManager.listCopierAccounts();
    return res.status(200).json({ success: true, accounts, ...(await connectionManager.getCapacity().catch(() => ({}))) });
  } catch (e: any) {
    console.error('❌ [API /admin/copier-accounts]', e?.message || e);
    return res.status(502).json({ success: false, error: 'Could not read the accounts from the copier service.' });
  }
});

tradeRouter.post('/admin/copier-accounts/remove', requireAdmin, async (req: Request, res: Response) => {
  try {
    const r = await connectionManager.removeCopierAccount(String(req.body?.accountId ?? ''), req.body?.force === true);
    return res.status(r.ok ? 200 : r.reason === 'NOT_FOUND' ? 404 : 409).json({ success: r.ok, reason: r.reason });
  } catch (e: any) {
    console.error('❌ [API /admin/copier-accounts/remove]', e?.message || e);
    return res.status(502).json({ success: false, error: 'The copier service did not remove the account.' });
  }
});

/**
 * GET /api/trade/admin/risk-rules  (administrators only, read-only)
 * The risk rules the server really applies, read from where they are really set: the connection minimum from the
 * MIN_CONNECT_EQUITY setting, and the copy size from Render or the Duplikium template. copySize is null when it cannot be read.
 */
tradeRouter.get('/admin/risk-rules', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const connectMinimum = connectionManager.getConnectMinimum();
    const copySize = await connectionManager.getCopySize().catch(() => null);
    return res.status(200).json({ success: true, connectMinimum, copySize });
  } catch (e: any) {
    console.error('❌ [API /admin/risk-rules]', e?.message || e);
    return res.status(500).json({ success: false, error: 'The risk rules could not be read.' });
  }
});

/** GET /api/trade/admin/copier-check: signs in, finds the master and the template, reads trades. No secrets are returned. */
tradeRouter.get('/admin/copier-check', requireAdmin, async (_req: Request, res: Response) => {
  try {
    return res.status(200).json({ success: true, ...(await connectionManager.runConnectionCheck()), note: connectionManager.getMasterNote() });
  } catch (e: any) {
    console.error('❌ [API /admin/copier-check]', e?.message || e);
    return res.status(500).json({ success: false, error: 'The connection check could not run.' });
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
    const updated = await connectionManager.setCopyStatus(String(targetId), status);
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
 * Removes the broker account from the platform and from the copier service. Trades already open stay open on the broker account.
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
      .json({ success: true, connected: false, client: null, pending: pendingFor(connectionManager.pendingView(user.uid), connectJobs.get(user.uid)) });
  }
  return res.status(200).json({ success: true, connected: true, client: toPublicClient(c) });
});

/**
 * GET /api/trade/robot-state
 * What the master account is actually doing right now, as the copier service reports it.
 *  - UNAVAILABLE: the master is not connected or its trades could not be read, so nothing can be said about trades.
 *  - NO_TRADE: the master is connected and has no open position.
 *  - TRADE: the master is connected and has at least one open position.
 */
tradeRouter.get('/robot-state', requireUser, async (_req: Request, res: Response) => {
  const unavailable = () => res.status(200).json({ success: true, state: 'UNAVAILABLE', trades: [], updatedAt: new Date().toISOString() });
  if (!connectionManager.isConnected()) return unavailable();
  try {
    const trades = await connectionManager.getMasterTrades();
    return res.status(200).json({
      success: true,
      state: trades.length > 0 ? 'TRADE' : 'NO_TRADE',
      trades,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    return unavailable();
  }
});

/**
 * GET /api/trade/my-trades  (signed-in users)
 * The caller's own open and closed trades as the copier service reports them. Nothing is estimated: a value the
 * service does not report is left out, and a trade that cannot be read is skipped rather than guessed.
 */
tradeRouter.get('/my-trades', requireUser, async (req: Request, res: Response) => {
  const user = getAuthUser(req);
  try {
    const t = await connectionManager.getClientTrades(user.uid);
    if (!t) return res.status(200).json({ success: true, connected: false, trades: [] });
    const toTrade = (p: any, status: 'OPEN' | 'CLOSED') => ({
      id: p.id,
      masterTradeId: '',
      symbol: p.symbol,
      direction: p.side,
      volume: p.volume,
      openPrice: p.openPrice ?? 0,
      currentPrice: status === 'CLOSED' ? p.closePrice ?? 0 : 0,
      closePrice: p.closePrice ?? undefined,
      sl: p.stopLoss ?? 0,
      tp: p.takeProfit ?? 0,
      pnl: p.profit ?? 0,
      commission: p.commission ?? 0,
      swap: p.swap ?? 0,
      status,
      openTime: p.openTime ?? '',
      closeTime: p.closeTime ?? undefined,
      idempotencyKey: p.id,
    });
    return res.status(200).json({
      success: true,
      connected: true,
      trades: [...t.open.map((p) => toTrade(p, 'OPEN')), ...t.closed.map((p) => toTrade(p, 'CLOSED'))],
    });
  } catch (e: any) {
    console.warn('⚠️ [API /my-trades]', String(e?.message || e).slice(0, 160));
    return res.status(502).json({ success: false, error: 'Your trades could not be read just now.' });
  }
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
