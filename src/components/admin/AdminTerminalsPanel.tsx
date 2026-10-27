import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, RotateCw, Trash2, Eraser } from 'lucide-react';
import { authHeaders } from '../../services/apiAuth';

interface TerminalRow {
  accountId: string;
  userId: string;
  login: string;
  server: string;
  /** MetaApi's own state and broker connection for the terminal. */
  state?: string;
  connectionStatus?: string;
  /** A verified client is using this terminal right now. */
  live: boolean;
  /** What the supervisor is doing with it: still connecting, gave up, or nothing. */
  tracked: 'PENDING' | 'FAILED' | null;
  verifiedBefore?: boolean;
  redeploys?: number;
  lastAction?: string;
  disconnectedSince?: string;
  minutesLeft?: number;
  error?: { code: string; message: string; hint: string; ref?: string };
  /** The supervisor remembers it but MetaApi no longer has it. */
  missing?: boolean;
}

interface SupervisorStats {
  ticks: number;
  lastTickAt: number;
  lastDiscoverAt: number;
  lastDiscoverAdopted: number;
  verified: number;
  gaveUp: number;
  restarted: number;
}

interface Inventory {
  terminals: TerminalRow[];
  supervisor: SupervisorStats | null;
  used?: number;
  limit?: number;
  perUserLimit?: number;
}

type Notice = { tone: 'ok' | 'error'; text: string };
type Confirm = { id: string; kind: 'remove' | 'force' } | 'cleanup' | null;

const ago = (ms: number): string => {
  if (!ms) return 'not yet';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
};

const agoIso = (iso?: string): string | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? ago(t) : null;
};

const shortId = (id: string): string => (id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id);

function statusOf(r: TerminalRow): { text: string; cls: string } {
  if (r.missing) return { text: 'Gone from MetaApi', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' };
  if (r.live) return { text: 'In service', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' };
  if (r.tracked === 'PENDING') return { text: 'Connecting', cls: 'bg-blue-500/10 text-blue-300 border-blue-500/30' };
  if (r.tracked === 'FAILED') return { text: 'Gave up', cls: 'bg-rose-500/10 text-rose-300 border-rose-500/30' };
  return { text: 'Leftover', cls: 'bg-slate-500/10 text-slate-300 border-slate-500/30' };
}

const btn =
  'px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition';

/**
 * Every client terminal MetaApi holds, and what the terminal supervisor is doing about each one.
 * The master account never appears here and cannot be touched from here. Terminals of clients who were
 * connected before are protected: removing one needs a second, explicit confirmation.
 */
export const AdminTerminalsPanel: React.FC = () => {
  const [data, setData] = useState<Inventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/trade/admin/terminals', { headers: await authHeaders() });
      const body = await res.json().catch(() => ({} as any));
      if (res.ok) {
        setData({
          terminals: Array.isArray(body.terminals) ? body.terminals : [],
          supervisor: body.supervisor ?? null,
          used: typeof body.used === 'number' ? body.used : undefined,
          limit: typeof body.limit === 'number' ? body.limit : undefined,
          perUserLimit: typeof body.perUserLimit === 'number' ? body.perUserLimit : undefined,
        });
        setError(null);
      } else {
        setError(body.error || 'Could not load the terminals.');
      }
    } catch {
      setError('Could not reach the server.');
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const post = async (path: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/trade/admin/terminals/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({} as any));
    return { ok: res.ok && json.success !== false, json };
  };

  const redeploy = async (r: TerminalRow) => {
    setBusy(r.accountId);
    setNotice(null);
    try {
      const { ok, json } = await post('redeploy', { accountId: r.accountId });
      if (ok) {
        setNotice({ tone: 'ok', text: `Restart sent for #${r.login}. MetaApi usually needs a minute or two to bring it back.` });
      } else {
        setNotice({
          tone: 'error',
          text:
            json.reason === 'NOT_FOUND'
              ? 'MetaApi no longer has this terminal.'
              : json.reason === 'NOT_CLIENT'
                ? 'Only client terminals can be restarted here.'
                : json.error || 'The restart was not accepted.',
        });
      }
    } catch {
      setNotice({ tone: 'error', text: 'Could not reach the server.' });
    } finally {
      setBusy(null);
      load();
    }
  };

  const remove = async (r: TerminalRow, force: boolean) => {
    setBusy(r.accountId);
    setNotice(null);
    setConfirm(null);
    try {
      const { ok, json } = await post('remove', { accountId: r.accountId, force });
      if (ok) {
        setNotice({ tone: 'ok', text: `Removed the terminal of #${r.login}.` });
      } else if (json.reason === 'PROTECTED') {
        // A client who was connected before (or has billing history): ask once more, plainly.
        setConfirm({ id: r.accountId, kind: 'force' });
      } else {
        setNotice({
          tone: 'error',
          text:
            json.reason === 'LIVE'
              ? 'This client is in service. Use the client\'s own disconnect instead.'
              : json.reason === 'NOT_FOUND'
                ? 'MetaApi no longer has this terminal.'
                : json.reason === 'NOT_CLIENT'
                  ? 'Only client terminals can be removed here.'
                  : json.error || 'The terminal was not removed.',
        });
      }
    } catch {
      setNotice({ tone: 'error', text: 'Could not reach the server.' });
    } finally {
      setBusy(null);
      load();
    }
  };

  const cleanup = async () => {
    setBusy('cleanup');
    setNotice(null);
    setConfirm(null);
    try {
      const { ok, json } = await post('cleanup', {});
      if (ok) {
        const n = Array.isArray(json.removed) ? json.removed.length : 0;
        setNotice({
          tone: 'ok',
          text: n === 0 ? 'Nothing needed cleaning up.' : `Removed ${n} leftover terminal${n === 1 ? '' : 's'}. ${json.kept ?? 0} kept.`,
        });
      } else {
        setNotice({ tone: 'error', text: json.error || 'Could not clean up the terminals.' });
      }
    } catch {
      setNotice({ tone: 'error', text: 'Could not reach the server.' });
    } finally {
      setBusy(null);
      load();
    }
  };

  if (data === null) return <p className="text-xs text-slate-500">{error || 'Loading…'}</p>;

  const sup = data.supervisor;
  const rows = [...data.terminals].sort((a, b) => {
    const rank = (r: TerminalRow) => (r.tracked === 'FAILED' ? 0 : r.tracked === 'PENDING' ? 1 : r.live ? 3 : 2);
    return rank(a) - rank(b) || a.login.localeCompare(b.login);
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-xs text-slate-400 max-w-2xl">
          Client terminals as MetaApi sees them, and what the supervisor is doing about each one. Terminals that are slow
          to connect are started, restarted and verified automatically. The master account is never listed here.
        </p>
        <div className="flex items-center gap-2">
          {confirm === 'cleanup' ? (
            <>
              <span className="text-xs text-amber-300">Remove all leftovers?</span>
              <button type="button" onClick={cleanup} disabled={busy !== null} className={`${btn} bg-rose-600 hover:bg-rose-500 text-white`}>
                Yes, clean up
              </button>
              <button type="button" onClick={() => setConfirm(null)} className={`${btn} bg-slate-800 hover:bg-slate-700 text-slate-200`}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirm('cleanup')}
              disabled={busy !== null}
              className={`${btn} bg-slate-800 hover:bg-slate-700 text-slate-200`}
              title="Removes terminals that are not in service, not protected and not still connecting"
            >
              <Eraser className="w-3.5 h-3.5" />
              Clean up leftovers
            </button>
          )}
          <button type="button" onClick={load} className={`${btn} bg-slate-800 hover:bg-slate-700 text-slate-200`}>
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}
      {notice && (
        <p className={`text-xs rounded-lg px-3 py-2 border ${notice.tone === 'ok' ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' : 'text-rose-300 border-rose-500/30 bg-rose-500/10'}`}>
          {notice.text}
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Client terminals</div>
          <div className="font-bold text-white mt-0.5">
            {data.used ?? rows.filter((r) => !r.missing).length}
            <span className="text-slate-500 font-normal"> / {data.limit ? data.limit : 'no limit'}</span>
          </div>
          {data.perUserLimit ? <div className="text-[10px] text-slate-500">{data.perUserLimit} per client</div> : null}
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Last supervisor check</div>
          <div className="font-bold text-white mt-0.5">{sup ? ago(sup.lastTickAt) : 'not running'}</div>
          {sup ? <div className="text-[10px] text-slate-500">{sup.ticks} checks so far</div> : null}
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Brought into service</div>
          <div className="font-bold text-white mt-0.5">{sup ? sup.verified : 0}</div>
          <div className="text-[10px] text-slate-500">{sup ? `${sup.restarted} restarts sent` : ''}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Gave up on</div>
          <div className="font-bold text-white mt-0.5">{sup ? sup.gaveUp : 0}</div>
          <div className="text-[10px] text-slate-500">{sup ? `last search ${ago(sup.lastDiscoverAt)}` : ''}</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">No client terminals in MetaApi right now.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const st = statusOf(r);
            const disconnectedFor = agoIso(r.disconnectedSince);
            const confirming = confirm && confirm !== 'cleanup' && confirm.id === r.accountId ? confirm : null;
            const link =
              r.state || r.connectionStatus
                ? `${r.state ?? '?'} / ${r.connectionStatus ?? '?'}`
                : null;
            return (
              <div key={r.accountId} className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs space-y-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-white">#{r.login}</span>
                  <span className="text-slate-300 font-mono">{r.server}</span>
                  <span className={`px-1.5 py-0.5 rounded border ${st.cls}`}>{st.text}</span>
                  {link && (
                    <span
                      className={`px-1.5 py-0.5 rounded border font-mono ${
                        r.connectionStatus === 'CONNECTED'
                          ? 'border-emerald-500/30 text-emerald-300'
                          : r.state === 'DEPLOYED'
                            ? 'border-amber-500/30 text-amber-300'
                            : 'border-slate-600 text-slate-400'
                      }`}
                      title="MetaApi state / connection to the broker"
                    >
                      {link}
                    </span>
                  )}
                  {r.verifiedBefore && (
                    <span className="px-1.5 py-0.5 rounded border border-purple-500/30 text-purple-300" title="Never given up on or cleaned up automatically">
                      Protected
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500">
                  <span className="font-mono" title={`user ${r.userId}`}>user {shortId(r.userId)}</span>
                  <span className="font-mono" title={`MetaApi account ${r.accountId}`}>acct {shortId(r.accountId)}</span>
                  {typeof r.redeploys === 'number' && <span>{r.redeploys} restart{r.redeploys === 1 ? '' : 's'}</span>}
                  {r.lastAction && <span>last step: {r.lastAction.toLowerCase()}</span>}
                  {disconnectedFor && <span>not connected since {disconnectedFor}</span>}
                  {typeof r.minutesLeft === 'number' && <span>{r.minutesLeft} min left before giving up</span>}
                </div>

                {r.error && (
                  <p className="text-slate-400 break-words">
                    <span className="font-mono text-rose-300">{r.error.code}</span> {r.error.message}
                    {r.error.ref ? <span className="text-slate-600 font-mono"> ref {r.error.ref}</span> : null}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  {confirming ? (
                    <>
                      <span className="text-amber-300">
                        {confirming.kind === 'force'
                          ? 'This client was connected before (or has billing history). Removing the terminal disconnects them. Remove anyway?'
                          : 'Remove this terminal from MetaApi?'}
                      </span>
                      <button
                        type="button"
                        onClick={() => remove(r, confirming.kind === 'force')}
                        disabled={busy !== null}
                        className={`${btn} bg-rose-600 hover:bg-rose-500 text-white`}
                      >
                        Yes, remove
                      </button>
                      <button type="button" onClick={() => setConfirm(null)} className={`${btn} bg-slate-800 hover:bg-slate-700 text-slate-200`}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => redeploy(r)}
                        disabled={busy !== null || Boolean(r.missing)}
                        className={`${btn} bg-slate-800 hover:bg-slate-700 text-slate-200`}
                        title="Restart the terminal (what pressing Redeploy in MetaApi does)"
                      >
                        <RotateCw className={`w-3.5 h-3.5 ${busy === r.accountId ? 'animate-spin' : ''}`} />
                        Restart
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirm({ id: r.accountId, kind: 'remove' })}
                        disabled={busy !== null || r.live}
                        className={`${btn} bg-slate-800 hover:bg-rose-900/60 text-rose-300`}
                        title={r.live ? 'In service: use the client\'s own disconnect' : 'Remove this terminal from MetaApi'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {r.missing ? 'Clear record' : 'Remove'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
