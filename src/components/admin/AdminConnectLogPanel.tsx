import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { authHeaders } from '../../services/apiAuth';

type Timings = Record<string, number>;

interface FailureRow {
  at: string;
  user: string;
  login: string;
  server: string;
  stage: string;
  code: string;
  ref?: string;
  raw: string;
  timings?: Timings;
  /** True when the connection went on in the background instead of failing. */
  background?: boolean;
}

interface SuccessRow {
  at: string;
  user: string;
  login: string;
  server: string;
  totalSeconds: number;
  timings: Timings;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** "checking 0.4s · creating 12.1s · deploying 38s", so the slow step stands out. */
const timingLine = (t?: Timings): string =>
  Object.entries(t || {})
    .filter(([, secs]) => typeof secs === 'number' && secs >= 0.1)
    .map(([stage, secs]) => `${stage} ${secs >= 10 ? Math.round(secs) : secs}s`)
    .join(' · ');

/**
 * Recent MT5 connection attempts with the technical reason and how long each step took, so a client's
 * "could not connect" (or "it took long") can be diagnosed without searching server logs. Passwords are
 * never stored here. The lists are kept in memory, so they start empty after a server restart.
 */
export const AdminConnectLogPanel: React.FC = () => {
  const [rows, setRows] = useState<FailureRow[] | null>(null);
  const [successes, setSuccesses] = useState<SuccessRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/trade/admin/connect-failures', { headers: await authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setRows(Array.isArray(body.failures) ? body.failures : []);
        setSuccesses(Array.isArray(body.successes) ? body.successes : []);
        setError(null);
      } else {
        setError(body.error || 'Could not load the connection log.');
      }
    } catch {
      setError('Could not reach the server.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (rows === null) return <p className="text-xs text-slate-500">{error || 'Loading…'}</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">
          Connection attempts since the server last started. Passwords are never recorded.
        </p>
        <button
          type="button"
          onClick={load}
          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}

      <h4 className="text-xs font-semibold text-slate-300 pt-1">Attempts that did not finish in the browser</h4>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">None recorded.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={`${r.at}-${i}`} className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs space-y-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-slate-400 font-mono">{when(r.at)}</span>
                <span className="font-semibold text-white">#{r.login}</span>
                <span className="text-slate-300 font-mono">{r.server}</span>
                {r.background ? (
                  <span
                    className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/30"
                    title="The terminal exists and the supervisor kept connecting it without the browser"
                  >
                    carried on in the background
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/30 font-mono">{r.code}</span>
                )}
                <span className="text-slate-500">at {r.stage}</span>
                {r.ref && <span className="text-slate-500 font-mono">ref {r.ref}</span>}
                <span className="text-slate-600 font-mono">user {r.user}</span>
              </div>
              {timingLine(r.timings) && <p className="text-slate-500 font-mono">{timingLine(r.timings)}</p>}
              <p className="text-slate-400 font-mono break-words">{r.raw}</p>
            </div>
          ))}
        </div>
      )}

      <h4 className="text-xs font-semibold text-slate-300 pt-2">Recent successful connections</h4>
      {successes.length === 0 ? (
        <p className="text-xs text-slate-500">None recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {successes.map((s, i) => (
            <div key={`${s.at}-${i}`} className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs space-y-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-slate-400 font-mono">{when(s.at)}</span>
                <span className="font-semibold text-white">#{s.login}</span>
                <span className="text-slate-300 font-mono">{s.server}</span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                  {s.totalSeconds}s in total
                </span>
                <span className="text-slate-600 font-mono">user {s.user}</span>
              </div>
              {timingLine(s.timings) && <p className="text-slate-500 font-mono">{timingLine(s.timings)}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
