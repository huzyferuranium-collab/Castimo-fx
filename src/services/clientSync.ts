/**
 * What the two answers the server gives the dashboard mean. Pure (it imports nothing), so it can be tested on its own.
 *
 * Everybody asks for their OWN account (GET /api/trade/my-account). Administrators are also sent every client
 * (GET /api/trade/clients), for the admin console. An administrator can use the Client Terminal with their own account too, so
 * their own account has to come from the first answer: it is not found by looking through the list (the list is for the
 * admin console, and an account that is held back for any reason is not in it).
 */

/** The server's answer about the signed-in user's own account. */
export interface OwnAnswer {
  connected?: boolean;
  client?: unknown;
  pending?: unknown;
}

export interface SyncEntry {
  client: any;
  /** True for the signed-in user's own account. */
  own: boolean;
}

export interface SyncPlan {
  /** False when neither answer arrived: nothing is changed. */
  reachable: boolean;
  /** The accounts to apply: the signed-in user's own first, then everyone else the server listed. */
  entries: SyncEntry[];
  /** True when the server sent the list of all clients (this user is an administrator). */
  listed: boolean;
  /** What the "still connecting" notice should now show ({ value: null } clears it); null leaves it as it is. */
  pending: { value: unknown } | null;
}

/**
 * @param mine  the answer about the user's own account, or null when that request did not succeed
 * @param list  every client (administrators only), or null when this user is not sent it or the request did not succeed
 */
export function planSync(mine: OwnAnswer | null, list: unknown[] | null): SyncPlan {
  const entries: SyncEntry[] = [];
  let pending: SyncPlan['pending'] = null;

  if (mine) {
    const connected = Boolean(mine.connected);
    if (connected && mine.client && typeof mine.client === 'object') entries.push({ client: mine.client, own: true });
    // Connected: nothing is left to wait for. Otherwise whatever the server says about a connection it is still looking after.
    pending = { value: connected ? null : mine.pending ?? null };
  }

  for (const c of list ?? []) {
    if (c && typeof c === 'object') entries.push({ client: c, own: false });
  }

  return { reachable: mine !== null || list !== null, entries, listed: list !== null, pending };
}
