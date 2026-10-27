/**
 * Service model rules (pure functions, no I/O, unit-tested).
 *
 * A client is on exactly one model at a time:
 *   - 'subscription'  : a flat USDT price per period, paid up front. Copying runs only while paid up.
 *   - 'profit_share'  : the platform takes a share of NEW profit (see profitShare.ts).
 *
 * Stored per client in Firestore (`service_plans/{userId}`), written only by the server.
 */

export type ServiceModel = 'subscription' | 'profit_share';

export const DEFAULT_SUBSCRIPTION_PRICE_USDT = 100;
export const DEFAULT_SUBSCRIPTION_PERIOD_DAYS = 30;

export interface SubscriptionState {
  periodStart: string;
  periodEnd: string;
  /** The client asked not to renew. Access continues to periodEnd; there are no automatic charges. */
  cancelAtPeriodEnd?: boolean;
  lastTxHash?: string;
  paidUsdt?: number;
}

export interface PlanRecord {
  userId: string;
  model: ServiceModel;
  selectedAt: string;
  subscription?: SubscriptionState;
}

export function isServiceModel(v: unknown): v is ServiceModel {
  return v === 'subscription' || v === 'profit_share';
}

export function subscriptionActive(plan: Pick<PlanRecord, 'model' | 'subscription'> | null | undefined, nowMs: number): boolean {
  if (!plan || plan.model !== 'subscription' || !plan.subscription) return false;
  const end = Date.parse(plan.subscription.periodEnd);
  return Number.isFinite(end) && end > nowMs;
}

/** Paying early adds to the time left; paying late starts from now. */
export function nextPeriod(currentEndIso: string | undefined, nowMs: number, periodDays: number): { start: string; end: string } {
  const currentEnd = currentEndIso ? Date.parse(currentEndIso) : NaN;
  const startMs = Number.isFinite(currentEnd) && currentEnd > nowMs ? currentEnd : nowMs;
  return { start: new Date(startMs).toISOString(), end: new Date(startMs + periodDays * 24 * 3600 * 1000).toISOString() };
}

export interface SwitchContext {
  connected: boolean;
  hasPendingInvoice: boolean;
  nowMs: number;
}

/**
 * Whether the client may change to `target`. The first choice is always allowed. After that the two
 * models can never overlap: no switching while connected (profit not yet settled could be lost),
 * with an unpaid invoice, or while a paid subscription is still running.
 */
export function canSelectModel(
  current: PlanRecord | null,
  target: ServiceModel,
  ctx: SwitchContext
): { ok: boolean; reason?: string } {
  if (!current) return { ok: true };
  if (current.model === target) return { ok: true };
  if (ctx.connected) return { ok: false, reason: 'Disconnect your MT5 account before changing your service plan.' };
  if (ctx.hasPendingInvoice) return { ok: false, reason: 'Pay your outstanding profit-share invoice before changing your plan.' };
  if (subscriptionActive(current, ctx.nowMs)) {
    return { ok: false, reason: 'Your monthly subscription is still running. You can change plan after it ends.' };
  }
  return { ok: true };
}

export function daysLeft(periodEndIso: string | undefined, nowMs: number): number {
  const end = periodEndIso ? Date.parse(periodEndIso) : NaN;
  if (!Number.isFinite(end) || end <= nowMs) return 0;
  return Math.ceil((end - nowMs) / (24 * 3600 * 1000));
}
