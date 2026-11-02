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
  /** For a request-limit error: how long to leave the service alone before asking again. */
  retryAfterMs?: number;
  constructor(kind: DuplikiumErrorKind, message: string, extra: { code?: string; status?: number; detail?: string; retryAfterMs?: number } = {}) {
    super(message);
    this.name = 'DuplikiumError';
    this.kind = kind;
    this.code = extra.code;
    this.status = extra.status;
    this.detail = extra.detail;
    this.retryAfterMs = extra.retryAfterMs;
  }
}

/** A short description of an answer we could not read: the status and the first words, with any password in it hidden. */
let nonJsonNoted = false;
let contactUsNoted = false;

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
  /** What the answer looked like (field names and kinds only), for the logs when something could not be read. Not enumerable. */
  readonly layout?: string;
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
  /** Optional: how often the whole account list may be read inside the service's limits (milliseconds). */
  refreshSpacingMs?(): number;
  /** Optional: how long until the limits let the next read of the account list through (0 = now). */
  accountsReadyInMs?(): number;
  /** Optional: how many more reads of the account list fit in the current minute and hour. */
  accountsHeadroom?(): number;
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
const POS_ID_KEYS = ['ticket', 'position_id', 'positionId', 'position_ticket', 'order_id', 'orderId', 'order', 'position', 'id', 'trade_id', 'tradeId', 'deal', 'identifier'];
const POS_SYMBOL_KEYS = ['symbol', 'instrument', 'pair', 'symbol_name', 'symbolName'];
const POS_SIDE_KEYS = ['type', 'side', 'action', 'direction', 'cmd', 'order_type', 'position_type', 'positionType', 'trade_type', 'operation'];
const POS_VOLUME_KEYS = ['volume', 'lots', 'lot', 'size', 'quantity', 'qty', 'lot_size'];
const POS_ACCOUNT_KEYS = ['account_id', 'accountId', 'id_account'];

/** The first of these fields that holds a plain value (text or number). Objects and lists are never read as a value. */
function firstScalar(raw: any, keys: string[]): string | number | undefined {
  for (const k of keys) {
    const v = raw[k];
    if ((typeof v === 'string' && v.trim() !== '') || (typeof v === 'number' && Number.isFinite(v))) return v;
  }
  return undefined;
}

/**
 * Buy or sell, only when the answer says it in words ("Buy", "SELL", "POSITION_TYPE_BUY", "long", "b"/"s").
 * A number (for example 0 or 1) is never turned into a side: what the numbers mean has not been confirmed for this service.
 */
export function readSide(v: unknown): 'BUY' | 'SELL' | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (s === 'b') return 'BUY';
  if (s === 's') return 'SELL';
  const words = s.split(/[^a-z]+/).filter(Boolean);
  const buy = words.some((w) => w === 'buy' || w === 'long');
  const sell = words.some((w) => w === 'sell' || w === 'short');
  return buy === sell ? null : buy ? 'BUY' : 'SELL';
}

/** True for an object that names a symbol and a size: it is read as one position. */
function looksLikePosition(v: any): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v) && firstScalar(v, POS_SYMBOL_KEYS) !== undefined && firstScalar(v, POS_VOLUME_KEYS) !== undefined;
}

/**
 * Reads one open or closed position. Several spellings are accepted for each field because the position
 * calls are the least documented part of the service. A position without a recognisable id, symbol,
 * buy/sell side and size is rejected (null): it is left out rather than shown with made-up values.
 */
export function normalizePosition(raw: any): DuplikiumPosition | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = str(firstScalar(raw, POS_ID_KEYS));
  const symbol = str(firstScalar(raw, POS_SYMBOL_KEYS));
  const side = readSide(firstScalar(raw, POS_SIDE_KEYS));
  const volume = num(firstScalar(raw, POS_VOLUME_KEYS));
  if (!id || !symbol || !side || volume === null || volume <= 0) return null;
  const openRaw = firstDefined(raw, ['open_time', 'opentime', 'time_open', 'open_date', 'openTime', 'opened_at', 'openedAt', 'open_at', 'time']);
  const closeRaw = firstDefined(raw, ['close_time', 'closetime', 'time_close', 'close_date', 'closeTime', 'closed_at', 'closedAt']);
  return {
    id,
    symbol,
    side,
    volume,
    openPrice: num(firstDefined(raw, ['open_price', 'openprice', 'price_open', 'openPrice', 'entry_price', 'price'])),
    closePrice: num(firstDefined(raw, ['close_price', 'closeprice', 'price_close', 'closePrice'])),
    stopLoss: num(firstDefined(raw, ['sl', 'stop_loss', 'stoploss', 'stopLoss'])),
    takeProfit: num(firstDefined(raw, ['tp', 'take_profit', 'takeprofit', 'takeProfit'])),
    profit: num(firstDefined(raw, ['profit', 'pnl', 'net_profit', 'floating_profit'])),
    commission: num(raw.commission),
    swap: num(raw.swap),
    openTime: toIso(openRaw),
    closeTime: toIso(closeRaw),
    rawOpenTime: openRaw === undefined ? null : String(openRaw),
  };
}

/** Lists that hold rows whatever is in them, so a row we cannot read is counted, not lost without a word. */
const ROW_LISTS = /^(positions?|open_?positions?|closed_?positions?|trades?|data|results?|items|rows)$/i;

/**
 * Finds the positions inside whatever Duplikium returned: a bare list, a list under any name, rows keyed by ticket or by
 * account, or one level of grouping. Groups whose name matches `skipGroups` (closed trades when reading open ones, and
 * the other way round) are not entered.
 */
export function extractPositionList(json: any, skipGroups?: RegExp): any[] {
  const rows: any[] = [];
  const walk = (v: any, key: string, depth: number) => {
    if (depth > 5 || !v || typeof v !== 'object') return;
    if (skipGroups && key && skipGroups.test(key)) return;
    if (Array.isArray(v)) {
      const holdsRows = ROW_LISTS.test(key) || key === '' || v.some(looksLikePosition);
      for (const item of v) {
        if (looksLikePosition(item)) rows.push(item);
        else if (item && typeof item === 'object' && !Array.isArray(item) && holdsRows && !Object.values(item).some((x) => x && typeof x === 'object')) rows.push(item);
        else walk(item, key, depth + 1);
      }
      return;
    }
    if (looksLikePosition(v)) {
      rows.push(v);
      return;
    }
    for (const [k, child] of Object.entries(v)) walk(child, /^\d+$/.test(k) ? key : k, depth + 1);
  };
  walk(json, '', 0);
  return rows;
}

/** The kind of a value, for describing an answer without showing what is in it. */
function kindOf(v: unknown): string {
  return v === null ? 'null' : Array.isArray(v) ? 'list' : typeof v;
}

/**
 * What an answer looked like: field names and kinds, never values, except buy/sell and symbol fields (short, and what is
 * needed to learn how the service writes a side). Keys that are ids (long numbers) are shown as #id. For the logs and the
 * administrator's connection check.
 */
export function describeAnswer(json: any, depth = 0): string {
  if (json === null || typeof json !== 'object') return kindOf(json);
  if (depth >= 4) return Array.isArray(json) ? 'list' : 'object';
  if (Array.isArray(json)) return json.length === 0 ? '[]' : `[${json.length}× ${describeAnswer(json[0], depth + 1)}]`;
  const entries = Object.entries(json);
  const shown = entries.slice(0, 16).map(([k, v]) => {
    const name = /^\d{3,}$/.test(k) ? '#id' : k;
    if (v !== null && typeof v === 'object') return `${name}:${describeAnswer(v, depth + 1)}`;
    const reveal = (POS_SIDE_KEYS.includes(k) || POS_SYMBOL_KEYS.includes(k)) && (typeof v === 'number' || (typeof v === 'string' && v.length <= 24));
    return `${name}:${kindOf(v)}${reveal ? `=${JSON.stringify(v)}` : ''}`;
  });
  return `{${shown.join(', ')}${entries.length > 16 ? `, …${entries.length - 16} more` : ''}}`;
}

export interface ReadPositionsOptions {
  /** The account that was asked for: rows that name another account are dropped. */
  accountId?: string;
  /** Groups not to enter (see extractPositionList). */
  skipGroups?: RegExp;
}

export function readPositions(json: any, opts: ReadPositionsOptions = {}): PositionsResult {
  const list = extractPositionList(json, opts.skipGroups);
  const positions: DuplikiumPosition[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of list) {
    const owner = raw && typeof raw === 'object' ? str(firstScalar(raw, POS_ACCOUNT_KEYS)) : '';
    if (opts.accountId && owner && owner !== String(opts.accountId)) continue; // another account's trade: never shown here
    const p = normalizePosition(raw);
    if (!p) skipped++;
    else if (!seen.has(p.id)) {
      seen.add(p.id);
      positions.push(p);
    }
  }
  const result: PositionsResult = { positions, skipped };
  // Kept beside the result (not enumerable) so a caller can describe an answer it could not fully read.
  Object.defineProperty(result, 'layout', { value: describeAnswer(json), enumerable: false });
  return result;
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

/**
 * Duplikium's documented limits for the calls that depend on how many accounts are linked to the API key:
 * getAccounts min(1xN,10)/s, min(2xN,60)/min, min(30xN,1800)/h; open positions 5, 30, 900; closed positions 5, 15, 300.
 * Large values keep a 10% margin; small ones are used exactly (2 a minute cannot be made smaller).
 */
export function limitsForAccountCount(n: number): Pick<Record<LimitClass, Window>, 'accounts' | 'open' | 'closed'> {
  const N = Math.max(1, Math.floor(n) || 1);
  const m = (x: number) => (x >= 10 ? Math.floor(x * 0.9) : x);
  const w = (sec: number, min: number, hour: number): Window => ({ perSec: Math.min(N, sec), perMin: m(Math.min(2 * N, min)), perHour: m(Math.min(30 * N, hour)) });
  return { accounts: w(10, 60, 1800), open: w(5, 30, 900), closed: w(5, 15, 300) };
}

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

  private listCount: number | null = null;
  private serviceCount: { n: number; at: number } | null = null;
  private blockedUntil = new Map<LimitClass, number>();

  /**
   * The service refused a call of this kind: leave this kind of call alone for `ms`. Calls made meanwhile would only be refused
   * again (and may count against us), so they are not sent at all.
   */
  blockFor(cls: LimitClass, ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    const until = this.now() + ms;
    if (until > (this.blockedUntil.get(cls) ?? 0)) this.blockedUntil.set(cls, until);
  }

  /** An account was added (+1) or removed (-1): the count the limits depend on moves with it, before the next list read confirms it. */
  noteAccountsChange(delta: number): void {
    if (this.listCount === null || !Number.isFinite(delta)) return;
    this.setAccountsCount(this.listCount + delta, 'list');
  }

  /** Milliseconds until a call of this kind would be let through, 0 if it may go now. Does not use up a slot. */
  msUntilFree(cls: LimitClass): number {
    return this.waitFor(cls, this.now());
  }

  /** How many more calls of this kind fit in the current minute and hour (the smaller of the two). Does not use up a slot. */
  headroom(cls: LimitClass): number {
    const t = this.now();
    const w = this.limits[cls];
    const used = (this.hits.get(cls) ?? []).filter((x) => t - x < 3_600_000);
    const inMinute = used.filter((x) => t - x < 60_000).length;
    return Math.max(0, Math.min(w.perMin - inMinute, w.perHour - used.length));
  }

  /**
   * The limits for the calls that depend on the number of linked accounts. `list` is how many accounts we last saw;
   * `service` is the number Duplikium itself named in a request-limit answer ("with 1 accounts"), which wins for 30 minutes.
   */
  setAccountsCount(n: number, source: 'list' | 'service'): void {
    const k = Math.max(1, Math.floor(n) || 1);
    if (source === 'list') this.listCount = k;
    else this.serviceCount = { n: k, at: this.now() };
    const fresh = this.serviceCount && this.now() - this.serviceCount.at < 30 * 60_000;
    const eff = fresh ? Math.min(this.serviceCount!.n, this.listCount ?? this.serviceCount!.n) : (this.listCount ?? k);
    Object.assign(this.limits, limitsForAccountCount(eff));
  }

  /** How far apart calls of this kind must be, on average, to stay inside every window (milliseconds). */
  sustainableSpacingMs(cls: LimitClass): number {
    const w = this.limits[cls];
    return Math.ceil(Math.max(1100 / w.perSec, 60_000 / w.perMin, 3_600_000 / w.perHour));
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
    const blocked = this.blockedUntil.get(cls);
    if (blocked !== undefined && blocked > t) wait = Math.max(wait, blocked - t);
    return wait;
  }

  async acquire(cls: LimitClass, maxWaitMs: number = this.maxWaitMs): Promise<void> {
    const started = this.now();
    for (;;) {
      const t = this.now();
      const wait = this.waitFor(cls, t);
      if (wait <= 0) {
        this.hits.get(cls)!.push(t);
        return;
      }
      if (t - started + wait > maxWaitMs) {
        throw new DuplikiumError('RATE_LIMIT', 'The copier service is busy right now. Please try again in a minute.', { retryAfterMs: wait + 1000 });
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
    if (opts.limiter) this.limiter = opts.limiter;
    else {
      // Until we have seen the account list, assume the smallest size: the limits only get roomier from there.
      this.limiter = new RateLimiter(DEFAULT_LIMITS, this.now);
      this.limiter.setAccountsCount(1, 'list');
    }
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

  /** How often the whole account list may be read, on average, inside the service's limits (milliseconds). */
  refreshSpacingMs(): number {
    return this.limiter.sustainableSpacingMs('accounts');
  }

  /** How long until the limits let the next read of the account list through (0 = now). */
  accountsReadyInMs(): number {
    return this.limiter.msUntilFree('accounts');
  }

  /** How many more reads of the account list fit in the current minute and hour. */
  accountsHeadroom(): number {
    return this.limiter.headroom('accounts');
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
      // The service named its real limit ("2/1 per second", "with 1 accounts"): remember it so we never go over it again.
      if (limit.accounts) this.limiter.setAccountsCount(limit.accounts, 'service');
      if (limit.unit && limit.max) this.limiter.tighten(cls, limit.unit, limit.max);
      // A per-second slip is over in a moment: wait and try once more before giving up.
      if (limit.unit === 'second' && !rateRetried) {
        await this.limiter.pause(1300);
        return this.call(path, cls, form, retried, lenient, true);
      }
      const retryAfterMs = limit.unit === 'second' ? 3_000 : limit.unit === 'hour' ? 600_000 : 65_000;
      // From here on this kind of call is not sent until the wait is over: it would only be refused again.
      this.limiter.blockFor(cls, retryAfterMs);
      throw new DuplikiumError('RATE_LIMIT', 'The copier service is busy right now. Please try again in a minute.', { status: res.status, detail: message.slice(0, 200), retryAfterMs });
    }
    if (message) throw new DuplikiumError('API', message, { status: res.status, code: errCode(json) });
    if (res.status >= 400) throw new DuplikiumError('API', `The copier service answered with status ${res.status}.`, { status: res.status });
    return json;
  }

  // ----- accounts -----

  async addAccount(p: AddAccountParams): Promise<{ accountId: string }> {
    const added = await this.addAccountRaw(p);
    this.limiter.noteAccountsChange(1); // the limits grow with the number of linked accounts, from this moment on
    return added;
  }

  private async addAccountRaw(p: AddAccountParams): Promise<{ accountId: string }> {
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
      this.limiter.noteAccountsChange(-1);
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
    if (list && ids === undefined) this.limiter.setAccountsCount(list.length, 'list'); // the whole list: how many accounts are linked
    if (!list) {
      const keys = json && typeof json === 'object' ? Object.keys(json).slice(0, 12).join(', ') : typeof json;
      throw new DuplikiumError('BAD_RESPONSE', 'The copier service sent an account list we could not read.', { detail: `the answer had these fields: ${keys || 'none'}` });
    }
    return list.map(normalizeAccount).filter((a: DuplikiumAccount | null): a is DuplikiumAccount => a !== null);
  }

  // ----- copy settings -----

  async getSettings(f: { idMaster?: string; idSlave?: string; idGroup?: string }): Promise<DuplikiumSetting[]> {
    let json: any;
    try {
      json = await this.call('settings/getSettings.php', 'settings', { id_master: f.idMaster, id_slave: f.idSlave, id_group: f.idGroup });
    } catch (e) {
      // Seen live: when nothing matches the filter yet, Duplikium answers with only "please contact us at support@trade-copier.com".
      // That is read as "no settings found". Anything that depends on a setting reads it back and checks the value, so this can
      // never make a setting look applied.
      if (e instanceof DuplikiumError && e.kind === 'API' && /^\W*please contact us\b/i.test(e.message)) {
        if (!contactUsNoted) {
          contactUsNoted = true;
          console.warn('ℹ️ [DUPLIKIUM] Reading copy settings was answered with "please contact us" and is treated as "no settings found yet".');
        }
        return [];
      }
      throw e;
    }
    const list = Array.isArray(json?.settings) ? json.settings : [];
    return list.map(normalizeSetting).filter((s: DuplikiumSetting | null): s is DuplikiumSetting => s !== null);
  }

  async setSettings(s: { idMaster?: string; idSlave?: string; idGroup?: string; copierStatus?: number; riskFactorType?: number; riskFactorValue?: number }): Promise<void> {
    if (s.idSlave && s.idGroup) throw new DuplikiumError('API', 'Set either a slave or a template, not both.');
    if (!s.idSlave && !s.idGroup) throw new DuplikiumError('API', 'A slave or a template is required.');
    // The service takes a LIST of settings rows (its own sample does http_build_query on a list), so the row is sent as row 0:
    // 0[id_master]=..&0[id_slave]=..&0[copier_status]=.. . Its answer is not relied on: callers read the setting back to confirm it took.
    const row: Record<string, unknown> = {
      id_master: s.idMaster,
      id_slave: s.idSlave,
      id_group: s.idGroup,
      copier_status: s.copierStatus,
      risk_factor_type: s.riskFactorType,
      risk_factor_value: s.riskFactorValue,
    };
    const form: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) form[`0[${k}]`] = v;
    await this.call('settings/setSettings.php', 'settings', form, false, true);
  }

  // ----- positions -----

  async getOpenPositions(accountId: string): Promise<PositionsResult> {
    return readPositions(await this.call('position/getOpenPositions.php', 'open', { account_id: accountId }), { accountId, skipGroups: /closed|history|pending/i });
  }

  async getClosedPositions(accountId: string): Promise<PositionsResult> {
    return readPositions(await this.call('position/getClosedPositions.php', 'closed', { account_id: accountId }), { accountId, skipGroups: /^open|pending/i });
  }
}

const RATE_LIMIT_WORDS = /request limit|rate limit|too many requests/i;

/** Reads "(2/1 per second)" out of the service's own wording: 1 call is allowed, 2 were made. */
export function parseRateLimit(message: string): { unit?: 'second' | 'minute' | 'hour'; max?: number; accounts?: number } {
  const text = String(message ?? '');
  const m = text.match(/\(\s*\d+\s*\/\s*(\d+)\s*per\s*(second|minute|hour)\s*\)/i);
  const a = text.match(/with\s+(\d+)\s+accounts?/i);
  return { ...(m ? { max: Number(m[1]), unit: m[2].toLowerCase() as 'second' | 'minute' | 'hour' } : {}), ...(a ? { accounts: Number(a[1]) } : {}) };
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
