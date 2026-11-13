export type YieldTransactionType = 'allocation' | 'yield_distribution' | 'withdrawal_request';
export type YieldStatus = 'pending' | 'confirmed' | 'active' | 'rejected' | 'completed';

export interface UserYieldAllocation {
  id: string;
  userId: string;
  allocatedAmountUsdt: number;
  walletBalanceUsdt: number;
  totalYieldEarnedUsdt: number;
  dailyRatePct: number; // Fixed 2.0% per business day (Mon-Fri)
  businessDaysCompleted: number; // 0..100 business days completed
  termBusinessDays: number; // Fixed 100 business days
  status: 'active' | 'paused' | 'pending' | 'completed';
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
    submittedAt?: string;
  };
  createdAt: string;
  confirmedAt?: string;
}

export interface YieldPoolSummary {
  totalAllocatedUsdt: number;
  totalYieldEarnedUsdt: number;
  walletBalanceUsdt: number;
  currentDailyRatePct: number;
  businessDaysCompleted: number;
  termBusinessDays: number;
  nextDistributionMs: number;
  isTradingDay: boolean;
  activeDepositsCount: number;
}
