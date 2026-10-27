/**
 * Broker verification rules (pure functions, no I/O, unit-tested).
 *
 * The one rule of this platform: an account is only "connected" if the BROKER itself
 * answered for it. Nothing the browser sends (balance, equity, names, flags) is ever
 * trusted. These helpers decide what counts as a real, usable broker account.
 */

export type BrokerErrorCode =
  | 'BAD_INPUT'
  | 'VERIFICATION_UNAVAILABLE'
  | 'BROKER_SERVER_NOT_FOUND'
  | 'BROKER_AUTH_FAILED'
  | 'BROKER_UNREACHABLE'
  | 'BROKER_SLOW'
  | 'BAD_BROKER_RESPONSE'
  | 'LOGIN_MISMATCH'
  | 'TRADING_NOT_ALLOWED'
  | 'ALREADY_LINKED'
  | 'IS_MASTER_ACCOUNT'
  | 'MIN_EQUITY'
  | 'UNSUPPORTED_CURRENCY'
  | 'CAPACITY';

export class BrokerVerificationError extends Error {
  code: BrokerErrorCode;
  /** Short reference a client can quote to support; never contains secrets. */
  ref?: string;
  /** The connect step that was running when it failed. */
  stage?: string;
  /** Technical detail for the administrator only (never shown to clients). */
  detail?: string;
  constructor(code: BrokerErrorCode, message: string) {
    super(message);
    this.name = 'BrokerVerificationError';
    this.code = code;
  }
}

/** Account information as reported by the broker terminal (via MetaApi). */
export interface BrokerAccountInfo {
  login?: string | number;
  server?: string;
  broker?: string;
  name?: string;
  currency?: string;
  balance?: unknown;
  equity?: unknown;
  freeMargin?: unknown;
  leverage?: unknown;
  tradeAllowed?: boolean;
  investorMode?: boolean;
}

export interface VerifiedBrokerAccount {
  balance: number;
  equity: number;
  freeMargin: number;
  leverage: number;
  currency: string;
  brokerName: string;
  accountHolderName: string;
  tradeAllowed: true;
  investorMode: false;
  accountType: 'demo' | 'real';
}

export interface SubmittedCredentials {
  login: string;
  server: string;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function sameLogin(a: unknown, b: unknown): boolean {
  return String(a ?? '').trim() === String(b ?? '').trim() && String(a ?? '').trim() !== '';
}

/** Cleans and validates what the client typed. Throws BAD_INPUT. */
export function validateSubmittedCredentials(input: {
  login: unknown;
  password: unknown;
  server: unknown;
}): { login: string; password: string; server: string } {
  const login = String(input.login ?? '').trim();
  const server = String(input.server ?? '').trim();
  const password = typeof input.password === 'string' ? input.password : '';

  if (!/^\d{4,12}$/.test(login)) {
    throw new BrokerVerificationError('BAD_INPUT', 'MT5 account number must be 4 to 12 digits.');
  }
  if (server.length < 3 || server.length > 100) {
    throw new BrokerVerificationError('BAD_INPUT', 'Please choose your broker server.');
  }
  if (password.length < 1 || password.length > 200) {
    throw new BrokerVerificationError('BAD_INPUT', 'Please enter your MT5 password.');
  }
  return { login, password, server };
}

/** Smallest equity (in USD) a client needs to START a new connection. */
export const DEFAULT_MIN_CONNECT_EQUITY = 200;

/**
 * Eligibility for a NEW connection only. It is checked once, when the client connects, using the
 * broker's own figures. It is never used later to disconnect: an account that connected with enough
 * equity stays connected if its equity falls, until the client disconnects it.
 * Only USD accounts are accepted, because the minimum and the profit share are measured in USD.
 */
export function checkConnectEligibility(
  v: { equity: number; currency: string },
  minEquity: number = DEFAULT_MIN_CONNECT_EQUITY
): void {
  if (String(v.currency).toUpperCase() !== 'USD') {
    throw new BrokerVerificationError(
      'UNSUPPORTED_CURRENCY',
      `Only USD accounts can be connected right now. Your account is in ${v.currency}.`
    );
  }
  if (!Number.isFinite(v.equity) || v.equity < minEquity) {
    throw new BrokerVerificationError(
      'MIN_EQUITY',
      `Your account equity is $${Math.max(0, Number.isFinite(v.equity) ? v.equity : 0).toFixed(2)}. You need at least $${minEquity.toFixed(2)} to connect.`
    );
  }
}

/**
 * Decides whether the broker's answer describes a real, tradable account.
 * Throws a BrokerVerificationError for anything else.
 */
export function verifyBrokerAccountInfo(
  info: BrokerAccountInfo | null | undefined,
  submitted: SubmittedCredentials
): VerifiedBrokerAccount {
  if (!info || typeof info !== 'object') {
    throw new BrokerVerificationError('BAD_BROKER_RESPONSE', 'The broker returned no account information.');
  }

  // The broker's own answer must name the broker and carry real money figures.
  const brokerName = typeof info.broker === 'string' ? info.broker.trim() : '';
  if (!brokerName) {
    throw new BrokerVerificationError('BAD_BROKER_RESPONSE', 'The broker did not identify itself.');
  }
  if (!isFiniteNumber(info.balance) || !isFiniteNumber(info.equity) || info.balance < 0 || info.equity < 0) {
    throw new BrokerVerificationError('BAD_BROKER_RESPONSE', 'The broker returned invalid balance figures.');
  }

  // If the broker reports a login, it must be the one that was submitted.
  if (info.login !== undefined && info.login !== null && !sameLogin(info.login, submitted.login)) {
    throw new BrokerVerificationError('LOGIN_MISMATCH', 'The broker account does not match the login you entered.');
  }

  // Copying needs permission to place orders. A read-only (investor) login cannot be copied onto.
  if (info.tradeAllowed === false || info.investorMode === true) {
    throw new BrokerVerificationError(
      'TRADING_NOT_ALLOWED',
      'This login is read-only (investor password) or has trading disabled. Use the trading password so trades can be copied.'
    );
  }

  const server = String(info.server || submitted.server || '');
  const equity = info.equity;
  return {
    balance: info.balance,
    equity,
    freeMargin: isFiniteNumber(info.freeMargin) ? info.freeMargin : equity,
    leverage: isFiniteNumber(info.leverage) && info.leverage > 0 ? info.leverage : 100,
    currency: typeof info.currency === 'string' && info.currency ? info.currency : 'USD',
    brokerName,
    accountHolderName: typeof info.name === 'string' ? info.name.trim() : '',
    tradeAllowed: true,
    investorMode: false,
    accountType: /demo/i.test(server) ? 'demo' : 'real',
  };
}

// ---------- ownership of broker accounts inside MetaApi ----------

/** Every account we create in MetaApi is named after the user who linked it. */
export function clientAccountName(userId: string, login: string): string {
  return `CastimoFX Client ${userId} #${login}`;
}

/**
 * True only if a MetaApi account was created for this exact user. Accounts that belong to
 * another user, the master account, or that were created by hand are NOT owned.
 * (The older name format is still recognised so earlier test links keep working.)
 */
export function isOwnedBy(accountName: unknown, userId: string): boolean {
  if (typeof accountName !== 'string' || !userId) return false;
  return (
    accountName.startsWith(`CastimoFX Client ${userId} #`) ||
    accountName.startsWith(`CastimoFX Client - ${userId} (#`)
  );
}

/** Maps raw MetaApi errors to errors that are safe and useful to show a client. */
export function translateBrokerError(
  err: any,
  creds: SubmittedCredentials
): BrokerVerificationError {
  const msg: string = String(err?.message || '');
  const code: string = String(err?.details?.code || err?.code || '');

  // Our own MetaApi token being refused is OUR problem, never the client's password.
  const status = Number(err?.status ?? err?.statusCode ?? 0);
  if (
    status === 401 ||
    String(err?.name || '') === 'UnauthorizedError' ||
    (/\btoken\b/i.test(msg) && /(invalid|expired|unauthori[sz]ed|not valid)/i.test(msg))
  ) {
    return new BrokerVerificationError(
      'VERIFICATION_UNAVAILABLE',
      'Account verification is temporarily unavailable. Please try again in a few minutes.'
    );
  }

  // Too many requests: a busy moment, not a wrong password and not a full quota.
  if (status === 429 || /too ?many ?requests/i.test(msg)) {
    const busy = new BrokerVerificationError('BROKER_SLOW', 'Our verification service is busy. Please try again in a minute.');
    busy.ref = 'RATE_LIMITED';
    return busy;
  }

  if (msg.includes('.dat file for server') || code === 'E_SRV_NOT_FOUND') {
    const suggestions: string[] = err?.details?.serversByBrokers
      ? (Object.values(err.details.serversByBrokers).flat() as string[]).slice(0, 5)
      : [];
    return new BrokerVerificationError(
      'BROKER_SERVER_NOT_FOUND',
      `Broker server '${creds.server}' was not recognised.` +
        (suggestions.length ? ` Servers that exist: ${suggestions.join(', ')}.` : '') +
        ' Check that it matches your broker\'s official MT5 server name.'
    );
  }
  if (
    code === 'E_AUTH' ||
    code === 'INVALID_CREDENTIALS' ||
    /INVALID_CREDENTIALS|authori[sz]ation|authentication|account connection validation failed/i.test(msg)
  ) {
    return new BrokerVerificationError(
      'BROKER_AUTH_FAILED',
      `The broker rejected MT5 account #${creds.login} on '${creds.server}'. Check the account number, password and server.`
    );
  }
  if (/top[- ]?up|not enough funds|insufficient|quota|limit/i.test(msg) || code === 'E_QUOTA_EXCEEDED') {
    return new BrokerVerificationError(
      'CAPACITY',
      'We cannot add new accounts right now. Please try again later or contact support.'
    );
  }
  // Anything else: keep the wording calm and attach a short reference that matches the server log.
  const e = new BrokerVerificationError(
    'BROKER_UNREACHABLE',
    'Could not reach your broker to verify this account. Please try again in a minute.'
  );
  e.ref = (code || String(err?.name || '') || 'UNKNOWN').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
  return e;
}

// ---------- broker server names ----------

/** Fixes common short or old spellings of broker server names. Unknown names pass through unchanged. */
export function normalizeBrokerServer(raw: string): string {
  const server = String(raw ?? '').trim();
  let m: RegExpMatchArray | null;
  if ((m = server.match(/^exness-?real(\d+)$/i))) return `Exness-MT5Real${m[1]}`;
  if ((m = server.match(/^exness-?trial(\d+)$/i))) return `Exness-MT5Trial${m[1]}`;
  if ((m = server.match(/^icmarkets-?live(\d+)$/i))) return `ICMarketsSC-Live${m[1].padStart(2, '0')}`;
  if ((m = server.match(/^hfmarkets-?live(\d+)$/i))) return `HFMarketsGlobal-Live${m[1]}`;
  if ((m = server.match(/^xm(?:global)?-?mt5-?(\d+)$/i))) return `XMGlobal-MT5-${m[1]}`;
  return server;
}

const strip = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * If MetaApi says a server name is unknown but lists real servers, pick the one that is the same
 * name written differently (case, dashes, "MT5" inserted). Only names from MetaApi's own list are
 * ever returned, so this can never point an account at an invented server.
 */
export function pickServerAlias(requested: string, suggestions: string[]): string | null {
  const target = strip(requested);
  if (!target) return null;
  const hit = suggestions.find((s) => {
    const t = strip(s);
    return t === target || t === target.replace('real', 'mt5real') || t === target.replace('trial', 'mt5trial');
  });
  return hit && hit !== requested ? hit : null;
}

// ---------- account capacity (MetaApi charges per account) ----------

export function isPlatformClientAccount(accountName: unknown): boolean {
  return typeof accountName === 'string' && accountName.startsWith('CastimoFX Client');
}

/** How many of the given MetaApi accounts were created for clients (not the master). */
export function countClientAccounts(accounts: Array<{ name?: unknown }>): number {
  return accounts.filter((a) => isPlatformClientAccount(a?.name)).length;
}

export function readLimit(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** Reads the user id and MT5 login back out of the name we gave a client's MetaApi account. */
export function parseClientAccountName(name: unknown): { userId: string; login: string } | null {
  if (typeof name !== 'string') return null;
  const m = name.match(/^CastimoFX Client (\S+) #(\d+)$/) || name.match(/^CastimoFX Client - (\S+) \(#(\d+)\)$/);
  return m ? { userId: m[1], login: m[2] } : null;
}
