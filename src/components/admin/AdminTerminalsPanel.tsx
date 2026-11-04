import React, { useCallback, useState } from 'react';
import { usePolling } from '../../hooks/usePolling';
import { RefreshCw, Trash2, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react';
import { authHeaders } from '../../services/apiAuth';
import { Collapsible } from '../common/Collapsible';

interface CopierRow {
  accountId: string;
  userId: string;
  login: string;
  server: string;
  /** Duplikium's own state word for the account, e.g. CONNECTED. */
  state: string;
  enabled: boolean;
  balance: number | null;
  equity: number | null;
  /** A verified client is using this account right now. */
  live: boolean;
  /** What the server is doing with it: still connecting, gave up, or nothing. */
  tracked: 'PENDING' | 'FAILED' | null;
  /** The copier status last set at Duplikium: 1 on, -1 close only, 0 frozen. */
  copyApplied?: number;
}

interface Inventory {
  accounts: CopierRow[];
  used?: number;
  limit?: number;
  perUserLimit?: number;
}

interface CheckStep {
  name: string;
  ok: boolean;
  detail: string;
  /** Lines to show under the detail, e.g. the accounts and templates the administrator can choose from. */
  lines?: string[];
}

type Notice = { tone: 'ok' | 'error'; text: string };
type Confirm = { id: string; kind: 'remove' | 'force' } | null;

const shortId = (id: string): string => (id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id);

const money = (n: number | null): string => (n === null ? 'not reported' : `$${n.toFixed(2)}`);

function statusOf(r: CopierRow): { text: string; cls: string } {
  if (r.live) return { text: 'In service', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' };
  if (r.tracked === 'PENDING') return { text: 'Connecting', cls: 'bg-blue-500/10 text-blue-300 border-blue-500/30' };
  if (r.tracked === 'FAILED') return { text: 'Gave up', cls: 'bg-rose-500/10 text-rose-300 border-rose-500/30' };
  return { text: 'Leftover', cls: 'bg-slate-500/10 text-slate-300 border-slate-500/30' };
}

const copyWord = (n?: number): string | null =>
  n === 1 ? 'copying on' : n === -1 ? 'close only (paused)' : n === 0 ? 'frozen' : null;

const btn =
  'px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition';

/**
 * Every client account Duplikium holds for CASTIMOFx, and what the server is doing about each one, plus the
 * connection check. The master account never appears here and cannot be touched from here. A client who is in
 * service (or has billing history) is protected: removing one needs a second, explicit confirmation.
 */
export const AdminTerminalsPanel: React.FC = () => {
  const [data, setData] = useState<Inventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [check, setCheck] = useState<{ ok: boolean; steps: CheckStep[]; note?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/trade/admin/copier-accounts', { headers: await authHeaders() });
      const body = await res.json().catch(() => ({} as any));
      if (res.ok) {
        setData({
          accounts: Array.isArray(body.accounts) ? body.accounts : [],
          used: typeof body.used === 'number' ? body.used : undefined,
          limit: typeof body.limit === 'number' ? body.limit : undefined,
          perUserLimit: typeof body.perUserLimit === 'number' ? body.perUserLimit : undefined,
        });
        setError(null);
      } else {
        setError(body.error || 'Could not load the accounts.');
      }
    } catch {
      setError('Could not reach the server.');
    }
  }, []);

  usePolling(load, 30_000);

  const runCheck = async () => {
    setBusy('check');
    setNotice(null);
    try {
      const res = await fetch('/api/trade/admin/copier-check', { headers: await authHeaders() });
      const body = await res.json().catch(() => ({} as any));
      if (res.ok && Array.isArray(body.steps)) setCheck({ ok: Boolean(body.ok), steps: body.steps, note: body.note || undefined });
      else setNotice({ tone: 'error', text: body.error || 'The connection check could not run.' });
    } catch {
      setNotice({ tone: 'error', text: 'Could not reach the server.' });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (r: CopierRow, force: boolean) => {
    setBusy(r.accountId);
    setNotice(null);
    setConfirm(null);
    try {
      const res = await fetch('/api/trade/admin/copier-accounts/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ accountId: r.accountId, force }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (res.ok && json.success !== false) {
        setNotice({ tone: 'ok', text: `Removed the account of #${r.login}.` });
      } else if (json.reason === 'PROTECTED') {
        setConfirm({ id: r.accountId, kind: 'force' });
      } else {
        setNotice({
          tone: 'error',
          text:
            json.reason === 'NOT_FOUND'
              ? 'Duplikium no longer has this account.'
              : json.reason === 'NOT_A_CLIENT'
                ? 'Only client accounts can be removed here.'
                : json.error || 'The account was not removed.',
        });
      }
    } catch {
      setNotice({ tone: 'error', text: 'Could not reach the server.' });
    } finally {
      setBusy(null);
      load();
    }
  };

  if (data === null) return <p className="text-xs text-slate-500">{error || 'Loading…'}</p>;

  const rows = [...data.accounts].sort((a, b) => {
    const rank = (r: CopierRow) => (r.tracked === 'FAILED' ? 0 : r.tracked === 'PENDING' ? 1 : r.live ? 3 : 2);
    return rank(a) - rank(b) || a.login.localeCompare(b.login);
  });
  const inService = rows.filter((r) => r.live).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400">Client accounts held at Duplikium.</p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={runCheck} disabled={busy !== null} className={`${btn} btn-gold font-semibold`} title="Signs in to Duplikium, finds the master and the template, and reads the master's trades">
            <ShieldCheck className={`w-3.5 h-3.5 ${busy === 'check' ? 'animate-pulse' : ''}`} />
            Connection check
          </button>
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

      {check && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-bold text-white">Connection check</h4>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${check.ok ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' : 'text-amber-300 border-amber-500/30 bg-amber-500/10'}`}>
              {check.ok ? 'ALL STEPS PASSED' : 'NEEDS ATTENTION'}
            </span>
          </div>
          <ul className="space-y-1.5">
            {check.steps.map((s) => (
              <li key={s.name} className="flex items-start gap-2 text-xs">
                {s.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-px" /> : <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-px" />}
                <span className="min-w-0">
                  <span className="font-semibold text-slate-200">{s.name}.</span> <span className="text-slate-400 break-words">{s.detail}</span>
                  {s.lines && s.lines.length > 0 && (
                    <span className="block mt-1.5 space-y-1">
                      {s.lines.map((line, i) => (
                        <span key={i} className="block font-mono text-[11px] text-slate-300 bg-slate-950 border border-slate-800 rounded-md px-2 py-1 break-all select-all">
                          {line}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {check.note && <p className="text-[11px] text-slate-500">{check.note}</p>}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2.5">
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5">
          <div className="text-[11px] text-slate-400">Accounts</div>
          <div className="text-sm font-bold font-mono text-white">{data.used ?? rows.length}</div>
          <div className="text-[10px] text-slate-500">{data.limit ? `limit ${data.limit}` : 'no limit'}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5">
          <div className="text-[11px] text-slate-400">In service</div>
          <div className="text-sm font-bold font-mono text-white">{inService}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5">
          <div className="text-[11px] text-slate-400">Pending</div>
          <div className="text-sm font-bold font-mono text-white">{rows.filter((r) => r.tracked).length}</div>
        </div>
      </div>

      <Collapsible title="About this list" openLabel="Details" closeLabel="Hide">
        <p>Duplikium does the copying. This server connects, pauses and removes client accounts there and reads the results.</p>
        <p>The master account is never listed here and cannot be removed from here. Removing a client account leaves trades already open in the client's own MT5.</p>
        <p>
          Pending means the account is still connecting or the server gave up. {data.perUserLimit ? `Each client may have ${data.perUserLimit} account${data.perUserLimit > 1 ? 's' : ''}.` : ''}
        </p>
      </Collapsible>

      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">No client accounts at Duplikium right now.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const st = statusOf(r);
            const confirming = confirm && confirm.id === r.accountId ? confirm : null;
            const copy = copyWord(r.copyApplied);
            return (
              <div key={r.accountId} className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs space-y-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-white">#{r.login}</span>
                  <span className="text-slate-300 font-mono">{r.server}</span>
                  <span className={`px-1.5 py-0.5 rounded border ${st.cls}`}>{st.text}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded border font-mono ${r.state === 'CONNECTED' ? 'border-emerald-500/30 text-emerald-300' : 'border-amber-500/30 text-amber-300'}`}
                    title="Duplikium's last known state for the account"
                  >
                    {r.state || 'NONE'}
                  </span>
                  {copy && <span className="px-1.5 py-0.5 rounded border border-slate-600 text-slate-300">{copy}</span>}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500">
                  <span className="font-mono" title={`user ${r.userId}`}>user {shortId(r.userId)}</span>
                  <span className="font-mono" title={`Duplikium account ${r.accountId}`}>acct {shortId(r.accountId)}</span>
                  <span>balance {money(r.balance)}</span>
                  <span>equity {money(r.equity)}</span>
                  {!r.enabled && <span className="text-amber-300">switched off at Duplikium</span>}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  {confirming ? (
                    <>
                      <span className="text-amber-300">
                        {confirming.kind === 'force'
                          ? 'This client is in service (or has billing history). Removing the account disconnects them. Remove anyway?'
                          : 'Remove this account from Duplikium?'}
                      </span>
                      <button type="button" onClick={() => remove(r, confirming.kind === 'force')} disabled={busy !== null} className={`${btn} btn-red font-semibold`}>
                        Yes, remove
                      </button>
                      <button type="button" onClick={() => setConfirm(null)} className={`${btn} bg-slate-800 hover:bg-slate-700 text-slate-200`}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirm({ id: r.accountId, kind: 'remove' })}
                      disabled={busy !== null}
                      className={`${btn} bg-slate-800 hover:bg-rose-900/60 text-rose-300`}
                      title="Remove this account from Duplikium. Trades already open stay open on the client's broker account."
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove
                    </button>
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
