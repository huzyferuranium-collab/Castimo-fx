/**
 * The rules for what happens to a client's copier account while it is not yet (or no longer) a verified,
 * live connection. Pure functions only: given what Duplikium last reported and what we remember, decide
 * the next step. The connection manager does the I/O; keeping the rules here means every branch can be
 * unit-tested without the network.
 *
 *   connected + real figures        -> VERIFY (apply the rules, then switch copying on)
 *   connected, figures not in yet   -> WAIT   (Duplikium refreshes balances after each trade and every 5 minutes)
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
  | { action: 'WAIT'; label: string; disconnectedSince?: number }
  | { action: 'REJECT'; reason: 'TRADING_NOT_ALLOWED' | 'BROKER_AUTH_FAILED' | 'GONE' }
  | { action: 'GIVE_UP' };

/** How long "not logged in" is tolerated before the login is judged wrong. The first login can take a moment. */
export const DISCONNECT_GRACE_MS = 45_000;

export function decideLink(
  acc: DuplikiumAccount | null,
  mem: LinkMemory,
  now: number,
  graceMs: number = DISCONNECT_GRACE_MS
): LinkDecision {
  if (!acc) return { action: 'REJECT', reason: 'GONE' };

  const kind = classifyState(acc.state);
  if (kind === 'investor') return { action: 'REJECT', reason: 'TRADING_NOT_ALLOWED' };

  if (kind === 'connected' && hasFigures(acc)) return { action: 'VERIFY' };

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
export function desiredCopierStatus(rec: { status: string; billingBlocked?: boolean; isBrokerVerified: boolean }): number {
  // Not (yet) verified: frozen. Paused or unpaid: only follow the master's closes, so nothing is left stranded.
  if (!rec.isBrokerVerified) return COPIER.FROZEN;
  return rec.status === 'ACTIVE' && !rec.billingBlocked ? COPIER.ON : COPIER.CLOSE_ONLY;
}
