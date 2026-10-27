import { authHeaders } from './apiAuth';

export interface WithdrawalRow {
  id: string;
  gross: number;
  fee: number;
  feePct: number;
  net: number;
  status: 'pending' | 'processing' | 'completed' | 'rejected' | 'failed';
  wallet: string;
  requestedAt: string;
  cycleCutoff: string;
  expectedBy: string;
  txHash: string | null;
  reason: string | null;
  updatedAt: string;
  userId?: string;
}

export interface ReferralSummary {
  code: string;
  link: string;
  ratesPct: number[];
  counts: { level1: number; level2: number; level3: number };
  earnedUsdt: number;
  heldUsdt: number;
  availableUsdt: number;
  recentCommissions: Array<{ id: string; level: number; ratePct: number; amountUsdt: number; createdAt: string }>;
  withdrawals: WithdrawalRow[];
  rules: { minUsdt: number; feePct: number; processingHours: number };
  schedule: { serverNow: string; nextCutoff: string; nextExpectedBy: string };
}

export interface NotificationItem {
  id: string;
  kind: 'personal' | 'activity';
  title: string;
  message: string;
  at: string;
}

async function call<T = any>(path: string, body?: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    return res.ok && d.success ? { ok: true, data: d as T } : { ok: false, error: d.error || 'Request failed.' };
  } catch {
    return { ok: false, error: 'Network error. Please try again.' };
  }
}

export const getReferralSummary = () => call<ReferralSummary>('/api/referrals/summary');
export const requestWithdrawal = (amount: number, wallet: string) => call('/api/referrals/withdraw', { amount, wallet });
export const getNotifications = () => call<{ items: NotificationItem[] }>('/api/referrals/notifications');
export const adminGetWithdrawals = () => call<{ withdrawals: WithdrawalRow[] }>('/api/referrals/admin/withdrawals');
export const adminSetWithdrawalStatus = (id: string, status: string, reason?: string) =>
  call(`/api/referrals/admin/withdrawals/${encodeURIComponent(id)}/status`, { status, reason });
export const adminCompleteWithdrawal = (id: string, txHash: string) =>
  call(`/api/referrals/admin/withdrawals/${encodeURIComponent(id)}/complete`, { txHash });

const REF_KEY = 'castimofx_ref';

/** Remembers ?ref=CODE from the link so it can be applied after sign-up. */
export function captureReferralFromUrl(): void {
  try {
    const code = new URLSearchParams(window.location.search).get('ref');
    if (code && /^[A-Za-z0-9]{6,12}$/.test(code)) localStorage.setItem(REF_KEY, code.toUpperCase());
  } catch {
    // storage may be blocked; nothing else to do
  }
}

/** Sends a remembered code to the server once the person is signed in. The server decides if it counts. */
export async function attachPendingReferral(): Promise<void> {
  let code: string | null = null;
  try {
    code = localStorage.getItem(REF_KEY);
  } catch {
    return;
  }
  if (!code) return;
  const r = await call('/api/referrals/attach', { code });
  // Success or a definite "no" both mean the code should not be tried again. A network error should.
  if (r.ok || (r.error && r.error !== 'Network error. Please try again.')) {
    try {
      localStorage.removeItem(REF_KEY);
    } catch {
      // ignore
    }
  }
}
