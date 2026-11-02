/**
 * Duplikium (trade-copier.com) REST API v4 client.
 *
 * Duplikium does the copying itself: a master account is watched and every slave account linked to it
 * receives the same trades. This file is only the thin, careful doorway to that service:
 *
 *  - It signs in with the cockpit login (HTTP Basic) and keeps the 48-hour access token fresh.
 *  - It keeps every call inside Duplikium's per-second / per-minute / per-hour limits.
 *  - It turns Duplikium's answers into plain typed objects. Numbers that Duplikium does not report are
 *    `null`: nothing is guessed, defaulted or filled in.
 *
 * Secrets: the cockpit login and password come from environment variables only. A client's broker
 * password is passed straight through to Duplikium in `addAccount` and is never stored by us.
 *
 * Everything that touches the network goes through one injectable `transport`, so the whole client can
 * be tested with a fake service.
 */

export const DUPLIKIUM_BASE_URL = 'https://www.trade-copier.com/webservice/v4/';

export type DuplikiumErrorKind =
  | 'NOT_CONFIGURED' // our cockpit login is missing
  | 'AUTH' // Duplikium refused our login or token
  | 'RATE_LIMIT' // we would have gone over Duplikium's limits
  | 'NETWORK' // could not reach Duplikium, or it did not answer in time
  | 'BAD_RESPONSE' // an answer we cannot read
  | 'API'; // Duplikium answered with an error message

export class DuplikiumError extends Error {
  kind: DuplikiumErrorKind;
  /** The error code Duplikium returned, when it returned one. */
  code?: string;
  status?: number;
  /** For the administrator's log only (never shown to clients): what the answer looked like, with secrets removed. */
  detail?: string;
  constructor(kind: DuplikiumErrorKind, message: string, extra: { code?: string; status?: number; detail?: string } = {}) {
    super(message);
    this.name = 'DuplikiumError';
    this.kind = kind;
    this.code = extra.code;
    this.status = extra.status;
    this.detail = extra.detail;
  }
}

/** A short description of an answer we could not read: the status and the first words, with any password in it hidden. */
let nonJsonNoted = false;

export function describeReply(status: number, text: string, secrets: string[] = []): string {
  let t = String(text ?? '');
  for (const sec of secrets) if (sec) t = t.split(sec).join('***');
  t = t.replace(/\s+/g, ' ').trim().slice(0, 140);
  return `HTTP ${status}, ${text ? `${String(text).length} characters, starts: "${t}"` : 'empty answer'}`;
}

// ---------- plain types ----------

export interface DuplikiumAccount {
  accountId: string;
  name: string;
  login: string;
  server: string;
  /** The platform Duplikium reports: mt4, mt5, ... */
  broker: string;
  type: 'master' | 'slave' | 'unknown';
  enabled: boolean;
  balance: number | null;
  equity: number | null;
  freeMargin: number | null;
  /** Account currency, upper case, or '' when not reported. */
  currency: string;
  /** Duplikium's last known state, e.g. CONNECTED, DISCONNECTED, INVESTOR_PASSWORD. Upper case. */
  state: string;
  lastUpdate: string | null;
  groupId: string | null;
  subscriptionKey: string | null;
  openTrades: number | null;
}

export interface DuplikiumPosition {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  openPrice: number | null;
  closePrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  profit: number | null;
  commission: number | null;
  swap: number | null;
  openTime: string | null;
  closeTime: string | null;
  /** The text exactly as Duplikium sent it, kept so the administrator can check the time zone. */
  rawOpenTime: string | null;
}

export interface PositionsResult {
  positions: DuplikiumPosition[];
  /** Entries that could not be read (for example no recognisable buy/sell). They are left out, never invented. */
  skipped: number;
}

export interface DuplikiumSetting {
  idMaster: string | null;
  idSlave: string | null;
  idGroup: string | null;
  copierStatus: number | null;
  riskFactorType: number | null;
  riskFactorValue: number | null;
}

/** copier_status values from the Duplikium documentation. */
export const COPIER = { CLOSE_ONLY: -1, FROZEN: 0, ON: 1, OPEN_ONLY: 2 } as const;

export interface AddAccountParams {
  type: 'master' | 'slave';
  name: string;
  broker: 'mt4' | 'mt5';
  login: string;
  password: string;
  server: string;
  enabled: boolean;
  /** Template (group) id to apply, for slaves. */
  group?: string;
  /** A subscription key, or 'auto'. */
  subscription?: string;
}

/** The part of the client the rest of the app needs. Tests pass a fake that implements this. */
export interface CopierApi {
  addAccount(p: AddAccountParams): Promise<{ accountId: string }>;
  deleteAccount(accountId: string): Promise<void>;
  updateAccount(accountId: string, changes: { enabled?: boolean; password?: string; name?: string; group?: string | null }): Promise<void>;
  getAccounts(ids?: string | string[]): Promise<DuplikiumAccount[]>;
  getSettings(f: { idMaster?: string; idSlave?: string; idGroup?: string }): Promise<DuplikiumSetting[]>;
  setSettings(s: { idMaster?: string; idSlave?: string; idGroup?: string; copierStatus?: number; riskFactorType?: number; riskFactorValue?: number }): Promise<void>;
  getOpenPositions(accountId: string): Promise<PositionsResult>;
  getClosedPositions(accountId: string): Promise<PositionsResult>;
}

// ---------- reading Duplikium's answers (pure, unit-tested) ----------

export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const strOrNull = (v: unknown): string | null => {
  const s = str(v);
  return s === '' ? null : s;
};

/**
 * The account rows inside an answer to "get accounts". Accepts the documented list ({ accounts: [...] }) and the other plain
 * shapes a filtered request may return (one { account: {...} }, a list under "account", a bare list, or rows keyed by id).
 * Anything else is null: an unknown shape is an error, never an empty list.
 */
export function accountRows(json: any): any[] | null {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return null;
  const rowLike = (v: any) => v && typeof v === 'object' && (v.account_id !== undefined || v.accountId !== undefined || v.id !== undefined);
  for (const key of ['accounts', 'account']) {
    const v = json[key];
    if (Array.isArray(v)) return v;
    if (rowLike(v)) return [v];
    if (v && typeof v === 'object') {
      const vals = Object.values(v);
      if (vals.length > 0 && vals.every(rowLike)) return vals;
      if (vals.length === 0 && key === 'accounts') return [];
    }
  }
  return null;
}

export function normalizeAccount(raw: any): DuplikiumAccount | null {
  if (!raw || typeof raw !== 'object') return null;
  const accountId = str(raw.account_id ?? raw.accountId ?? raw.id);
  if (!accountId) return null;
  const t = num(raw.type);
  return {
    accountId,
    name: str(raw.name),
    login: str(raw.login),
    server: str(raw.server),
    broker: str(raw.broker).toLowerCase(),
    type: t === 0 ? 'master' : t === 1 ? 'slave' : 'unknown',
    enabled: num(raw.status) === 1,
    balance: num(raw.balance),
    equity: num(raw.equity),
    freeMargin: num(raw.free_margin ?? raw.freeMargin),
    currency: str(raw.ccy ?? raw.currency).toUpperCase(),
    state: str(raw.state).toUpperCase(),
    lastUpdate: strOrNull(raw.lastUpdate ?? raw.last_update),
    groupId: strOrNull(raw.groupid ?? raw.group_id ?? raw.group),
    subscriptionKey: strOrNull(raw.subscription_key ?? raw.subscription),
    openTrades: num(raw.open_trades),
  };
}

export function normalizeSetting(raw: any): DuplikiumSetting | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    idMaster: strOrNull(raw.id_master),
    idSlave: strOrNull(raw.id_slave),
    idGroup: strOrNull(raw.id_group),
    copierStatus: num(raw.copier_status),
    riskFactorType: num(raw.risk_factor_type),
    riskFactorValue: num(raw.risk_factor_value),
  };
}

function firstDefined(raw: any, keys: string[]): unknown {
  for (const k of keys) if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '') return raw[k];
  return undefined;
}

/** Turns Duplikium's time text into an ISO string. Text without a zone is read as UTC. */
export function toIso(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v < 1e12 ? v * 1000 : v; // seconds or milliseconds
    return new Date(ms).toISOString();
  }
  const s = String(v).trim();
  if (/^\d{9,13}$/.test(s)) return toIso(Number(s));
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : `${s.replace(' ', 'T')}Z`;
  const t = Date.parse(withZone);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Reads one open or closed position. Several spellings are accepted for each field because the position
 * calls are the least documented part of the service. A position without a recognisable id, symbol,
 * buy/sell side and size is rejected (null): it is left out rather than shown with made-up values.
 */
export function normalizePosition(raw: any): DuplikiumPosition | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(firstDefined(raw, ['ticket', 'position_id', 'positionId', 'order_id', 'id', 'trade_id']));
  const symbol = str(firstDefined(raw, ['symbol', 'instrument', 'pair']));
  const rawSide = firstDefined(raw, ['type', 'side', 'action', 'direction', 'cmd', 'order_type']);
  const volume = num(firstDefined(raw, ['volume', 'lots', 'lot', 'size', 'quantity']));
  let side: 'BUY' | 'SELL' | null = null;
  if (typeof rawSide === 'string') {
    if (/buy|long/i.test(rawSide)) side = 'BUY';
    else if (/sell|short/i.test(rawSide)) side = 'SELL';
  }
  if (!id || !symbol || !side || volume === null || volume <= 0) return null;
  const openRaw = firstDefined(raw, ['open_time', 'opentime', 'time_open', 'open_date', 'openTime', 'time']);
  const closeRaw = firstDefined(raw, ['close_time', 'closetime', 'time_close', 'close_date', 'closeTime']);
  return {
    id,
    symbol,
    side,
    volume,
    openPrice: num(firstDefined(raw, ['open_price', 'openprice', 'price_open', 'openPrice', 'price'])),
    closePrice: num(firstDefined(raw, ['close_price', 'closeprice', 'price_close', 'closePrice'])),
    stopLoss: num(firstDefined(raw, ['sl', 'stop_loss', 'stoploss', 'stopLoss'])),
    takeProfit: num(firstDefined(raw, ['tp', 'take_profit', 'takeprofit', 'takeProfit'])),
    profit: num(firstDefined(raw, ['profit', 'pnl', 'net_profit'])),
    commission: num(raw.commission),
    swap: num(raw.swap),
    openTime: toIso(openRaw),
    closeTime: toIso(closeRaw),
    rawOpenTime: openRaw === undefined ? null : String(openRaw),
  };
}

/** Finds the list of positions inside whatever object Duplikium returned. */
export function extractPositionList(json: any): any[] {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return [];
  for (const k of ['positions', 'openPositions', 'open_positions', 'closedPositions', 'closed_positions', 'trades', 'data', 'results']) {
    if (Array.isArray(json[k])) return json[k];
  }
  for (const v of Object.values(json)) if (Array.isArray(v)) return v as any[];
  return [];
}

export function readPositions(json: any): PositionsResult {
  const list = extractPositionList(json);
  const positions: DuplikiumPosition[] = [];
  let skipped = 0;
  for (const raw of list) {
    const p = normalizePosition(raw);
    if (p) positions.push(p);
    else skipped++;
  }
  return { positions, skipped };
}

// ---------- rate limits ----------

export type LimitClass = 'accounts' | 'open' | 'closed' | 'settings' | 'other';

interface Window {
  perSec: number;
  perMin: number;
  perHour: number;
}

/**
 * Duplikium's published limits, with a safety margin (we stay at about 80%). The documentation says the
 * real limits depend on how many accounts are linked, so these are the conservative starting point.
 */
export const DEFAULT_LIMITS: Record<LimitClass, Window> = {
  accounts: { perSec: 5, perMin: 50, perHour: 1500 },
  open: { perSec: 3, perMin: 24, perHour: 700 },
  closed: { perSec: 3, perMin: 12, perHour: 240 },
  settings: { perSec: 1, perMin: 48, perHour: 960 },
  other: { perSec: 1, perMin: 48, perHour: 2800 },
};

/** Sliding-window limiter. `acquire` waits for a free slot, or gives up after `maxWaitMs`. */
export class RateLimiter {
  private hits = new Map<LimitClass, number[]>();
  private limits: Record<LimitClass, Window>;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private maxWaitMs: number;
  constructor(
    limits: Record<LimitClass, Window> = DEFAULT_LIMITS,
    now: () => number = Date.now,
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    maxWaitMs = 30_000
  ) {
    // Its own copy: what is learned from the service below must never change the shared defaults.
    this.limits = Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, { ...v }])) as Record<LimitClass, Window>;
    this.now = now;
    this.sleep = sleep;
    this.maxWaitMs = maxWaitMs;
  }

  /**
   * The service told us the real limit for this kind of call (for example "2/1 per second"): from now on we stay inside it.
   * Never raises a limit, and never goes below 1.
   */
  tighten(cls: LimitClass, unit: 'second' | 'minute' | 'hour', max: number): void {
    if (!Number.isFinite(max) || max < 1) return;
    const key = unit === 'second' ? 'perSec' : unit === 'minute' ? 'perMin' : 'perHour';
    const w = this.limits[cls];
    if (max < w[key]) w[key] = Math.floor(max);
  }

  /** Waits (using the same clock as the limiter, so tests can fake it). */
  async pause(ms: number): Promise<void> {
    await this.sleep(ms);
  }

  /** Milliseconds until a call of this class may go, 0 if it may go now. */
  private waitFor(cls: LimitClass, t: number): number {
    const w = this.limits[cls];
    const arr = (this.hits.get(cls) ?? []).filter((x) => t - x < 3_600_000);
    this.hits.set(cls, arr);
    let wait = 0;
    const check = (windowMs: number, max: number) => {
      const inWin = arr.filter((x) => t - x < windowMs);
      if (inWin.length >= max) wait = Math.max(wait, inWin[inWin.length - max] + windowMs - t);
    };
    check(1100, w.perSec); // a little over a second, so two calls can never land in the same second at the service
    check(60_000, w.perMin);
    check(3_600_000, w.perHour);
    return wait;
  }

  async acquire(cls: LimitClass): Promise<void> {
    const started = this.now();
    for (;;) {
      const t = this.now();
      const wait = this.waitFor(cls, t);
      if (wait <= 0) {
        this.hits.get(cls)!.push(t);
        return;
      }
      if (t - started + wait > this.maxWaitMs) {
        throw new DuplikiumError('RATE_LIMIT', 'The copier service is busy right now. Please try again in a minute.');
      }
      await this.sleep(Math.min(wait + 5, 5_000));
    }
  }
}

// ---------- the client ----------

export interface TransportRequest {
  method: 'POST';
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}
export interface TransportResponse {
  status: number;
  text: string;
}
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

/** The real network call. HTTPS only. */
export const fetchTransport: Transport = async (req) => {
  let res: Response;
  try {
    res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: AbortSignal.timeout(req.timeoutMs) });
  } catch (e: any) {
    throw new DuplikiumError('NETWORK', 'Could not reach the copier service.', { code: String(e?.name || 'FETCH') });
  }
  return { status: res.status, text: await res.text() };
};

export interface DuplikiumClientOptions {
  user: string;
  password: string;
  baseUrl?: string;
  transport?: Transport;
  limiter?: RateLimiter;
  now?: () => number;
  timeoutMs?: number;
  /** Refresh the token when fewer than this many seconds remain (default one hour; tokens last 48 hours). */
  refreshBeforeSeconds?: number;
}

export class DuplikiumClient implements CopierApi {
  private token = '';
  private tokenExp = 0; // unix seconds
  private tokenPromise: Promise<string> | null = null;
  private readonly baseUrl: string;
  private readonly transport: Transport;
  private readonly limiter: RateLimiter;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly refreshBefore: number;
  private readonly opts: DuplikiumClientOptions;

  constructor(opts: DuplikiumClientOptions) {
    this.opts = opts;
    this.baseUrl = (opts.baseUrl ?? DUPLIKIUM_BASE_URL).replace(/\/?$/, '/');
    if (!/^https:\/\//i.test(this.baseUrl)) throw new DuplikiumError('NOT_CONFIGURED', 'The copier service must be reached over HTTPS.');
    this.transport = opts.transport ?? fetchTransport;
    this.now = opts.now ?? Date.now;
    this.limiter = opts.limiter ?? new RateLimiter(DEFAULT_LIMITS, this.now);
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.refreshBefore = opts.refreshBeforeSeconds ?? 3600;
  }

  /** Builds a client from DUPLIKIUM_API_USER / DUPLIKIUM_API_TOKEN, or returns null when either is missing. */
  static fromEnv(env: Record<string, string | undefined> = process.env): DuplikiumClient | null {
    const user = (env.DUPLIKIUM_API_USER || '').trim();
    const password = (env.DUPLIKIUM_API_TOKEN || '').trim();
    if (!user || !password) return null;
    return new DuplikiumClient({ user, password });
  }

  // ----- token -----

  private tokenFresh(): boolean {
    return Boolean(this.token) && this.tokenExp - Math.floor(this.now() / 1000) > this.refreshBefore;
  }

  private async ensureToken(force = false): Promise<string> {
    if (!force && this.tokenFresh()) return this.token;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = (async () => {
      try {
        await this.limiter.acquire('other');
        const basic = Buffer.from(`${this.opts.user}:${this.opts.password}`, 'utf8').toString('base64');
        const res = await this.transport({
          method: 'POST',
          url: `${this.baseUrl}access/getToken.php`,
          headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' },
          body: '',
          timeoutMs: this.timeoutMs,
        });
        const json = this.parse(res);
        const token = typeof json?.token === 'string' ? json.token : '';
        if (!token) {
          throw new DuplikiumError('AUTH', 'The copier service did not accept our login.', { status: res.status, code: errCode(json) });
        }
        this.token = token;
        const exp = num(json.exp);
        // If no expiry came back, assume a short life so we ask again soon rather than trust it for 48 hours.
        this.tokenExp = exp ?? Math.floor(this.now() / 1000) + 6 * 3600;
        return token;
      } finally {
        this.tokenPromise = null;
      }
    })();
    return this.tokenPromise;
  }

  /** Signs in now (or refreshes). Used by the administrator's connection check. */
  async signIn(): Promise<{ expiresAt: string }> {
    await this.ensureToken(true);
    return { expiresAt: new Date(this.tokenExp * 1000).toISOString() };
  }

  // ----- plumbing -----

  /**
   * `lenient` is for calls whose answer we do not need and whose effect we always read back afterwards (changing copy settings):
   * a successful (2xx) answer that is not JSON is then accepted, and what it looked like is noted once in the log.
   */
  private parse(res: TransportResponse, secrets: string[] = [], lenient = false): any {
    let json: any;
    try {
      json = res.text ? JSON.parse(res.text) : {};
    } catch {
      if (lenient && res.status >= 200 && res.status < 300) {
        if (!nonJsonNoted) {
          nonJsonNoted = true;
          console.warn(`ℹ️ [DUPLIKIUM] A settings change was answered without JSON (${describeReply(res.status, res.text, secrets)}). The result is checked by reading the settings back.`);
        }
        return {};
      }
      throw new DuplikiumError('BAD_RESPONSE', 'The copier service sent an answer we could not read.', {
        status: res.status,
        detail: describeReply(res.status, res.text, secrets),
      });
    }
    return json;
  }

  private async call(path: string, cls: LimitClass, form: Record<string, unknown>, retried = false, lenient = false, rateRetried = false): Promise<any> {
    const token = await this.ensureToken();
    await this.limiter.acquire(cls);
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) v.forEach((item, i) => body.append(`${k}[${i}]`, String(item)));
      else body.append(k, String(v));
    }
    const res = await this.transport({
      method: 'POST',
      url: `${this.baseUrl}${path}`,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
      timeoutMs: this.timeoutMs,
    });
    const json = this.parse(res, [String(form.password ?? '')], lenient);
    const message = errMessage(json);
    if (res.status === 401 || res.status === 403 || (message && /token|unauthori[sz]ed|authenticat/i.test(message))) {
      // The token may have expired early: sign in again once and retry.
      if (!retried) {
        this.token = '';
        return this.call(path, cls, form, true, lenient, rateRetried);
      }
      throw new DuplikiumError('AUTH', 'The copier service did not accept our login.', { status: res.status, code: errCode(json) });
    }
    const limit = res.status === 429 || (message && RATE_LIMIT_WORDS.test(message)) ? parseRateLimit(message) : undefined;
    if (limit) {
      // The service named its real limit ("2/1 per second"): remember it so we never go over it again.
      if (limit.unit && limit.max) this.limiter.tighten(cls, limit.unit, limit.max);
      // A per-second slip is over in a moment: wait and try once more before giving up.
      if (limit.unit === 'second' && !rateRetried) {
        await this.limiter.pause(1300);
        return this.call(path, cls, form, retried, lenient, true);
      }
      throw new DuplikiumError('RATE_LIMIT', 'The copier service is busy right now. Please try again in a minute.', { status: res.status, detail: message.slice(0, 200) });
    }
    if (message) throw new DuplikiumError('API', message, { status: res.status, code: errCode(json) });
    if (res.status >= 400) throw new DuplikiumError('API', `The copier service answered with status ${res.status}.`, { status: res.status });
    return json;
  }

  // ----- accounts -----

  async addAccount(p: AddAccountParams): Promise<{ accountId: string }> {
    let json: any;
    try {
      json = await this.call('account/addAccount.php', 'other', {
        type: p.type === 'master' ? 0 : 1,
        name: p.name,
        broker: p.broker,
        login: p.login,
        password: p.password,
        server: p.server,
        status: p.enabled ? 1 : 0,
        group: p.group ?? '',
        subscription: p.subscription ?? '',
      });
    } catch (e) {
      // The service may have created the account and then sent something we could not read: look for it by the exact name we gave it.
      if (e instanceof DuplikiumError && e.kind === 'BAD_RESPONSE') {
        const found = await this.findAccountWeAdded(p);
        if (found) return { accountId: found };
      }
      throw e;
    }
    // The documented shape is { account: { account_id } }; other plain shapes are accepted too, never a guessed id.
    const a = Array.isArray(json?.account) ? json.account[0] : json?.account;
    const first = Array.isArray(json?.accounts) ? json.accounts[0] : undefined;
    const id = str(a?.account_id ?? a?.id ?? first?.account_id ?? first?.id ?? json?.account_id ?? json?.id);
    if (id) return { accountId: id };
    const found = await this.findAccountWeAdded(p);
    if (found) return { accountId: found };
    const keys = json && typeof json === 'object' ? Object.keys(json).slice(0, 12).join(', ') : typeof json;
    throw new DuplikiumError('BAD_RESPONSE', 'The copier service did not return the new account.', { detail: `the answer had these fields: ${keys || 'none'}` });
  }

  /** The id of the account with exactly this name and login, if the service has it (used only when the answer to "add" was unreadable). */
  private async findAccountWeAdded(p: AddAccountParams): Promise<string | null> {
    try {
      const list = await this.getAccounts();
      const hits = list.filter((a) => a.name === p.name && String(a.login) === String(p.login));
      return hits.length === 1 ? hits[0].accountId : null;
    } catch {
      return null;
    }
  }

  async deleteAccount(accountId: string): Promise<void> {
    try {
      await this.call('account/deleteAccount.php', 'other', { account_id: accountId });
    } catch (e: any) {
      // Removing an account that is already gone is not an error.
      if (e instanceof DuplikiumError && e.kind === 'API' && /not.?found|unknown|does not exist|no such/i.test(e.message)) return;
      throw e;
    }
  }

  async updateAccount(accountId: string, changes: { enabled?: boolean; password?: string; name?: string; group?: string | null }): Promise<void> {
    await this.call('account/updateAccount.php', 'other', {
      account_id: accountId,
      status: changes.enabled === undefined ? undefined : changes.enabled ? 1 : 0,
      password: changes.password,
      name: changes.name,
      group: changes.group === null ? '' : changes.group,
    });
  }

  async getAccounts(ids?: string | string[]): Promise<DuplikiumAccount[]> {
    const json = await this.call('account/getAccounts.php', 'accounts', { account_id: ids });
    const list = accountRows(json);
    if (!list) {
      const keys = json && typeof json === 'object' ? Object.keys(json).slice(0, 12).join(', ') : typeof json;
      throw new DuplikiumError('BAD_RESPONSE', 'The copier service sent an account list we could not read.', { detail: `the answer had these fields: ${keys || 'none'}` });
    }
    return list.map(normalizeAccount).filter((a: DuplikiumAccount | null): a is DuplikiumAccount => a !== null);
  }

  // ----- copy settings -----

  async getSettings(f: { idMaster?: string; idSlave?: string; idGroup?: string }): Promise<DuplikiumSetting[]> {
    const json = await this.call('settings/getSettings.php', 'settings', { id_master: f.idMaster, id_slave: f.idSlave, id_group: f.idGroup });
    const list = Array.isArray(json?.settings) ? json.settings : [];
    return list.map(normalizeSetting).filter((s: DuplikiumSetting | null): s is DuplikiumSetting => s !== null);
  }

  async setSettings(s: { idMaster?: string; idSlave?: string; idGroup?: string; copierStatus?: number; riskFactorType?: number; riskFactorValue?: number }): Promise<void> {
    if (s.idSlave && s.idGroup) throw new DuplikiumError('API', 'Set either a slave or a template, not both.');
    if (!s.idSlave && !s.idGroup) throw new DuplikiumError('API', 'A slave or a template is required.');
    // The documentation does not describe this answer, so its shape is not relied on: callers read the setting back to confirm it took.
    await this.call(
      'settings/setSettings.php',
      'settings',
      {
        id_master: s.idMaster,
        id_slave: s.idSlave,
        id_group: s.idGroup,
        copier_status: s.copierStatus,
        risk_factor_type: s.riskFactorType,
        risk_factor_value: s.riskFactorValue,
      },
      false,
      true
    );
  }

  // ----- positions -----

  async getOpenPositions(accountId: string): Promise<PositionsResult> {
    return readPositions(await this.call('position/getOpenPositions.php', 'open', { account_id: accountId }));
  }

  async getClosedPositions(accountId: string): Promise<PositionsResult> {
    return readPositions(await this.call('position/getClosedPositions.php', 'closed', { account_id: accountId }));
  }
}

const RATE_LIMIT_WORDS = /request limit|rate limit|too many requests/i;

/** Reads "(2/1 per second)" out of the service's own wording: 1 call is allowed, 2 were made. */
export function parseRateLimit(message: string): { unit?: 'second' | 'minute' | 'hour'; max?: number } {
  const m = String(message ?? '').match(/\(\s*\d+\s*\/\s*(\d+)\s*per\s*(second|minute|hour)\s*\)/i);
  return m ? { max: Number(m[1]), unit: m[2].toLowerCase() as 'second' | 'minute' | 'hour' } : {};
}

function errMessage(json: any): string {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return '';
  const e = json.error;
  if (typeof e === 'string' && e) return e;
  if (e && typeof e === 'object' && typeof e.message === 'string') return e.message;
  return '';
}
function errCode(json: any): string | undefined {
  const c = json && typeof json === 'object' ? json.code : undefined;
  return c === undefined || c === null ? undefined : String(c);
}
