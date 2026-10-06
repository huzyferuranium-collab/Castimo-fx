import React, { useState } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { ThemeToggle, ThemeSegmentedControl } from './components/common/ThemeToggle';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { UserMenu } from './components/auth/UserMenu';
import { AuthModal } from './components/auth/AuthModal';
import { AdminGateModal } from './components/auth/AdminGateModal';
import { ClientDashboard } from './components/dashboard/ClientDashboard';
import { AdminDashboard } from './components/dashboard/AdminDashboard';
import { ReferralCommissionView } from './components/referrals/ReferralCommissionView';
import { FAQSection } from './components/landing/FAQSection';
import {
  Shield,
  TrendingUp,
  Sparkles,
  Server,
  ArrowRight,
  Share2,
  Lock,
  Download,
} from 'lucide-react';

const TickerBar: React.FC = () => {
  return (
    <div className="bg-slate-100 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800/80 py-1.5 px-4 overflow-x-auto text-[11px] font-mono text-slate-600 dark:text-slate-400 flex items-center justify-between gap-6 no-scrollbar">
      <div className="flex items-center gap-6 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-slate-800 dark:text-slate-300 font-bold">TRON NETWORK:</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">TRC20 USDT ACTIVE</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-600 dark:text-slate-500 font-medium">XAUUSD:</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-bold">2,651.80 +0.35%</span>
        </div>
      </div>
      <div className="hidden lg:flex items-center gap-3 shrink-0 text-[10px] text-slate-500 dark:text-slate-500">
        <span>MODEL: 50% PROFIT SHARE</span>
        <span>•</span>
        <span>REFERRALS: 5% / 3% / 2%</span>
        <span>•</span>
        <span>24H WATCHER: ACTIVE</span>
      </div>
    </div>
  );
};

type ActivePortalTab = 'client' | 'referrals' | 'admin';

const MainContent: React.FC = () => {
  const { userProfile, loading, isDemoUser, demoLogin, switchRole } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [adminGateOpen, setAdminGateOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ActivePortalTab>('client');

  const isAdmin = userProfile?.role === 'admin';

  // Synchronize tab with user role when loaded
  React.useEffect(() => {
    if (userProfile?.role === 'admin') {
      setActiveTab('admin');
    } else if (activeTab === 'admin') {
      setActiveTab('client');
    }
  }, [userProfile?.role, activeTab]);

  // Check URL hash for direct #admin portal request
  React.useEffect(() => {
    const handleHash = () => {
      if (window.location.hash === '#admin') {
        if (!isAdmin) {
          setAdminGateOpen(true);
        } else {
          setActiveTab('admin');
        }
      }
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [isAdmin]);

  const handleSelectTab = (tab: ActivePortalTab) => {
    if (tab === 'admin') {
      if (!isAdmin) {
        setAdminGateOpen(true);
        return;
      }
      setActiveTab('admin');
      return;
    }

    if (!userProfile) {
      demoLogin('client');
    }
    setActiveTab(tab);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-300 gap-3">
        <div className="w-10 h-10 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin"></div>
        <p className="text-xs font-mono text-slate-400">Initializing Castimofx Security Engine...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      <TickerBar />

      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-slate-950/85 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2.5 sm:py-0 sm:h-16 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4">
          <div className="flex items-center justify-between w-full sm:w-auto">
            {/* Logo & Brand */}
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-slate-950 font-black shadow-md shadow-emerald-500/20 shrink-0">
                <TrendingUp className="w-4 h-4 text-slate-950" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h1 className="text-sm sm:text-base font-black tracking-wider text-white">CASTIMOFx</h1>
                  <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    MT5
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 hidden md:block">
                  50% Profit Share Copier & 3-Phase Referral Hub
                </p>
              </div>
            </div>

            {/* Mobile Right Controls: Theme & UserMenu */}
            <div className="flex sm:hidden items-center gap-1.5">
              <ThemeToggle showLabel={false} />
              <UserMenu
                onOpenAuth={() => setAuthModalOpen(true)}
                onOpenAdminGate={() => setAdminGateOpen(true)}
              />
            </div>
          </div>

          {/* Center Navigation Toggle: ONLY SHOWS RELEVANT CLIENT/ADMIN TABS */}
          <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 shadow-inner overflow-x-auto no-scrollbar w-full sm:w-auto justify-start sm:justify-center">
            <button
              onClick={() => handleSelectTab('client')}
              className={`px-3 sm:px-3.5 py-1.5 text-xs font-semibold rounded-lg transition flex items-center gap-1.5 cursor-pointer shrink-0 ${
                activeTab === 'client'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
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
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Share2 className="w-3.5 h-3.5 text-blue-400" />
              <span>Referral Hub</span>
              <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                5%•3%•2%
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
            {isDemoUser && (
              <span className="hidden lg:inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/30">
                <Sparkles className="w-3 h-3" />
                <span>Simulation Active</span>
              </span>
            )}
            <UserMenu
              onOpenAuth={() => setAuthModalOpen(true)}
              onOpenAdminGate={() => setAdminGateOpen(true)}
            />
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {!userProfile ? (
          /* Unauthenticated Landing / Onboarding View */
          <div className="py-8 space-y-12 animate-in fade-in duration-300">
            {/* Hero Section */}
            <div className="text-center max-w-3xl mx-auto space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
                <Shield className="w-3.5 h-3.5" />
                <span>Pure 50% Profit Share Model • 3-Phase Referral Program</span>
              </div>
              <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
                Institutional MT5 Copying with{' '}
                <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
                  50% Profit Share & 3-Tier Commissions
                </span>
              </h2>
              <p className="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto leading-relaxed">
                Zero upfront subscription fees or packages. We get paid strictly 50% profit share after your connected MT5 makes profits. Refer other traders and earn across three phases: 5% Phase 1, 3% Phase 2, and 2% Phase 3 from their 24h profit settlements.
              </p>

              {/* Public Client CTAs: NO PUBLIC ADMIN ACCESS */}
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => handleSelectTab('client')}
                  className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 font-bold text-sm text-slate-950 shadow-lg shadow-emerald-500/25 transition flex items-center gap-2 cursor-pointer"
                >
                  <TrendingUp className="w-4 h-4" />
                  <span>Access Client Terminal</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleSelectTab('referrals')}
                  className="px-6 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-blue-300 border border-blue-800/60 font-bold text-sm shadow-lg transition flex items-center gap-2 cursor-pointer"
                >
                  <Share2 className="w-4 h-4 text-blue-400" />
                  <span>Referral Hub (5%•3%•2%)</span>
                </button>
              </div>
            </div>

            {/* Architecture Highlights */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-base text-white">Pure 50% Profit Share</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  No packages or monthly subscriptions. We earn strictly when your MT5 wins. 50% profit share is settled on net new gains within a 24-hour window.
                </p>
              </div>

              <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
                  <Share2 className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-base text-white">3-Phase Referral Program</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Earn recurring USDT from the 24-hour settlements of your network: 5% Phase 1 (Direct), 3% Phase 2 (Secondary), and 2% Phase 3 (Tertiary).
                </p>
              </div>

              <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
                  <Shield className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-base text-white">Autonomous 24h Watcher</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  The automated watcher reads profits in real time and monitors a 24-hour settlement window. Terminals that fail to remit the 50% share within 24 hours are automatically disconnected.
                </p>
              </div>
            </div>

            {/* Platform Knowledge Base / FAQ Section */}
            <FAQSection onSelectTab={handleSelectTab} />
          </div>
        ) : activeTab === 'admin' ? (
          isAdmin ? (
            <AdminDashboard />
          ) : (
            /* Protected Security Fallback for non-admins */
            <div className="max-w-lg mx-auto py-12 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-purple-950/60 border border-purple-800/80 flex items-center justify-center text-purple-400 mx-auto">
                <Lock className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-white">Administrator Access Restricted</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                This console is reserved exclusively for system administrators and platform risk supervisors. Enter master passkey credentials to unlock oversight privileges.
              </p>
              <div className="pt-2 flex justify-center gap-3">
                <button
                  onClick={() => setActiveTab('client')}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition cursor-pointer"
                >
                  Return to Client Terminal
                </button>
                <button
                  onClick={() => setAdminGateOpen(true)}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-purple-600/30 cursor-pointer"
                >
                  Enter Admin Passkey
                </button>
              </div>
            </div>
          )
        ) : activeTab === 'referrals' ? (
          <ReferralCommissionView />
        ) : (
          <ClientDashboard onNavigateToReferrals={() => setActiveTab('referrals')} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 mt-auto text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-400">CASTIMOFx TRADING PLATFORM</span>
            <span>•</span>
            <span>50% Profit Share Institutional Copier & 3-Phase Referral Network</span>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <span className="text-[11px] text-slate-600 hidden md:inline">
              Direct Broker Custody • Autonomous 24h Watcher • TRC20 USDT Remittance
            </span>
            <ThemeSegmentedControl />
            {/* Direct 1-Click Project Download */}
            <a
              href="/castimo-fx-project.zip"
              download="castimo-fx-project.zip"
              className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-cyan-400 dark:hover:text-cyan-300 transition cursor-pointer border-l border-slate-800 pl-4 font-medium"
              title="Download clean single-file ZIP archive of the entire project"
            >
              <Download className="w-3.5 h-3.5 text-cyan-500" />
              <span>Download (.zip)</span>
            </a>
            {/* Discreet Staff / Admin Gateway Link */}
            <button
              onClick={() => setAdminGateOpen(true)}
              className="flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-purple-400 transition cursor-pointer border-l border-slate-800 pl-4"
              title="Restricted Staff & Admin Gateway"
            >
              <Lock className="w-3 h-3" />
              <span>Staff Gateway</span>
            </button>
          </div>
        </div>
      </footer>

      {/* Global Auth Modal */}
      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />

      {/* Administrator Security Gateway Modal */}
      <AdminGateModal
        isOpen={adminGateOpen}
        onClose={() => setAdminGateOpen(false)}
        onSuccess={() => {
          setActiveTab('admin');
        }}
      />
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
