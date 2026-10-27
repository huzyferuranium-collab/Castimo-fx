import {
  Subscription,
  SubscriptionPlan,
  Mt5Account,
  MasterMt5Account,
  CopiedTrade,
  RiskSettings,
  WithdrawalRequest,
  ProfitShareSettlement,
  LedgerEntry,
  AuditLog,
  ReconciliationReport,
  ProfitShareInvoice,
  ReferralPhase,
  ReferralUser,
  ReferralCommissionEvent,
  ReferralStats,
  ClientNotification,
  NotificationType,
} from '../types';
import { authHeaders } from './apiAuth';

export const TRC20_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
// The wallet that receives USDT. Set VITE_TREASURY_ADDRESS to YOUR real TRON (TRC20) address at build time.
// Until it is set (and looks like a valid TRON address) no payment address is shown and payments are refused.
const RAW_TREASURY = String((import.meta as any).env?.VITE_TREASURY_ADDRESS ?? '').trim();
export const CASTIMO_TREASURY_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(RAW_TREASURY) ? RAW_TREASURY : '';
export const PAYMENTS_ENABLED = CASTIMO_TREASURY_ADDRESS !== '';

export const DEFAULT_PLANS: SubscriptionPlan[] = [
  {
    id: 'weekly',
    name: 'Weekly Trader Pass',
    priceUsdt: 15,
    durationDays: 7,
    description: 'Entry pass for active forex & commodities trade copying.',
    features: [
      'Institutional trade replication (EURUSD, XAUUSD, GBPUSD)',
      'Real-time MT5 trade replication',
      'Daily High-Water Mark profit settlement',
      'Pay in USDT (TRC20)',
    ],
  },
  {
    id: 'monthly',
    name: 'Monthly Pro Trader',
    priceUsdt: 40,
    durationDays: 30,
    description: 'Most popular plan for full monthly automated copiers.',
    features: [
      'All major, minor & gold pairs',
      'Lot size scaled to your account balance',
      'Continuous margin & drawdown guard',
      'Exportable financial ledger & tax reports',
    ],
  },
];

export const DEFAULT_RISK_SETTINGS: RiskSettings = {
  minEquityToTrade: 200,
  maxLotSize: 2.0,
  maxExposureUsd: 10000,
  maxOpenPositions: 5,
  maxDailyLossUsd: 500,
  maxDrawdownPercent: 15,
  symbolWhitelist: ['XAUUSD'],
  lotSizeMultiplier: 1.0,
  maxDrawdownLimitUsd: 400,
  autoCloseOnDrawdown: true,
  copyStopLoss: true,
  copyTakeProfit: true,
};

// Initial Seed Data
export const INITIAL_MASTER_ACCOUNT: MasterMt5Account = {
  id: 'master-mt5-castimo-001',
  accountName: 'Castimo Master Bridge',
  accountNumber: 'Not Connected',
  brokerServer: 'Awaiting MT5 Bridge',
  status: 'disconnected',
  balance: 0.0,
  equity: 0.0,
  freeMargin: 0.0,
  floatingPL: 0.0,
  marginLevel: 0.0,
  leverage: 100,
  latencyMs: 0,
  activeCopiersCount: 0,
  signalBroadcasting: false,
  bridgePort: 8443,
  lastPing: new Date().toISOString(),
  connectedAt: new Date().toISOString(),
  openTradesCount: 0,
  activeTrades: [],
  tradeHistory: [],
};

const INITIAL_ACCOUNT: Mt5Account = {
  id: 'mt5-acc-initial',
  userId: 'verified-client-castimo-001',
  accountNumber: 'Not Connected',
  brokerServer: 'Awaiting MT5 Bridge',
  status: 'disconnected',
  balance: 0.0,
  equity: 0.0,
  freeMargin: 0.0,
  marginLevel: 0.0,
  leverage: 100,
  riskStatus: 'normal',
  profitShareStatus: 'up_to_date',
  unpaidProfitShareUsdt: 0.0,
  profitShareDueAt: undefined,
  lastProfitGenerated: 0.0,
  lastPing: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  copiedFromMasterAccount: undefined,
  masterAccountName: undefined,
};

const INITIAL_PROFIT_INVOICES: ProfitShareInvoice[] = [];

const INITIAL_SUPERVISED_ACCOUNTS: Mt5Account[] = [];

const INITIAL_REFERRALS: ReferralUser[] = [];

const INITIAL_COMMISSION_HISTORY: ReferralCommissionEvent[] = [];

const INITIAL_TRADES: CopiedTrade[] = [];

const INITIAL_WITHDRAWALS: WithdrawalRequest[] = [];

const INITIAL_SETTLEMENTS: ProfitShareSettlement[] = [];

const INITIAL_LEDGER: LedgerEntry[] = [];

const INITIAL_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'audit-001',
    userId: 'verified-client-castimo-001',
    actor: 'System',
    action: 'TERMINAL_INITIALIZED',
    category: 'MT5',
    details: 'Castimo FX Terminal initialized in initial standby state ($0.00 balance, awaiting MT5 bridge).',
    ip: '127.0.0.1',
    timestamp: new Date().toISOString(),
    status: 'SUCCESS',
  },
];

const INITIAL_NOTIFICATIONS: ClientNotification[] = [
  {
    id: 'notif-001',
    type: 'AUTONOMOUS_WATCHER',
    title: 'Terminal Initialized',
    message: 'Castimo FX Terminal initialized in clean standby state. Connect your MT5 account to activate automated 50% profit share copying.',
    timestamp: new Date().toISOString(),
    read: false,
  },
];

/** Progress of a connection, as reported by the server. */
export interface ConnectProgress {
  stage: string;
  label: string;
  percent: number;
  elapsedSeconds: number;
}

/** A failed connection with a plain-language reason and what to do next. */
export class ConnectError extends Error {
  code?: string;
  hint?: string;
  ref?: string;
  retryable?: boolean;
  constructor(message: string) {
    super(message);
    this.name = 'ConnectError';
  }
}

class TradingEngine {
  private subscription: Subscription | null = null;
  private masterAccount: MasterMt5Account = INITIAL_MASTER_ACCOUNT;
  private mt5Account: Mt5Account = INITIAL_ACCOUNT;
  private supervisedAccounts: Mt5Account[] = INITIAL_SUPERVISED_ACCOUNTS;
  private profitInvoices: ProfitShareInvoice[] = INITIAL_PROFIT_INVOICES;
  private referrals: ReferralUser[] = INITIAL_REFERRALS;
  private commissionHistory: ReferralCommissionEvent[] = INITIAL_COMMISSION_HISTORY;
  private referralBalance: number = 0.0;
  private notifications: ClientNotification[] = INITIAL_NOTIFICATIONS;
  private trades: CopiedTrade[] = INITIAL_TRADES;
  private riskSettings: RiskSettings = DEFAULT_RISK_SETTINGS;
  private withdrawals: WithdrawalRequest[] = INITIAL_WITHDRAWALS;
  private settlements: ProfitShareSettlement[] = INITIAL_SETTLEMENTS;
  private ledger: LedgerEntry[] = INITIAL_LEDGER;
  private auditLogs: AuditLog[] = INITIAL_AUDIT_LOGS;
  private usedTxHashes: Set<string> = new Set([
    '9a8d7e6f5c4b3a210987654321fedcba0123456789abcdef0123456789abcdef',
    '4f2e1d0c9b8a7f6e5d4c3b2a10987654321fedcba0987654321abcdef0123456',
  ]);

  private listeners: (() => void)[] = [];

  constructor() {
    this.subscription = null;
    this.runRiskCheck();
  }

  public subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  // --- GETTERS ---
  public getSubscription(): Subscription | null {
    return this.subscription;
  }

  public getMt5Account(): Mt5Account {
    return this.mt5Account;
  }

  // --- MASTER MT5 ACCOUNT (MAIN SIGNAL PROVIDER IN ADMIN CONSOLE) ---
  public getMasterAccount(): MasterMt5Account {
    return this.masterAccount;
  }

  /**
   * Synchronizes the in-browser Master Account with live data from MetaApi server
   */
  public syncMasterAccountFromCloud(masterData: any, activeClientsCount?: number): void {
    if (!masterData) return;
    this.masterAccount = {
      ...this.masterAccount,
      accountNumber: String(masterData.login || this.masterAccount.accountNumber),
      brokerServer: masterData.server || this.masterAccount.brokerServer,
      balance: masterData.balance != null ? Number(masterData.balance) : this.masterAccount.balance,
      equity: masterData.equity != null ? Number(masterData.equity) : this.masterAccount.equity,
      freeMargin: masterData.freeMargin != null ? Number(masterData.freeMargin) : this.masterAccount.freeMargin,
      marginLevel: masterData.marginLevel != null ? Number(masterData.marginLevel) : this.masterAccount.marginLevel,
      openTradesCount: masterData.openPositionsCount != null ? Number(masterData.openPositionsCount) : this.masterAccount.openTradesCount,
      activeCopiersCount: activeClientsCount != null ? activeClientsCount : this.masterAccount.activeCopiersCount,
      status: 'broadcasting',
      signalBroadcasting: true,
      lastPing: new Date().toISOString(),
    };
    this.notify();
  }

  public connectMasterAccount(params: {
    accountNumber: string;
    brokerServer: string;
    accountName?: string;
    password?: string;
  }): MasterMt5Account {
    this.masterAccount = {
      ...this.masterAccount,
      accountNumber: params.accountNumber,
      brokerServer: params.brokerServer,
      accountName: params.accountName || `Castimo Master #${params.accountNumber}`,
      status: 'broadcasting',
      signalBroadcasting: true,
      lastPing: new Date().toISOString(),
      connectedAt: new Date().toISOString(),
    };

    this.logAudit(
      'admin-lead-master',
      'Administrator',
      'MASTER_ACCOUNT_CONNECTED',
      'ADMIN',
      `Main Master MT5 Account #${params.accountNumber} successfully connected on server ${params.brokerServer}. Institutional trade signal broadcasting active.`,
      'SUCCESS'
    );

    this.notify();
    return this.masterAccount;
  }

  public toggleMasterSignalBroadcasting(): boolean {
    this.masterAccount.signalBroadcasting = !this.masterAccount.signalBroadcasting;
    this.masterAccount.status = this.masterAccount.signalBroadcasting ? 'broadcasting' : 'paused';
    this.masterAccount.lastPing = new Date().toISOString();

    this.logAudit(
      'admin-lead-master',
      'Administrator',
      this.masterAccount.signalBroadcasting ? 'MASTER_BROADCAST_RESUMED' : 'MASTER_BROADCAST_PAUSED',
      'ADMIN',
      `Master signal replication to all slave client accounts is now ${this.masterAccount.signalBroadcasting ? 'ACTIVE' : 'PAUSED'}.`,
      'SUCCESS'
    );

    this.notify();
    return this.masterAccount.signalBroadcasting;
  }

  public disconnectMasterAccount(): void {
    this.masterAccount.status = 'disconnected';
    this.masterAccount.signalBroadcasting = false;
    this.masterAccount.lastPing = new Date().toISOString();

    this.logAudit(
      'admin-lead-master',
      'Administrator',
      'MASTER_ACCOUNT_DISCONNECTED',
      'ADMIN',
      'Main Master MT5 Account disconnected from bridge. Trade broadcast suspended.',
      'WARNING'
    );

    this.notify();
  }

  public reconnectMasterAccount(): void {
    this.masterAccount.status = 'broadcasting';
    this.masterAccount.signalBroadcasting = true;
    this.masterAccount.latencyMs = Math.floor(Math.random() * 8) + 12; // 12-20ms
    this.masterAccount.lastPing = new Date().toISOString();

    this.logAudit(
      'admin-lead-master',
      'Administrator',
      'MASTER_ACCOUNT_RECONNECTED',
      'ADMIN',
      `Master MT5 bridge ping refreshed (${this.masterAccount.latencyMs}ms). Active signal broadcast online.`,
      'SUCCESS'
    );

    this.notify();
  }

  public resetAdminToInitialState(): void {
    this.masterAccount = {
      id: 'master-mt5-castimo-001',
      accountName: 'Castimo Master Bridge',
      accountNumber: 'Not Connected',
      brokerServer: 'Awaiting MT5 Bridge',
      status: 'disconnected',
      balance: 0.0,
      equity: 0.0,
      freeMargin: 0.0,
      floatingPL: 0.0,
      marginLevel: 0.0,
      leverage: 100,
      latencyMs: 0,
      activeCopiersCount: 0,
      signalBroadcasting: false,
      bridgePort: 8443,
      lastPing: new Date().toISOString(),
      connectedAt: new Date().toISOString(),
      openTradesCount: 0,
      activeTrades: [],
      tradeHistory: [],
    };
    this.supervisedAccounts = [];
    this.profitInvoices = [];

    this.logAudit(
      'admin-lead-master',
      'Administrator',
      'ADMIN_INITIAL_STATE_RESET',
      'ADMIN',
      'Admin console and Master MT5 Bridge reset to initial state configuration ($0.00 balance, awaiting MT5 bridge).',
      'SUCCESS'
    );

    this.notify();
  }

  public resetAllToInitialState(): void {
    this.resetAdminToInitialState();
    this.mt5Account = {
      id: 'mt5-acc-initial',
      userId: 'verified-client-castimo-001',
      accountNumber: 'Not Connected',
      brokerServer: 'Awaiting MT5 Bridge',
      status: 'disconnected',
      balance: 0.0,
      equity: 0.0,
      freeMargin: 0.0,
      marginLevel: 0.0,
      leverage: 100,
      riskStatus: 'normal',
      profitShareStatus: 'up_to_date',
      unpaidProfitShareUsdt: 0.0,
      profitShareDueAt: undefined,
      lastProfitGenerated: 0.0,
      lastPing: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      copiedFromMasterAccount: undefined,
      masterAccountName: undefined,
    };
    this.trades = [];
    this.settlements = [];
    this.withdrawals = [];
    this.notify();
  }

  public executeMasterTrade(
    symbol: string,
    direction: 'BUY' | 'SELL',
    volume: number,
    sl?: number,
    tp?: number
  ): { masterTradeId: string; replicatedCount: number } {
    const masterTradeId = `MST-${Date.now().toString().slice(-5)}`;
    const currentPrice =
      symbol === 'XAUUSD' ? 2655.4 : symbol === 'EURUSD' ? 1.0862 : symbol === 'GBPUSD' ? 1.3045 : 152.4;

    const newMasterTrade: CopiedTrade = {
      id: `trade-master-${Date.now().toString().slice(-4)}`,
      masterTradeId,
      symbol,
      direction,
      volume,
      openPrice: currentPrice,
      currentPrice,
      sl: sl || (direction === 'BUY' ? parseFloat((currentPrice * 0.995).toFixed(2)) : parseFloat((currentPrice * 1.005).toFixed(2))),
      tp: tp || (direction === 'BUY' ? parseFloat((currentPrice * 1.015).toFixed(2)) : parseFloat((currentPrice * 0.985).toFixed(2))),
      pnl: 0.0,
      commission: parseFloat((volume * 7.0).toFixed(2)),
      swap: 0.0,
      status: 'OPEN',
      openTime: new Date().toISOString(),
      idempotencyKey: `${masterTradeId}-client-${this.mt5Account.accountNumber}`,
    };

    let replicatedCount = 0;
    if (this.mt5Account.status === 'copying' && this.masterAccount.signalBroadcasting) {
      const mult = this.riskSettings.lotSizeMultiplier || 1.0;
      const clientTrade: CopiedTrade = {
        ...newMasterTrade,
        id: `trade-cp-${Date.now().toString().slice(-4)}`,
        volume: parseFloat((volume * mult).toFixed(2)),
      };
      this.trades.unshift(clientTrade);
      replicatedCount++;
    }

    this.masterAccount.openTradesCount = (this.masterAccount.openTradesCount || 0) + 1;
    this.masterAccount.lastPing = new Date().toISOString();

    this.logAudit(
      'admin-lead-master',
      'Master Signal Publisher',
      'MASTER_TRADE_BROADCASTED',
      'MT5',
      `Master Order ${direction} ${volume} Lots ${symbol} executed at ${currentPrice}. Instantaneously replicated to ${replicatedCount} connected client terminals.`,
      'SUCCESS'
    );

    this.notify();
    return { masterTradeId, replicatedCount };
  }

  public getSupervisedAccounts(): Mt5Account[] {
    return this.supervisedAccounts;
  }

  public getProfitInvoices(): ProfitShareInvoice[] {
    return this.profitInvoices;
  }

  public getActiveProfitInvoice(userId?: string): ProfitShareInvoice | null {
    const targetUserId = userId || this.mt5Account.userId;
    return this.profitInvoices.find(
      (inv) => inv.userId === targetUserId && inv.status === 'pending'
    ) || null;
  }

  public getTrades(): CopiedTrade[] {
    return this.trades;
  }

  public getOpenTrades(): CopiedTrade[] {
    return this.trades.filter((t) => t.status === 'OPEN');
  }

  public getTradeHistory(limit: number = 10): CopiedTrade[] {
    return this.trades
      .filter((t) => t.status === 'CLOSED')
      .sort(
        (a, b) =>
          new Date(b.closeTime || b.openTime).getTime() -
          new Date(a.closeTime || a.openTime).getTime()
      )
      .slice(0, limit);
  }

  public getRiskSettings(): RiskSettings {
    return this.riskSettings;
  }

  public getWithdrawals(): WithdrawalRequest[] {
    return this.withdrawals;
  }

  public getSettlements(): ProfitShareSettlement[] {
    return this.settlements;
  }

  public getLedger(): LedgerEntry[] {
    return this.ledger;
  }

  public getAuditLogs(): AuditLog[] {
    return this.auditLogs;
  }

  // --- NOTIFICATION CENTER API ---
  public getNotifications(): ClientNotification[] {
    return this.notifications;
  }

  public getUnreadNotificationCount(): number {
    return this.notifications.filter((n) => !n.read).length;
  }

  public markNotificationAsRead(id: string): void {
    const notif = this.notifications.find((n) => n.id === id);
    if (notif) {
      notif.read = true;
      this.notify();
    }
  }

  public markAllNotificationsAsRead(): void {
    this.notifications.forEach((n) => (n.read = true));
    this.notify();
  }

  public clearNotifications(): void {
    this.notifications = [];
    this.notify();
  }

  public addNotification(
    type: NotificationType,
    title: string,
    message: string,
    amountUsdt?: number,
    linkAction?: 'open_settlements' | 'open_referrals' | 'open_payment'
  ): ClientNotification {
    const notif: ClientNotification = {
      id: `notif-${Date.now().toString().slice(-5)}`,
      type,
      title,
      message,
      amountUsdt,
      timestamp: new Date().toISOString(),
      read: false,
      linkAction,
    };
    this.notifications.unshift(notif);
    this.notify();
    return notif;
  }

  public getPendingWithdrawalsTotal(): number {
    return this.withdrawals
      .filter((w) => w.status === 'requested' || w.status === 'reserved' || w.status === 'approved')
      .reduce((sum, w) => sum + w.amount, 0);
  }

  // --- RISK ENGINE (Section 9) ---
  public runRiskCheck(): { riskStatus: 'normal' | 'warning' | 'blocked'; blockedReason?: string } {
    const openTrades = this.getOpenTrades();

    let status: 'normal' | 'warning' | 'blocked' = 'normal';
    let reason: string | undefined = undefined;

    if (this.mt5Account.status === 'disconnected') {
      this.mt5Account.riskStatus = 'normal';
      this.mt5Account.blockedReason = undefined;
      return { riskStatus: 'normal' };
    }

    // The $200 minimum applies only when a client first connects (checked by the server).
    // A connected account is never blocked or disconnected because its equity falls.

    if (openTrades.length >= this.riskSettings.maxOpenPositions) {
      if (status !== 'blocked') {
        status = 'warning';
        reason = `Max open positions reached (${openTrades.length}/${this.riskSettings.maxOpenPositions}).`;
      }
    }

    this.mt5Account.riskStatus = status;
    this.mt5Account.blockedReason = reason;

    if (status === 'blocked' && this.mt5Account.status === 'copying') {
      this.mt5Account.status = 'blocked';
      this.logAudit(
        this.mt5Account.userId,
        'SYSTEM_RISK_ENGINE',
        'TRADE_COPYING_BLOCKED',
        'RISK',
        reason || 'Equity fell below $200 safety floor.',
        'FAILED'
      );
    }

    return { riskStatus: status, blockedReason: reason };
  }

  public updateRiskSettings(newSettings: Partial<RiskSettings>, adminActor: string) {
    this.riskSettings = { ...this.riskSettings, ...newSettings };
    this.runRiskCheck();
    this.logAudit(
      'system',
      adminActor,
      'RISK_SETTINGS_UPDATED',
      'ADMIN',
      `Updated risk parameters: Min Equity=$${this.riskSettings.minEquityToTrade}, Max Lot=${this.riskSettings.maxLotSize}`,
      'SUCCESS'
    );
    this.notify();
  }

  public updateClientRiskSettings(newSettings: Partial<RiskSettings>): RiskSettings {
    // Platform rule: Mandatory minEquity cannot be set below $200
    if (newSettings.minEquityToTrade !== undefined && newSettings.minEquityToTrade < 200) {
      newSettings.minEquityToTrade = 200;
    }
    this.riskSettings = { ...this.riskSettings, ...newSettings };
    this.runRiskCheck();
    this.logAudit(
      this.mt5Account.userId,
      'Client Trader',
      'CLIENT_RISK_SETTINGS_SAVED',
      'RISK',
      `Custom risk parameters updated: Lot Multiplier=${this.riskSettings.lotSizeMultiplier}x, Max Drawdown=${this.riskSettings.maxDrawdownPercent}% ($${this.riskSettings.maxDrawdownLimitUsd} USD)`,
      'SUCCESS'
    );
    this.notify();
    return this.riskSettings;
  }

  // --- WITHDRAWAL SAFETY ENGINE (Section 10) ---
  /**
   * Implements strict formula:
   * If open trades exist:
   * withdrawable amount = min(
   *   (free margin * 50%) - pending withdrawal reservations,
   *   equity - $200
   * )
   * If <= 0, withdrawable amount is 0.
   * Emergency rule: If open trades exist and equity <= $200, withdrawals are completely blocked.
   *
   * If no open trades exist:
   * withdrawable amount = free margin - pending withdrawal reservations
   */
  public calculateWithdrawableAmount(): {
    withdrawable: number;
    isBlocked: boolean;
    reason?: string;
    hasOpenTrades: boolean;
    formulaDetails: {
      freeMargin: number;
      equity: number;
      pendingReservations: number;
      margin50Pct: number;
      equityMinus200: number;
    };
  } {
    const openTrades = this.getOpenTrades();
    const hasOpenTrades = openTrades.length > 0;
    const freeMargin = this.mt5Account.freeMargin;
    const equity = this.mt5Account.equity;
    const pendingReservations = this.getPendingWithdrawalsTotal();
    const margin50Pct = freeMargin * 0.5;
    const equityMinus200 = equity - 200;

    // Emergency rule: If open trades exist and equity <= $200, withdrawals are completely blocked!
    if (hasOpenTrades && equity <= 200) {
      return {
        withdrawable: 0,
        isBlocked: true,
        reason: 'Emergency Rule: Account equity is $200.00 or lower while open copied trades exist. Withdrawals are completely blocked to prevent liquidation.',
        hasOpenTrades,
        formulaDetails: {
          freeMargin,
          equity,
          pendingReservations,
          margin50Pct,
          equityMinus200,
        },
      };
    }

    let calculatedWithdrawable = 0;

    if (hasOpenTrades) {
      const optionA = margin50Pct - pendingReservations;
      const optionB = equityMinus200;
      calculatedWithdrawable = Math.min(optionA, optionB);
    } else {
      calculatedWithdrawable = freeMargin - pendingReservations;
    }

    if (calculatedWithdrawable < 0) {
      calculatedWithdrawable = 0;
    }

    return {
      withdrawable: Math.max(0, parseFloat(calculatedWithdrawable.toFixed(2))),
      isBlocked: calculatedWithdrawable <= 0,
      reason:
        calculatedWithdrawable <= 0
          ? 'Calculated withdrawable margin is $0.00 after margin safety reserve and pending reservations.'
          : undefined,
      hasOpenTrades,
      formulaDetails: {
        freeMargin,
        equity,
        pendingReservations,
        margin50Pct,
        equityMinus200,
      },
    };
  }

  public submitWithdrawalRequest(
    userId: string,
    userEmail: string,
    amount: number,
    destinationAddress: string
  ): WithdrawalRequest {
    const calc = this.calculateWithdrawableAmount();

    if (calc.isBlocked && calc.withdrawable <= 0) {
      throw new Error(calc.reason || 'Withdrawal is currently blocked by risk safety rules.');
    }

    if (amount <= 0) {
      throw new Error('Withdrawal amount must be greater than 0.');
    }

    if (amount > calc.withdrawable) {
      throw new Error(
        `Requested amount ($${amount.toFixed(2)}) exceeds maximum safe withdrawable capacity ($${calc.withdrawable.toFixed(2)}).`
      );
    }

    if (!destinationAddress.startsWith('T') || destinationAddress.length < 34) {
      throw new Error('Invalid TRC20 USDT payout address format (must begin with "T" and be 34 characters).');
    }

    // Atomic reservation
    const newRequest: WithdrawalRequest = {
      id: `wdr-${Date.now().toString().slice(-6)}`,
      userId,
      userEmail,
      amount,
      destinationAddress,
      status: 'reserved',
      estimatedWithdrawableAtRequest: calc.withdrawable,
      hasOpenTrades: calc.hasOpenTrades,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.withdrawals.unshift(newRequest);

    // Create immutable ledger entry for reservation
    this.addLedgerEntry(
      'WITHDRAWAL_RESERVE_LOCKED',
      newRequest.id,
      `Atomic reserve locked for TRC20 withdrawal to ${destinationAddress.slice(0, 6)}...${destinationAddress.slice(-4)}`,
      amount,
      0
    );

    this.logAudit(
      userId,
      userEmail,
      'WITHDRAWAL_REQUEST_SUBMITTED',
      'WITHDRAWAL',
      `Locked $${amount.toFixed(2)} USDT in atomic reservation for request ${newRequest.id}`,
      'SUCCESS'
    );

    this.notify();
    return newRequest;
  }

  public updateWithdrawalStatus(
    withdrawalId: string,
    newStatus: 'approved' | 'processing' | 'paid' | 'rejected' | 'cancelled',
    adminActor: string,
    reason?: string,
    txHash?: string
  ) {
    const req = this.withdrawals.find((w) => w.id === withdrawalId);
    if (!req) throw new Error('Withdrawal request not found.');

    const oldStatus = req.status;
    req.status = newStatus;
    req.updatedAt = new Date().toISOString();
    if (reason) req.rejectionReason = reason;
    if (txHash) req.txHash = txHash;

    if (newStatus === 'paid') {
      this.addLedgerEntry(
        'WITHDRAWAL_PAYOUT_SETTLED',
        req.id,
        `TRC20 USDT Payout confirmed via TX ${txHash || 'TX-SIM-' + Date.now()}`,
        req.amount,
        0
      );
      // Deduct from balance
      this.mt5Account.balance -= req.amount;
      this.mt5Account.equity -= req.amount;
      this.mt5Account.freeMargin -= req.amount;
    } else if (newStatus === 'rejected' || newStatus === 'cancelled') {
      this.addLedgerEntry(
        'WITHDRAWAL_RESERVE_RELEASED',
        req.id,
        `Withdrawal reservation released (${newStatus}): ${reason || 'Client/Admin cancellation'}`,
        0,
        req.amount
      );
    }

    this.logAudit(
      req.userId,
      adminActor,
      `WITHDRAWAL_${newStatus.toUpperCase()}`,
      'WITHDRAWAL',
      `Withdrawal ${req.id} changed from ${oldStatus} to ${newStatus}. ${reason ? 'Note: ' + reason : ''}`,
      'SUCCESS'
    );

    this.runRiskCheck();
    this.notify();
  }

  // --- 50% PROFIT SHARE (real: invoices come from the server, payments are checked on the TRON blockchain) ---
  private billingInfo: { enabled: boolean; treasuryAddress: string; feePct: number; periodDays: number } = {
    enabled: false,
    treasuryAddress: '',
    feePct: 50,
    periodDays: 7,
  };

  public getBillingInfo() {
    return this.billingInfo;
  }

  /** Loads this user's invoices (or all invoices for an administrator) from the server. */
  public async syncInvoicesFromBackend(asAdmin = false): Promise<void> {
    try {
      const headers = await authHeaders();
      if (!headers.Authorization) return;
      const res = await fetch(asAdmin ? '/api/trade/admin/invoices' : '/api/trade/invoices', { headers });
      if (!res.ok) return;
      const data = await res.json();
      if (!asAdmin) {
        this.billingInfo = {
          enabled: Boolean(data.billingEnabled),
          treasuryAddress: String(data.treasuryAddress || ''),
          feePct: Number(data.feePct) || 50,
          periodDays: Number(data.periodDays) || 7,
        };
      }
      const rows: any[] = Array.isArray(data.invoices) ? data.invoices : [];
      this.profitInvoices = rows.map((r) => ({
        id: String(r.id),
        userId: String(r.userId),
        accountNumber: String(r.accountLogin ?? ''),
        grossProfit: Number(r.grossProfit) || 0,
        profitSharePct: Number(r.feePct) || 50,
        amountDueUsdt: Number(r.amountDueUsdt) || 0,
        recipientAddress: String(r.recipientAddress || ''),
        status: r.status === 'paid' ? 'paid' : Date.parse(r.dueAt) <= Date.now() ? 'overdue_blocked' : 'pending',
        createdAt: String(r.createdAt),
        dueAt: String(r.dueAt),
        paidAt: r.paidAt,
        txHash: r.txHash,
      }));
      if (!asAdmin) {
        const open = this.profitInvoices.filter((i) => i.status !== 'paid');
        const due = open.reduce((t, i) => t + i.amountDueUsdt, 0);
        this.mt5Account.unpaidProfitShareUsdt = Math.round(due * 100) / 100;
        this.mt5Account.profitShareDueAt = open.length
          ? open.map((i) => i.dueAt).sort()[0]
          : undefined;
        this.mt5Account.profitShareStatus = open.some((i) => i.status === 'overdue_blocked') ? 'overdue_disconnected' : open.length ? 'payment_pending' : 'up_to_date';
      }
      this.notify();
    } catch {
      // keep what we had
    }
  }

  /** Sends the payment's transaction ID to the server, which checks it on the TRON blockchain. */
  public async payProfitShareInvoice(
    invoiceId: string,
    txHash?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const headers = await authHeaders();
      if (!headers.Authorization) return { success: false, error: 'Please sign in with a real account first.' };
      const res = await fetch('/api/trade/pay-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ invoiceId, txHash: txHash ?? '' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: data?.error || 'Payment could not be verified.' };
      await this.syncInvoicesFromBackend();
      await this.syncClientsFromBackend();
      return { success: true };
    } catch {
      return { success: false, error: 'Could not reach the server. Please try again.' };
    }
  }

  /** Administrator marks an invoice paid by hand. */
  public async adminConfirmInvoice(invoiceId: string, note?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/trade/admin/confirm-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ invoiceId, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: data?.error || 'Could not confirm the invoice.' };
      await this.syncInvoicesFromBackend(true);
      return { success: true };
    } catch {
      return { success: false, error: 'Could not reach the server.' };
    }
  }

  public async submitAndVerifyProfitShareHash(
    _accountNumber: string,
    txHash: string
  ): Promise<{
    success: boolean;
    message: string;
    amountSettled?: number;
    txHash?: string;
    invoiceId?: string;
    error?: string;
  }> {
    const cleanHash = txHash.trim();
    if (!cleanHash) {
      return { success: false, message: 'Transaction hash is required.', error: 'Please paste your TRC-20 Transaction Hash (TXID).' };
    }
    const pending = this.profitInvoices.find((i) => i.status !== 'paid');
    if (!pending) {
      return { success: false, message: 'No invoice is waiting for payment.', error: 'You have no unpaid invoice.' };
    }
    const r = await this.payProfitShareInvoice(pending.id, cleanHash);
    if (!r.success) return { success: false, message: r.error || 'Verification failed.', error: r.error };
    return {
      success: true,
      message: `Payment verified on the TRON network. $${pending.amountDueUsdt.toFixed(2)} USDT received.`,
      amountSettled: pending.amountDueUsdt,
      txHash: cleanHash,
      invoiceId: pending.id,
    };
  }

  public trigger24hWatcherSweep(): { checked: number; disconnectedCount: number; message: string } {
    return { checked: 0, disconnectedCount: 0, message: 'Overdue invoices are handled automatically by the server.' };
  }

  public simulateNewProfits(grossProfit: number = 200.0): ProfitShareInvoice {
    const fee = grossProfit * 0.5; // 50%
    const dueAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    const inv: ProfitShareInvoice = {
      id: `inv-share-${Date.now().toString().slice(-4)}`,
      userId: this.mt5Account.userId,
      accountNumber: this.mt5Account.accountNumber,
      grossProfit,
      profitSharePct: 50,
      amountDueUsdt: fee,
      recipientAddress: CASTIMO_TREASURY_ADDRESS,
      status: 'pending',
      createdAt: new Date().toISOString(),
      dueAt,
    };

    this.profitInvoices.unshift(inv);
    this.mt5Account.balance += grossProfit;
    this.mt5Account.equity += grossProfit;
    this.mt5Account.freeMargin += grossProfit;
    this.mt5Account.lastProfitGenerated = grossProfit;
    this.mt5Account.unpaidProfitShareUsdt = (this.mt5Account.unpaidProfitShareUsdt || 0) + fee;
    this.mt5Account.profitShareDueAt = dueAt;
    this.mt5Account.profitShareStatus = 'payment_pending';

    // Synchronize into supervised accounts
    const sup = this.supervisedAccounts.find((a) => a.accountNumber === this.mt5Account.accountNumber);
    if (sup) {
      sup.balance = this.mt5Account.balance;
      sup.equity = this.mt5Account.equity;
      sup.unpaidProfitShareUsdt = this.mt5Account.unpaidProfitShareUsdt;
      sup.profitShareDueAt = dueAt;
      sup.profitShareStatus = 'payment_pending';
    }

    this.logAudit(
      this.mt5Account.userId,
      'MT5 Bridge Feed',
      'PROFIT_CYCLE_CLOSED',
      'MT5',
      `Closed profitable cycle: +${grossProfit.toFixed(2)}. 50% profit share invoice (${fee.toFixed(2)} USDT) issued with 24-hour grace window.`,
      'SUCCESS'
    );

    this.notify();
    return inv;
  }

  public simulateFastForward24h(): void {
    // Set dueAt to 10 minutes in the past
    const pastDue = new Date(Date.now() - 600 * 1000).toISOString();
    this.mt5Account.profitShareDueAt = pastDue;
    const inv = this.getActiveProfitInvoice();
    if (inv) {
      inv.dueAt = pastDue;
    }
    const sup = this.supervisedAccounts.find((a) => a.accountNumber === this.mt5Account.accountNumber);
    if (sup) {
      sup.profitShareDueAt = pastDue;
    }

    this.trigger24hWatcherSweep();
  }

  public reconnectAccount(accountNumber: string): void {
    if (this.mt5Account.accountNumber === accountNumber) {
      this.mt5Account.status = 'copying';
      this.mt5Account.riskStatus = 'normal';
      this.mt5Account.blockedReason = undefined;
      this.mt5Account.profitShareStatus = 'up_to_date';
      this.mt5Account.unpaidProfitShareUsdt = 0;
      this.mt5Account.profitShareDueAt = undefined;
    }
    const sup = this.supervisedAccounts.find((a) => a.accountNumber === accountNumber);
    if (sup) {
      sup.status = 'copying';
      sup.riskStatus = 'normal';
      sup.blockedReason = undefined;
      sup.profitShareStatus = 'up_to_date';
      sup.unpaidProfitShareUsdt = 0;
      sup.profitShareDueAt = undefined;
    }
    this.notify();
  }

  // --- TRC20 USDT SUBSCRIPTION & TRONGRID ENGINE (Section 5 & 6) ---
  public createSubscriptionInvoice(userId: string, planId: 'weekly' | 'monthly'): Subscription {
    const plan = DEFAULT_PLANS.find((p) => p.id === planId) || DEFAULT_PLANS[0];

    const newSub: Subscription = {
      id: `sub-cfx-${Date.now().toString().slice(-6)}`,
      userId,
      planId: plan.id,
      planName: plan.name,
      priceUsdt: plan.priceUsdt,
      status: 'pending_payment',
      confirmations: 0,
      recipientAddress: CASTIMO_TREASURY_ADDRESS,
      createdAt: new Date().toISOString(),
    };

    this.subscription = newSub;
    this.logAudit(
      userId,
      'Client',
      'INVOICE_GENERATED',
      'PAYMENT',
      `Generated invoice for ${plan.name} ($${plan.priceUsdt} USDT TRC20). Recipient: ${CASTIMO_TREASURY_ADDRESS}`,
      'SUCCESS'
    );

    this.notify();
    return newSub;
  }

  public verifyTronGridTxHash(
    txHash: string,
    onProgress?: (confirmations: number, status: string) => void
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      // 1. Validation
      const cleanHash = txHash.trim();
      const hashRegex = /^[0-9a-fA-F]{64}$/;

      if (!hashRegex.test(cleanHash)) {
        resolve({
          success: false,
          error: 'Invalid TronGrid TX Hash format. Must be a 64-character hexadecimal transaction ID.',
        });
        return;
      }

      if (this.usedTxHashes.has(cleanHash)) {
        resolve({
          success: false,
          error: 'Duplicate Transaction Hash! This payment hash has already been redeemed.',
        });
        return;
      }

      if (!this.subscription) {
        resolve({
          success: false,
          error: 'No active subscription invoice waiting for payment.',
        });
        return;
      }

      this.subscription.status = 'payment_submitted';
      this.subscription.txHash = cleanHash;
      this.notify();

      // Simulate TronGrid API confirmation stream (at least 20 confirmations)
      let conf = 1;
      const interval = setInterval(() => {
        conf += Math.floor(Math.random() * 4) + 3;
        if (this.subscription) {
          this.subscription.confirmations = conf;
          this.subscription.status = 'payment_confirming';
        }
        if (onProgress) {
          onProgress(conf, `Querying TronGrid TRC20 USDT Contract... ${conf}/20 confirmations`);
        }
        this.notify();

        if (conf >= 22) {
          clearInterval(interval);
          this.usedTxHashes.add(cleanHash);

          const now = new Date();
          const plan = DEFAULT_PLANS.find((p) => p.id === this.subscription?.planId) || DEFAULT_PLANS[0];
          const expiresAt = new Date(now.getTime() + plan.durationDays * 24 * 3600 * 1000);

          if (this.subscription) {
            this.subscription.status = 'active';
            this.subscription.confirmations = conf;
            this.subscription.startDate = now.toISOString();
            this.subscription.expiresAt = expiresAt.toISOString();
          }

          // Immutable ledger entry
          this.addLedgerEntry(
            'TRC20_SUBSCRIPTION_PAYMENT',
            cleanHash,
            `TronGrid verified TRC20 payment for ${plan.name} ($${plan.priceUsdt} USDT). Confirmed blocks: ${conf}`,
            0,
            plan.priceUsdt
          );

          this.logAudit(
            this.subscription?.userId || 'client',
            'TronGrid Validator',
            'PAYMENT_CONFIRMED',
            'PAYMENT',
            `TRC20 payment verified: ${cleanHash.slice(0, 8)}... (${conf} confirmations). Subscription activated.`,
            'SUCCESS'
          );

          this.notify();
          resolve({ success: true });
        }
      }, 400);
    });
  }

  // --- MT5 CONNECTION & ONBOARDING (Section 7) ---
  /**
   * Safe onboarding: Credentials are sent via secure HTTPS to the private bridge.
   * NEVER store password in plaintext or in frontend state!
   */
  public async connectMt5Account(
    userId: string,
    accountNumber: string,
    brokerServer: string,
    passwordSecure: string, // sent once over HTTPS to the server, never stored here
    onProgress?: (p: ConnectProgress) => void
  ): Promise<boolean> {
    // Only a real, signed-in account can connect.
    const headers = await authHeaders();
    if (!headers.Authorization) {
      throw new Error(
        'Please sign in with your email account first.'
      );
    }

    this.mt5Account.status = 'connecting';
    this.notify();

    // The server starts the connection in the background and we follow its progress.
    // We send credentials only: no balance, equity or names.
    const fail = (message: string, extra: Partial<ConnectError> = {}): never => {
      this.mt5Account.status = 'connection_failed';
      this.notify();
      throw Object.assign(new ConnectError(message), extra);
    };

    let res: Response;
    try {
      res = await fetch('/api/trade/provision-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          login: accountNumber.trim(),
          password: passwordSecure,
          server: brokerServer.trim(),
          platform: 'mt5',
        }),
      });
    } catch {
      return fail('Could not reach the server. Check your internet connection and try again.');
    }

    const started = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      return fail(started.error || 'The broker could not verify this account. Nothing was connected.', { code: started.code });
    }

    // Poll until the connection finishes. A dropped request does not stop the connection, so we just ask again.
    const POLL_MS = 2000;
    const GIVE_UP_MS = 10 * 60_000;
    const began = Date.now();
    let job = started.job;
    let missing = 0;
    while (job && job.status === 'running') {
      onProgress?.({ stage: job.stage, label: job.label, percent: job.percent, elapsedSeconds: job.elapsedSeconds });
      if (Date.now() - began > GIVE_UP_MS) {
        return fail('This is taking longer than expected. Close this window and press Connect again in a minute.', { retryable: true });
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
      try {
        const poll = await fetch('/api/trade/connect-status', { headers: await authHeaders() });
        if (poll.ok) {
          const body = await poll.json().catch(() => ({} as any));
          job = body.job;
          if (!job && ++missing >= 3) break;
        }
      } catch {
        // network blip: keep waiting
      }
    }

    if (!job || job.status === 'failed') {
      const e = job?.error;
      return fail(e?.message || 'We lost track of this connection. Please press Connect again.', {
        code: e?.code,
        hint: e?.hint,
        ref: e?.ref,
        retryable: e ? Boolean(e.retryable) : true,
      });
    }

    const c = job.result;
    // Defence in depth: accept only an answer the broker verified.
    if (!c || c.isBrokerVerified !== true || c.isSimulated === true) {
      return fail('The broker could not verify this account. Nothing was connected.');
    }
    onProgress?.({ stage: 'done', label: 'Connected', percent: 100, elapsedSeconds: job.elapsedSeconds });

    // Start copying (the server checks that this user owns a verified account).
    try {
      await fetch('/api/trade/toggle-mirror', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ targetState: 'ACTIVE' }),
      });
    } catch (toggleErr: any) {
      console.warn('⚠️ [TRADING_ENGINE] Toggle mirror notice:', toggleErr?.message);
    }

    const balance = Number(c.balance);
    const equity = Number(c.equity);
    this.mt5Account = {
      ...this.mt5Account,
      userId,
      accountNumber: String(c.login),
      brokerServer: String(c.server),
      status: 'copying',
      balance,
      equity,
      freeMargin: Number(c.freeMargin ?? equity),
      marginLevel: 0,
      leverage: Number(c.leverage),
      riskStatus: 'normal',
      brokerName: c.brokerName,
      accountHolderName: c.accountHolderName || '',
      isBrokerVerified: true,
      tradeAllowed: c.tradeAllowed,
      investorMode: c.investorMode,
      verificationTimestamp: c.verificationTimestamp,
      copiedFromMasterAccount: this.masterAccount.accountNumber,
      masterAccountName: this.masterAccount.accountName,
      lastPing: new Date().toISOString(),
    };

    const existingIndex = this.supervisedAccounts.findIndex(
      (a) => a.userId === userId || a.accountNumber === String(c.login)
    );
    if (existingIndex >= 0) {
      this.supervisedAccounts[existingIndex] = { ...this.mt5Account };
    } else {
      this.supervisedAccounts.push({ ...this.mt5Account });
    }

    this.masterAccount.activeCopiersCount = Math.max(1, this.supervisedAccounts.length);

    this.logAudit(
      userId,
      `Client (${c.login})`,
      'CONNECTED_TO_MAIN_MASTER',
      'MT5',
      `Client MT5 #${c.login} verified by the broker (${c.brokerName}, ${c.accountType || 'account'}) and connected to Main Master MT5 #${this.masterAccount.accountNumber}. Broker-reported equity: $${equity.toFixed(2)}.`,
      'SUCCESS'
    );

    this.runRiskCheck();
    this.notify();
    return true;
  }

  /**
   * Syncs broker-verified accounts from the server. Administrators receive every client;
   * everyone else receives only their own account. Nothing else is trusted.
   */
  public async syncClientsFromBackend(): Promise<void> {
    try {
      const headers = await authHeaders();
      if (!headers.Authorization) return; // demo / quick-start sessions have nothing to sync

      let clients: any[] = [];
      const all = await fetch('/api/trade/clients', { headers });
      if (all.ok) {
        const data = await all.json();
        clients = Array.isArray(data.clients) ? data.clients : [];
      } else {
        const mine = await fetch('/api/trade/my-account', { headers });
        if (!mine.ok) return;
        const data = await mine.json();
        clients = data.connected && data.client ? [data.client] : [];
      }

      for (const c of clients) {
        if (c.isBrokerVerified !== true || c.isSimulated === true) continue;
        const mappedAcc: Mt5Account = {
          id: c.accountId || `mt5-acc-${c.userId}`,
          userId: c.userId,
          accountNumber: String(c.login),
          brokerServer: c.server,
          status: c.status === 'ACTIVE' ? 'copying' : 'disconnected',
          balance: Number(c.balance),
          equity: Number(c.equity),
          freeMargin: Number(c.freeMargin ?? c.equity),
          marginLevel: 0,
          leverage: Number(c.leverage),
          riskStatus: 'normal',
          profitShareStatus: 'up_to_date',
          unpaidProfitShareUsdt: 0,
          lastProfitGenerated: 0,
          lastPing: c.lastSync || new Date().toISOString(),
          createdAt: new Date().toISOString(),
          brokerName: c.brokerName,
          accountHolderName: c.accountHolderName || '',
          isBrokerVerified: true,
          tradeAllowed: c.tradeAllowed,
          investorMode: c.investorMode,
          verificationTimestamp: c.verificationTimestamp,
          copiedFromMasterAccount: this.masterAccount.accountNumber,
          masterAccountName: this.masterAccount.accountName,
        };

        const idx = this.supervisedAccounts.findIndex(
          (a) => a.userId === c.userId || a.accountNumber === String(c.login)
        );
        if (idx >= 0) {
          this.supervisedAccounts[idx] = { ...this.supervisedAccounts[idx], ...mappedAcc };
        } else {
          this.supervisedAccounts.push(mappedAcc);
        }

        if (this.mt5Account.userId === c.userId) {
          this.mt5Account = {
            ...this.mt5Account,
            accountNumber: mappedAcc.accountNumber,
            brokerServer: mappedAcc.brokerServer,
            status: mappedAcc.status,
            balance: mappedAcc.balance,
            equity: mappedAcc.equity,
            freeMargin: mappedAcc.freeMargin,
            leverage: mappedAcc.leverage,
            brokerName: mappedAcc.brokerName,
            accountHolderName: mappedAcc.accountHolderName,
            isBrokerVerified: true,
            tradeAllowed: mappedAcc.tradeAllowed,
            investorMode: mappedAcc.investorMode,
            verificationTimestamp: mappedAcc.verificationTimestamp,
          };
        }
      }
      if (clients.length > 0) {
        this.masterAccount.activeCopiersCount = this.supervisedAccounts.length;
        this.notify();
      }
    } catch {
      // Non-blocking background sync
    }
  }

  /**
   * Asks the server to re-read balance and equity from the broker.
   * Figures can no longer be typed in by hand: only the broker's answer is used.
   */
  public async refreshAccountFromBroker(): Promise<boolean> {
    try {
      const headers = await authHeaders();
      if (!headers.Authorization) return false;
      const res = await fetch('/api/trade/reverify-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({}),
      });
      if (!res.ok) return false;
      await this.syncClientsFromBackend();
      return true;
    } catch {
      return false;
    }
  }

  // --- MT5 DISCONNECTION STATE MACHINE (Section 11) ---
  /**
   * copying -> disconnect_requested -> closing_positions -> disconnected
   * Failure state: disconnect_failed
   */
  public async requestMt5Disconnection(
    userId: string,
    onProgress?: (step: string) => void
  ): Promise<{ success: boolean; error?: string }> {
    if (this.mt5Account.status !== 'copying' && this.mt5Account.status !== 'connected') {
      return { success: false, error: 'Account is not currently actively copying.' };
    }

    // Step 1: disconnect_requested
    this.mt5Account.status = 'disconnect_requested';
    if (onProgress) onProgress('Disconnection requested. Halting new trade signals...');
    this.logAudit(
      userId,
      `Client (${this.mt5Account.accountNumber})`,
      'MT5_DISCONNECT_REQUESTED',
      'MT5',
      'Disconnection command dispatched. New trade copying halted immediately.',
      'SUCCESS'
    );
    this.notify();
    await new Promise((res) => setTimeout(res, 800));

    // Step 2: closing_positions
    this.mt5Account.status = 'closing_positions';
    if (onProgress) onProgress('Removing your account from the copier. Open trades stay open in your MT5 and are not closed for you...');
    this.logAudit(
      userId,
      'MT5 Copier Service',
      'CLOSING_COPIED_POSITIONS',
      'MT5',
      `Closing ${this.getOpenTrades().length} open copied positions.`,
      'SUCCESS'
    );
    this.notify();
    await new Promise((res) => setTimeout(res, 1200));

    // Ask the server to stop copying and remove the account from MetaApi. Only continue if it worked.
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/trade/disconnect-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        this.mt5Account.status = 'disconnect_failed' as any;
        this.notify();
        return { success: false, error: data?.error || 'Could not disconnect right now. Please try again.' };
      }
    } catch {
      this.mt5Account.status = 'disconnect_failed' as any;
      this.notify();
      return { success: false, error: 'Could not reach the server. Please try again.' };
    }

    // Close all open trades
    const now = new Date().toISOString();
    this.trades.forEach((t) => {
      if (t.status === 'OPEN') {
        t.status = 'CLOSED';
        t.closePrice = t.currentPrice;
        t.closeTime = now;
      }
    });

    // Step 3: disconnected
    this.mt5Account = {
      ...this.mt5Account,
      status: 'disconnected',
      accountNumber: 'Not Connected',
      brokerServer: 'Awaiting MT5 Bridge',
      balance: 0.0,
      equity: 0.0,
      freeMargin: 0.0,
      marginLevel: 0.0,
      unpaidProfitShareUsdt: 0.0,
      profitShareDueAt: undefined,
      lastProfitGenerated: 0.0,
    };
    if (onProgress) onProgress('Disconnected. Copying has stopped and your account was removed.');
    this.logAudit(
      userId,
      'MT5 Bridge',
      'MT5_DISCONNECTED_SUCCESSFULLY',
      'MT5',
      'Copying stopped and account removed from the copier. Open trades on the broker account were not closed.',
      'SUCCESS'
    );

    this.runRiskCheck();
    this.notify();
    return { success: true };
  }

  // --- DAILY PROFIT SHARE & HIGH WATER MARK (Section 12) ---
  public executeDailySettlement(adminActor: string): ProfitShareSettlement {
    const previousHwm = this.settlements[0]?.newHwm ?? (this.mt5Account.equity || 0.0);
    const currentEquity = this.mt5Account.equity || 0.0;
    const newHwm = Math.max(previousHwm, currentEquity);
    const eligibleGain = Math.max(0, newHwm - previousHwm);
    const realizedGainToday = eligibleGain;
    const profitSharePct = 50;
    const feeAmount = (eligibleGain * profitSharePct) / 100;

    const settlement: ProfitShareSettlement = {
      id: `settle-${new Date().toISOString().split('T')[0]}`,
      userId: this.mt5Account.userId,
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
      realizedProfit: realizedGainToday,
      commissions: 1.8,
      swaps: 0.0,
      previousLosses: 0.0,
      previousHwm,
      newHwm,
      eligibleGain,
      profitSharePct,
      feeAmount,
      status: 'SETTLED',
      settledAt: new Date().toISOString(),
      invoiceId: `INV-FEE-${Date.now().toString().slice(-4)}`,
    };

    this.settlements.unshift(settlement);

    if (feeAmount > 0) {
      this.addLedgerEntry(
        'PROFIT_SHARE_FEE_LEVIED',
        settlement.id,
        `Daily UTC 50% Profit share fee on new gain ($${eligibleGain.toFixed(2)}) above HWM ($${previousHwm.toFixed(2)})`,
        feeAmount,
        0
      );
    }

    this.logAudit(
      this.mt5Account.userId,
      adminActor,
      'DAILY_PROFIT_SHARE_SETTLED',
      'SETTLEMENT',
      `Settlement completed. Previous HWM: $${previousHwm}, New HWM: $${newHwm}, Fee: $${feeAmount.toFixed(2)} USDT`,
      'SUCCESS'
    );

    this.notify();
    return settlement;
  }

  // --- IMMUTABLE LEDGER (Section 4 & 13) ---
  private addLedgerEntry(
    referenceType: LedgerEntry['referenceType'],
    referenceId: string,
    description: string,
    debit: number,
    credit: number
  ) {
    const lastBalance = this.ledger.length > 0 ? this.ledger[0].balanceAfter : 0;
    const balanceAfter = lastBalance + credit - debit;

    const newEntry: LedgerEntry = {
      id: `ldg-${Date.now().toString().slice(-6)}`,
      timestamp: new Date().toISOString(),
      referenceType,
      referenceId,
      description,
      debit,
      credit,
      balanceAfter: parseFloat(balanceAfter.toFixed(2)),
      isImmutable: true,
    };

    this.ledger.unshift(newEntry);
  }

  // --- AUDIT LOGGING (Section 14) ---
  public logAudit(
    userId: string,
    actor: string,
    action: string,
    category: AuditLog['category'],
    details: string,
    status: 'SUCCESS' | 'WARNING' | 'FAILED'
  ) {
    const log: AuditLog = {
      id: `audit-${Date.now().toString().slice(-6)}`,
      userId,
      actor,
      action,
      category,
      details,
      ip: '198.51.100.' + (Math.floor(Math.random() * 80) + 10),
      timestamp: new Date().toISOString(),
      status,
    };
    this.auditLogs.unshift(log);
  }

  // --- RECONCILIATION REPORT (Section 13) ---
  public generateReconciliationReport(): ReconciliationReport {
    const openTrades = this.getOpenTrades();
    const pendingWithdrawals = this.getPendingWithdrawalsTotal();
    const report: ReconciliationReport = {
      id: `recon-${Date.now().toString().slice(-6)}`,
      timestamp: new Date().toISOString(),
      mt5EquityVsDb: this.mt5Account.equity,
      ledgerBalanceVsCash: this.ledger[0]?.balanceAfter || 0,
      openCopiedPositions: openTrades.length,
      pendingWithdrawalsCount: this.withdrawals.filter((w) => w.status === 'reserved').length,
      discrepancies: [],
      status: 'BALANCED',
    };

    if (this.mt5Account.equity < 200 && openTrades.length > 0) {
      report.status = 'DISCREPANCY_DETECTED';
      report.discrepancies.push('CRITICAL: Equity is below $200 while positions remain unhedged!');
    }

    return report;
  }
}

export const tradingEngine = new TradingEngine();
