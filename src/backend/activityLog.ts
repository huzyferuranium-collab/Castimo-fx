/**
 * A short memory of what the master account really did, for the dashboard's "Activity" and "Recent signals".
 *
 * Every entry is written by the replication engine at the moment something REALLY happens (the master opened,
 * changed or closed a trade, and how many clients it was copied to). Nothing is generated, estimated or scored.
 * The log lives in memory, so it starts empty after a restart and says so; it is never filled with sample entries.
 *
 * Pure (no I/O, no timers) and unit-tested.
 */

export type ActivityKind = 'master_opened' | 'master_modified' | 'master_closed' | 'copied';

export interface ActivityEvent {
  id: string;
  /** ISO time the event was recorded on the server. */
  at: string;
  kind: ActivityKind;
  symbol: string;
  side?: 'BUY' | 'SELL';
  volume?: number;
  price?: number;
  /** Only for 'copied': how many active clients received the trade, and how many did not. */
  copied?: number;
  notCopied?: number;
  /** A plain sentence built only from the facts above. */
  text: string;
}

export type NewActivity = Omit<ActivityEvent, 'id' | 'at' | 'text'> & { at?: string };

function fmtPrice(n: number | undefined): string {
  return n !== undefined && Number.isFinite(n) && n > 0 ? ` at ${n}` : '';
}

export function describeActivity(e: NewActivity): string {
  const sym = e.symbol || 'a symbol';
  switch (e.kind) {
    case 'master_opened':
      return `The master opened a ${e.side ?? ''} ${e.volume ?? ''} ${sym}${fmtPrice(e.price)}.`.replace(/\s+/g, ' ').replace(' .', '.');
    case 'master_modified':
      return `The master changed the stop-loss or take-profit on ${sym}.`;
    case 'master_closed':
      return `The master closed its ${e.side ? e.side + ' ' : ''}${sym} trade.`.replace(/\s+/g, ' ');
    case 'copied': {
      const ok = e.copied ?? 0;
      const bad = e.notCopied ?? 0;
      if (ok + bad === 0) return `No active clients to copy the ${sym} trade to.`;
      return bad === 0
        ? `The ${sym} trade was copied to ${ok} client${ok === 1 ? '' : 's'}.`
        : `The ${sym} trade was copied to ${ok} of ${ok + bad} clients; ${bad} not copied.`;
    }
  }
}

export class ActivityLog {
  private items: ActivityEvent[] = [];
  private seq = 0;
  private readonly max: number;
  private readonly now: () => number;

  constructor(max = 100, now: () => number = () => Date.now()) {
    this.max = max;
    this.now = now;
  }

  add(e: NewActivity): ActivityEvent {
    const at = e.at ?? new Date(this.now()).toISOString();
    const ev: ActivityEvent = { ...e, id: `act-${Date.parse(at) || this.now()}-${++this.seq}`, at, text: describeActivity(e) };
    this.items.unshift(ev);
    if (this.items.length > this.max) this.items.length = this.max;
    return ev;
  }

  /** Newest first. */
  recent(n = 50): ActivityEvent[] {
    return this.items.slice(0, Math.max(0, n));
  }

  /** The master's newly opened trades, newest first (what the dashboard calls signals). */
  signals(n = 20): ActivityEvent[] {
    return this.items.filter((e) => e.kind === 'master_opened').slice(0, Math.max(0, n));
  }

  size(): number {
    return this.items.length;
  }
}
