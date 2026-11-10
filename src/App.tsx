import { captureReferralFromUrl } from './services/referralApi';
import HeroBackdrop, { BackdropVariant } from './components/landing/HeroBackdrop';
import { LandingPage } from './components/landing/LandingPage';
import { BrandLoader } from './components/common/BrandLoader';
import React, { Suspense, lazy, useState } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { ThemeToggle, ThemeSegmentedControl } from './components/common/ThemeToggle';
import { AssistantChat } from './components/assistant/AssistantChat';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { UserMenu } from './components/auth/UserMenu';
import { AuthModal } from './components/auth/AuthModal';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { referralRatesLabel } from './utils/format';

// The signed-in screens are big, so each is fetched only when it is opened. Visitors on the landing page never download them.
const ClientDashboard = lazy(() => import('./components/dashboard/ClientDashboard').then((m) => ({ default: m.ClientDashboard })));
const loadAdminDashboard = () => import('./components/dashboard/AdminDashboard');
const AdminDashboard = lazy(() => loadAdminDashboard().then((m) => ({ default: m.AdminDashboard })));

/**
 * The admin hub's code is downloaded early for whoever was an administrator last time on this device: while sign-in and the
 * profile are still loading, not only once the hub is about to be drawn. This is a download hint only; being an
 * administrator is still decided by the role stored in the database (and checked again by the server on every request).
 */
const ADMIN_HINT_KEY = 'castimo_admin_hint';
try {
  if (typeof window !== 'undefined' && window.localStorage.getItem(ADMIN_HINT_KEY) === '1') void loadAdminDashboard().catch(() => undefined);
} catch {
  // storage unavailable: the hub simply downloads when it is opened
}
const ReferralCommissionView = lazy(() => import('./components/referrals/ReferralCommissionView').then((m) => ({ default: m.ReferralCommissionView })));
const YieldPoolSection = lazy(() => import('./components/dashboard/YieldPoolSection').then((m) => ({ default: m.YieldPoolSection })));
import {
  TrendingUp,
  Server,
  Share2,
  Flame,
} from 'lucide-react';

captureReferralFromUrl();

const TickerBar: React.FC = () => {
  return (
    <div className="bg-slate-100 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800/80 py-1.5 px-4 overflow-x-auto text-[11px] font-mono text-slate-600 dark:text-slate-400 flex items-center justify-between gap-6 no-scrollbar">
      <div className="flex items-center gap-6 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-800 dark:text-slate-300 font-bold">PAYMENTS:</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">USDT (TRC20)</span>
        </div>
      </div>
      <div className="hidden lg:flex items-center gap-3 shrink-0 text-[10px] text-slate-500 dark:text-slate-500">
        <span>$100/MONTH OR 50% PROFIT SHARE</span>
        <span>•</span>
        <span>REFERRALS: {referralRatesLabel()}</span>
        <span>•</span>
        <span>YIELD POOL: UP TO 2% DAILY</span>
        <span>•</span>
        <span>INVOICES DUE BEFORE MIDNIGHT GMT</span>
      </div>
    </div>
  );
};

type ActivePortalTab = 'client' | 'referrals' | 'yield_pool' | 'admin';

const MainContent: React.FC = () => {
  const { userProfile, loading } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  // null = not chosen yet: admins land on the Admin Console, everyone else on the client terminal. Working it out here (not
  // in an effect after the first paint) means an admin never sees the client dashboard drawn, and loading, first.
  const [chosenTab, setActiveTab] = useState<ActivePortalTab | null>(null);

  const isAdmin = userProfile?.role === 'admin';
  const activeTab: ActivePortalTab = chosenTab ?? (isAdmin ? 'admin' : 'client');

  // A different account (or a role change) starts again from its own landing tab, and remembers the download hint.
  React.useEffect(() => {
    setActiveTab(null);
    try {
      if (isAdmin) window.localStorage.setItem(ADMIN_HINT_KEY, '1');
      else if (userProfile) window.localStorage.removeItem(ADMIN_HINT_KEY);
    } catch {
      // ignore
    }
    if (isAdmin) void loadAdminDashboard().catch(() => undefined);
  }, [userProfile?.uid, userProfile?.role]);

  // Each page gets its own colour mood from the shared palette.
  const pageMood: BackdropVariant = !userProfile ? 'landing' : activeTab === 'admin' && isAdmin ? 'admin' : activeTab === 'referrals' ? 'referrals' : 'client';
  React.useEffect(() => {
    document.documentElement.dataset.page = pageMood;
  }, [pageMood]);

  const handleSelectTab = (tab: ActivePortalTab) => {
    if (tab === 'admin') {
      if (isAdmin) setActiveTab('admin');
      return;
    }

    // Only signed-in accounts can open the terminals.
    if (!userProfile) {
      setAuthModalOpen(true);
      return;
    }
    setActiveTab(tab);
  };

  if (loading) {
    return <BrandLoader message="Starting up securely…" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      <HeroBackdrop variant={pageMood} />
      <TickerBar />

      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-slate-950/85 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2.5 sm:py-0 sm:h-16 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4">
          <div className="flex items-center justify-between w-full sm:w-auto">
            {/* Logo & Brand */}
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 via-violet-600 to-rose-500 flex items-center justify-center text-white font-black shadow-lg shadow-violet-500/30 ring-1 ring-white/30 shrink-0">
                <TrendingUp className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h1 className="text-sm sm:text-base font-black tracking-wider text-white">Castimofx</h1>
                  <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-700 dark:text-sky-200 border border-sky-500/40">
                    MT5
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 hidden lg:block">
                  50% Profit Share Copier & 3-Phase Referral Hub
                </p>
              </div>
            </div>

            {/* Mobile Right Controls: Theme & UserMenu */}
            <div className="flex sm:hidden items-center gap-1.5">
              <ThemeToggle showLabel={false} />
              <UserMenu
                onOpenAuth={() => setAuthModalOpen(true)}
              />
            </div>
          </div>

          {/* Center Navigation Toggle: ONLY SHOWS RELEVANT CLIENT/ADMIN TABS */}
          <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 shadow-inner overflow-x-auto no-scrollbar w-full sm:w-auto justify-start sm:justify-center">
            <button
              onClick={() => handleSelectTab('client')}
              className={`px-3 sm:px-3.5 py-1.5 text-xs font-semibold rounded-lg transition flex items-center gap-1.5 cursor-pointer shrink-0 ${
                activeTab === 'client'
                  ? 'bg-blue-500/15 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200 border border-blue-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Client Terminal</span>
            </button>
            <button
              onClick={() => handleSelectTab('referrals')}
              className={`px-3 sm:px-3.5 py-1.5 text-xs font-semibold rounded-lg transition flex items-center gap-1.5 cursor-pointer shrink-0 ${
                activeTab === 'referrals'
                  ? 'bg-rose-500/15 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200 border border-rose-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Share2 className="w-3.5 h-3.5 text-rose-400" />
              <span>Referral Hub</span>
              <span className={`${isAdmin ? 'hidden sm:inline' : ''} text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-gradient-to-r from-rose-500/20 via-violet-500/20 to-blue-500/20 text-rose-700 dark:text-rose-200 border border-rose-500/30`}>
                {referralRatesLabel('•')}
              </span>
            </button>
            <button
              onClick={() => handleSelectTab('yield_pool')}
              className={`px-3 sm:px-3.5 py-1.5 text-xs font-semibold rounded-lg transition flex items-center gap-1.5 cursor-pointer shrink-0 ${
                activeTab === 'yield_pool'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Flame className="w-3.5 h-3.5 text-emerald-400" />
              <span>Yield Pool Hub</span>
              <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                Up to 2%
              </span>
            </button>

            {/* ONLY DISPLAYED TO VERIFIED ADMINISTRATORS */}
            {isAdmin && (
              <button
                onClick={() => handleSelectTab('admin')}
                className={`px-3 sm:px-3.5 py-1.5 text-xs font-semibold rounded-lg transition flex items-center gap-1.5 cursor-pointer shrink-0 ${
                  activeTab === 'admin'
                    ? 'bg-purple-500/25 text-purple-200 border border-purple-500/40 shadow-sm'
                    : 'text-purple-400 hover:text-purple-300'
                }`}
              >
                <Server className="w-3.5 h-3.5 text-purple-400" />
                <span>Admin Console</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
              </button>
            )}
          </div>

          {/* Desktop Right Action / Profile Menu */}
          <div className="hidden sm:flex items-center gap-2 sm:gap-3 shrink-0">
            <ThemeToggle showLabel={false} />
            <UserMenu
              onOpenAuth={() => setAuthModalOpen(true)}
            />
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-24">
        {!userProfile ? (
          /* Unauthenticated Landing / Onboarding View */
          <div className="relative py-4 animate-in fade-in duration-300">
            <LandingPage onSelectTab={handleSelectTab} />
          </div>
        ) : (
          <div key={activeTab} className="page-enter">
            <ErrorBoundary>
              <Suspense fallback={<BrandLoader message="Loading…" />}>
                {activeTab === 'admin' && isAdmin ? (
                  <AdminDashboard />
                ) : activeTab === 'referrals' ? (
                  <ReferralCommissionView />
                ) : activeTab === 'yield_pool' ? (
                  <YieldPoolSection
                    userId={userProfile?.uid || ''}
                    userEmail={userProfile?.email}
                    onNavigateToPositions={() => setActiveTab('client')}
                  />
                ) : (
                  <ClientDashboard
                    onNavigateToReferrals={() => setActiveTab('referrals')}
                    onNavigateToYieldPool={() => setActiveTab('yield_pool')}
                  />
                )}
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 mt-auto text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-400">Castimofx Trading Platform</span>
            <span>•</span>
            <span>MT5 Trade Copier & 3-Level Referral Network</span>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <span className="text-[11px] text-slate-600 hidden md:inline">
              Direct Broker Custody • Automatic Billing Checks • TRC20 USDT Payments
            </span>
            <ThemeSegmentedControl />
          </div>
        </div>
      </footer>

      {/* Global Auth Modal */}
      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />

      {/* Help assistant (bottom-right): only inside the app once someone is signed in, never on the welcome page,
          and only when the server has it switched on */}
      {userProfile && <AssistantChat />}

    </div>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MainContent />
      </AuthProvider>
    </ThemeProvider>
  );
}
