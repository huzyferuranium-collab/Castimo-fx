import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { tradingEngine, CASTIMO_TREASURY_ADDRESS, type PayableNowView } from '../../services/tradingEngine';
import { authHeaders } from '../../services/apiAuth';
import { pendingNote, pendingAccountLine, type PendingConnectionView } from '../../services/pendingConnection';
import {
  Mt5Account,
  CopiedTrade,
  ProfitShareInvoice,
} from '../../types';
import { TradeCopierTable } from '../mt5/TradeCopierTable';
import { TradeHistory } from '../mt5/TradeHistory';
import { NotificationCenter } from '../notifications/NotificationCenter';
import { ProfitSharePaymentModal } from '../payments/ProfitSharePaymentModal';
import { TermsModal } from '../legal/TermsModal';
import { hasAcceptedTerms, acceptTerms } from '../../services/agreements';
import { Mt5ConnectionModal } from '../mt5/Mt5ConnectionModal';
import { Mt5DisconnectModal } from '../mt5/Mt5DisconnectModal';
import { SettlementHistoryModal } from '../settlements/SettlementHistoryModal';
import { LedgerAuditModal } from '../ledger/LedgerAuditModal';
import { SidebarNav, NavGroup } from '../common/SidebarNav';

import { RobotConsole } from './RobotConsole';
import { AuthModal } from '../auth/AuthModal';
import { ServicePlanPage } from './ServicePlanPage';
import { getPlanView, PlanView } from '../../services/servicePlanApi';
import { WelcomeHero, StatCard, ProgressRing, ActionCard, IconTile, SectionBanner, Tone } from './DashboardVisuals';
import { ART, ArtName } from './Illustrations';
import { TradePerformance } from './TradeCharts';
import { AnimatedNumber } from '../common/AnimatedNumber';

import {
  Wallet,
  TrendingUp,
  Server,
  Shield,
  ShieldAlert,
  Power,
  Clock,
  Award,
  FileText,
  Share2,
  History,
  Activity,
  ArrowRight,
  Sliders,
  Cpu,
  ArrowUpRight,
  ArrowDownRight,
  Mail,
  Send,
  Zap,
  Radio,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ShieldCheck,
  CreditCard,
  User,
  UserCheck,
  Copy,
  Check,
  ExternalLink,
  QrCode,
  Lock,
} from 'lucide-react';

interface ClientDashboardProps {
  onNavigateToReferrals?: () => void;
}

export const ClientDashboard: React.FC<ClientDashboardProps> = ({ onNavigateToReferrals }) => {
  const { userProfile, isEmailVerified, isAdmin, isClient } = useAuth();
  const isUserAdmin = isAdmin ?? (userProfile?.role === 'admin');
  const isUserClient = isClient ?? (!isUserAdmin || userProfile?.role === 'client');

  const [activeSection, setActiveSection] = useState<string>('overview');
  // Paying the 50% before the daily settlement: what is payable now, and the button's state.
  const [payable, setPayable] = useState<PayableNowView | null>(null);
  const [payableLoading, setPayableLoading] = useState(false);
  const [payNowBusy, setPayNowBusy] = useState(false);
  const [payNowError, setPayNowError] = useState('');
  const loadPayable = async () => {
    setPayableLoading(true);
    setPayable(await tradingEngine.getPayableNow());
    setPayableLoading(false);
  };
  const payNow = async () => {
    setPayNowBusy(true);
    setPayNowError('');
    const r = await tradingEngine.payProfitShareNow();
    if (!r.success) setPayNowError(r.error || 'The invoice could not be made.');
    await loadPayable();
    setPayNowBusy(false);
  };
  useEffect(() => {
    if (activeSection !== 'settlement_due') return;
    void loadPayable();
    const t = setInterval(() => void loadPayable(), 60_000);
    return () => clearInterval(t);
  }, [activeSection]);

  // Every real client must accept the terms before using the dashboard. null = still checking.
  const [termsAccepted, setTermsAccepted] = useState<boolean | null>(null);
  useEffect(() => {
    const uid = userProfile?.uid;
    // Administrators do not connect client accounts, so they have nothing to agree to.
    if (!uid || userProfile?.role === 'admin') {
      setTermsAccepted(true);
      return;
    }
    let cancelled = false;
    hasAcceptedTerms(uid).then((ok) => !cancelled && setTermsAccepted(ok));
    return () => {
      cancelled = true;
    };
  }, [userProfile?.uid]);
  const [account, setAccount] = useState<Mt5Account>(tradingEngine.getMt5Account());
  // A connection the server is still looking after (or has given up on), so the client is never left guessing.
  const [pending, setPending] = useState<PendingConnectionView | null>(tradingEngine.getPendingConnection());
  const [trades, setTrades] = useState<CopiedTrade[]>(tradingEngine.getTrades());
  // Said on the trade pages when the list could not be loaded or shown in full (instead of a page that just looks empty).
  const [tradesNotice, setTradesNotice] = useState<string | null>(tradingEngine.getTradesNotice());
  // How many open trades the copier service counts on this account (it can be more than the details we could read).
  const [openReported, setOpenReported] = useState<number>(tradingEngine.getOpenReported());

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showEmailVerifyModal, setShowEmailVerifyModal] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [countdownText, setCountdownText] = useState<string>('');

  // Client Equity Calibration State
  const [isSavingEquity, setIsSavingEquity] = useState(false);

  // 50% Profit Share Remittance & Transaction Hash State
  const [invoices, setInvoices] = useState<ProfitShareInvoice[]>(tradingEngine.getProfitInvoices());
  // The address the server checks a payment against is the one stored on the unpaid invoice; it is shown, so the two always match.
  const payToAddress = invoices.find((i) => i.status !== 'paid')?.recipientAddress || CASTIMO_TREASURY_ADDRESS;
  const [txHashInput, setTxHashInput] = useState<string>('');
  const [isVerifyingHash, setIsVerifyingHash] = useState<boolean>(false);
  const [hashResult, setHashResult] = useState<{
    success: boolean;
    message: string;
    amountSettled?: number;
    txHash?: string;
    error?: string;
  } | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<boolean>(false);

  // Which service plan the client chose (kept on the server). undefined = still loading.
  const [planView, setPlanView] = useState<PlanView | null | undefined>(undefined);
  const refreshPlan = () => {
    if (!userProfile?.uid || userProfile.role === 'admin') return;
    getPlanView().then(setPlanView);
  };
  useEffect(refreshPlan, [userProfile?.uid]);
  const planChosen = planView === undefined || planView === null || !planView.available || planView.model !== null;
  const openConnect = () => {
    // Email confirmation is asked for here, at the moment it is needed, and never blocks anything else.
    if (!isEmailVerified && !isAdmin) {
      setShowEmailVerifyModal(true);
      return;
    }
    if (!planChosen) {
      setActiveSection('plan');
      return;
    }
    setShowConnectModal(true);
  };

  // Copier service status (master reading) and this client's copy switch
  const [copierStatus, setCopierStatus] = useState<{
    connected: boolean;
    status: string;
    masterBalance: number;
    masterEquity: number;
    openPositionsCount: number;
    activeClientsCount: number;
    mirrorActive: boolean;
    loading: boolean;
    error?: string;
    mode?: string;
  }>({
    connected: false,
    status: 'UNKNOWN',
    masterBalance: 0,
    masterEquity: 0,
    openPositionsCount: 0,
    activeClientsCount: 0,
    mirrorActive: true,
    loading: false,
  });

  const [isRetryingMaster, setIsRetryingMaster] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  const fetchCopierStatus = async () => {
    try {
      const res = await fetch('/api/trade/account-status', { headers: await authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setCopierStatus((prev) => ({
          ...prev,
          connected: data.connected === true,
          status: data.status || 'UNKNOWN',
          masterBalance: data.master?.balance != null ? Number(data.master.balance) : prev.masterBalance,
          masterEquity: data.master?.equity != null ? Number(data.master.equity) : prev.masterEquity,
          openPositionsCount: data.master?.openPositionsCount ?? 0,
          activeClientsCount: Number(data.activeClientsCount) || 0,
          mode: data.mode,
        }));
        if (data.master) {
          tradingEngine.syncMasterAccountFromCloud(data.master, data.activeClientsCount);
          setAccount(tradingEngine.getMt5Account());
        }
      }
    } catch {
      // The last reading stays on screen until the next one succeeds
    }
  };

  const handleRetryMasterTerminal = async () => {
    try {
      setIsRetryingMaster(true);
      setRetryMessage(null);
      const res = await fetch('/api/trade/retry-master', { method: 'POST', headers: await authHeaders() });
      const data = await res.json();
      setRetryMessage(data.message || data.error || (data.success ? 'Master connected' : 'Retry completed'));
      await fetchCopierStatus();
    } catch {
      setRetryMessage('Network error while requesting master reconnect');
    } finally {
      setIsRetryingMaster(false);
    }
  };

  useEffect(() => {
    fetchCopierStatus();
    tradingEngine.syncClientsFromBackend();
    tradingEngine.syncInvoicesFromBackend();
    void tradingEngine.syncClientIp();
    let tick = 0;
    const interval = setInterval(() => {
      fetchCopierStatus();
      tradingEngine.syncClientsFromBackend();
      if (++tick % 6 === 0) tradingEngine.syncInvoicesFromBackend();
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleMirror = async () => {
    try {
      setCopierStatus((prev) => ({ ...prev, loading: true, error: undefined }));
      const targetState = copierStatus.mirrorActive ? 'IDLE' : 'ACTIVE';
      const res = await fetch('/api/trade/toggle-mirror', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ targetState }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCopierStatus((prev) => ({
          ...prev,
          mirrorActive: data.status === 'ACTIVE',
          loading: false,
        }));
      } else {
        setCopierStatus((prev) => ({
          ...prev,
          loading: false,
          error: data.error || 'Failed to toggle mirror state',
        }));
      }
    } catch (err: any) {
      setCopierStatus((prev) => ({
        ...prev,
        loading: false,
        error: err?.message || 'Network error while contacting trade server',
      }));
    }
  };

  useEffect(() => {
    const unsubscribe = tradingEngine.subscribe(() => {
      setAccount({ ...tradingEngine.getMt5Account() });
      setPending(tradingEngine.getPendingConnection());
      setTrades([...tradingEngine.getTrades()]);
      setTradesNotice(tradingEngine.getTradesNotice());
      setOpenReported(tradingEngine.getOpenReported());
      setInvoices([...tradingEngine.getProfitInvoices()]);
    });
    return () => unsubscribe();
  }, []);

  const handleCopyAddress = (addr: string) => {
    try {
      navigator.clipboard?.writeText(addr);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2500);
    } catch {
      // Ignored
    }
  };

  const handleVerifyHash = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanHash = txHashInput.trim();
    if (!cleanHash) {
      setHashResult({
        success: false,
        message: 'Transaction hash required',
        error: 'Please paste your TRC-20 Transaction Hash (TXID) before verifying.',
      });
      return;
    }

    setIsVerifyingHash(true);
    setHashResult(null);

    try {
      const res = await tradingEngine.submitAndVerifyProfitShareHash(account.accountNumber, cleanHash);
      setHashResult(res);
      if (res.success) {
        setTxHashInput('');
        setInvoices([...tradingEngine.getProfitInvoices()]);
        setAccount({ ...tradingEngine.getMt5Account() });
      }
    } catch (err: any) {
      setHashResult({
        success: false,
        message: 'Verification failed',
        error: err?.message || 'Failed to communicate with TRON blockchain validator.',
      });
    } finally {
      setIsVerifyingHash(false);
    }
  };

  // Update countdown to 24h deadline if profit share is pending
  useEffect(() => {
    const updateCountdown = () => {
      if (!account.profitShareDueAt) {
        setCountdownText('');
        return;
      }
      const dueTime = new Date(account.profitShareDueAt).getTime();
      const now = Date.now();
      const diff = dueTime - now;

      if (diff <= 0) {
        setCountdownText('24h Window Expired');
      } else {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        setCountdownText(`${hours}h ${minutes}m remaining`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [account.profitShareDueAt]);

  const isConnected = account.status === 'copying' || account.status === 'connected';
  const isBlockedUnpaid = account.status === 'blocked_unpaid';
  const isRiskBlocked = account.status === 'blocked' || account.riskStatus === 'blocked';
  // Connected, but below the minimum equity: nothing is copied yet, and it starts by itself once the account reaches the minimum.
  const copyHeld = isConnected && !!account.copyHeld;
  const readingBalance = account.copyHeld === 'reading_balance';
  const copyMinText = typeof account.copyMinimumUsd === 'number' ? `$${account.copyMinimumUsd.toFixed(2)}` : 'the minimum';
  // The two plans never mix: a monthly subscriber has no 50% invoices and sees none of the 50% screens.
  const isSubscriber = planView?.model === 'subscription';
  const subscriptionRunning = Boolean(planView?.subscription?.active);
  const hasPendingShare = !isSubscriber && (account.unpaidProfitShareUsdt || 0) > 0;
  const openTrades = trades.filter((t) => t.status === 'OPEN');
  const openTradesCount = Math.max(openTrades.length, openReported);
  const openDetailsMissing = openReported > openTrades.length;
  const floatingPnl = openTrades.reduce((acc, trade) => acc + (trade.pnl || 0), 0);

  const shareNavItem: NavGroup['items'][number] = {
    id: 'settlement_due',
    label: '50% Profit Share',
    icon: Wallet,
    badge: hasPendingShare ? `$${(account.unpaidProfitShareUsdt || 0).toFixed(0)} Due` : 'Settled',
    badgeVariant: hasPendingShare ? 'warning' : 'success',
  };

  // Streamlined collapsible sidebar navigation: clean, responsive, with Profile & 50% Share
  const navGroups: NavGroup[] = [
    {
      groupTitle: 'Trading',
      items: [
        {
          id: 'overview',
          label: 'Dashboard',
          icon: Cpu,
        },
        {
          id: 'plan',
          label: 'Service Plan',
          icon: Wallet,
          badge: planView?.model ? (planView.model === 'subscription' ? 'Monthly' : '50% Share') : planView?.available ? 'Choose' : undefined,
          badgeVariant: planView?.model ? 'success' : 'warning',
        },
        {
          id: 'positions',
          label: 'Active Trades',
          icon: Activity,
          badge: openTradesCount > 0 ? openTradesCount : undefined,
          badgeVariant: 'success',
        },
        {
          id: 'history',
          label: 'Trade History',
          icon: History,
        },
      ],
    },
    {
      groupTitle: 'More',
      items: [
        ...(isSubscriber ? [] : [shareNavItem]),
        {
          id: 'profile',
          label: 'Profile',
          icon: ShieldCheck,
        },
      ],
    },
  ];

  return (
    <div className="flex flex-col lg:flex-row items-start gap-1 lg:gap-6 max-w-7xl mx-auto pb-12">
      {/* Clean, Minimal Sidebar Navigation */}
      <SidebarNav
        groups={navGroups}
        activeId={activeSection}
        onSelect={setActiveSection}
        title="Castimo Terminal"
        subtitle={isConnected ? `MT5 #${account.accountNumber}` : 'Not Connected'}
        accentColor="emerald"
        statusBadge={{
          text: copyHeld ? 'Connected · Not copying' : isConnected ? 'Mirroring Live' : isBlockedUnpaid ? 'Unpaid' : 'Disconnected',
          variant: copyHeld ? 'warning' : isConnected ? 'success' : isBlockedUnpaid ? 'danger' : 'warning',
          pulsing: isConnected && !copyHeld,
        }}
      />

      {/* Main Content Area */}
      <div className="flex-1 w-full space-y-4 sm:space-y-6 min-w-0">
        {/* Section banner with its own illustration + Notification Center (the overview shows the welcome banner instead) */}
        {activeSection !== 'overview' && (() => {
          const label = navGroups.flatMap((g) => g.items).find((i) => i.id === activeSection)?.label || 'Castimo FX Terminal';
          const looks: Record<string, { tone: Tone; art: ArtName; subtitle: string }> = {
            plan: { tone: 'violet', art: 'medal', subtitle: 'Choose or manage how you pay for Castimo.' },
            positions: { tone: 'aqua', art: 'radar', subtitle: 'The trades being mirrored to your account right now.' },
            history: { tone: 'royal', art: 'clock', subtitle: 'Your closed trades, newest first.' },
            profile: { tone: 'magenta', art: 'badge', subtitle: 'Your account details.' },
            settlement_due: { tone: 'gold', art: 'coins', subtitle: 'Your profit-share invoice.' },
          };
          const look = looks[activeSection] || { tone: 'royal' as Tone, art: undefined, subtitle: readingBalance ? 'MT5 connected. Reading your balance…' : copyHeld ? 'MT5 connected. Copying starts once your account has the minimum.' : isConnected ? 'MT5 trade mirroring active' : '' };
          return (
            <SectionBanner
              tone={look.tone}
              art={look.art}
              title={label}
              subtitle={look.subtitle}
              chip={isConnected ? `#${account.accountNumber}` : 'NOT CONNECTED'}
              right={
                <NotificationCenter
                  onOpenSettlements={() => setShowSettlementModal(true)}
                  onOpenReferrals={onNavigateToReferrals}
                  onOpenPayment={() => setShowPaymentModal(true)}
                />
              }
            />
          );
        })()}

        {/* Monthly subscribers: only their own plan's notice is ever shown */}
        {isSubscriber && !subscriptionRunning && activeSection !== 'plan' && (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h4 className="font-bold text-sm text-amber-600 dark:text-amber-300">
                {planView?.subscription ? 'Your monthly subscription has ended' : 'Your monthly subscription is not paid yet'}
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                Pay ${planView?.price.subscriptionUsdt ?? 100} USDT (TRC20) to {planView?.subscription ? 'resume' : 'start'} copying. Once paid, you owe nothing on your profits.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveSection('plan')}
              className="btn-gold px-4 py-2 rounded-xl font-bold text-xs shrink-0 cursor-pointer"
            >
              Go to payment
            </button>
          </div>
        )}

        {/* Connected, but below the minimum equity: said kindly, with what happens next */}
        {copyHeld && (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 animate-in fade-in">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold text-sm text-amber-600 dark:text-amber-300">{readingBalance ? 'Connected. Reading your balance…' : 'Connected, but not copying yet'}</h4>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                {readingBalance
                  ? 'Your broker accepted the login. The copier reports your balance within about 5 minutes, and copying starts by itself as soon as it does. There is nothing else to do.'
                  : account.copyHeld === 'currency'
                  ? 'Your account is connected, but right now we can only copy to accounts held in US dollars (USD).'
                  : <>Your account is safely connected. Trades from the master account start copying as soon as your account equity reaches {copyMinText}
                {' '}(it is ${account.equity.toFixed(2)} now). Add funds at your broker whenever you are ready: there is nothing else to do, we start copying by ourselves.</>}
              </p>
            </div>
          </div>
        )}

        {/* Unpaid profit share: copying is paused */}
        {!isSubscriber && isBlockedUnpaid && isConnected && (
          <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xl animate-in fade-in">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-sm text-rose-300">
                  Copying paused: profit share unpaid
                </h4>
                <p className="text-xs text-rose-200/90 mt-0.5">
                  Pay ${(account.unpaidProfitShareUsdt || 0).toFixed(2)} USDT to resume copying.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowPaymentModal(true)}
              className="btn-gold px-4 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Wallet className="w-4 h-4" />
              <span>Pay ${(account.unpaidProfitShareUsdt || 0).toFixed(2)} USDT</span>
            </button>
          </div>
        )}

        {/* ========================================================
            SUB-SECTION 1: SUMMARISED ESSENTIALS DASHBOARD
            ======================================================== */}
        {activeSection === 'plan' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <ServicePlanPage onChanged={refreshPlan} />
          </div>
        )}

        {activeSection === 'overview' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* 1. WELCOME BANNER: who you are, where things stand, what to do next (all real status) */}
            <WelcomeHero
              name={(userProfile?.displayName || 'Trader').split(' ')[0]}
              state={isConnected ? 'connected' : pending?.kind === 'working' ? 'connecting' : pending?.kind === 'failed' ? 'failed' : 'disconnected'}
              headline={
                copyHeld
                  ? 'Connected, not copying yet'
                  : isConnected
                  ? 'Your account is mirroring trades'
                  : pending?.kind === 'working'
                    ? 'Your MT5 terminal is connecting'
                    : pending?.kind === 'failed'
                      ? 'We could not finish connecting'
                      : 'Ready to start copying'
              }
              detail={
                copyHeld
                  ? `MT5 #${account.accountNumber} is linked. Copying starts as soon as your account equity reaches ${copyMinText}.`
                  : isConnected
                  ? `MT5 #${account.accountNumber}${account.brokerName || account.brokerServer ? ` · ${account.brokerName || account.brokerServer}` : ''} is linked and copying.`
                  : pending?.kind === 'working'
                    ? 'This updates by itself as soon as your account is ready. You do not need to keep this page open.'
                    : pending?.kind === 'failed'
                      ? 'You can try again whenever you are ready.'
                      : 'Connect your MT5 login and broker server to begin.'
              }
              chips={[
                isConnected
                  ? { label: `MT5 #${account.accountNumber}`, pulse: true }
                  : pending?.kind === 'working'
                    ? { label: 'Connecting…', pulse: true }
                    : { label: 'Not connected' },
                ...(isConnected && account.isBrokerVerified ? [{ label: 'Broker verified' }] : []),
                ...(copyHeld ? [{ label: 'Not copying yet' }] : []),
                ...(isConnected && account.connectionState === 'RECONNECTING' ? [{ label: 'Reconnecting…' }] : []),
                ...(isConnected && account.connectionState === 'ERROR' ? [{ label: 'Link problem' }] : []),
                ...(planView
                  ? [
                      planView.model === 'subscription'
                        ? { label: subscriptionRunning ? `Monthly plan · ${planView.subscription?.daysLeft ?? 0}d left` : 'Monthly plan · not active' }
                        : planView.model === 'profit_share'
                          ? { label: '50% Profit Share' }
                          : planView.available
                            ? { label: 'No plan chosen yet' }
                            : null,
                    ].filter(Boolean) as Array<{ label: string }>
                  : []),
              ]}
              primary={
                isConnected
                  ? { label: 'Manage account', onClick: () => setShowDisconnectModal(true), icon: <Power className="w-4 h-4" /> }
                  : pending?.kind === 'working'
                    ? undefined
                    : { label: pending?.kind === 'failed' ? 'Try again' : 'Connect MT5', onClick: openConnect, icon: <Server className="w-4 h-4" /> }
              }
              secondary={planView?.available ? { label: 'Service plan', onClick: () => setActiveSection('plan') } : undefined}
              topRight={
                <NotificationCenter
                  onOpenSettlements={() => setShowSettlementModal(true)}
                  onOpenReferrals={onNavigateToReferrals}
                  onOpenPayment={() => setShowPaymentModal(true)}
                />
              }
            />

            {/* 2. LIVE ACCOUNT FIGURES (real broker data; hidden until an account is linked) */}
            {(isConnected || isUserAdmin) && (
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
                <StatCard tone="royal" art="coins" icon={<Wallet className="w-5 h-5" />} label="Balance" value={account.balance} />
                <StatCard
                  tone="violet"
                  art="gem"
                  icon={<TrendingUp className="w-5 h-5" />}
                  label="Equity"
                  value={account.equity}
                  footer={
                    isConnected ? (
                      <button
                        type="button"
                        onClick={async () => {
                          setIsSavingEquity(true);
                          try {
                            await tradingEngine.refreshAccountFromBroker();
                          } finally {
                            setIsSavingEquity(false);
                          }
                        }}
                        className="inline-flex items-center gap-1 font-bold text-violet-600 dark:text-violet-300 hover:underline cursor-pointer"
                        title="Re-read balance and equity from your broker"
                      >
                        <RefreshCw className={`w-3 h-3 ${isSavingEquity ? 'animate-spin' : ''}`} />
                        {isSavingEquity ? 'Refreshing…' : 'Refresh from broker'}
                      </button>
                    ) : undefined
                  }
                />
                <StatCard
                  tone="aqua"
                  art="shield"
                  icon={<Shield className="w-5 h-5" />}
                  label="Free margin"
                  value={account.freeMargin}
                  share={account.equity > 0 ? account.freeMargin / account.equity : null}
                  footer={account.equity > 0 ? 'Share of your equity that is free' : undefined}
                />
                <StatCard
                  tone={floatingPnl >= 0 ? 'mint' : 'ruby'}
                  art="orbit"
                  icon={<Activity className="w-5 h-5" />}
                  label="Floating P/L"
                  value={floatingPnl}
                  signed
                  valueClass={floatingPnl >= 0 ? '!text-emerald-600 dark:!text-emerald-300' : '!text-rose-600 dark:!text-rose-300'}
                  footer={`${openTradesCount} open trade${openTradesCount === 1 ? '' : 's'}`}
                />
              </div>
            )}

            {/* 3. YOUR PLAN AT A GLANCE (clients only: an admin account has no plan to show) */}
            {!isUserAdmin && (
            <div>
              <div
                className="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-white dark:bg-slate-900 p-4 sm:p-6 border border-transparent"
                style={{ ['--rim-accent' as string]: '168,85,247' }}
              >
                <div aria-hidden className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-gradient-to-br from-fuchsia-400 via-violet-500 to-indigo-500 opacity-35 bloom" />
                {planView === undefined ? (
                  <div className="relative flex items-center gap-4">
                    <div className="w-24 h-24 rounded-full shimmer" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-1/2 rounded-full shimmer" />
                      <div className="h-3 w-2/3 rounded-full shimmer" />
                    </div>
                  </div>
                ) : (
                  <div className="relative flex items-center gap-3 sm:gap-5">
                    {isSubscriber ? (
                      <ProgressRing value={(planView?.subscription?.daysLeft ?? 0) / (planView?.price.periodDays || 30)} size={92}>
                        <AnimatedNumber value={planView?.subscription?.daysLeft ?? 0} decimals={0} prefix="" className="font-display font-extrabold text-2xl text-slate-900 dark:text-white" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">days left</span>
                      </ProgressRing>
                    ) : (
                      (() => {
                        const PlanArt = hasPendingShare ? ART.clock : ART.medal;
                        return <PlanArt size={96} className="shrink-0 animate-float-a w-16 h-16 sm:w-24 sm:h-24" />;
                      })()
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Your plan</div>
                      <div className="font-display font-extrabold text-lg sm:text-xl text-slate-900 dark:text-white mt-0.5">
                        {isSubscriber ? 'Monthly Subscription' : planView?.model === 'profit_share' ? '50% Profit Share' : planView?.available ? 'No plan chosen yet' : 'Service plan'}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                        {isSubscriber
                          ? subscriptionRunning
                            ? 'Active. Nothing is owed on your profits while it runs.'
                            : 'Not active. Pay for the plan to resume copying.'
                          : planView?.model === 'profit_share'
                            ? hasPendingShare
                              ? `$${(account.unpaidProfitShareUsdt || 0).toFixed(2)} USDT is due on your latest invoice.`
                              : 'All settled. You pay 50% of new profit only.'
                            : planView?.available
                              ? 'Choose Monthly or 50% Profit Share to get started.'
                              : 'Open the plan page to see how you pay.'}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {hasPendingShare && (
                          <button
                            type="button"
                            onClick={() => setShowPaymentModal(true)}
                            className="btn-gold px-4 py-2 rounded-xl font-extrabold text-xs cursor-pointer"
                          >
                            Pay ${(account.unpaidProfitShareUsdt || 0).toFixed(2)} USDT
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setActiveSection('plan')}
                          className="px-4 py-2 rounded-xl bg-violet-500/10 hover:bg-violet-500/20 text-violet-700 dark:text-violet-200 font-bold text-xs transition cursor-pointer"
                        >
                          {planView?.model ? 'Manage plan' : planView?.available ? 'Choose plan' : 'Open plan page'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            )}

            {/* 2. COMPACT AI TRADING ASSISTANT (ESSENTIAL CENTERPIECE OF AI DASHBOARD) */}
            {!planChosen && !isConnected && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs">Choose a service plan (Monthly or 50% Profit Share) before connecting your MT5 account.</p>
                <button
                  type="button"
                  onClick={() => setActiveSection('plan')}
                  className="btn-gold px-3.5 py-1.5 rounded-xl font-bold text-xs shrink-0 cursor-pointer"
                >
                  Choose plan
                </button>
              </div>
            )}
            {/* The server is still bringing the client's terminal up: said calmly, nothing for the client to do */}
            {!isConnected && pending?.kind === 'working' && (
              <div
                className="p-4 rounded-2xl bg-gradient-to-r from-blue-950/40 via-slate-900 to-slate-900 border border-blue-500/30 text-white flex items-start gap-3 shadow-md animate-in fade-in"
                aria-live="polite"
              >
                <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/40 flex items-center justify-center text-blue-300 shrink-0 shadow-inner">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                </div>
                <div className="min-w-0">
                  <h4 className="font-bold text-sm text-white">Your MT5 terminal is connecting</h4>
                  <p className="text-xs text-slate-300 mt-0.5">{pending.label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {pendingNote(pending)} You do not need to keep this page open: it updates by itself as soon as your account is ready.
                  </p>
                  {pendingAccountLine(pending) && (
                    <p className="text-[11px] text-slate-500 font-mono mt-1 break-all">{pendingAccountLine(pending)}</p>
                  )}
                </div>
              </div>
            )}

            {/* The server could not finish the connection: said kindly, with one clear next step */}
            {!isConnected && pending?.kind === 'failed' && (
              <div className="p-4 rounded-2xl bg-gradient-to-r from-rose-950/30 via-slate-900 to-slate-900 border border-rose-500/30 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-md animate-in fade-in">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/40 flex items-center justify-center text-rose-300 shrink-0 shadow-inner">
                    <AlertCircle className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-sm text-white">We could not finish connecting your account</h4>
                    <p className="text-xs text-slate-300 mt-0.5">
                      {pending.error?.message || 'Your trading terminal did not connect in time.'}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">{pendingNote(pending)}</p>
                    {pendingAccountLine(pending) && (
                      <p className="text-[11px] text-slate-500 font-mono mt-1 break-all">{pendingAccountLine(pending)}</p>
                    )}
                    {pending.error?.ref && (
                      <p className="text-[10px] text-slate-600 font-mono mt-0.5">Reference: {pending.error.ref}</p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={openConnect}
                  className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 cursor-pointer shrink-0"
                >
                  <Server className="w-4 h-4" />
                  <span>Try again</span>
                </button>
              </div>
            )}

            {/* Performance charts: drawn only from your real trades, absent until there are some */}
            <TradePerformance trades={trades} />

            <RobotConsole />

            {/* 4. QUICK ACTIONS: each with its own illustration; spans are arranged so the last row is never left with a hole */}
            {(() => {
              const actions: Array<{ tone: Tone; art: ArtName; icon: React.ReactNode; title: string; hint: string; onClick: () => void }> = [
                { tone: 'violet', art: 'medal', icon: <Wallet className="w-5 h-5" />, title: 'Service plan', hint: 'Choose or manage how you pay', onClick: () => setActiveSection('plan') },
                { tone: 'aqua', art: 'radar', icon: <Activity className="w-5 h-5" />, title: 'Active trades', hint: 'See what is being mirrored now', onClick: () => setActiveSection('positions') },
                { tone: 'royal', art: 'clock', icon: <History className="w-5 h-5" />, title: 'Trade history', hint: 'Review your closed trades', onClick: () => setActiveSection('history') },
                ...(onNavigateToReferrals
                  ? [{ tone: 'ruby' as Tone, art: 'network' as ArtName, icon: <Share2 className="w-5 h-5" />, title: 'Referral Hub', hint: 'Earn across three levels', onClick: onNavigateToReferrals }]
                  : []),
                { tone: 'magenta', art: 'badge', icon: <ShieldCheck className="w-5 h-5" />, title: 'Profile', hint: 'Your account details', onClick: () => setActiveSection('profile') },
              ];
              const n = actions.length;
              const xlSpan = (i: number) => (n === 5 ? (i < 3 ? 'xl:col-span-2' : 'xl:col-span-3') : n === 4 ? 'xl:col-span-3' : 'xl:col-span-2');
              const smSpan = (i: number) => (n % 2 === 1 && i === n - 1 ? 'col-span-2' : '');
              return (
                <div className="grid grid-cols-2 xl:grid-cols-6 gap-2.5 sm:gap-4">
                  {actions.map((a, i) => (
                    <ActionCard key={a.title} {...a} className={`${smSpan(i)} ${xlSpan(i)}`} />
                  ))}
                </div>
              );
            })()}

            {/* 5. RECENT ACTIVITY (your real mirrored trades; nothing is shown until there are some) */}
            {trades.length > 0 && (
              <div className="rounded-2xl sm:rounded-3xl bg-white dark:bg-slate-900 p-4 sm:p-6 border border-transparent" style={{ ['--rim-accent' as string]: '79,125,255' }}>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="font-display font-extrabold text-base text-slate-900 dark:text-white">Recent activity</h3>
                  <button type="button" onClick={() => setActiveSection('history')} className="text-xs font-bold text-blue-600 dark:text-sky-300 hover:underline cursor-pointer">
                    View all
                  </button>
                </div>
                <ul className="space-y-1.5">
                  {[...trades]
                    .sort((a, b) => Date.parse(b.openTime) - Date.parse(a.openTime))
                    .slice(0, 4)
                    .map((t) => (
                      <li key={t.id} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-indigo-500/[0.06] transition">
                        <IconTile tone={t.direction === 'BUY' ? 'mint' : t.direction === 'SELL' ? 'ruby' : 'mint'} size="w-9 h-9">
                          {t.direction === 'BUY' ? <ArrowUpRight className="w-4 h-4" /> : t.direction === 'SELL' ? <ArrowDownRight className="w-4 h-4" /> : <Activity className="w-4 h-4" />}
                        </IconTile>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-slate-900 dark:text-white">{t.symbol}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {t.direction ? `${t.direction} · ` : ''}{t.volume} lots · {t.status === 'OPEN' ? 'Open' : 'Closed'}
                          </div>
                        </div>
                        <div className={`font-mono text-sm font-extrabold ${(t.pnl || 0) >= 0 ? '!text-emerald-600 dark:!text-emerald-300' : '!text-rose-600 dark:!text-rose-300'}`}>
                          {(t.pnl || 0) >= 0 ? '+' : ''}${(t.pnl || 0).toFixed(2)}
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ========================================================
            SUB-SECTION 2: ACTIVE COPIED POSITIONS (FULL TABLE)
            ======================================================== */}
        {activeSection === 'positions' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 pb-1 px-1">
              <div className="flex flex-wrap items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Live Mirrored Positions</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {openTradesCount} Active
                </span>
              </div>
              <span className="text-[11px] text-slate-500 font-mono">
                Terminal: #{account.accountNumber}{account.leverage ? ` • 1:${account.leverage}` : ''}
              </span>
            </div>

            {tradesNotice && (
              <div role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{tradesNotice}</div>
            )}
            {openDetailsMissing && (
              <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                You have {openReported} open trade{openReported === 1 ? '' : 's'} right now. The details (symbol, size and profit) aren't available yet and will appear here as soon as they are.
              </div>
            )}
            <TradeCopierTable trades={trades} />
          </div>
        )}

        {/* ========================================================
            SUB-SECTION 3: EXECUTED TRADE HISTORY
            ======================================================== */}
        {activeSection === 'history' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 pb-1 px-1">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Executed Trade History Log</h3>
              </div>
              <span className="text-[11px] text-slate-500 font-mono">
                Terminal: #{account.accountNumber}
              </span>
            </div>

            {tradesNotice && (
              <div role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{tradesNotice}</div>
            )}
            <TradeHistory accountNumber={account.accountNumber} limit={15} />
          </div>
        )}

        {/* ========================================================
            SUB-SECTION 4: 50% PROFIT SHARE & TRANSACTION HASH VERIFICATION
            ======================================================== */}
        {activeSection === 'settlement_due' && !isSubscriber && (
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* Header Card */}
            <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3 sm:space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500 dark:text-amber-400 shrink-0 shadow-inner">
                    <Wallet className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                      <span>Profit share</span>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border font-bold ${
                        hasPendingShare
                          ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                          : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                      }`}>
                        {hasPendingShare ? 'DUE NOW' : 'ALL SETTLED'}
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      50% of new profit · paid in USDT (TRC20)
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    Terminal: #{account.accountNumber}
                  </span>
                </div>
              </div>

              {/* Dues KPI Overview */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                <div className="p-3 sm:p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 font-mono min-w-0">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-sans">Share due</span>
                  <span className="text-base sm:text-xl break-words font-bold text-amber-500 dark:text-amber-400 mt-1 block">
                    ${(account.unpaidProfitShareUsdt || 0).toFixed(2)} USDT
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    {hasPendingShare ? 'Payment needed' : 'Nothing due'}
                  </span>
                </div>

                <div className="p-3 sm:p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 font-mono min-w-0">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-sans">Time to pay</span>
                  <span className="text-base font-bold text-slate-800 dark:text-slate-200 mt-1 sm:mt-2 block">
                    {hasPendingShare ? countdownText : '—'}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    Copying pauses if unpaid after 24h
                  </span>
                </div>

                <div className="p-3 sm:p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 font-mono col-span-2 sm:col-span-1">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-sans">Network</span>
                  <span className="text-base font-bold text-emerald-600 dark:text-emerald-400 mt-1 sm:mt-2 block">
                    TRON (USDT TRC20)
                  </span>
                </div>
              </div>

              {/* Pay now: the 50% of closed-trade profit can be paid before the daily settlement */}
              {!hasPendingShare && (
                <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/30 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Ready to pay now</span>
                      <span className="text-xl font-bold font-mono text-amber-600 dark:text-amber-400 block mt-0.5">
                        {payable ? `$${payable.fee.toFixed(2)} USDT` : payableLoading ? 'Checking…' : '—'}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                        {payable
                          ? `${payable.feePct}% of $${payable.gain.toFixed(2)} new profit from ${payable.trades} closed trade${payable.trades === 1 ? '' : 's'}`
                          : 'Your closed trades since the last invoice'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void payNow()}
                      disabled={!payable?.canPay || payNowBusy}
                      className="px-4 py-2.5 rounded-xl text-sm font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                    >
                      {payNowBusy ? 'Preparing invoice…' : 'Pay my share now'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {payNowError ||
                      (payable && !payable.canPay && payable.reason) ||
                      (payable?.canPay
                        ? 'All trades are closed. Press the button to get your invoice, then pay it below.'
                        : `Payment opens when your closed-trade profit reaches ${payable?.minProfitUsd ?? 20} USD and no trade is open. Under that, copying is never paused.`)}
                  </p>
                </div>
              )}

              {/* TRC20 Receiving Address Box */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                    <span>Payment address</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">TRON only</span>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <div className="flex-1 px-3 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-300 select-all truncate">
                    {payToAddress || 'Payment address not set yet'}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCopyAddress(payToAddress)}
                    className="px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shrink-0 shadow-sm"
                  >
                    {copyFeedback ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copyFeedback ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <p className="text-[10px] text-slate-400">
                  Send TRC20 USDT only, on the TRON network. Then paste the transaction ID (TXID) from your wallet below.
                </p>
              </div>

              {/* Live Transaction Hash Input & Verification Form */}
              <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-indigo-950/40 border border-emerald-500/30 space-y-3 sm:space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <h4 className="text-sm font-semibold text-white">Verify your payment</h4>
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  Paste the 64-character transaction ID (TXID) from your wallet. We check it on the network and mark your invoice paid. Sending from an exchange such as Binance? Up to 4 USDT less than the invoice (their withdrawal fee) is accepted.
                </p>

                <form onSubmit={handleVerifyHash} className="space-y-3">
                  <div>
                    <div className="relative">
                      <CreditCard className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                      <input
                        type="text"
                        value={txHashInput}
                        onChange={(e) => setTxHashInput(e.target.value)}
                        placeholder="Transaction ID (TXID)"
                        className="w-full pl-9 pr-3 py-2.5 text-xs bg-slate-950 border border-slate-700/80 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-white placeholder-slate-500 font-mono tracking-tight"
                      />
                    </div>
                  </div>

                  {/* Verification Feedback Banner */}
                  {hashResult && (
                    <div
                      className={`p-3.5 rounded-xl text-xs flex items-start gap-2.5 animate-in fade-in ${
                        hashResult.success
                          ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-200'
                          : 'bg-rose-500/15 border border-rose-500/40 text-rose-200'
                      }`}
                    >
                      {hashResult.success ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      )}
                      <div className="space-y-1">
                        <div className="font-bold">{hashResult.message}</div>
                        {hashResult.error && (
                          <div className="text-[11px] text-rose-300">{hashResult.error}</div>
                        )}
                        {hashResult.txHash && (
                          <div className="text-[10px] font-mono text-emerald-300 break-all pt-1">
                            TXID: {hashResult.txHash}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row items-center gap-3">
                    <button
                      type="submit"
                      disabled={isVerifyingHash}
                      className="btn-gold w-full sm:w-auto px-5 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {isVerifyingHash ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Verifying…</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4" />
                          <span>Verify payment</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowPaymentModal(true)}
                      className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      <QrCode className="w-3.5 h-3.5 text-amber-400" />
                      <span>Show QR code</span>
                    </button>
                  </div>
                </form>
              </div>

              {/* Settlement History Log Table */}
              <div className="pt-2">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                    Past invoices
                  </h4>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {invoices.length}
                  </span>
                </div>

                {invoices.length === 0 ? (
                  <div className="p-6 text-center text-slate-500 text-xs rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    No invoices yet. One appears here when your account makes new profit.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 text-[10px] uppercase border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="py-2.5 px-3">Invoice</th>
                          <th className="py-2.5 px-3">Profit</th>
                          <th className="py-2.5 px-3">50% Share</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3">TXID</th>
                          <th className="py-2.5 px-3">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                        {invoices.map((inv) => (
                          <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                            <td className="py-2.5 px-3 text-white font-bold">#{inv.id}</td>
                            <td className="py-2.5 px-3 text-emerald-400 font-bold">+${inv.grossProfit.toFixed(2)}</td>
                            <td className="py-2.5 px-3 text-amber-400 font-bold">${inv.amountDueUsdt.toFixed(2)} USDT</td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                  inv.status === 'paid'
                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                }`}
                              >
                                {inv.status === 'paid' ? 'Verified Paid' : 'Pending'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-400 max-w-[180px] truncate">
                              {inv.txHash ? (
                                <span className="text-emerald-400 text-[11px]" title={inv.txHash}>
                                  {inv.txHash.slice(0, 10)}...{inv.txHash.slice(-8)}
                                </span>
                              ) : (
                                <span className="text-slate-500 italic">Awaiting submission</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                              {new Date(inv.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
            SUB-SECTION 5: CLIENT PROFILE & NATIONAL ID VERIFICATION
            ======================================================== */}
        {activeSection === 'profile' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* Profile Overview Card */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800/80 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-500 dark:text-emerald-400 font-black text-lg shadow-inner">
                    {userProfile?.displayName ? userProfile.displayName.charAt(0).toUpperCase() : 'C'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                        {userProfile?.displayName || 'Client Trader'}
                      </h3>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold">
                        CLIENT TRADER
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {userProfile?.email}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 font-mono">
                    Member since {userProfile?.createdAt ? new Date(userProfile.createdAt).toLocaleDateString([], { month: 'short', year: 'numeric' }) : ''}
                  </span>
                </div>
              </div>

              {/* Email status. Confirming it is only required before connecting an MT5 account. */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">Email</h4>
                  <p className="text-xs text-slate-500">
                    {userProfile?.email} · {isEmailVerified ? 'confirmed' : 'not confirmed yet (needed before you connect an account)'}
                  </p>
                </div>
                {!isEmailVerified && (
                  <button
                    type="button"
                    onClick={() => setShowEmailVerifyModal(true)}
                    className="btn-gold px-3 py-1.5 rounded-lg font-bold text-xs cursor-pointer shrink-0"
                  >
                    Confirm email
                  </button>
                )}
              </div>

              {/* Linked MT5 Terminal Custody Details */}
              <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">Linked MT5 Trading Terminal</h4>
                  </div>
                  <span
                    className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                      isConnected
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    {account.status.toUpperCase()}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] text-slate-500 uppercase block font-sans">MT5 Login</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white mt-0.5 block">
                      #{account.accountNumber}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] text-slate-500 uppercase block font-sans">Broker Server</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white mt-0.5 block truncate">
                      {account.brokerServer}
                    </span>
                  </div>

                  {account.leverage ? (
                    <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <span className="text-[10px] text-slate-500 uppercase block font-sans">Terminal Leverage</span>
                      <span className="text-sm font-bold text-slate-900 dark:text-white mt-0.5 block">
                        1:{account.leverage}
                      </span>
                    </div>
                  ) : null}

                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={openConnect}
                    className="px-3.5 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-medium transition cursor-pointer"
                  >
                    Change MT5 Terminal Connection
                  </button>
                  {isConnected && (
                    <button
                      type="button"
                      onClick={() => setShowDisconnectModal(true)}
                      className="btn-red border border-transparent px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
                    >
                      Disconnect MT5
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <AuthModal
        isOpen={showEmailVerifyModal}
        onClose={() => setShowEmailVerifyModal(false)}
        defaultTab="verify"
        prefillEmail={userProfile?.email}
      />

      <TermsModal
        isOpen={termsAccepted === false}
        onAccept={async () => {
          const r = await acceptTerms(userProfile?.uid || '');
          if (r.success) setTermsAccepted(true);
          return r;
        }}
      />

      {/* Modals & Dialogs (Preserved Exactly) */}
      <ProfitSharePaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        userId={userProfile?.uid || ''}
      />

      <Mt5ConnectionModal
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        userId={userProfile?.uid || ''}
      />

      <Mt5DisconnectModal
        isOpen={showDisconnectModal}
        onClose={() => setShowDisconnectModal(false)}
        userId={userProfile?.uid || ''}
      />

      <SettlementHistoryModal
        isOpen={showSettlementModal}
        onClose={() => setShowSettlementModal(false)}
        settlements={tradingEngine.getSettlements()}
        currentHwm={account.equity || 0.0}
      />

      <LedgerAuditModal
        isOpen={showLedgerModal}
        onClose={() => setShowLedgerModal(false)}
        ledger={tradingEngine.getLedger()}
        auditLogs={tradingEngine.getAuditLogs()}
      />

    </div>
  );
};
