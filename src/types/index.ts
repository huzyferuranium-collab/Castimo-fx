export type UserRole = 'client' | 'admin';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  photoURL?: string;
}

export type SubscriptionStatus =
  | 'pending_payment'
  | 'payment_submitted'
  | 'payment_confirming'
  | 'active'
  | 'expiring'
  | 'expired'
  | 'suspended'
  | 'cancelled';

export interface SubscriptionPlan {
  id: 'weekly' | 'monthly';
  name: string;
  priceUsdt: number;
  durationDays: number;
  description: string;
  features: string[];
}

export interface Subscription {
  id: string;
  userId: string;
  planId: 'weekly' | 'monthly';
  planName: string;
  priceUsdt: number;
  status: SubscriptionStatus;
  txHash?: string;
  confirmations: number;
  recipientAddress: string;
  createdAt: string;
  startDate?: string;
  expiresAt?: string;
}

export type Mt5ConnectionStatus =
  | 'pending'
  | 'connecting'
  | 'connected'
  | 'copying'
  | 'connection_failed'
  | 'disconnect_requested'
  | 'closing_positions'
  | 'disconnected'
  | 'disconnect_failed'
  | 'blocked'
  | 'blocked_unpaid';

export interface ProfitShareInvoice {
  id: string;
  userId: string;
  accountNumber: string;
  grossProfit: number;
  profitSharePct: number; // 50%
  amountDueUsdt: number;
  recipientAddress: string;
  status: 'pending' | 'paid' | 'overdue_blocked';
  createdAt: string;
  dueAt: string; // Exactly 24 hours after creation
  paidAt?: string;
  txHash?: string;
}

export interface Mt5Account {
  id: string;
  userId: string;
  accountNumber: string;
  brokerServer: string;
  status: Mt5ConnectionStatus;
  balance: number;
  equity: number;
  freeMargin: number;
  marginLevel: number;
  leverage: number;
  riskStatus: 'normal' | 'warning' | 'blocked';
  blockedReason?: string;
  profitShareStatus?: 'up_to_date' | 'payment_pending' | 'overdue_disconnected';
  unpaidProfitShareUsdt?: number;
  profitShareDueAt?: string;
  lastProfitGenerated?: number;
  lastPing: string;
  createdAt: string;
  copiedFromMasterAccount?: string;
  masterAccountName?: string;
}

export interface MasterMt5Account {
  id: string;
  accountName: string;
  accountNumber: string;
  brokerServer: string;
  status: 'broadcasting' | 'connected' | 'paused' | 'disconnected';
  balance: number;
  equity: number;
  freeMargin: number;
  marginLevel: number;
  leverage: number;
  latencyMs: number;
  activeCopiersCount: number;
  signalBroadcasting: boolean;
  bridgePort: number;
  lastPing: string;
  connectedAt: string;
  openTradesCount: number;
}

export interface CopiedTrade {
  id: string;
  masterTradeId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  volume: number;
  openPrice: number;
  currentPrice: number;
  closePrice?: number;
  sl: number;
  tp: number;
  pnl: number;
  commission: number;
  swap: number;
  status: 'OPEN' | 'CLOSED';
  openTime: string;
  closeTime?: string;
  idempotencyKey: string;
}

export interface RiskSettings {
  minEquityToTrade: number; // $200 default
  maxLotSize: number;
  maxExposureUsd: number;
  maxOpenPositions: number;
  maxDailyLossUsd: number;
  maxDrawdownPercent: number;
  symbolWhitelist: string[];
  lotSizeMultiplier: number; // 0.1x - 3.0x
  maxDrawdownLimitUsd: number; // e.g. $400 USD
  autoCloseOnDrawdown: boolean;
  copyStopLoss: boolean;
  copyTakeProfit: boolean;
}

export type WithdrawalStatus =
  | 'requested'
  | 'blocked'
  | 'reserved'
  | 'approved'
  | 'processing'
  | 'paid'
  | 'rejected'
  | 'cancelled';

export interface WithdrawalRequest {
  id: string;
  userId: string;
  userEmail: string;
  amount: number;
  destinationAddress: string;
  status: WithdrawalStatus;
  estimatedWithdrawableAtRequest: number;
  hasOpenTrades: boolean;
  rejectionReason?: string;
  txHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProfitShareSettlement {
  id: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  realizedProfit: number;
  commissions: number;
  swaps: number;
  previousLosses: number;
  previousHwm: number;
  newHwm: number;
  eligibleGain: number;
  profitSharePct: number;
  feeAmount: number;
  status: 'SETTLED' | 'PENDING' | 'DISPUTED';
  settledAt: string;
  invoiceId: string;
}

export interface LedgerEntry {
  id: string;
  timestamp: string;
  referenceType:
    | 'TRC20_SUBSCRIPTION_PAYMENT'
    | 'TRADE_PROFIT_REALIZED'
    | 'TRADE_LOSS_REALIZED'
    | 'PROFIT_SHARE_FEE_LEVIED'
    | 'WITHDRAWAL_RESERVE_LOCKED'
    | 'WITHDRAWAL_RESERVE_RELEASED'
    | 'WITHDRAWAL_PAYOUT_SETTLED';
  referenceId: string;
  description: string;
  debit: number;
  credit: number;
  balanceAfter: number;
  isImmutable: boolean;
}

export type AuditCategory =
  | 'AUTH'
  | 'MT5'
  | 'RISK'
  | 'WITHDRAWAL'
  | 'PAYMENT'
  | 'SETTLEMENT'
  | 'LEDGER'
  | 'ADMIN';

export interface AuditLog {
  id: string;
  userId: string;
  actor: string;
  action: string;
  category: AuditCategory;
  details: string;
  ip: string;
  timestamp: string;
  status: 'SUCCESS' | 'WARNING' | 'FAILED';
}

export interface ReconciliationReport {
  id: string;
  timestamp: string;
  mt5EquityVsDb: number;
  ledgerBalanceVsCash: number;
  openCopiedPositions: number;
  pendingWithdrawalsCount: number;
  discrepancies: string[];
  status: 'BALANCED' | 'DISCREPANCY_DETECTED';
}

export type ReferralPhase = 1 | 2 | 3;

export interface ReferralUser {
  id: string;
  name: string;
  accountNumber: string;
  phase: ReferralPhase; // Phase 1 (5%), Phase 2 (3%), Phase 3 (2%)
  referrerName: string;
  totalSettledProfit: number;
  totalCommissionPaid: number;
  joinedAt: string;
  status: 'active' | 'pending_settlement';
}

export interface ReferralCommissionEvent {
  id: string;
  timestamp: string;
  fromClientName: string;
  fromAccountNumber: string;
  phase: ReferralPhase;
  phasePct: number; // 5%, 3%, 2%
  settledProfit: number; // 24-hr profit
  profitShareAmount: number; // 50% profit share
  commissionEarnedUsdt: number;
  status: 'CREDITED' | 'PAID_OUT';
}

export interface ReferralStats {
  referralCode: string;
  referralLink: string;
  phase1CommissionPct: number; // 5
  phase2CommissionPct: number; // 3
  phase3CommissionPct: number; // 2
  totalEarnedUsdt: number;
  availableBalanceUsdt: number;
  phase1Count: number;
  phase2Count: number;
  phase3Count: number;
  referrals: ReferralUser[];
  history: ReferralCommissionEvent[];
}

export type NotificationType =
  | 'SETTLEMENT_PROCESSED'
  | 'REFERRAL_COMMISSION'
  | 'SETTLEMENT_DUE'
  | 'AUTONOMOUS_WATCHER'
  | 'TRADE_CLOSED';

export interface ClientNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  amountUsdt?: number;
  timestamp: string;
  read: boolean;
  linkAction?: 'open_settlements' | 'open_referrals' | 'open_payment';
}

