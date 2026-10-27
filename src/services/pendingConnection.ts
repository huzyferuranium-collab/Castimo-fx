/**
 * What the dashboard shows about a connection the server is still looking after (or has given up on).
 *
 * The server keeps a client's terminal going even when the browser stops waiting, and reports it as
 * `pending`. This file only reads that report and words it kindly; it imports nothing, so it can be
 * tested on its own.
 */

export interface PendingConnectionView {
  /** 'working': still connecting. 'failed': the server gave up and the client can try again. */
  kind: 'working' | 'failed';
  /** One plain line about what is happening, e.g. "Waiting for your broker to accept the terminal…". */
  label: string;
  /** Whole minutes before the server stops waiting (only for brand-new connections). */
  minutesLeft?: number;
  login?: string;
  server?: string;
  error?: { code: string; message: string; hint: string; ref?: string };
}

/** How a connection attempt ended for the browser: live now, or carried on by the server without it. */
export type ConnectOutcome = 'connected' | 'background';

/** Reads what the server sent. Anything unexpected becomes null, so the screen never shows a broken notice. */
export function normalizePending(raw: unknown): PendingConnectionView | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== 'working' && r.kind !== 'failed') return null;
  const kind = r.kind;

  const out: PendingConnectionView = {
    kind,
    label:
      typeof r.label === 'string' && r.label.trim()
        ? r.label.trim()
        : kind === 'failed'
          ? 'Could not connect'
          : 'Getting your terminal ready…',
  };
  if (typeof r.minutesLeft === 'number' && Number.isFinite(r.minutesLeft) && r.minutesLeft >= 0) {
    out.minutesLeft = Math.floor(r.minutesLeft);
  }
  if (typeof r.login === 'string' && r.login) out.login = r.login;
  if (typeof r.server === 'string' && r.server) out.server = r.server;

  const e = r.error;
  if (e && typeof e === 'object') {
    const err = e as Record<string, unknown>;
    if (typeof err.message === 'string' && err.message) {
      out.error = {
        code: typeof err.code === 'string' ? err.code : '',
        message: err.message,
        hint: typeof err.hint === 'string' ? err.hint : '',
        ref: typeof err.ref === 'string' && err.ref ? err.ref : undefined,
      };
    }
  }
  return out;
}

/** The calm second line under the notice: how long we will keep trying, or what to do next. */
export function pendingNote(p: PendingConnectionView): string {
  if (p.kind === 'failed') {
    return p.error?.hint || 'Nothing was charged and nothing was changed. You can try again whenever you are ready.';
  }
  if (typeof p.minutesLeft === 'number') {
    return p.minutesLeft <= 1
      ? 'We will keep trying for about another minute.'
      : `We will keep trying for about ${p.minutesLeft} more minutes.`;
  }
  return 'We will keep trying by ourselves. There is nothing you need to do.';
}

/** "#133227028 · HFMarketsGlobal-Live20", or an empty string when neither is known. */
export function pendingAccountLine(p: PendingConnectionView): string {
  const parts: string[] = [];
  if (p.login) parts.push(`#${p.login}`);
  if (p.server) parts.push(p.server);
  return parts.join(' · ');
}
