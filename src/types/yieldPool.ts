export type YieldTransactionType = 'allocation' | 'yield_distribution' | 'withdrawal_request';
export type YieldStatus = 'pending' | 'confirmed' | 'active' | 'rejected' | 'completed';

export interface UserYieldAllocation {
  id: string;
  userId: string;
  allocatedAmountUsdt: number;
  walletBalanceUsdt: number;
  totalYieldEarnedUsdt: number;
  dailyRatePct: number; // e.g. 1.25% (up to 2.0%)
  status: 'active' | 'paused' | 'pending';
  lastDistributionAt?: string; // ISO string
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
}

export interface YieldLedgerEntry {
  id: string;
  userId: string;
  allocationId?: string;
  type: YieldTransactionType;
  amount: number;
  netAmount: number;
  feeAmount?: number;
  txHash?: string;
  status: YieldStatus;
  description: string;
  network?: string; // default TRC20
  recipientAddress?: string;
  metadata?: {
    dailyRatePct?: number;
    distributionDate?: string;
    tradingDay?: boolean;
    marketCondition?: string;
  };
  createdAt: string;
  confirmedAt?: string;
}

export interface YieldPoolSummary {
  totalAllocatedUsdt: number;
  totalYieldEarnedUsdt: number;
  walletBalanceUsdt: number;
  currentDailyRatePct: number;
  nextDistributionMs: number;
  isTradingDay: boolean;
  activeDepositsCount: number;
}
