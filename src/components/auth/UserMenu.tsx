import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../context/ThemeContext';
import { User, LogOut, ShieldCheck, ChevronDown, Check, RefreshCw, Zap, Sparkles, Sun, Moon } from 'lucide-react';
import { UserRole } from '../../types';

interface UserMenuProps {
  onOpenAuth: () => void;
  onOpenAdminGate?: () => void;
}

export const UserMenu: React.FC<UserMenuProps> = ({ onOpenAuth, onOpenAdminGate }) => {
  const { userProfile, signOutUser, switchRole, isDirectSession, isDemoUser } = useAuth();
  const { theme, isDark, toggleTheme } = useTheme();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!userProfile) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenAuth}
          className="px-4 py-2 text-xs font-semibold rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition shadow-md shadow-emerald-500/20 cursor-pointer"
        >
          Sign In / Connect
        </button>
      </div>
    );
  }

  const isAdmin = userProfile.role === 'admin';

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="flex items-center gap-2.5 p-1.5 pr-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition"
      >
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${
          isAdmin ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
        }`}>
          {userProfile.displayName ? userProfile.displayName.charAt(0).toUpperCase() : 'U'}
        </div>
        <div className="text-left hidden md:block">
          <div className="text-xs font-semibold text-slate-200 leading-tight">
            {userProfile.displayName || 'Trader'}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded ${
              isAdmin ? 'bg-purple-950/80 text-purple-300 border border-purple-800' : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
            }`}>
              {userProfile.role}
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          </div>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-1" />
      </button>

      {dropdownOpen && (
        <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-2 z-50 text-slate-200 animate-in fade-in duration-150">
          <div className="px-3 py-2 border-b border-slate-800/80">
            <p className="text-xs font-semibold text-white">{userProfile.displayName}</p>
            <p className="text-[11px] text-slate-400 truncate">{userProfile.email}</p>
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-emerald-400">
              {isDemoUser ? (
                <>
                  <Sparkles className="w-3 h-3 text-amber-400" />
                  <span className="text-amber-300">Simulation Session Active</span>
                </>
              ) : isDirectSession ? (
                <>
                  <Zap className="w-3 h-3 text-emerald-400" />
                  <span>Direct Session Active</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                  <span>Firebase Session Active</span>
                </>
              )}
            </div>
          </div>

          {isAdmin ? (
            <div className="py-2 border-b border-slate-800/80">
              <p className="px-3 text-[10px] font-semibold text-purple-400 uppercase tracking-wider mb-1">
                Admin Privilege Active
              </p>
              <button
                onClick={() => {
                  switchRole('client');
                  setDropdownOpen(false);
                }}
                className="w-full flex items-center justify-between px-3 py-1.5 text-xs rounded-lg transition text-slate-300 hover:bg-slate-800"
              >
                <span className="flex items-center gap-2">
                  <User className="w-3.5 h-3.5" />
                  Preview Client Trader View
                </span>
              </button>
            </div>
          ) : onOpenAdminGate ? (
            <div className="py-1.5 border-b border-slate-800/80">
              <button
                onClick={() => {
                  setDropdownOpen(false);
                  onOpenAdminGate();
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-400 hover:text-purple-300 hover:bg-purple-950/30 rounded-lg transition"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
                <span>Administrator Login</span>
              </button>
            </div>
          ) : null}

          <div className="py-1.5 border-b border-slate-800/80">
            <button
              onClick={() => toggleTheme()}
              className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 rounded-lg transition cursor-pointer"
            >
              <span className="flex items-center gap-2">
                {isDark ? (
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                ) : (
                  <Moon className="w-3.5 h-3.5 text-indigo-500" />
                )}
                <span>Interface Theme</span>
              </span>
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                {isDark ? 'Dark' : 'White'}
              </span>
            </button>
          </div>

          <div className="pt-1">
            <button
              onClick={() => {
                signOutUser();
                setDropdownOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose-400 hover:bg-rose-500/10 rounded-lg transition font-medium cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Disconnect & Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
