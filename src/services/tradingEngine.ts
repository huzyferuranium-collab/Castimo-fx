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

export const TRC20_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export const CASTIMO_TREASURY_ADDRESS = 'TJzM7N4VvUq82Yx8fD3A6P4L8otSzgjLj6t';

export const DEFAULT_PLANS: SubscriptionPlan[] = [
  {
    id: 'weekly',
    name: 'Weekly Trader Pass',
    priceUsdt: 15,
    durationDays: 7,
    description: 'Entry pass for active forex & commodities trade copying.',
    features: [
      'Institutional trade replication (EURUSD, XAUUSD, GBPUSD)',
      'Sub-50ms execution bridge',
      'Built-in $200 equity safety stop',
      'Daily High-Water Mark profit settlement',
      'Full TRC20 USDT automated verification',
    ],
  },
  {
    id: 'monthly',
    name: 'Monthly Pro Trader',
    priceUsdt: 40,
    durationDays: 30,
    description: 'Most popular plan for full monthly automated copiers.',
    features: [
      'Priority bridge server routing',
      'All major, minor & gold pairs',
      'Dynamic lot scaling based on equity',
      'Continuous margin & drawdown guard',
      'Exportable financial ledger & tax reports',
      'Dedicated 24/7 technical monitoring',
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
  accountName: 'Castimo Prime Master (Alpha Bridge)',
  accountNumber: '1099284',
  brokerServer: 'ICMarketsSC-Live01',
  status: 'broadcasting',
  balance: 50000.0,
  equity: 52380.5,
  freeMargin: 48920.0,
  marginLevel: 2450.0,
  leverage: 500,
  latencyMs: 14,
  activeCopiersCount: 8,
  signalBroadcasting: true,
  bridgePort: 8443,
  lastPing: new Date().toISOString(),
  connectedAt: '2026-08-15T00:00:00Z',
  openTradesCount: 2,
};

const INITIAL_ACCOUNT: Mt5Account = {
  id: 'mt5-acc-882910',
  userId: 'demo-client-castimo-001',
  accountNumber: '8829104',
  brokerServer: 'ICMarketsSC-Live02',
  status: 'copying',
  balance: 2450.0,
  equity: 2618.4,
  freeMargin: 2310.2,
  marginLevel: 850.5,
  leverage: 500,
  riskStatus: 'normal',
  profitShareStatus: 'payment_pending',
  unpaidProfitShareUsdt: 150.0,
  profitShareDueAt: new Date(Date.now() + 18 * 3600 * 1000).toISOString(),
  lastProfitGenerated: 300.0,
  lastPing: new Date().toISOString(),
  createdAt: '2026-09-01T08:00:00Z',
  copiedFromMasterAccount: '1099284',
  masterAccountName: 'Castimo Prime Master (Alpha Bridge)',
};

const INITIAL_PROFIT_INVOICES: ProfitShareInvoice[] = [
  {
    id: 'inv-share-8891',
    userId: 'demo-client-castimo-001',
    accountNumber: '8829104',
    grossProfit: 300.0,
    profitSharePct: 50,
    amountDueUsdt: 150.0,
    recipientAddress: CASTIMO_TREASURY_ADDRESS,
    status: 'pending',
    createdAt: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
    dueAt: new Date(Date.now() + 18 * 3600 * 1000).toISOString(),
  },
];

const INITIAL_SUPERVISED_ACCOUNTS: Mt5Account[] = [
  INITIAL_ACCOUNT,
  {
    id: 'mt5-acc-910248',
    userId: 'demo-client-castimo-002',
    accountNumber: '9102482',
    brokerServer: 'Pepperstone-Live01',
    status: 'copying',
    balance: 5120.0,
    equity: 5410.0,
    freeMargin: 4950.0,
    marginLevel: 1100.0,
    leverage: 500,
    riskStatus: 'normal',
    profitShareStatus: 'up_to_date',
    unpaidProfitShareUsdt: 0,
    lastProfitGenerated: 420.0,
    lastPing: new Date().toISOString(),
    createdAt: '2026-08-15T10:00:00Z',
  },
  {
    id: 'mt5-acc-773291',
    userId: 'demo-client-castimo-003',
    accountNumber: '7732910',
    brokerServer: 'Exness-Real5',
    status: 'blocked_unpaid',
    balance: 1850.0,
    equity: 1850.0,
    freeMargin: 1850.0,
    marginLevel: 0,
    leverage: 200,
    riskStatus: 'blocked',
    blockedReason: 'Auto-disconnected by 24h Watcher: 50% profit share ($180.00 USDT) unpaid after 24 hours of profit realization.',
    profitShareStatus: 'overdue_disconnected',
    unpaidProfitShareUsdt: 180.0,
    profitShareDueAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    lastProfitGenerated: 360.0,
    lastPing: new Date().toISOString(),
    createdAt: '2026-07-20T14:00:00Z',
  },
  {
    id: 'mt5-acc-652091',
    userId: 'demo-client-castimo-004',
    accountNumber: '6520911',
    brokerServer: 'FPMarkets-Live1',
    status: 'copying',
    balance: 3400.0,
    equity: 3510.0,
    freeMargin: 3200.0,
    marginLevel: 920.0,
    leverage: 500,
    riskStatus: 'normal',
    profitShareStatus: 'up_to_date',
    unpaidProfitShareUsdt: 0,
    lastProfitGenerated: 150.0,
    lastPing: new Date().toISOString(),
    createdAt: '2026-09-10T11:00:00Z',
  },
];

const INITIAL_REFERRALS: ReferralUser[] = [
  {
    id: 'ref-u-101',
    name: 'Marcus Sterling',
    accountNumber: '7721840',
    phase: 1, // Phase 1: 5% of profit share
    referrerName: 'Direct Referral',
    totalSettledProfit: 1200.0,
    totalCommissionPaid: 30.0,
    joinedAt: '2026-09-12T10:00:00Z',
    status: 'active',
  },
  {
    id: 'ref-u-102',
    name: 'Elena Rostova',
    accountNumber: '9103822',
    phase: 1, // Phase 1: 5% of profit share
    referrerName: 'Direct Referral',
    totalSettledProfit: 800.0,
    totalCommissionPaid: 20.0,
    joinedAt: '2026-09-18T14:30:00Z',
    status: 'active',
  },
  {
    id: 'ref-u-201',
    name: 'Tariq Al-Mansoor',
    accountNumber: '6629104',
    phase: 2, // Phase 2: 3% of profit share
    referrerName: 'Marcus Sterling (Tier 1)',
    totalSettledProfit: 1500.0,
    totalCommissionPaid: 22.5,
    joinedAt: '2026-09-22T08:15:00Z',
    status: 'active',
  },
  {
    id: 'ref-u-301',
    name: 'Sofia Chen',
    accountNumber: '5519401',
    phase: 3, // Phase 3: 2% of profit share
    referrerName: 'Tariq Al-Mansoor (Tier 2)',
    totalSettledProfit: 600.0,
    totalCommissionPaid: 6.0,
    joinedAt: '2026-09-28T16:00:00Z',
    status: 'active',
  },
];

const INITIAL_COMMISSION_HISTORY: ReferralCommissionEvent[] = [
  {
    id: 'comm-881',
    timestamp: '2026-09-30T23:59:59Z',
    fromClientName: 'Marcus Sterling',
    fromAccountNumber: '7721840',
    phase: 1,
    phasePct: 5,
    settledProfit: 400.0,
    profitShareAmount: 200.0, // 50% profit share
    commissionEarnedUsdt: 10.0, // 5% of 200
    status: 'CREDITED',
  },
  {
    id: 'comm-882',
    timestamp: '2026-10-01T23:59:59Z',
    fromClientName: 'Tariq Al-Mansoor',
    fromAccountNumber: '6629104',
    phase: 2,
    phasePct: 3,
    settledProfit: 500.0,
    profitShareAmount: 250.0,
    commissionEarnedUsdt: 7.5, // 3% of 250
    status: 'CREDITED',
  },
  {
    id: 'comm-883',
    timestamp: '2026-10-02T10:00:00Z',
    fromClientName: 'Sofia Chen',
    fromAccountNumber: '5519401',
    phase: 3,
    phasePct: 2,
    settledProfit: 300.0,
    profitShareAmount: 150.0,
    commissionEarnedUsdt: 3.0, // 2% of 150
    status: 'CREDITED',
  },
];

const INITIAL_TRADES: CopiedTrade[] = [
  {
    id: 'trade-cp-901',
    masterTradeId: 'MST-44810',
    symbol: 'XAUUSD',
    direction: 'BUY',
    volume: 0.25,
    openPrice: 2642.5,
    currentPrice: 2651.8,
    sl: 2630.0,
    tp: 2675.0,
    pnl: 232.5,
    commission: 1.75,
    swap: 0.0,
    status: 'OPEN',
    openTime: new Date(Date.now() - 3600000 * 4).toISOString(),
    idempotencyKey: 'MST-44810-8829104',
  },
  {
    id: 'trade-cp-902',
    masterTradeId: 'MST-44819',
    symbol: 'XAUUSD',
    direction: 'SELL',
    volume: 0.20,
    openPrice: 2654.0,
    currentPrice: 2651.8,
    sl: 2665.0,
    tp: 2635.0,
    pnl: 44.0,
    commission: 1.4,
    swap: 0.0,
    status: 'OPEN',
    openTime: new Date(Date.now() - 3600000 * 2).toISOString(),
    idempotencyKey: 'MST-44819-8829104',
  },
  {
    id: 'trade-cp-889',
    masterTradeId: 'MST-44750',
    symbol: 'XAUUSD',
    direction: 'BUY',
    volume: 0.3,
    openPrice: 2635.0,
    currentPrice: 2648.0,
    closePrice: 2648.0,
    sl: 2622.0,
    tp: 2648.0,
    pnl: 390.0,
    commission: 2.1,
    swap: 0.0,
    status: 'CLOSED',
    openTime: '2026-10-02T19:30:00Z',
    closeTime: '2026-10-02T22:15:00Z',
    idempotencyKey: 'MST-44750-8829104',
  },
  {
    id: 'trade-cp-888',
    masterTradeId: 'MST-44732',
    symbol: 'XAUUSD',
    direction: 'BUY',
    volume: 0.3,
    openPrice: 2638.2,
    currentPrice: 2649.5,
    closePrice: 2649.5,
    sl: 2628.0,
    tp: 2655.0,
    pnl: 339.0,
    commission: 2.1,
    swap: 0.0,
    status: 'CLOSED',
    openTime: '2026-10-02T16:00:00Z',
    closeTime: '2026-10-02T18:45:00Z',
    idempotencyKey: 'MST-44732-8829104',
  },
  {
    id: 'trade-cp-887',
    masterTradeId: 'MST-44715',
    symbol: 'XAUUSD',
    direction: 'SELL',
    volume: 0.25,
    openPrice: 2658.0,
    currentPrice: 2649.2,
    closePrice: 2649.2,
    sl: 2668.0,
    tp: 2645.0,
    pnl: 220.0,
    commission: 1.75,
    swap: 0.0,
    status: 'CLOSED',
    openTime: '2026-10-02T12:15:00Z',
    closeTime: '2026-10-02T15:20:00Z',
    idempotencyKey: 'MST-44715-8829104',
  },
  {
    id: 'trade-cp-886',
    masterTradeId: 'MST-44690',
    symbol: 'XAUUSD',
    direction: 'BUY',
    volume: 0.3,
    openPrice: 2632.0,
    currentPrice: 2645.0,
    closePrice: 2645.0,
    sl: 2622.0,
    tp: 2645.0,
    pnl: 290.0,
    commission: 2.1,
    swap: 0.0,
    status: 'CLOSED',
    openTime: '2026-10-02T08:10:00Z',
    closeTime: '2026-10-02T11:40:00Z',
    idempotencyKey: 'MST-44690-8829104',
  },
  {
    id: 'trade-cp-885',
    masterTradeId: 'MST-44665',
    symbol: 'XAUUSD',
    direction: 'SELL',
    volume: 0.2,
    openPrice: 2655.0,
    currentPrice: 2658.2,
    closePrice: 2658.2,
    sl: 2658.2,
    tp: 2640.0,
    pnl: -64.0,
    commission: 1.4,
    swap: 0.0,
    status: 'CLOSED',
    openTime: '2026-10-01T21:00:00Z',
    closeTime: '2026-10-01T22:30:00Z',
    idempotencyKey: 'MST-44665-8829104',
  },
  {
    id: 'trade-cp-884',
    masterTradeId: 'MST-44640',
    symbol: 'XAUUSD',
    direction: 'BUY',
    volume: 0.25,
    openPrice: 2636.5,
    currentPrice: 2646.0,
    closePrice: 2646.0,
    sl: 2628.0,
    tp: 2646.0,
    pnl: 237.5,
    commission: 1.75,
    swap: 0.0,
    status: 'CLOSED',
    openTime: '2026-10-01T14:20:00Z',
    closeTime: '2026-10-01T17:50:00Z',
    idempotencyKey: 'MST-44640-8829104',
  },
  {
    id: 'trade-cp-883',
    masterTradeId: 'MST-44612',
    symbol: 'XAUUSD',
    direction: 'BUY',
    volume: 0.25,
    openPrice: 2630.0,
    currentPrice: 2642.5,
    closePrice: 2642.5,
    sl: 2620.0,
    tp: 2645.0,
    pnl: 312.5,
    commission: 1.75,
    swap: 0.0,
    status: 'CLOSED',
    openTime: '2026-10-01T09:40:00Z',
    closeTime: '2026-10-01T13:10:00Z',
    idempotencyKey: 'MST-44612-8829104',
  },
  {
    id: 'trade-cp-882',
    masterTradeId: 'MST-44580',
    symbol: 'XAUUSD',
    direction: 'SELL',
    volume: 0.2,
    openPrice: 2648.0,
    currentPrice: 2652.5,
    closePrice: 2652.5,
    sl: 2652.5,
    tp: 2638.0,
    pnl: -90.0,
    commission: 1.4,
    swap: 0.0,
    status: 'CLOSED',
    openTime: '2026-09-30T18:20:00Z',
    closeTime: '2026-09-30T20:30:00Z',
    idempotencyKey: 'MST-44580-8829104',
  },
  {
    id: 'trade-cp-881',
    masterTradeId: 'MST-44550',
    symbol: 'XAUUSD',
    direction: 'BUY',
    volume: 0.25,
    openPrice: 2625.0,
    currentPrice: 2640.0,
    closePrice: 2640.0,
    sl: 2615.0,
    tp: 2642.0,
    pnl: 375.0,
    commission: 1.75,
    swap: 0.0,
    status: 'CLOSED',
    openTime: '2026-09-30T13:00:00Z',
    closeTime: '2026-09-30T16:30:00Z',
    idempotencyKey: 'MST-44550-8829104',
  },
  {
    id: 'trade-cp-880',
    masterTradeId: 'MST-44510',
    symbol: 'XAUUSD',
    direction: 'SELL',
    volume: 0.3,
    openPrice: 2654.0,
    currentPrice: 2645.0,
    closePrice: 2645.0,
    sl: 2664.0,
    tp: 2642.0,
    pnl: 270.0,
    commission: 2.1,
    swap: 0.0,
    status: 'CLOSED',
    openTime: '2026-09-30T07:15:00Z',
    closeTime: '2026-09-30T10:15:00Z',
    idempotencyKey: 'MST-44510-8829104',
  },
  {
    id: 'trade-cp-879',
    masterTradeId: 'MST-44480',
    symbol: 'XAUUSD',
    direction: 'SELL',
    volume: 0.25,
    openPrice: 2650.0,
    currentPrice: 2641.5,
    closePrice: 2641.5,
    sl: 2659.0,
    tp: 2640.0,
    pnl: 212.5,
    commission: 1.75,
    swap: 0.0,
    status: 'CLOSED',
    openTime: '2026-09-29T14:30:00Z',
    closeTime: '2026-09-29T18:00:00Z',
    idempotencyKey: 'MST-44480-8829104',
  },
];

const INITIAL_SUBSCRIPTION: Subscription = {
  id: 'sub-cfx-001',
  userId: 'demo-client-castimo-001',
  planId: 'monthly',
  planName: 'Monthly Pro Trader',
  priceUsdt: 40,
  status: 'active',
  txHash: '9a8d7e6f5c4b3a210987654321fedcba0123456789abcdef0123456789abcdef',
  confirmations: 38,
  recipientAddress: CASTIMO_TREASURY_ADDRESS,
  createdAt: '2026-09-15T12:00:00Z',
  startDate: '2026-09-15T12:05:00Z',
  expiresAt: '2026-10-15T12:05:00Z',
};

const INITIAL_WITHDRAWALS: WithdrawalRequest[] = [
  {
    id: 'wdr-7721',
    userId: 'demo-client-castimo-001',
    userEmail: 'trader@castimofx.com',
    amount: 350.0,
    destinationAddress: 'TXg8A2k9YvLmNpQrStUvWxYz0123456789',
    status: 'paid',
    estimatedWithdrawableAtRequest: 890.0,
    hasOpenTrades: true,
    txHash: '4f2e1d0c9b8a7f6e5d4c3b2a10987654321fedcba0987654321abcdef0123456',
    createdAt: '2026-09-25T14:20:00Z',
    updatedAt: '2026-09-25T15:10:00Z',
  },
];

const INITIAL_SETTLEMENTS: ProfitShareSettlement[] = [
  {
    id: 'settle-2026-09-30',
    userId: 'demo-client-castimo-001',
    periodStart: '2026-09-29T00:00:00Z',
    periodEnd: '2026-09-30T00:00:00Z',
    realizedProfit: 300.0,
    commissions: 2.8,
    swaps: 0.1,
    previousLosses: 0.0,
    previousHwm: 2150.0,
    newHwm: 2450.0,
    eligibleGain: 300.0,
    profitSharePct: 50,
    feeAmount: 150.0,
    status: 'SETTLED',
    settledAt: '2026-09-30T23:59:59Z',
    invoiceId: 'INV-FEE-9021',
  },
];

const INITIAL_LEDGER: LedgerEntry[] = [
  {
    id: 'ldg-001',
    timestamp: '2026-09-15T12:05:00Z',
    referenceType: 'TRC20_SUBSCRIPTION_PAYMENT',
    referenceId: 'sub-cfx-001',
    description: 'TRC20 USDT Subscription Payment received (38 confirmations)',
    debit: 0,
    credit: 40.0,
    balanceAfter: 40.0,
    isImmutable: true,
  },
  {
    id: 'ldg-002',
    timestamp: '2026-09-25T14:20:00Z',
    referenceType: 'WITHDRAWAL_RESERVE_LOCKED',
    referenceId: 'wdr-7721',
    description: 'Withdrawal atomic reservation locked against equity balance',
    debit: 350.0,
    credit: 0,
    balanceAfter: -310.0,
    isImmutable: true,
  },
  {
    id: 'ldg-003',
    timestamp: '2026-09-30T16:30:00Z',
    referenceType: 'TRADE_PROFIT_REALIZED',
    referenceId: 'trade-cp-889',
    description: 'Realized net profit from closed copied trade MST-44750 (GBPUSD)',
    debit: 0,
    credit: 297.3,
    balanceAfter: -12.7,
    isImmutable: true,
  },
  {
    id: 'ldg-004',
    timestamp: '2026-09-30T23:59:59Z',
    referenceType: 'PROFIT_SHARE_FEE_LEVIED',
    referenceId: 'settle-2026-09-30',
    description: 'Daily UTC 20% Performance fee above High-Water Mark (HWM)',
    debit: 60.0,
    credit: 0,
    balanceAfter: -72.7,
    isImmutable: true,
  },
];

const INITIAL_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'audit-001',
    userId: 'demo-client-castimo-001',
    actor: 'Client (8829104)',
    action: 'MT5_COPIER_CONNECTED',
    category: 'MT5',
    details: 'Encrypted handshake verified. Connected to ICMarketsSC-Live02 bridge.',
    ip: '198.51.100.42',
    timestamp: '2026-09-01T08:00:00Z',
    status: 'SUCCESS',
  },
  {
    id: 'audit-002',
    userId: 'demo-client-castimo-001',
    actor: 'System Risk Engine',
    action: 'RISK_THRESHOLD_MONITOR',
    category: 'RISK',
    details: 'Equity $2618.40 safely exceeds $200.00 critical floor. Copying active.',
    ip: '127.0.0.1',
    timestamp: '2026-10-02T09:30:00Z',
    status: 'SUCCESS',
  },
  {
    id: 'audit-003',
    userId: 'demo-admin-castimo-999',
    actor: 'Admin (David Vance)',
    action: 'WITHDRAWAL_APPROVAL_SETTLED',
    category: 'WITHDRAWAL',
    details: 'Approved TRC20 payout $350.00 to TXg8...6789. TX confirmed.',
    ip: '82.102.23.11',
    timestamp: '2026-09-25T15:10:00Z',
    status: 'SUCCESS',
  },
];

const INITIAL_NOTIFICATIONS: ClientNotification[] = [
  {
    id: 'notif-001',
    type: 'REFERRAL_COMMISSION',
    title: 'New Referral Commission Credited',
    message: '+$10.00 USDT earned from Phase 1 referral Marcus Sterling (#7721840) on their 24h profit settlement.',
    amountUsdt: 10.0,
    timestamp: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
    read: false,
    linkAction: 'open_referrals',
  },
  {
    id: 'notif-002',
    type: 'SETTLEMENT_PROCESSED',
    title: '24-Hour Profit Settlement Processed',
    message: '50% Profit Share settlement #set-cfx-0929 ($225.00 USDT) has been verified on TRC20 and recorded in ledger.',
    amountUsdt: 225.0,
    timestamp: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    read: false,
    linkAction: 'open_settlements',
  },
  {
    id: 'notif-003',
    type: 'SETTLEMENT_DUE',
    title: '24-Hour Settlement Window Active',
    message: '$150.00 USDT profit share is due for remittance within 24 hours. Copying is currently active.',
    amountUsdt: 150.0,
    timestamp: new Date(Date.now() - 1000 * 60 * 360).toISOString(),
    read: true,
    linkAction: 'open_payment',
  },
];

class TradingEngine {
  private subscription: Subscription | null = null;
  private masterAccount: MasterMt5Account = INITIAL_MASTER_ACCOUNT;
  private mt5Account: Mt5Account = INITIAL_ACCOUNT;
  private supervisedAccounts: Mt5Account[] = INITIAL_SUPERVISED_ACCOUNTS;
  private profitInvoices: ProfitShareInvoice[] = INITIAL_PROFIT_INVOICES;
  private referrals: ReferralUser[] = INITIAL_REFERRALS;
  private commissionHistory: ReferralCommissionEvent[] = INITIAL_COMMISSION_HISTORY;
  private referralBalance: number = 78.5;
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
    this.subscription = INITIAL_SUBSCRIPTION;
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

  public triggerDemoNotification(type: 'settlement' | 'referral'): ClientNotification {
    if (type === 'referral') {
      return this.addNotification(
        'REFERRAL_COMMISSION',
        'New Referral Commission Credited',
        '+$15.00 USDT earned from Phase 2 referral Tariq Al-Mansoor on their 24h profit settlement.',
        15.0,
        'open_referrals'
      );
    } else {
      return this.addNotification(
        'SETTLEMENT_PROCESSED',
        '24-Hour Profit Settlement Processed',
        'Your 50% Profit Share remittance of $150.00 USDT has been successfully verified on TRC20.',
        150.0,
        'open_settlements'
      );
    }
  }

  // --- 3-PHASE REFERRAL COMMISSION ENGINE (5% Phase 1, 3% Phase 2, 2% Phase 3) ---
  public getReferralStats(userAccount?: string): ReferralStats {
    const code = 'CFX-' + (userAccount || this.mt5Account.accountNumber || '8829104');
    const link = `https://castimofx.com/?ref=${code}`;
    const totalEarned = this.commissionHistory.reduce((s, c) => s + c.commissionEarnedUsdt, 0);

    return {
      referralCode: code,
      referralLink: link,
      phase1CommissionPct: 5,
      phase2CommissionPct: 3,
      phase3CommissionPct: 2,
      totalEarnedUsdt: parseFloat(totalEarned.toFixed(2)),
      availableBalanceUsdt: parseFloat(this.referralBalance.toFixed(2)),
      phase1Count: this.referrals.filter((r) => r.phase === 1).length,
      phase2Count: this.referrals.filter((r) => r.phase === 2).length,
      phase3Count: this.referrals.filter((r) => r.phase === 3).length,
      referrals: this.referrals,
      history: this.commissionHistory,
    };
  }

  public simulateReferralSettlement(
    phase: ReferralPhase,
    profitAmount: number = 500.0
  ): ReferralCommissionEvent {
    const profitShareAmount = profitAmount * 0.5; // 50% profit share
    const phasePct = phase === 1 ? 5 : phase === 2 ? 3 : 2;
    const commissionEarnedUsdt = parseFloat(((profitShareAmount * phasePct) / 100).toFixed(2));

    const candidate = this.referrals.find((r) => r.phase === phase) || this.referrals[0];
    candidate.totalSettledProfit += profitAmount;
    candidate.totalCommissionPaid += commissionEarnedUsdt;

    const event: ReferralCommissionEvent = {
      id: `comm-${Date.now().toString().slice(-4)}`,
      timestamp: new Date().toISOString(),
      fromClientName: candidate.name,
      fromAccountNumber: candidate.accountNumber,
      phase,
      phasePct,
      settledProfit: profitAmount,
      profitShareAmount,
      commissionEarnedUsdt,
      status: 'CREDITED',
    };

    this.commissionHistory.unshift(event);
    this.referralBalance += commissionEarnedUsdt;

    this.addLedgerEntry(
      'PROFIT_SHARE_FEE_LEVIED',
      event.id,
      `Phase ${phase} (${phasePct}%) Referral Commission credited from ${candidate.name} ($${commissionEarnedUsdt.toFixed(2)} USDT on $${profitShareAmount.toFixed(2)} profit share)`,
      0,
      commissionEarnedUsdt
    );

    this.logAudit(
      this.mt5Account.userId,
      'Referral Commission Engine',
      `REFERRAL_COMMISSION_PHASE_${phase}`,
      'PAYMENT',
      `Credited $${commissionEarnedUsdt.toFixed(2)} USDT (${phasePct}% of 24h settlement profit share) from #${candidate.accountNumber}.`,
      'SUCCESS'
    );

    this.addNotification(
      'REFERRAL_COMMISSION',
      `New Referral Commission: +$${commissionEarnedUsdt.toFixed(2)} USDT`,
      `Credited Phase ${phase} commission (${phasePct}% of 24h profit share) from ${candidate.name} (#${candidate.accountNumber}). Available in your wallet.`,
      commissionEarnedUsdt,
      'open_referrals'
    );

    this.notify();
    return event;
  }

  public async claimReferralCommission(
    amount: number,
    destinationAddress: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (amount <= 0) return { success: false, error: 'Amount must be greater than zero.' };
    if (amount > this.referralBalance) {
      return {
        success: false,
        error: `Requested amount ($${amount.toFixed(2)}) exceeds available referral balance ($${this.referralBalance.toFixed(2)}).`,
      };
    }
    if (!destinationAddress || destinationAddress.trim().length < 15) {
      return { success: false, error: 'Valid TRC20 recipient wallet address is required.' };
    }

    const txHash =
      '4f8a9b2c' + Date.now().toString(16) + Math.random().toString(16).slice(2, 10);
    this.referralBalance = parseFloat((this.referralBalance - amount).toFixed(2));

    this.addLedgerEntry(
      'PROFIT_SHARE_FEE_LEVIED',
      `claim-ref-${Date.now().toString().slice(-4)}`,
      `Referral Commission Payout ($${amount.toFixed(2)} USDT) dispatched to ${destinationAddress.slice(0, 10)}... (TX: ${txHash.slice(0, 12)}...)`,
      amount,
      0
    );

    this.logAudit(
      this.mt5Account.userId,
      'Client',
      'REFERRAL_PAYOUT_CLAIMED',
      'PAYMENT',
      `Claimed referral commission payout of $${amount.toFixed(2)} USDT to ${destinationAddress}. TX: ${txHash}`,
      'SUCCESS'
    );

    this.notify();
    return { success: true, txHash };
  }

  public getPendingWithdrawalsTotal(): number {
    return this.withdrawals
      .filter((w) => w.status === 'requested' || w.status === 'reserved' || w.status === 'approved')
      .reduce((sum, w) => sum + w.amount, 0);
  }

  // --- RISK ENGINE (Section 9) ---
  public runRiskCheck(): { riskStatus: 'normal' | 'warning' | 'blocked'; blockedReason?: string } {
    const minEquity = this.riskSettings.minEquityToTrade; // $200
    const equity = this.mt5Account.equity;
    const openTrades = this.getOpenTrades();

    let status: 'normal' | 'warning' | 'blocked' = 'normal';
    let reason: string | undefined = undefined;

    if (equity < minEquity) {
      status = 'blocked';
      reason = `CRITICAL: Account equity ($${equity.toFixed(2)}) is below the required safety threshold ($${minEquity.toFixed(2)}). All new trade copying blocked.`;
    } else if (equity < minEquity + 100) {
      status = 'warning';
      reason = `WARNING: Equity ($${equity.toFixed(2)}) is approaching the $${minEquity.toFixed(2)} minimum.`;
    }

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

  // --- 50% PROFIT SHARE SETTLEMENT & 24H WATCHER ENGINE ---
  public async payProfitShareInvoice(
    invoiceId: string,
    txHash?: string
  ): Promise<{ success: boolean; error?: string }> {
    const inv = this.profitInvoices.find((i) => i.id === invoiceId);
    if (!inv) {
      return { success: false, error: 'Invoice not found.' };
    }
    if (inv.status === 'paid') {
      return { success: true };
    }

    const verifiedTx =
      txHash && txHash.trim().length === 64
        ? txHash.trim()
        : 'tx-trc20-' + Date.now().toString(16) + Math.random().toString(16).slice(2, 10);

    inv.status = 'paid';
    inv.paidAt = new Date().toISOString();
    inv.txHash = verifiedTx;

    // Clear dues on client account
    if (this.mt5Account.userId === inv.userId) {
      this.mt5Account.unpaidProfitShareUsdt = 0;
      this.mt5Account.profitShareStatus = 'up_to_date';
      this.mt5Account.profitShareDueAt = undefined;
      if (this.mt5Account.status === 'blocked_unpaid') {
        this.mt5Account.status = 'copying';
        this.mt5Account.blockedReason = undefined;
        this.mt5Account.riskStatus = 'normal';
      }
    }

    // Update in supervised accounts
    const supAcc = this.supervisedAccounts.find((a) => a.accountNumber === inv.accountNumber);
    if (supAcc) {
      supAcc.unpaidProfitShareUsdt = 0;
      supAcc.profitShareStatus = 'up_to_date';
      supAcc.profitShareDueAt = undefined;
      if (supAcc.status === 'blocked_unpaid') {
        supAcc.status = 'copying';
        supAcc.blockedReason = undefined;
        supAcc.riskStatus = 'normal';
      }
    }

    this.addLedgerEntry(
      'PROFIT_SHARE_FEE_LEVIED',
      inv.id,
      `50% Profit Share received (${inv.amountDueUsdt.toFixed(2)} USDT) for gross profit ${inv.grossProfit.toFixed(2)}. TXID: ${verifiedTx.slice(0, 16)}...`,
      inv.amountDueUsdt,
      0
    );

    this.logAudit(
      inv.userId,
      'System Payment Engine',
      'PROFIT_SHARE_PAID_USDT',
      'PAYMENT',
      `Invoice ${inv.id} paid. ${inv.amountDueUsdt.toFixed(2)} USDT verified on TRC20 network. Account trade copying active.`,
      'SUCCESS'
    );

    this.addNotification(
      'SETTLEMENT_PROCESSED',
      '24-Hour Profit Settlement Processed',
      `Your 50% Profit Share remittance of $${inv.amountDueUsdt.toFixed(2)} USDT for invoice ${inv.id} has been verified on TRC20 network. Trading remains uninterrupted.`,
      inv.amountDueUsdt,
      'open_settlements'
    );

    this.notify();
    return { success: true };
  }

  public trigger24hWatcherSweep(): { checked: number; disconnectedCount: number; message: string } {
    let disconnectedCount = 0;
    const now = Date.now();

    // Check main mt5Account
    if (
      this.mt5Account.unpaidProfitShareUsdt &&
      this.mt5Account.unpaidProfitShareUsdt > 0 &&
      this.mt5Account.profitShareDueAt &&
      new Date(this.mt5Account.profitShareDueAt).getTime() < now &&
      this.mt5Account.status !== 'blocked_unpaid' &&
      this.mt5Account.status !== 'disconnected'
    ) {
      this.mt5Account.status = 'blocked_unpaid';
      this.mt5Account.profitShareStatus = 'overdue_disconnected';
      this.mt5Account.blockedReason = `Auto-disconnected by 24h Watcher: 50% profit share (${this.mt5Account.unpaidProfitShareUsdt.toFixed(2)} USDT) unpaid after 24 hours of profit realization.`;
      this.mt5Account.riskStatus = 'blocked';
      disconnectedCount++;

      this.logAudit(
        this.mt5Account.userId,
        'Autonomous 24h Watcher Daemon',
        'AUTO_DISCONNECT_UNPAID_24H',
        'RISK',
        `Account #${this.mt5Account.accountNumber} auto-disconnected. 50% profit share overdue.`,
        'WARNING'
      );
    }

    // Check supervised accounts
    for (const acc of this.supervisedAccounts) {
      if (
        acc.unpaidProfitShareUsdt &&
        acc.unpaidProfitShareUsdt > 0 &&
        acc.profitShareDueAt &&
        new Date(acc.profitShareDueAt).getTime() < now &&
        acc.status !== 'blocked_unpaid' &&
        acc.status !== 'disconnected'
      ) {
        acc.status = 'blocked_unpaid';
        acc.profitShareStatus = 'overdue_disconnected';
        acc.blockedReason = `Auto-disconnected by 24h Watcher: 50% profit share (${acc.unpaidProfitShareUsdt.toFixed(2)} USDT) unpaid after 24 hours of profit realization.`;
        acc.riskStatus = 'blocked';
        disconnectedCount++;
      }
    }

    this.notify();
    return {
      checked: this.supervisedAccounts.length,
      disconnectedCount,
      message: `24h Watcher sweep complete. Checked ${this.supervisedAccounts.length} accounts. ${disconnectedCount} account(s) auto-disconnected due to unpaid 50% profit share.`,
    };
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
    _passwordSecure: string // forwarded over encrypted bridge, discarded immediately
  ): Promise<boolean> {
    this.mt5Account.status = 'connecting';
    this.notify();

    // Simulated secure handshake with Node.js MT5 Bridge service
    await new Promise((res) => setTimeout(res, 1200));

    this.mt5Account = {
      ...this.mt5Account,
      userId,
      accountNumber,
      brokerServer,
      status: 'copying',
      balance: 2450.0,
      equity: 2618.4,
      freeMargin: 2310.2,
      marginLevel: 850.5,
      leverage: 500,
      riskStatus: 'normal',
      copiedFromMasterAccount: this.masterAccount.accountNumber,
      masterAccountName: this.masterAccount.accountName,
      lastPing: new Date().toISOString(),
    };

    this.masterAccount.activeCopiersCount = (this.masterAccount.activeCopiersCount || 0) + 1;

    this.logAudit(
      userId,
      `Client (${accountNumber})`,
      'CONNECTED_TO_MAIN_MASTER',
      'MT5',
      `Client MT5 #${accountNumber} successfully connected to Main Master MT5 #${this.masterAccount.accountNumber} (${this.masterAccount.accountName}). Real-time trade copying initiated.`,
      'SUCCESS'
    );

    this.runRiskCheck();
    this.notify();
    return true;
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
    if (onProgress) onProgress('Liquidating and closing all open copied positions on MT5 bridge...');
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
    this.mt5Account.status = 'disconnected';
    if (onProgress) onProgress('All positions closed. MT5 copier bridge disconnected successfully.');
    this.logAudit(
      userId,
      'MT5 Bridge',
      'MT5_DISCONNECTED_SUCCESSFULLY',
      'MT5',
      'Account disconnected safely. Open positions count: 0.',
      'SUCCESS'
    );

    this.runRiskCheck();
    this.notify();
    return { success: true };
  }

  // --- DAILY PROFIT SHARE & HIGH WATER MARK (Section 12) ---
  public executeDailySettlement(adminActor: string): ProfitShareSettlement {
    const previousHwm = 2150.0;
    const currentEquity = this.mt5Account.equity;
    const realizedGainToday = 185.0;
    const newHwm = Math.max(previousHwm, currentEquity);
    const eligibleGain = Math.max(0, newHwm - previousHwm);
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
