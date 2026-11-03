import { Router, Request, Response } from 'express';
import { authenticateRequest } from './firebaseAuth';
import { clientIpFrom } from './clientIp';
import { BillingService, billingConfig } from './billing';
import { Mt5ConnectionManager } from './MT5_CONNECTION_MANAGER';
import { DEFAULT_MIN_CONNECT_EQUITY, readLimit } from './brokerVerification';
import { DAILY_EQUITY_RATES_PCT, REFERRAL_RATES_PCT, WITHDRAW_FEE_PCT, WITHDRAW_MIN_USDT } from './referrals';
import {
  AssistantError,
  type ClientFacts,
  allowMessage,
  askWithFallback,
  builtInAnswer,
  type KnowledgeFacts,
  assistantConfigured,
  buildSystemPrompt,
  cleanHistory,
} from './assistant';

export const assistantRouter = Router();

/** GET /api/assistant/status: whether the chat bubble should be shown. */
assistantRouter.get('/status', (_req: Request, res: Response) => {
  res.status(200).json({ success: true, available: assistantConfigured() });
});

/** The signed-in client's own account, for personal answers. Never anyone else's. */
async function clientFacts(req: Request): Promise<{ facts: ClientFacts; uid?: string }> {
  let user;
  try {
    user = await authenticateRequest(req as any);
  } catch {
    return { facts: { signedIn: false } };
  }
  const facts: ClientFacts = { signedIn: true, emailConfirmed: Boolean(user.emailVerified), plan: 'none' };
  try {
    const billing = BillingService.getInstance();
    const plan = await billing.getPlan(user.uid).catch(() => null);
    facts.plan = plan?.model === 'subscription' ? 'subscription' : plan?.model === 'profit_share' ? 'profit_share' : 'none';
    const manager = Mt5ConnectionManager.getInstance();
    const rec = manager.getClientConnection(user.uid);
    if (rec && rec.isBrokerVerified && rec.userId === user.uid) {
      facts.connected = true;
      facts.login = rec.login;
      facts.server = rec.server;
      facts.equityUsd = rec.figuresPending ? undefined : rec.equity;
      facts.copying = rec.figuresPending
        ? 'reading_balance'
        : rec.unsupportedCurrency
        ? 'not_usd'
        : rec.billingBlocked
        ? 'unpaid_invoice'
        : rec.status !== 'ACTIVE'
        ? 'paused_by_client'
        : rec.lowFunds
        ? 'below_minimum'
        : 'copying';
    } else {
      const p = manager.pendingView(user.uid);
      if (p) facts.connecting = p.kind === 'failed' ? `could not connect (${p.error?.message || 'unknown reason'})` : p.label;
    }
    const invoices = await billing.listInvoicesForUser(user.uid).catch(() => []);
    facts.unpaidInvoiceUsdt = invoices.filter((i) => i.status !== 'paid').reduce((t, i) => t + (Number(i.amountDueUsdt) || 0), 0);
  } catch {
    // answer without the account details rather than not at all
  }
  return { facts, uid: user.uid };
}

/** POST /api/assistant/chat { messages: [{ role: 'user' | 'assistant', text }] } -> { reply } */
assistantRouter.post('/chat', async (req: Request, res: Response) => {
  if (!assistantConfigured()) return res.status(503).json({ success: false, error: 'The assistant is not switched on yet.' });
  const history = cleanHistory(req.body?.messages);
  if (!history) return res.status(400).json({ success: false, error: 'Please type a question.' });
  try {
    const { facts, uid } = await clientFacts(req);
    const limit = allowMessage({ uid, ip: clientIpFrom(req.headers as any, req.socket?.remoteAddress) });
    if (!limit.allowed) {
      return res
        .status(429)
        .set('Retry-After', String(limit.retryAfterSeconds))
        .json({ success: false, error: `You have sent a lot of messages. Please wait ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s) and try again.` });
    }
    const cfg = billingConfig();
    const knowledge: KnowledgeFacts = {
        feePct: cfg.feePct,
        minProfitUsd: cfg.minProfitUsd,
        toleranceUsdt: cfg.paymentToleranceUsdt,
        dueHours: cfg.dueHours,
        minEquityUsd: readLimit(process.env.MIN_CONNECT_EQUITY, DEFAULT_MIN_CONNECT_EQUITY),
        subscriptionPriceUsdt: cfg.subscriptionPriceUsdt,
        subscriptionDays: cfg.subscriptionDays,
        referralPlanPct: [...REFERRAL_RATES_PCT],
        referralDailyPct: [...DAILY_EQUITY_RATES_PCT],
        withdrawMinUsdt: WITHDRAW_MIN_USDT,
        withdrawFeePct: WITHDRAW_FEE_PCT,
        supportWhatsapp: (process.env.SUPPORT_WHATSAPP || '').trim(),
        supportEmail: (process.env.SUPPORT_EMAIL || '').trim(),
    };
    const system = buildSystemPrompt(knowledge, facts);
    try {
      const { text } = await askWithFallback({
        apiKey: String(process.env.GEMINI_API_KEY).trim(),
        preferred: (process.env.GEMINI_MODEL || '').trim(),
        system,
        history,
      });
      return res.status(200).json({ success: true, reply: text });
    } catch (e: any) {
      // Gemini could not answer (key, model or quota; the reason is in the log): a built-in answer from our own rules instead.
      return res.status(200).json({ success: true, reply: builtInAnswer(history[history.length - 1].text, knowledge, facts), fallback: true });
    }
  } catch (e: any) {
    if (e instanceof AssistantError) return res.status(e.status).json({ success: false, error: e.message });
    console.error('❌ [API /assistant/chat]', e?.message || e);
    return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
});
