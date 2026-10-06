import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  badgeVariant?: 'default' | 'success' | 'warning' | 'danger';
  description?: string;
}

export interface NavGroup {
  groupTitle?: string;
  items: NavItem[];
}

interface SidebarNavProps {
  groups: NavGroup[];
  activeId: string;
  onSelect: (id: string) => void;
  title: string;
  subtitle?: string;
  statusBadge?: {
    text: string;
    variant: 'success' | 'warning' | 'danger' | 'purple';
    pulsing?: boolean;
  };
  accentColor?: 'emerald' | 'purple';
}

export const SidebarNav: React.FC<SidebarNavProps> = ({
  groups,
  activeId,
  onSelect,
  title,
  subtitle,
  statusBadge,
  accentColor = 'emerald',
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const allItems = groups.flatMap((g) => g.items);
  const activeItem = allItems.find((i) => i.id === activeId) || allItems[0];

  const getBadgeStyle = (variant: 'default' | 'success' | 'warning' | 'danger' = 'default') => {
    switch (variant) {
      case 'success':
        return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
      case 'warning':
        return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
      case 'danger':
        return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  const activeItemStyle =
    accentColor === 'purple'
      ? 'bg-purple-100 dark:bg-purple-600/15 text-purple-900 dark:text-purple-200 border-purple-300 dark:border-purple-500/40 shadow-xs font-semibold'
      : 'bg-emerald-100 dark:bg-emerald-600/15 text-emerald-900 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/40 shadow-xs font-semibold';

  const hoverItemStyle =
    accentColor === 'purple'
      ? 'hover:bg-purple-50 dark:hover:bg-purple-950/30 hover:text-purple-900 dark:hover:text-purple-200'
      : 'hover:bg-emerald-50 dark:hover:bg-emerald-950/30 hover:text-emerald-900 dark:hover:text-emerald-200';

  return (
    <>
      {/* MOBILE COMPACT HEADER & 1-TAP HORIZONTAL SWIPE DOCK */}
      <div className="lg:hidden w-full space-y-2 mb-3">
        {/* Mobile Header Bar */}
        <div className="flex items-center justify-between p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition cursor-pointer flex items-center gap-1.5 shrink-0"
              aria-label="Open navigation menu"
            >
              <Menu className="w-4 h-4" />
              <span className="text-xs font-semibold">Menu</span>
            </button>

            <div className="min-w-0">
              <span className="text-xs font-bold text-slate-900 dark:text-white block truncate leading-tight">
                {activeItem?.label || title}
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate block font-mono">
                {subtitle || title}
              </span>
            </div>
          </div>

          {statusBadge && (
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded-full border font-bold flex items-center gap-1 shrink-0 ${
                statusBadge.variant === 'success'
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40'
                  : statusBadge.variant === 'danger'
                  ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40'
                  : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40'
              }`}
            >
              {statusBadge.pulsing && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              )}
              <span>{statusBadge.text}</span>
            </span>
          )}
        </div>

        {/* 1-Tap Horizontal Shortcut Dock */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 px-0.5">
          {allItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeId === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition cursor-pointer shrink-0 border ${
                  isActive
                    ? activeItemStyle
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? (accentColor === 'purple' ? 'text-purple-600 dark:text-purple-300' : 'text-emerald-600 dark:text-emerald-400') : 'text-slate-400 dark:text-slate-500'}`} />
                <span>{item.label}</span>
                {item.badge !== undefined && (
                  <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-full border ${getBadgeStyle(item.badgeVariant)}`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mobile Drawer Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm lg:hidden animate-in fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Clean, Minimal Sidebar Container */}
      <aside
        className={`fixed lg:static top-0 bottom-0 left-0 z-50 lg:z-auto transition-all duration-200 ease-out shrink-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } ${collapsed ? 'lg:w-20' : 'w-72 lg:w-60 xl:w-64'}`}
      >
        <div className="h-full flex flex-col rounded-none lg:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden max-h-[100dvh] lg:max-h-none">
          {/* Header */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-2 shrink-0">
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white truncate">
                    {title}
                  </h3>
                </div>
                {subtitle && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5 font-mono">{subtitle}</p>
                )}
              </div>
            )}

            {/* Desktop Collapse / Mobile Close */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="lg:hidden p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => setCollapsed(!collapsed)}
                className="hidden lg:flex items-center justify-center w-7 h-7 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/80 transition cursor-pointer border border-slate-200 dark:border-slate-800"
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {collapsed ? (
                  <ChevronRight className="w-3.5 h-3.5" />
                ) : (
                  <ChevronLeft className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Clean Navigation Items */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-3 no-scrollbar">
            {groups.map((group, gIdx) => (
              <div key={gIdx} className="space-y-1">
                {!collapsed && group.groupTitle && (
                  <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 font-mono">
                    {group.groupTitle}
                  </div>
                )}

                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeId === item.id;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onSelect(item.id);
                        setMobileOpen(false);
                      }}
                      title={collapsed ? item.label : undefined}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs transition border cursor-pointer select-none text-left min-h-[40px] ${
                        isActive
                          ? activeItemStyle
                          : `border-transparent text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 ${hoverItemStyle}`
                      } ${collapsed ? 'justify-center px-0' : ''}`}
                    >
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          isActive
                            ? accentColor === 'purple'
                              ? 'text-purple-600 dark:text-purple-300'
                              : 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}
                      />

                      {!collapsed && (
                        <div className="flex-1 min-w-0 flex items-center justify-between gap-1.5">
                          <span className="truncate font-medium">{item.label}</span>
                          {item.badge !== undefined && (
                            <span
                              className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-full border shrink-0 ${getBadgeStyle(
                                item.badgeVariant
                              )}`}
                            >
                              {item.badge}
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
};
