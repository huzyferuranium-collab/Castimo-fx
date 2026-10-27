/**
 * The copy engine's memory of "which client trade belongs to which master trade", rebuilt from the brokers.
 *
 * Why this exists: the engine used to keep that link only in memory, so every restart (every deploy) made it
 * forget. A client who had copied a master trade before the restart then kept it open after the master closed
 * it. The broker never forgets, and every copy we open carries the label "CastimoCopy #<master trade id>", so
 * the link can always be rebuilt by reading each client's open positions.
 *
 * Pure functions only (no MetaApi, no timers): the engine (REPLICATION_ENGINE.ts) reads the positions and acts on
 * the plan, and every rule below can be tested without a broker.
 *
 * Safety rules, in order of importance:
 *  1. Only a position whose label is EXACTLY "CastimoCopy #<digits>" is ever touched. A client's own trades,
 *     or anything with another label, are never adopted, closed or counted.
 *  2. Nothing is closed unless the master's open trades are known right now (`masterOpen` is null otherwise).
 *  3. A copy with no open master trade is closed only after it was seen that way on two passes at least
 *     `confirmMs` apart, so one bad read can never close a healthy copy.
 *  4. A client whose positions could not be read is skipped: no decision is made for them.
 */

export const COPY_TAG = 'CastimoCopy #';

/** The label written on every copy we open. */
export function copyComment(masterPositionId: string | number): string {
  return `${COPY_TAG}${masterPositionId}`;
}

/** The master trade id inside a copy label, or null when the label is not exactly ours. */
export function parseCopyComment(comment: unknown): string | null {
  if (typeof comment !== 'string') return null;
  const m = /^CastimoCopy #(\d{1,20})$/.exec(comment.trim());
  return m ? m[1] : null;
}

export interface ClientPosition {
  id: string | number;
  comment?: string | null;
  symbol?: string;
  volume?: number;
  openPrice?: number;
  time?: Date | string | number | null;
}

export interface ReconcileClient {
  userId: string;
  accountId: string;
  /** The client's open positions as the broker reports them now; null when they could not be read. */
  positions: ClientPosition[] | null;
}

export interface ReconcileInput {
  /**
   * Master trades that are open right now. The caller passes the union of a live read and the engine's own list,
   * so a trade counts as closed only when both agree. null = not known: nothing is ever closed.
   */
  masterOpen: ReadonlySet<string> | null;
  clients: ReconcileClient[];
  /** What the engine remembers: master trade id -> user id -> client position id. */
  known: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** Copies seen without an open master trade on earlier passes: "userId|positionId" -> when first seen (ms). */
  suspects: ReadonlyMap<string, number>;
  /** Do not try to close this "userId|positionId" before this time (ms). Used to back off after a failed close. */
  notBefore?: ReadonlyMap<string, number>;
  now: number;
  /** A copy must have looked wrong for at least this long (across two passes) before it is closed. */
  confirmMs: number;
}

export interface Adoption {
  masterId: string;
  userId: string;
  accountId: string;
  positionId: string;
  symbol: string;
  volume: number;
  openPrice: number;
  openedAt: string;
}

export interface Closure {
  masterId: string;
  userId: string;
  accountId: string;
  positionId: string;
  symbol: string;
  reason: 'master-closed' | 'duplicate';
}

export interface ReconcilePlan {
  /** Copies found at the broker that the engine did not remember: remember them. */
  adopt: Adoption[];
  /** Copies to close now (confirmed). */
  close: Closure[];
  /** The suspects to carry into the next pass (includes the ones in `close` until the engine has acted). */
  suspects: Map<string, number>;
  /** How many suspects are still waiting for their second sighting: the engine should look again soon. */
  waiting: number;
  /** Tagged copies seen in total, for the admin view. */
  copiesSeen: number;
}

export function suspectKey(userId: string, positionId: string | number): string {
  return `${userId}|${positionId}`;
}

function openedAtOf(p: ClientPosition, fallbackMs: number): string {
  const t = p.time instanceof Date ? p.time.getTime() : p.time != null ? new Date(p.time as any).getTime() : NaN;
  return new Date(Number.isFinite(t) ? t : fallbackMs).toISOString();
}

/** Oldest first; ids compared as numbers when both are numeric, so the earliest-opened copy is kept. */
function byAge(a: ClientPosition, b: ClientPosition): number {
  const ta = a.time != null ? new Date(a.time as any).getTime() : NaN;
  const tb = b.time != null ? new Date(b.time as any).getTime() : NaN;
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
  const ia = Number(a.id);
  const ib = Number(b.id);
  if (Number.isFinite(ia) && Number.isFinite(ib) && ia !== ib) return ia - ib;
  return String(a.id).localeCompare(String(b.id));
}

export function planReconcile(input: ReconcileInput): ReconcilePlan {
  const { masterOpen, clients, known, suspects, notBefore, now, confirmMs } = input;
  const plan: ReconcilePlan = { adopt: [], close: [], suspects: new Map(), waiting: 0, copiesSeen: 0 };

  for (const client of clients) {
    if (client.positions == null) {
      // Could not be read this time: no decision, and what we already suspected about this client stays as it was.
      const prefix = `${client.userId}|`;
      for (const [k, v] of suspects) if (k.startsWith(prefix)) plan.suspects.set(k, v);
      continue;
    }

    // Group this client's copies by the master trade they belong to.
    const groups = new Map<string, ClientPosition[]>();
    for (const p of client.positions) {
      const masterId = parseCopyComment(p.comment);
      if (masterId === null) continue; // not ours: never touched
      const list = groups.get(masterId);
      if (list) list.push(p);
      else groups.set(masterId, [p]);
      plan.copiesSeen++;
    }
    if (masterOpen === null) continue; // the master's open trades are not known: decide nothing

    const suspect = (p: ClientPosition, masterId: string, reason: Closure['reason']) => {
      const key = suspectKey(client.userId, p.id);
      const first = suspects.get(key) ?? now;
      plan.suspects.set(key, first);
      const wait = notBefore?.get(key);
      if (now - first >= confirmMs && (wait === undefined || now >= wait)) {
        plan.close.push({
          masterId,
          userId: client.userId,
          accountId: client.accountId,
          positionId: String(p.id),
          symbol: String(p.symbol || ''),
          reason,
        });
      } else {
        plan.waiting++;
      }
    };

    for (const [masterId, list] of groups) {
      const copies = [...list].sort(byAge);
      if (masterOpen.has(masterId)) {
        const keeper = copies[0];
        if (known.get(masterId)?.get(client.userId) !== String(keeper.id)) {
          plan.adopt.push({
            masterId,
            userId: client.userId,
            accountId: client.accountId,
            positionId: String(keeper.id),
            symbol: String(keeper.symbol || ''),
            volume: Number(keeper.volume) || 0,
            openPrice: Number(keeper.openPrice) || 0,
            openedAt: openedAtOf(keeper, now),
          });
        }
        // A second copy of the same master trade is a double: keep the oldest, close the rest.
        for (const extra of copies.slice(1)) suspect(extra, masterId, 'duplicate');
      } else {
        // The master trade is not open any more: every copy of it should be gone.
        for (const p of copies) suspect(p, masterId, 'master-closed');
      }
    }
  }

  return plan;
}

/** Master trade id -> user id -> client position id, from the engine's own position table. */
export function knownFromTable(
  table: ReadonlyMap<string, { clientPositions: ReadonlyMap<string, { clientPositionId: string }> }>
): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const [masterId, mapping] of table) {
    const byUser = new Map<string, string>();
    for (const [userId, cp] of mapping.clientPositions) byUser.set(userId, String(cp.clientPositionId));
    out.set(masterId, byUser);
  }
  return out;
}

/** Back-off after a failed close: 30 s, 1 min, 2 min ... never more than 10 min. */
export function closeBackoffMs(failures: number): number {
  return Math.min(10 * 60_000, 30_000 * 2 ** Math.max(0, failures - 1));
}
