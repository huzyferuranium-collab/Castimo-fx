/**
 * Castimo AI help assistant (the chat bubble in the bottom-right corner).
 *
 * The model is Google Gemini, called from this server only (the key never reaches the browser). It answers from the
 * platform's own rules, written below from the same settings billing and referrals use, so the answers match what the
 * site really does. For a signed-in client it is also told that client's own account status (never anyone else's).
 *
 * Safety: no trading or investment advice, no profit promises, never asks for passwords, cannot move money or change
 * settings, and hands over to human support when it is not sure. Messages are limited per person.
 *
 * Settings (Render -> Environment): GEMINI_API_KEY (required), GEMINI_MODEL (default gemini-flash-latest),
 * SUPPORT_WHATSAPP, SUPPORT_EMAIL (optional, shown when it hands over), ASSISTANT_OFF=1 to switch it off.
 */
import { RateWindow } from './rateLimit.ts';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface KnowledgeFacts {
  feePct: number;
  minProfitUsd: number;
  toleranceUsdt: number;
  dueHours: number;
  minEquityUsd: number;
  subscriptionPriceUsdt: number;
  subscriptionDays: number;
  referralPlanPct: number[];
  referralDailyPct: number[];
  withdrawMinUsdt: number;
  withdrawFeePct: number;
  supportWhatsapp: string;
  supportEmail: string;
}

/** What the assistant may know about the signed-in client. Only their own account. */
export interface ClientFacts {
  signedIn: boolean;
  emailConfirmed?: boolean;
  plan?: 'profit_share' | 'subscription' | 'none';
  connected?: boolean;
  login?: string;
  server?: string;
  copying?: 'copying' | 'paused_by_client' | 'below_minimum' | 'reading_balance' | 'not_usd' | 'unpaid_invoice';
  equityUsd?: number;
  unpaidInvoiceUsdt?: number;
  connecting?: string;
}

export const MAX_MESSAGE_CHARS = 800;
export const MAX_HISTORY = 12;

export function supportLine(f: Pick<KnowledgeFacts, 'supportWhatsapp' | 'supportEmail'>): string {
  const parts = [f.supportWhatsapp && `WhatsApp ${f.supportWhatsapp}`, f.supportEmail && `email ${f.supportEmail}`].filter(Boolean);
  return parts.length ? `Contact our support team on ${parts.join(' or ')}.` : 'Contact our support team from the Help page.';
}

/** The assistant's instructions and the platform's rules, from the live settings. */
export function buildSystemPrompt(k: KnowledgeFacts, c: ClientFacts): string {
  const pct = (a: number[]) => a.map((x) => `${x}%`).join(' / ');
  const lines = [
    'You are Castimo AI, the help assistant of Castimofx (castimofx.com), a copy-trading service. A professional master MT5 account trades, and its trades are copied automatically to clients\' own MT5 accounts through the Duplikium trade copier. Clients keep their money at their own broker.',
    'Answer questions about using the service: connecting an MT5 account, copying, plans, the 50% profit share, paying in USDT, referrals and withdrawals. Be short, friendly and clear (at most about 120 words), in the language the client writes in. Use simple steps when explaining how to do something.',
    '',
    'STRICT RULES:',
    '- Never give trading, investment or financial advice. Never promise or predict profits, returns or results. Say plainly that trading is risky and losses are possible if asked about expected gains.',
    '- Never ask for, accept or repeat passwords, private keys, seed phrases or verification codes. If a client shares one, tell them to change it.',
    '- You cannot move money, mark invoices paid, change settings or connect accounts. Explain where in the app the client can do it.',
    '- Only use the facts below. If you do not know, or the question is about a payment problem, a missing withdrawal, an account error you cannot explain, or a complaint, say so and hand over: ' + supportLine(k),
    '- Only discuss this client\'s own account (given below). Never invent account figures.',
    '- Payments are only ever made to the address shown in the app. Warn clients about anyone asking them to pay elsewhere.',
    '',
    'FACTS ABOUT THE SERVICE:',
    `- Plans: (1) 50% Profit Share: the client pays ${k.feePct}% of the NEW net profit made by closed trades (profit minus commission and swap). No fee on losses; losses must be recovered before a new fee. Open trades are not charged until they close. (2) Monthly Plan: ${k.subscriptionPriceUsdt} USDT per ${k.subscriptionDays} days, no profit share.`,
    `- Profit share billing runs every 24 hours. An invoice is made only when the new profit since the last invoice is at least ${k.minProfitUsd} USD; under that nothing is invoiced, copying continues and the profit is carried forward. A client can also press "Pay my share now" on the 50% Profit Share tab when that profit is at least ${k.minProfitUsd} USD and no trade is open.`,
    `- Paying: USDT on the TRON network (TRC20) only, to the address shown on the 50% Profit Share tab. Then paste the 64-character transaction ID (TXID) into "Verify payment". From Binance: Withdraw, USDT, network TRON (TRC20); the TxID is in the withdrawal history. Up to ${k.toleranceUsdt} USDT less than the invoice is accepted (exchange fees). The check needs the transaction to be confirmed, usually 1-2 minutes. An invoice unpaid after ${k.dueHours} hours pauses copying until it is paid.`,
    `- Connecting: sign up and confirm the email (the connect window can resend the confirmation email), accept the terms, choose a plan, then Connect with the MT5 account number, the TRADING password (not the investor/read-only password) and the exact broker server shown on the MT5 login screen. Only USD accounts. The account connects as soon as the broker accepts the login; the balance appears within about 5 minutes and copying starts then.`,
    `- Copying needs at least ${k.minEquityUsd} USD equity. Below it the account stays connected but nothing is copied until it reaches the minimum (it starts by itself). Trade sizes follow the client's equity.`,
    '- Disconnecting: from Profile. Trades already open stay open in the client\'s MT5; nothing is closed for them.',
    `- Referrals (Referral Hub): levels 1 / 2 / 3. Monthly Plan clients: ${pct(k.referralPlanPct)} of the first ${k.subscriptionPriceUsdt} USDT payment, paid once. On top of that, every referred client on either plan: ${pct(k.referralWeeklyPct)} of their equity once a week, taken from the equity at the close of the trading week (Monday to Friday, no weekends), only for real accounts that are connected and copying then and have been connected 24 hours or more. Earnings build up in the Referral Hub; save a TRON (TRC20) address under Withdraw and request a withdrawal (minimum ${k.withdrawMinUsdt} USDT, ${k.withdrawFeePct}% processing fee). Requests before Thursday 23:59 GMT are paid in that week's round by the admin.`,
    '',
    'THIS CLIENT:',
    describeClient(c),
  ];
  return lines.join('\n');
}

export function describeClient(c: ClientFacts): string {
  if (!c.signedIn) return '- A visitor who is not signed in. You know nothing about their account; invite them to sign up or sign in for account-specific help.';
  const out: string[] = ['- Signed in.'];
  if (c.emailConfirmed === false) out.push('- Email address NOT confirmed yet (needed before connecting an account).');
  out.push(`- Plan: ${c.plan === 'subscription' ? 'Monthly Plan' : c.plan === 'profit_share' ? '50% Profit Share' : 'not chosen yet'}.`);
  if (c.connected) {
    out.push(`- MT5 account #${c.login} on ${c.server} is connected. Equity ${typeof c.equityUsd === 'number' ? `$${c.equityUsd.toFixed(2)}` : 'not reported yet'}.`);
    const why: Record<string, string> = {
      copying: 'Copying is ON.',
      paused_by_client: 'Copying is paused by the client.',
      below_minimum: 'Connected but NOT copying: equity is below the minimum.',
      reading_balance: 'Just connected: waiting for the copier to report the balance (up to about 5 minutes); copying starts then.',
      not_usd: 'Connected but NOT copying: the account is not in USD.',
      unpaid_invoice: 'Copying is PAUSED because a profit-share invoice is unpaid past its due time.',
    };
    if (c.copying) out.push(`- ${why[c.copying]}`);
  } else if (c.connecting) {
    out.push(`- No account in service. Connection status: ${c.connecting}.`);
  } else {
    out.push('- No MT5 account connected.');
  }
  if (typeof c.unpaidInvoiceUsdt === 'number' && c.unpaidInvoiceUsdt > 0) out.push(`- Unpaid profit-share invoice(s): ${c.unpaidInvoiceUsdt.toFixed(2)} USDT.`);
  return out.join('\n');
}

/** Cleans what the browser sent: only the last messages, each cut to a safe length, roles fixed. Null when there is no question. */
export function cleanHistory(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const msgs: ChatMessage[] = [];
  for (const m of raw.slice(-MAX_HISTORY)) {
    if (!m || typeof m !== 'object') continue;
    const text = String((m as any).text ?? '').trim().slice(0, MAX_MESSAGE_CHARS);
    if (!text) continue;
    msgs.push({ role: (m as any).role === 'assistant' ? 'assistant' : 'user', text });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return null;
  return msgs;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export class AssistantError extends Error {
  status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.name = 'AssistantError';
    this.status = status;
  }
}

/** One answer from Gemini (REST API, so no SDK version matters). */
export async function askGemini(opts: { apiKey: string; model: string; system: string; history: ChatMessage[]; fetchImpl?: FetchLike }): Promise<string> {
  const f: FetchLike = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`;
  let res;
  try {
    res = await f(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: opts.history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
        // Room for "thinking" models too: their hidden reasoning counts against this limit.
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new AssistantError('The assistant could not be reached. Please try again in a moment.', 502);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const why = String(data?.error?.message || data?.error?.status || '').replace(/AIza[0-9A-Za-z_-]+/g, '***').slice(0, 300);
    const err = new AssistantError(
      res.status === 429 ? 'The assistant is busy right now. Please try again in a minute.' : 'The assistant is not available right now. Please try again later.',
      res.status === 429 ? 429 : 502
    );
    (err as any).geminiStatus = res.status;
    (err as any).geminiWhy = why;
    throw err;
  }
  const text = (data?.candidates?.[0]?.content?.parts ?? [])
    .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
    .join('')
    .trim();
  if (!text) throw new AssistantError('The assistant had no answer for that. Please rephrase your question.', 502);
  return text.slice(0, 4000);
}

// ---------- limits ----------

/** Signed-in clients: 30 messages per 10 minutes and 150 a day. Visitors (by address): 10 per 10 minutes and 40 a day. */
const userShort = new RateWindow(30, 10 * 60_000);
const userDay = new RateWindow(150, 24 * 3600_000);
const guestShort = new RateWindow(10, 10 * 60_000);
const guestDay = new RateWindow(40, 24 * 3600_000);

export function allowMessage(key: { uid?: string; ip: string }, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  const [a, b] = key.uid ? [userShort.hit(`u:${key.uid}`, now), userDay.hit(`u:${key.uid}`, now)] : [guestShort.hit(`ip:${key.ip}`, now), guestDay.hit(`ip:${key.ip}`, now)];
  if (!a.allowed) return a;
  if (!b.allowed) return b;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function assistantConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean((env.GEMINI_API_KEY || '').trim()) && (env.ASSISTANT_OFF || '').trim() !== '1';
}

// ---------- choosing a model that works with this key ----------

/** Tried in order until one answers. A free AI Studio key cannot use every model, and old models are shut down over time. */
export const MODEL_CANDIDATES = ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash-lite'];

let workingModel = '';

/** Why a model was refused, for the log: never the key. */
function noteFailure(model: string, e: any): void {
  console.warn(`⚠️ [ASSISTANT] Gemini model ${model} refused (HTTP ${e?.geminiStatus ?? '?'}): ${e?.geminiWhy || e?.message || e}`);
}

/**
 * Asks the configured model (GEMINI_MODEL) or the first candidate that works, and remembers it. A key problem (401/403 that
 * is not about a model) stops the search at once, since no other model would work either.
 */
export async function askWithFallback(opts: { apiKey: string; preferred?: string; system: string; history: ChatMessage[]; fetchImpl?: FetchLike }): Promise<{ text: string; model: string }> {
  const order = [workingModel, opts.preferred || '', ...MODEL_CANDIDATES].filter((m, i, a) => m && a.indexOf(m) === i);
  let last: any = null;
  for (const model of order) {
    try {
      const text = await askGemini({ apiKey: opts.apiKey, model, system: opts.system, history: opts.history, fetchImpl: opts.fetchImpl });
      if (workingModel !== model) console.log(`✅ [ASSISTANT] Answering with Gemini model ${model}.`);
      workingModel = model;
      return { text, model };
    } catch (e: any) {
      last = e;
      noteFailure(model, e);
      if (model === workingModel) workingModel = '';
      const why = String(e?.geminiWhy || '').toLowerCase();
      const keyProblem = (e?.geminiStatus === 400 && /api key|api_key/.test(why)) || ((e?.geminiStatus === 401 || e?.geminiStatus === 403) && !/model|quota|limit|billing|free tier/.test(why));
      if (keyProblem) break;
      if (!e?.geminiStatus && !(e instanceof AssistantError)) break; // not an answer from Google at all
    }
  }
  throw last ?? new AssistantError('The assistant is not available right now. Please try again later.', 502);
}

export function resetWorkingModelForTests(): void {
  workingModel = '';
}

// ---------- built-in answers (used when Gemini cannot answer) ----------

/** A short, correct answer from the platform's rules for the most common questions, so a client is never left without help. */
export function builtInAnswer(question: string, k: KnowledgeFacts, c: ClientFacts): string {
  const q = question.toLowerCase();
  const help = supportLine(k);
  if (/not copy|no trade|isn.?t copy|not working|why.*copy|copying/.test(q)) {
    const mine = c.signedIn && c.connected
      ? c.copying === 'below_minimum'
        ? `Your account is connected, but copying starts once your equity reaches ${k.minEquityUsd} USD.`
        : c.copying === 'reading_balance'
        ? 'Your account just connected. The balance appears within about 5 minutes and copying starts by itself.'
        : c.copying === 'unpaid_invoice'
        ? 'Copying is paused because a profit-share invoice is unpaid. Pay it on the 50% Profit Share tab and copying resumes.'
        : c.copying === 'paused_by_client'
        ? 'Copying is paused on your account. Switch it back on from your dashboard.'
        : 'Your account is connected and copying. Trades appear when the master account opens a trade.'
      : `Copying needs a connected MT5 account (trading password, exact server) with at least ${k.minEquityUsd} USD equity, and no overdue invoice.`;
    return `${mine} ${help}`;
  }
  if (/txid|hash|transaction id/.test(q)) {
    return 'After sending USDT on the TRON (TRC20) network, open your wallet\'s transaction details (in Binance: Wallet, Transaction History, Withdrawal) and copy the TxID: 64 letters and numbers. Paste it into "Verify payment" on the 50% Profit Share tab. Wait 1-2 minutes after sending so the network confirms it.';
  }
  if (/pay|invoice|usdt|tron|trc|share|50/.test(q)) {
    return `You pay ${k.feePct}% of the new profit from closed trades. Every 24 hours an invoice is made when that profit is at least ${k.minProfitUsd} USD, or press "Pay my share now" when no trade is open. Send USDT on TRON (TRC20) to the address on the 50% Profit Share tab, then paste the TXID into "Verify payment". Up to ${k.toleranceUsdt} USDT less is accepted for exchange fees. Unpaid after ${k.dueHours} hours, copying pauses.`;
  }
  if (/refer|commission|withdraw|invite/.test(q)) {
    return `Share your link from the Referral Hub. Monthly Plan clients you refer earn you ${k.referralPlanPct.join('% / ')}% of their first ${k.subscriptionPriceUsdt} USDT payment (levels 1 / 2 / 3). On top of that, every client you refer earns you ${k.referralWeeklyPct.join('% / ')}% of their equity once a week, at the close of the trading week (real accounts that are connected and copying only). Save a TRON address under Withdraw and request at least ${k.withdrawMinUsdt} USDT (${k.withdrawFeePct}% fee).`;
  }
  if (/connect|mt5|server|password|login|account/.test(q)) {
    return 'Confirm your email, accept the terms and choose a plan. Then press Connect and enter your MT5 account number, your TRADING password (not the investor password) and the exact server shown on your MT5 login screen. Only USD accounts. It connects as soon as the broker accepts the login; your balance appears within about 5 minutes.';
  }
  if (/profit|return|earn|how much|guarantee/.test(q)) {
    return 'Results depend on the market and are never guaranteed: trading is risky and losses are possible. You only pay the profit share on real new profit from closed trades, never on losses.';
  }
  return `I can help with connecting your MT5 account, copying, the 50% profit share, paying in USDT and referrals. Could you ask about one of those? For anything else: ${help}`;
}
