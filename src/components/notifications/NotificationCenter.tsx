import React, { useState, useEffect } from 'react';
import { tradingEngine } from '../../services/tradingEngine';
import { ClientNotification, NotificationType } from '../../types';
import {
  Bell,
  Check,
  CheckCheck,
  Clock,
  Award,
  Share2,
  ShieldAlert,
  ArrowRight,
  Trash2,
  Zap,
  TrendingUp,
  X,
  ExternalLink,
  Sparkles,
  Calendar,
  Layers,
  Filter,
} from 'lucide-react';

interface NotificationCenterProps {
  onOpenSettlements?: () => void;
  onOpenReferrals?: () => void;
  onOpenPayment?: () => void;
  className?: string;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  onOpenSettlements,
  onOpenReferrals,
  onOpenPayment,
  className = '',
}) => {
  const [notifications, setNotifications] = useState<ClientNotification[]>(
    tradingEngine.getNotifications()
  );
  const [unreadCount, setUnreadCount] = useState<number>(
    tradingEngine.getUnreadNotificationCount()
  );
  const [isOpen, setIsOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | 'settlement' | 'referral' | 'system'>('all');
  const [toastNotification, setToastNotification] = useState<ClientNotification | null>(null);

  useEffect(() => {
    const unsub = tradingEngine.subscribe(() => {
      const list = [...tradingEngine.getNotifications()];
      const unread = tradingEngine.getUnreadNotificationCount();

      // If a new notification was just added to the front, show toast banner
      if (list.length > 0 && list[0].id !== notifications[0]?.id && !list[0].read) {
        setToastNotification(list[0]);
        setTimeout(() => setToastNotification(null), 5000);
      }

      setNotifications(list);
      setUnreadCount(unread);
    });
    return () => unsub();
  }, [notifications]);

  // Handle escape key to close centered modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleMarkAsRead = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    tradingEngine.markNotificationAsRead(id);
  };

  const handleMarkAllRead = () => {
    tradingEngine.markAllNotificationsAsRead();
  };

  const handleClearAll = () => {
    tradingEngine.clearNotifications();
  };

  const handleActionClick = (notif: ClientNotification) => {
    handleMarkAsRead(notif.id);
    setIsOpen(false);

    if (notif.linkAction === 'open_settlements' && onOpenSettlements) {
      onOpenSettlements();
    } else if (notif.linkAction === 'open_referrals' && onOpenReferrals) {
      onOpenReferrals();
    } else if (notif.linkAction === 'open_payment' && onOpenPayment) {
      onOpenPayment();
    }
  };

  const handleTriggerDemo = (type: 'settlement' | 'referral') => {
    tradingEngine.triggerDemoNotification(type);
  };

  // Filter items
  const settlementsCount = notifications.filter(
    (n) => n.type === 'SETTLEMENT_PROCESSED' || n.type === 'SETTLEMENT_DUE'
  ).length;
  const referralsCount = notifications.filter(
    (n) => n.type === 'REFERRAL_COMMISSION'
  ).length;
  const systemCount = notifications.filter(
    (n) => n.type === 'AUTONOMOUS_WATCHER' || n.type === 'TRADE_CLOSED'
  ).length;

  const filteredNotifications = notifications.filter((n) => {
    if (activeFilter === 'settlement') {
      return n.type === 'SETTLEMENT_PROCESSED' || n.type === 'SETTLEMENT_DUE';
    }
    if (activeFilter === 'referral') {
      return n.type === 'REFERRAL_COMMISSION';
    }
    if (activeFilter === 'system') {
      return n.type === 'AUTONOMOUS_WATCHER' || n.type === 'TRADE_CLOSED';
    }
    return true;
  });

  const formatRelativeTime = (timestamp: string) => {
    try {
      const diffMs = Date.now() - new Date(timestamp).getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}d ago`;
    } catch {
      return '';
    }
  };

  const formatFullDate = (timestamp: string) => {
    try {
      const d = new Date(timestamp);
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return timestamp;
    }
  };

  const getNotificationBadgeMeta = (type: NotificationType) => {
    switch (type) {
      case 'SETTLEMENT_PROCESSED':
        return {
          label: '50% Profit Settled',
          pillClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        };
      case 'SETTLEMENT_DUE':
        return {
          label: '50% Share Due (24h)',
          pillClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
        };
      case 'REFERRAL_COMMISSION':
        return {
          label: 'Referral Commission',
          pillClass: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
        };
      case 'AUTONOMOUS_WATCHER':
        return {
          label: '24h Watcher Daemon',
          pillClass: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
        };
      default:
        return {
          label: 'System Notification',
          pillClass: 'bg-slate-800 text-slate-300 border-slate-700',
        };
    }
  };

  const getIconForType = (type: NotificationType) => {
    switch (type) {
      case 'SETTLEMENT_PROCESSED':
        return (
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <Award className="w-5 h-5" />
          </div>
        );
      case 'REFERRAL_COMMISSION':
        return (
          <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
            <Zap className="w-5 h-5" />
          </div>
        );
      case 'SETTLEMENT_DUE':
        return (
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <Clock className="w-5 h-5" />
          </div>
        );
      case 'AUTONOMOUS_WATCHER':
        return (
          <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
        );
      default:
        return (
          <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 shrink-0">
            <Bell className="w-5 h-5" />
          </div>
        );
    }
  };

  return (
    <div className={`relative ${className}`}>
      {/* Toast Alert Popover for live incoming notifications */}
      {toastNotification && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm w-full p-4 rounded-2xl bg-slate-900 border border-emerald-500/40 shadow-2xl text-slate-100 flex items-start gap-3 animate-in slide-in-from-bottom-5 duration-300">
          {getIconForType(toastNotification.type)}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1">
              <span className="font-bold text-xs text-white truncate">
                {toastNotification.title}
              </span>
              <button
                type="button"
                onClick={() => setToastNotification(null)}
                className="text-slate-500 hover:text-white p-0.5"
                aria-label="Dismiss toast"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[11px] text-slate-300 mt-0.5 line-clamp-2 leading-relaxed">
              {toastNotification.message}
            </p>
            {toastNotification.linkAction && (
              <button
                type="button"
                onClick={() => {
                  handleActionClick(toastNotification);
                  setToastNotification(null);
                }}
                className="mt-2 text-[11px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
              >
                <span>View Full Details in Center</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`relative p-2.5 rounded-xl transition cursor-pointer flex items-center justify-center min-h-[44px] min-w-[44px] ${
          isOpen
            ? 'bg-slate-800 text-white border border-slate-700'
            : 'bg-slate-900/90 hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-slate-700'
        }`}
        title="Notification Center (Settlement & Referral Alerts)"
        aria-label="Open Notification Center"
      >
        <Bell className="w-4 h-4" />

        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-mono font-black text-slate-950 shadow-sm animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* CENTERED SCREEN MODAL DIALOG */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => setIsOpen(false)}
        >
          {/* Centered Modal Container */}
          <div
            className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] text-slate-100 animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-900/95 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                  <Bell className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-base sm:text-lg text-white truncate">
                      Notification Center
                    </h3>
                    {unreadCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">
                        {unreadCount} unread
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 truncate hidden sm:block">
                    Real-time profit settlements, referral earnings, and watcher audit updates
                  </p>
                </div>
              </div>

              {/* Header Action Buttons & Close */}
              <div className="flex items-center gap-2 shrink-0">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className="p-1.5 px-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1.5 cursor-pointer"
                    title="Mark all as read"
                  >
                    <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="hidden sm:inline">Mark All Read</span>
                  </button>
                )}

                {notifications.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-xl border border-slate-800 transition cursor-pointer"
                    title="Clear all notifications"
                    aria-label="Clear all notifications"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 border border-transparent hover:border-slate-700 transition cursor-pointer"
                  aria-label="Close dialog"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Filter Pills Navigation */}
            <div className="flex items-center border-b border-slate-800/80 bg-slate-950/60 p-2 sm:p-2.5 gap-1.5 overflow-x-auto no-scrollbar shrink-0">
              <button
                type="button"
                onClick={() => setActiveFilter('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer shrink-0 border ${
                  activeFilter === 'all'
                    ? 'bg-slate-800 text-white border-slate-700 shadow-sm'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                All ({notifications.length})
              </button>

              <button
                type="button"
                onClick={() => setActiveFilter('settlement')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer shrink-0 border ${
                  activeFilter === 'settlement'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                50% Settlements ({settlementsCount})
              </button>

              <button
                type="button"
                onClick={() => setActiveFilter('referral')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer shrink-0 border ${
                  activeFilter === 'referral'
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-sm'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Commissions ({referralsCount})
              </button>

              <button
                type="button"
                onClick={() => setActiveFilter('system')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer shrink-0 border ${
                  activeFilter === 'system'
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Watcher & Risk ({systemCount})
              </button>
            </div>

            {/* Scrollable Notifications Area with FULL DETAILS */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 p-2 sm:p-4 space-y-2">
              {filteredNotifications.length === 0 ? (
                <div className="py-12 px-4 text-center text-slate-400 space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-slate-800/60 border border-slate-700 flex items-center justify-center mx-auto text-slate-500">
                    <Bell className="w-6 h-6" />
                  </div>
                  <h4 className="font-semibold text-sm text-slate-200">No Notifications</h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    You have no notifications in this category. Live settlement sweeps and referral commissions will appear here automatically.
                  </p>
                </div>
              ) : (
                filteredNotifications.map((notif) => {
                  const badgeMeta = getNotificationBadgeMeta(notif.type);

                  return (
                    <div
                      key={notif.id}
                      className={`p-4 rounded-2xl border transition flex flex-col sm:flex-row items-start gap-3.5 ${
                        !notif.read
                          ? 'bg-slate-900 border-slate-700/80 shadow-md ring-1 ring-emerald-500/20'
                          : 'bg-slate-950/60 border-slate-800/80 opacity-90'
                      }`}
                    >
                      {/* Left Category Icon */}
                      <div className="shrink-0">{getIconForType(notif.type)}</div>

                      {/* Middle Content: Full Details */}
                      <div className="flex-1 min-w-0 space-y-2 w-full">
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-white">
                              {notif.title}
                            </span>
                            {!notif.read && (
                              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                            )}
                          </div>

                          {/* Time & Badges */}
                          <div className="flex items-center gap-2 text-[11px] text-slate-400">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${badgeMeta.pillClass}`}
                            >
                              {badgeMeta.label}
                            </span>
                            <span className="text-slate-500">
                              {formatRelativeTime(notif.timestamp)}
                            </span>
                          </div>
                        </div>

                        {/* Full Detailed Message (No Truncation) */}
                        <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">
                          {notif.message}
                        </p>

                        {/* Full Timestamp & Financial Payload Card */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/60 text-xs">
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                            <Calendar className="w-3.5 h-3.5 text-slate-500" />
                            <span>{formatFullDate(notif.timestamp)}</span>
                          </div>

                          <div className="flex items-center gap-2">
                            {notif.amountUsdt !== undefined && (
                              <span className="font-mono font-bold text-xs px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                {notif.type === 'REFERRAL_COMMISSION' ? '+' : ''}$
                                {notif.amountUsdt.toFixed(2)} USDT
                              </span>
                            )}

                            {notif.linkAction && (
                              <button
                                type="button"
                                onClick={() => handleActionClick(notif)}
                                className="px-3 py-1 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition flex items-center gap-1 cursor-pointer shadow-sm"
                              >
                                <span>
                                  {notif.linkAction === 'open_settlements'
                                    ? 'View Settlement Records'
                                    : notif.linkAction === 'open_referrals'
                                    ? 'Open Referral Hub'
                                    : notif.linkAction === 'open_payment'
                                    ? 'Pay 50% Share'
                                    : 'Open Portal'}
                                </span>
                                <ArrowRight className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {!notif.read && (
                              <button
                                type="button"
                                onClick={(e) => handleMarkAsRead(notif.id, e)}
                                className="p-1 text-slate-400 hover:text-emerald-400 transition cursor-pointer"
                                title="Mark as read"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Bottom Bar: Live Simulations & Diagnostics */}
            <div className="p-3 sm:p-4 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2.5 shrink-0 text-xs">
              <div className="flex items-center gap-1.5 text-slate-400">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[11px] font-semibold text-slate-300">Test Live Triggers:</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleTriggerDemo('referral')}
                  className="px-2.5 py-1 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/30 text-xs font-semibold cursor-pointer transition"
                >
                  + Referral Alert ($15)
                </button>
                <button
                  type="button"
                  onClick={() => handleTriggerDemo('settlement')}
                  className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-semibold cursor-pointer transition"
                >
                  + Settlement Alert ($150)
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
