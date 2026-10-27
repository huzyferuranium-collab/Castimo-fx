import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { NotificationItem, getNotifications } from '../../services/referralApi';

interface NotificationCenterProps {
  onOpenSettlements?: () => void;
  onOpenReferrals?: () => void;
  onOpenPayment?: () => void;
  className?: string;
}

const SEEN_KEY = 'castimofx_notifications_seen';

function readSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * Notifications come from real server records only: your own withdrawals, commissions and invoices, plus
 * anonymous platform activity such as "S***n subscribed to the Monthly Plan." With no events the list is empty.
 */
export const NotificationCenter: React.FC<NotificationCenterProps> = ({ className = '' }) => {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [seen, setSeen] = useState<string>(readSeen());
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<NotificationItem | null>(null);
  const toasted = useRef(false);

  const load = useCallback(async () => {
    const r = await getNotifications();
    if (!r.ok || !r.data) return;
    const list = r.data.items;
    setItems(list);
    // At most one pop-up per visit: the newest item you have not seen yet.
    if (!toasted.current) {
      toasted.current = true;
      const fresh = list.find((i) => i.at > readSeen());
      if (fresh) {
        setToast(fresh);
        setTimeout(() => setToast(null), 6000);
      }
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const unread = items.filter((i) => i.at > seen).length;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && items.length > 0) {
      const newest = items[0].at;
      try {
        localStorage.setItem(SEEN_KEY, newest);
      } catch {
        // ignore
      }
      // Keep the unread dots visible while the panel is open; clear them when it closes.
      setTimeout(() => setSeen(newest), 0);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={toggle}
        aria-label="Notifications"
        className="relative p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-black flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {toast && !open && (
        <div className="absolute right-0 top-11 z-40 w-72 rounded-xl border border-emerald-500/30 bg-slate-900 text-white p-3 shadow-xl animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[11px] font-bold text-emerald-400">{toast.title}</div>
              <div className="text-xs text-slate-200 mt-0.5">{toast.message}</div>
            </div>
            <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="text-slate-400 hover:text-white cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="absolute right-0 top-11 z-40 w-80 max-h-96 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <span className="text-sm font-bold text-slate-900 dark:text-white">Notifications</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-slate-500 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
          {items.length === 0 ? (
            <p className="p-4 text-xs text-slate-500">Nothing new yet. Updates appear here when something happens on your account.</p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {items.map((i) => (
                <li key={i.id} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-900 dark:text-white">{i.title}</span>
                    <span className="text-[10px] text-slate-500">{new Date(i.at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">{i.message}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
