import { authHeaders } from './apiAuth';

export type ServiceModel = 'subscription' | 'profit_share';

export interface PlanView {
  available: boolean;
  paymentsOpen: boolean;
  model: ServiceModel | null;
  selectedAt: string | null;
  subscription: { active: boolean; periodEnd: string; daysLeft: number; cancelAtPeriodEnd: boolean } | null;
  price: { subscriptionUsdt: number; periodDays: number; feePct: number };
  treasuryAddress: string;
  canSwitch: { ok: boolean; reason?: string };
  stats: { activeSubscribers: number; profitShareClients: number };
}

export async function getPlanView(): Promise<PlanView | null> {
  try {
    const res = await fetch('/api/trade/service-plan', { headers: await authHeaders() });
    if (!res.ok) return null;
    const d = await res.json();
    return d.success ? (d as PlanView) : null;
  } catch {
    return null;
  }
}

async function post(path: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(body ?? {}),
    });
    const d = await res.json().catch(() => ({}));
    return res.ok && d.success ? { ok: true } : { ok: false, error: d.error || 'Request failed.' };
  } catch {
    return { ok: false, error: 'Network error. Please try again.' };
  }
}

export const selectPlan = (model: ServiceModel) => post('/api/trade/service-plan/select', { model });
export const paySubscription = (txHash: string) => post('/api/trade/service-plan/pay-subscription', { txHash });
export const cancelSubscription = () => post('/api/trade/service-plan/cancel');
