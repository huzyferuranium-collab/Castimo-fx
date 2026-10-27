import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { authHeaders } from '../../services/apiAuth';

interface FailureRow {
  at: string;
  user: string;
  login: string;
  server: string;
  stage: string;
  code: string;
  ref?: string;
  raw: string;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Recent failed MT5 connection attempts with the technical reason, so a client's "could not connect"
 * can be diagnosed without searching server logs. Passwords are never stored here. The list is kept in
 * memory, so it starts empty after a server restart.
 */
export const AdminConnectLogPanel: React.FC = () => {
  const [rows, setRows] = useState<FailureRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/trade/admin/connect-failures', { headers: await authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setRows(Array.isArray(body.failures) ? body.failures : []);
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
          Failed MT5 connection attempts since the server last started. Passwords are never recorded.
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
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">No failed attempts recorded.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={`${r.at}-${i}`} className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs space-y-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-slate-400 font-mono">{when(r.at)}</span>
                <span className="font-semibold text-white">#{r.login}</span>
                <span className="text-slate-300 font-mono">{r.server}</span>
                <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/30 font-mono">{r.code}</span>
                <span className="text-slate-500">at {r.stage}</span>
                {r.ref && <span className="text-slate-500 font-mono">ref {r.ref}</span>}
                <span className="text-slate-600 font-mono">user {r.user}</span>
              </div>
              <p className="text-slate-400 font-mono break-words">{r.raw}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
