/**
 * Broker verification rules (pure functions, no I/O, unit-tested).
 *
 * The one rule of this platform: an account is only "connected" if the BROKER itself
 * answered for it. Nothing the browser sends (balance, equity, names, flags) is ever
 * trusted. These helpers decide what counts as a real, usable broker account.
 *
 * The broker's answer reaches us through Duplikium (trade-copier.com), which logs in to the client's MT5
 * account and reports the account's real balance, equity, free margin and connection state.
 */

import { DuplikiumError, type DuplikiumAccount } from './duplikiumClient.ts';

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
  | 'ALREADY_CONNECTED'
  | 'IS_MASTER_ACCOUNT'
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
  /** Set when the client's copier account exists and was kept (the failure was not final), so it can be finished in the background. */
  accountId?: string;
  constructor(code: BrokerErrorCode, message: string) {
    super(message);
    this.name = 'BrokerVerificationError';
    this.code = code;
  }
}

export interface VerifiedBrokerAccount {
  balance: number;
  equity: number;
  freeMargin: number;
  /** 0 means the service does not report leverage, so none is shown. */
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
    throw new BrokerVerificationError('BAD_INPUT', 'Please check your MT5 account number. It should be 4 to 12 digits.');
  }
  if (server.length < 3 || server.length > 100) {
    throw new BrokerVerificationError('BAD_INPUT', 'Please type or choose your broker server, exactly as shown on your MT5 login screen.');
  }
  if (password.length < 1 || password.length > 200) {
    throw new BrokerVerificationError('BAD_INPUT', 'Please enter your MT5 trading password.');
  }
  return { login, password, server };
}

/** Smallest equity (in USD) an account needs for trades to be copied to it. Below it the account still connects, it just does not copy yet. */
export const DEFAULT_MIN_CONNECT_EQUITY = 200;

/**
 * What a NEW connection needs. Only USD accounts are accepted, because the minimum and the profit share are measured in USD.
 * Equity is not a reason to refuse anyone: a smaller account connects and simply is not copied yet (see isBelowCopyMinimum).
 */
export function checkConnectEligibility(v: { equity: number; currency: string }): void {
  if (String(v.currency).toUpperCase() !== 'USD') {
    throw new BrokerVerificationError(
      'UNSUPPORTED_CURRENCY',
      `Right now we can only connect accounts held in US dollars (USD), and this one is in ${v.currency}.`
    );
  }
}

/**
 * True while an account has less equity than copying needs. When the figure cannot be read we also hold copying back
 * (nothing is copied to an account whose equity nobody can see); the account is released as soon as it is readable and big enough.
 */
export function isBelowCopyMinimum(equity: number, minEquity: number = DEFAULT_MIN_CONNECT_EQUITY): boolean {
  return !Number.isFinite(equity) || equity < minEquity;
}

// ---------- reading the broker's answer ----------

/**
 * What Duplikium's last known state means for us.
 *  - connected:    the account is logged in (a failed order or a protection stop is about trading, not the login)
 *  - investor:     only the read-only (investor) password was given, so trades cannot be copied
 *  - disconnected: Duplikium could not log in (wrong number, password or server, or the broker is unreachable)
 *  - service:      Duplikium's own balance for copying is empty: our problem, never the client's
 *  - pending:      no answer yet
 */
export type LinkKind = 'connected' | 'investor' | 'disconnected' | 'service' | 'pending';

export function classifyState(state: string): LinkKind {
  const s = String(state || '').trim().toUpperCase();
  if (s === 'INVESTOR_PASSWORD') return 'investor';
  if (s === 'DISCONNECTED') return 'disconnected';
  if (s === 'EMPTY_EWALLET') return 'service';
  if (
    s === 'CONNECTED' ||
    s === 'ORDER_FAILED' ||
    s === 'ORDER_FAILED_MARGIN' ||
    s === 'SYMBOL_NOT_FOUND' ||
    s.startsWith('SELLOUT_') ||
    s.startsWith('CLOSE_ONLY_') ||
    s.startsWith('FROZEN_')
  ) {
    return 'connected';
  }
  return 'pending';
}

/** True once Duplikium has reported the real figures we need (balance, equity and currency). */
export function hasFigures(a: Pick<DuplikiumAccount, 'balance' | 'equity' | 'currency'> | null | undefined): boolean {
  return Boolean(a) && isFiniteNumber(a!.balance) && isFiniteNumber(a!.equity) && String(a!.currency || '') !== '';
}

/**
 * Decides whether the broker's answer describes a real, tradable account.
 * Throws a BrokerVerificationError for anything else.
 */
export function verifyCopierAccount(
  acc: DuplikiumAccount | null | undefined,
  submitted: SubmittedCredentials
): VerifiedBrokerAccount {
  if (!acc || typeof acc !== 'object') {
    throw new BrokerVerificationError('BAD_BROKER_RESPONSE', 'The broker returned no account information.');
  }
  if (classifyState(acc.state) === 'investor') {
    throw new BrokerVerificationError(
      'TRADING_NOT_ALLOWED',
      'This login can only view the account (investor password) or has trading switched off. Please use your trading password so trades can be copied.'
    );
  }
  if (!hasFigures(acc) || acc.balance! < 0 || acc.equity! < 0) {
    throw new BrokerVerificationError('BAD_BROKER_RESPONSE', 'The broker returned invalid balance figures.');
  }
  // If the service reports a login, it must be the one that was submitted.
  if (acc.login && !sameLogin(acc.login, submitted.login)) {
    throw new BrokerVerificationError('LOGIN_MISMATCH', 'The broker reported a different account number from the one you entered. Please check it and try again.');
  }
  const server = String(acc.server || submitted.server || '');
  const equity = acc.equity as number;
  return {
    balance: acc.balance as number,
    equity,
    freeMargin: isFiniteNumber(acc.freeMargin) ? acc.freeMargin : equity,
    leverage: 0,
    currency: acc.currency,
    // The service does not report the broker's company name, so the server name (which the client typed
    // and the broker accepted) is shown instead.
    brokerName: server,
    accountHolderName: '',
    tradeAllowed: true,
    investorMode: false,
    accountType: /demo|trial/i.test(server) ? 'demo' : 'real',
  };
}

// ---------- ownership of broker accounts inside Duplikium ----------

/** Every account we create in Duplikium is named after the user who linked it. */
export function clientAccountName(userId: string, login: string): string {
  return `CastimoFX Client ${userId} #${login}`;
}

/**
 * True only if a Duplikium account was created for this exact user. Accounts that belong to
 * another user, the master account, or that were created by hand are NOT owned.
 */
export function isOwnedBy(accountName: unknown, userId: string): boolean {
  if (typeof accountName !== 'string' || !userId) return false;
  return (
    accountName.startsWith(`CastimoFX Client ${userId} #`) ||
    accountName.startsWith(`CastimoFX Client - ${userId} (#`)
  );
}

/** Maps errors from the copier service to errors that are safe and useful to show a client. */
export function translateCopierError(err: any, creds: SubmittedCredentials): BrokerVerificationError {
  if (err instanceof BrokerVerificationError) return err;

  if (err instanceof DuplikiumError) {
    // Our own login to the service being refused or missing is OUR problem, never the client's password.
    if (err.kind === 'AUTH' || err.kind === 'NOT_CONFIGURED') {
      const e = new BrokerVerificationError(
        'VERIFICATION_UNAVAILABLE',
        'Account verification is temporarily unavailable. Please try again in a few minutes.'
      );
      e.ref = err.kind === 'AUTH' ? 'COPIER_AUTH' : 'COPIER_NOT_CONFIGURED';
      return e;
    }
    if (err.kind === 'RATE_LIMIT') {
      const busy = new BrokerVerificationError('BROKER_SLOW', 'Our verification service is busy. Please try again in a minute.');
      busy.ref = 'RATE_LIMITED';
      return busy;
    }
    if (err.kind === 'NETWORK') {
      const e = new BrokerVerificationError('BROKER_UNREACHABLE', 'We could not reach the verification service just yet. Please try again in a minute.');
      e.ref = 'COPIER_NETWORK';
      return e;
    }
    if (err.kind === 'BAD_RESPONSE') {
      // This is a hiccup on our side, not a broker refusal: it is a retryable "unavailable" (the client's account is never removed for it).
      const e = new BrokerVerificationError('VERIFICATION_UNAVAILABLE', 'Account verification is temporarily unavailable. Please try again in a few minutes.');
      e.ref = 'COPIER_BAD_RESPONSE';
      // For the administrator only (passwords are already hidden in it): exactly what the copier service sent back.
      e.detail = String(err.detail || err.message).slice(0, 200);
      console.warn(`⚠️ [COPIER] Unreadable answer while connecting an account: ${e.detail}`);
      return e;
    }

    const msg = err.message;
    let out: BrokerVerificationError;
    if (/already|duplicate/i.test(msg)) {
      out = new BrokerVerificationError('ALREADY_LINKED', 'This broker account is already linked.');
    } else if (/limit|quota|maximum|subscription|plan|credit|wallet|upgrade|payment/i.test(msg)) {
      // The copier service's own limits or balance: ours to fix, not the client's.
      out = new BrokerVerificationError(
        'CAPACITY',
        'We cannot add new accounts at this moment. Please try again a little later, or contact support and we will help.'
      );
    } else if (/server/i.test(msg) && !/password/i.test(msg)) {
      out = new BrokerVerificationError(
        'BROKER_SERVER_NOT_FOUND',
        `Broker server '${creds.server}' was not recognised. Check that it matches your broker's official MT5 server name.`
      );
    } else if (/password|credential|login|invalid|authent|denied|refused|wrong/i.test(msg)) {
      out = new BrokerVerificationError(
        'BROKER_AUTH_FAILED',
        `Your broker did not accept the login for account #${creds.login} on '${creds.server}'. Please double-check the account number, trading password and server, then try again.`
      );
    } else {
      out = new BrokerVerificationError('BROKER_UNREACHABLE', 'We could not reach your broker just yet. Please try again in a minute.');
    }
    out.ref = (err.code || 'API').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) || 'API';
    out.detail = msg.slice(0, 200);
    return out;
  }

  // Anything else: keep the wording calm and attach a short reference that matches the server log.
  const e = new BrokerVerificationError('BROKER_UNREACHABLE', 'We could not reach your broker just yet. Please try again in a minute.');
  e.ref = (String(err?.name || 'UNKNOWN')).replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) || 'UNKNOWN';
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

// ---------- account capacity ----------

export function isPlatformClientAccount(accountName: unknown): boolean {
  return typeof accountName === 'string' && accountName.startsWith('CastimoFX Client');
}

/** How many of the given copier accounts were created for clients (not the master). */
export function countClientAccounts(accounts: Array<{ name?: unknown }>): number {
  return accounts.filter((a) => isPlatformClientAccount(a?.name)).length;
}

export function readLimit(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** Reads the user id and MT5 login back out of the name we gave a client's copier account. */
export function parseClientAccountName(name: unknown): { userId: string; login: string } | null {
  if (typeof name !== 'string') return null;
  const m = name.match(/^CastimoFX Client (\S+) #(\d+)$/) || name.match(/^CastimoFX Client - (\S+) \(#(\d+)\)$/);
  return m ? { userId: m[1], login: m[2] } : null;
}
