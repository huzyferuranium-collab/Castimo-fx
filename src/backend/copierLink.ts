/**
 * The rules for what happens to a client's copier account while it is not yet (or no longer) a verified,
 * live connection. Pure functions only: given what Duplikium last reported and what we remember, decide
 * the next step. The connection manager does the I/O; keeping the rules here means every branch can be
 * unit-tested without the network.
 *
 *   connected + real figures        -> VERIFY (apply the rules, then switch copying on)
 *   connected, figures not in yet   -> VERIFY_LOGIN when `connectOnLogin` (new connections): the login is proven, so the client is
 *                                      connected at once with copying held until the figures arrive; otherwise WAIT
 *                                      (Duplikium refreshes balances only after each trade and every 5 minutes)
 *   not logged in                   -> WAIT for a short grace period, then REJECT (wrong number / password / server)
 *   investor (read-only) password   -> REJECT
 *   service credit empty            -> WAIT   (our side; never the client's fault)
 *   gone from Duplikium             -> REJECT 'GONE'
 *   still unresolved after the deadline (new connections only) -> GIVE_UP
 */

import { COPIER, type DuplikiumAccount } from './duplikiumClient.ts';
import { classifyState, hasFigures } from './brokerVerification.ts';

export interface LinkMemory {
  startedAt: number;
  /** When an unverified connection is given up on. 0 means never (used for clients restored after a restart). */
  deadlineAt: number;
  /** Since when the account has been reported as not logged in. */
  disconnectedSince?: number;
}

export type LinkDecision =
  | { action: 'VERIFY' }
  | { action: 'VERIFY_LOGIN' }
  | { action: 'WAIT'; label: string; disconnectedSince?: number }
  | { action: 'REJECT'; reason: 'TRADING_NOT_ALLOWED' | 'BROKER_AUTH_FAILED' | 'GONE' }
  | { action: 'GIVE_UP' };

/** How long "not logged in" is tolerated before the login is judged wrong. The first login can take a moment. */
export const DISCONNECT_GRACE_MS = 45_000;

/** A new account may take a moment to show up in the service's list: it is not called "gone" before this much time has passed. */
export const GONE_GRACE_MS = 15_000;

export function decideLink(
  acc: DuplikiumAccount | null,
  mem: LinkMemory,
  now: number,
  graceMs: number = DISCONNECT_GRACE_MS,
  goneGraceMs: number = 0,
  connectOnLogin = false
): LinkDecision {
  if (!acc) {
    if (goneGraceMs > 0 && now - mem.startedAt < goneGraceMs) return { action: 'WAIT', label: 'Connecting to your broker…' };
    return { action: 'REJECT', reason: 'GONE' };
  }

  const kind = classifyState(acc.state);
  if (kind === 'investor') return { action: 'REJECT', reason: 'TRADING_NOT_ALLOWED' };

  if (kind === 'connected' && hasFigures(acc)) return { action: 'VERIFY' };
  if (kind === 'connected' && connectOnLogin) return { action: 'VERIFY_LOGIN' };

  let wait: LinkDecision;
  if (kind === 'disconnected') {
    const since = mem.disconnectedSince ?? now;
    if (now - since >= graceMs) return { action: 'REJECT', reason: 'BROKER_AUTH_FAILED' };
    wait = { action: 'WAIT', label: 'Waiting for your broker to accept the login…', disconnectedSince: since };
  } else if (kind === 'connected') {
    wait = { action: 'WAIT', label: 'Reading your account from the broker…' };
  } else if (kind === 'service') {
    wait = { action: 'WAIT', label: 'Getting your connection ready…' };
  } else {
    wait = { action: 'WAIT', label: 'Connecting to your broker…' };
  }

  if (mem.deadlineAt > 0 && now > mem.deadlineAt) return { action: 'GIVE_UP' };
  return wait;
}

/** What copying should be doing for a client: the one switch we control on the copier service. */
export function desiredCopierStatus(rec: { status: string; billingBlocked?: boolean; lowFunds?: boolean; figuresPending?: boolean; unsupportedCurrency?: boolean; isBrokerVerified: boolean }): number {
  // Not (yet) verified: frozen. Paused, unpaid, not yet at the minimum equity, or balance not read yet: only follow the master's
  // closes, so nothing is left stranded.
  if (!rec.isBrokerVerified) return COPIER.FROZEN;
  return rec.status === 'ACTIVE' && !rec.billingBlocked && !rec.lowFunds && !rec.figuresPending && !rec.unsupportedCurrency ? COPIER.ON : COPIER.CLOSE_ONLY;
}

/**
 * When to read the whole account list next (milliseconds). Normally every `baseSeconds`, but never faster than twice the
 * service's sustainable spacing (so other work keeps half of the allowed reads); after a request-limit answer, wait at
 * least the time the service asked for, and at least the sustainable spacing.
 */
export function nextRefreshDelayMs(baseSeconds: number, spacingMs: number, retryMs: number | null): number {
  const spacing = Math.max(0, spacingMs || 0);
  if (retryMs !== null) return Math.max(retryMs, spacing);
  return Math.max(baseSeconds * 1000, 2 * spacing);
}

/** What is known when the next read of the account list is planned. */
export interface ReadTiming {
  /** The normal gap between reads (seconds). */
  baseSeconds: number;
  /** How often reads may go on average inside the service's limits (milliseconds). */
  spacingMs: number;
  /** When the service asked us to leave it alone: how much of that wait is still left (milliseconds), or null. */
  waitLeftMs: number | null;
  /** How long ago anybody last read the list (a connect's read counts as much as the periodic one); null if never. */
  sinceLastReadMs: number | null;
  /** How long a new client's connection has been waiting in the background for the broker; null if none is. */
  waitingForMs: number | null;
  /** How long until the limits let a read through (0 = now). */
  readyInMs?: number;
  /** The quick gap used while a new client is waiting (milliseconds). */
  quickMs?: number;
}

/** How long a new client's connection is looked after at the quick pace, and then at a relaxed one, before the normal pace again. */
export const QUICK_FOR_MS = 60_000;
export const RELAXED_FOR_MS = 180_000;

/**
 * When to read the whole account list next (milliseconds).
 *  - Normally every `baseSeconds`, but never faster than twice the sustainable spacing (so other work keeps half of the allowed reads).
 *  - The gap is counted from the LAST read by anyone, so reads made while connecting a client replace the periodic one.
 *  - While a new client's connection waits for the broker the gap is short (quick, then relaxed), so it is finished within seconds of
 *    being ready; the limits themselves keep this inside the service's allowance.
 *  - After a request-limit answer nothing is read until the service's wait is over.
 */
export function nextReadDelayMs(t: ReadTiming): number {
  const spacing = Math.max(0, t.spacingMs || 0);
  const ready = Math.max(0, t.readyInMs || 0);
  const quick = Math.max(1000, t.quickMs ?? 5000);
  const waiting = t.waitingForMs !== null && t.waitingForMs < RELAXED_FOR_MS;
  const gapWhenBusy = t.waitingForMs !== null && t.waitingForMs < QUICK_FOR_MS ? quick : Math.max(quick, 15_000);
  if (t.waitLeftMs !== null && t.waitLeftMs > 0) return Math.max(t.waitLeftMs, waiting ? gapWhenBusy : spacing, ready);
  const gap = waiting ? gapWhenBusy : Math.max(t.baseSeconds * 1000, 2 * spacing);
  const since = t.sinceLastReadMs === null ? 0 : Math.max(0, t.sinceLastReadMs);
  return Math.max(1000, gap - since, ready);
}
