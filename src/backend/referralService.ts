/**
 * Referral codes, commissions, withdrawals and the activity feed, all kept in Firestore and written
 * only by this server. Every figure comes from a stored record. Nothing is estimated.
 *
 * One server instance is assumed: money changes for one user run one at a time (see `locked`).
 */
import { overdueText, reminderText } from './invoiceReminders.ts';
import { randomInt } from 'node:crypto';
import { DocExistsError, createDoc, getDoc, isFirestoreAdminConfigured, listAll, queryEquals, queryEqualsWithIds, setDoc } from './firestoreAdmin.ts';
import { TXID_PATTERN as HASH, checkUsdtPayment, fetchTxEvents, isTxFinalAndSuccessful, tronAddressToHex20 } from './tron.ts';
import {
  REFERRAL_RATES_PCT,
  WEEKLY_EQUITY_RATES_PCT,
  weeklyEquityLines,
  WITHDRAW_FEE_PCT,
  WITHDRAW_MIN_USDT,
  PROCESSING_HOURS,
  type WithdrawalStatus,
  availableBalance,
  canMoveStatus,
  commissionLines,
  computeWithdrawal,
  maskName,
  processingWindow,
  validateWithdrawAmount,
} from './referrals.ts';

import { dailyNoticeText } from './profitShareRealized.ts';
import { copyNoticeFor } from './copyNotice.ts';

export class ReferralError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ReferralError';
    this.status = status;
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BASE_URL = (process.env.PUBLIC_SITE_URL || 'https://castimofx.com').replace(/\/+$/, '');

const queues = new Map<string, Promise<unknown>>();
/** Runs `fn` after any earlier call for the same key has finished. */
function locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(key, next.catch(() => undefined));
  return next;
}

function need() {
  if (!isFirestoreAdminConfigured()) throw new ReferralError('This feature is not open yet. Please contact support.', 503);
}

type Doc = Record<string, any>;

export async function getOrCreateCode(uid: string): Promise<string> {
  need();
  const owned = (await getDoc('referral_code_owners', uid)) as Doc | null;
  if (owned?.code) return String(owned.code);
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]).join('');
    try {
      await createDoc('referral_codes', code, { uid, createdAt: new Date().toISOString() });
    } catch (e) {
      if (e instanceof DocExistsError) continue;
      throw e;
    }
    try {
      await createDoc('referral_code_owners', uid, { code });
      return code;
    } catch (e) {
      if (!(e instanceof DocExistsError)) throw e;
      return String(((await getDoc('referral_code_owners', uid)) as Doc)?.code);
    }
  }
  throw new ReferralError('Could not create your referral code. Please try again.', 500);
}

/** Up to three referrers above `uid`: direct referrer first. Stops at loops. */
export async function chainFor(uid: string): Promise<string[]> {
  const chain: string[] = [];
  let cur = uid;
  for (let i = 0; i < 3; i++) {
    const r = (await getDoc('referrals', cur)) as Doc | null;
    const up = r?.referrerUid ? String(r.referrerUid) : '';
    if (!up || up === uid || chain.includes(up)) break;
    chain.push(up);
    cur = up;
  }
  return chain;
}

/** Links a new account to whoever invited it. Allowed once, and only before the account has chosen a plan. */
export async function attachReferrer(uid: string, codeRaw: unknown): Promise<void> {
  need();
  const code = String(codeRaw ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6,12}$/.test(code)) throw new ReferralError('That referral link is not valid.');
  const owner = (await getDoc('referral_codes', code)) as Doc | null;
  if (!owner?.uid) throw new ReferralError('That referral link is not valid.', 404);
  const referrer = String(owner.uid);
  if (referrer === uid) throw new ReferralError('You cannot refer yourself.');
  if (await getDoc('service_plans', uid)) throw new ReferralError('A referral can only be added before you choose a plan.', 409);
  // The new account must not already sit above the referrer (that would make a loop).
  if ((await chainFor(referrer)).includes(uid)) throw new ReferralError('That referral link cannot be used.');
  try {
    await createDoc('referrals', uid, { referrerUid: referrer, code, attachedAt: new Date().toISOString() });
  } catch (e) {
    if (e instanceof DocExistsError) throw new ReferralError('Your account already has a referrer.', 409);
    throw e;
  }
}

/**
 * Credits commissions for a payment the platform has really received. Safe to call twice for the same
 * `sourceId`: each credit has a fixed id, so it can only exist once.
 */
export async function accrueCommissions(
  sourceUid: string,
  paidUsdt: number,
  sourceType: 'profit_invoice' | 'subscription',
  sourceId: string
): Promise<void> {
  if (!isFirestoreAdminConfigured()) return;
  const lines = commissionLines(await chainFor(sourceUid), paidUsdt);
  for (const l of lines) {
    try {
      await createDoc('referral_commissions', `${sourceId}-L${l.level}`, {
        beneficiaryUid: l.beneficiaryUid,
        sourceUid,
        level: l.level,
        ratePct: l.ratePct,
        basePaidUsdt: paidUsdt,
        amountUsdt: l.amountUsdt,
        sourceType,
        sourceId,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      if (!(e instanceof DocExistsError)) throw e;
    }
  }
}

/**
 * Credits one trading week's equity commission for a connected client, on the equity at the close of the week. Safe to call many
 * times: each credit has a fixed id per client, week and level, so it can only exist once. Returns how many credits were new.
 */
export async function accrueWeeklyEquityCommission(sourceUid: string, equityUsd: number, weekKey: string): Promise<number> {
  if (!isFirestoreAdminConfigured()) return 0;
  const lines = weeklyEquityLines(await chainFor(sourceUid), equityUsd);
  const sourceId = `eqw-${sourceUid}-${weekKey}`;
  let added = 0;
  for (const l of lines) {
    try {
      await createDoc('referral_commissions', `${sourceId}-L${l.level}`, {
        beneficiaryUid: l.beneficiaryUid,
        sourceUid,
        level: l.level,
        ratePct: l.ratePct,
        basePaidUsdt: Math.round(equityUsd * 100) / 100, // the client's equity at the close of the week
        amountUsdt: l.amountUsdt,
        sourceType: 'weekly_equity',
        sourceId,
        week: weekKey,
        createdAt: new Date().toISOString(),
      });
      added++;
    } catch (e) {
      if (!(e instanceof DocExistsError)) throw e;
    }
  }
  return added;
}

/** The TRON address a referrer saved for withdrawals ('' when none). */
export async function savedWallet(uid: string): Promise<string> {
  const w = (await getDoc('referral_wallets', uid).catch(() => null)) as Doc | null;
  return String(w?.address ?? '');
}

/** Saves the referrer's TRON (TRC20) address; every withdrawal request then goes to the admin with it. */
export async function saveWallet(uid: string, addressRaw: unknown): Promise<string> {
  need();
  const address = String(addressRaw ?? '').trim();
  if (tronAddressToHex20(address) === null) throw new ReferralError('Enter a valid TRON (TRC20) wallet address that starts with T.');
  await setDoc('referral_wallets', uid, { address, updatedAt: new Date().toISOString() });
  return address;
}

async function displayName(uid: string): Promise<string> {
  const u = (await getDoc('users', uid).catch(() => null)) as Doc | null;
  return String(u?.displayName ?? '');
}

export async function summary(uid: string) {
  need();
  const code = await getOrCreateCode(uid);
  const commissions = (await queryEquals('referral_commissions', 'beneficiaryUid', uid)) as Doc[];
  const withdrawals = (await queryEquals('referral_withdrawals', 'userId', uid)) as Doc[];
  const bal = availableBalance(commissions as any, withdrawals as any);

  // Who signed up under me, three levels deep (names are masked).
  const levels: Array<Array<{ name: string; joinedAt: string }>> = [[], [], []];
  let frontier = [uid];
  for (let lv = 0; lv < 3 && frontier.length; lv++) {
    const next: string[] = [];
    for (const parent of frontier) {
      const kids = (await queryEqualsWithIds('referrals', 'referrerUid', parent)) as Doc[];
      for (const k of kids) {
        const kid = String(k._id ?? ''); // the referral record is stored under the new member's own id
        levels[lv].push({ name: '', joinedAt: String(k.attachedAt ?? '') });
        if (kid) next.push(kid);
      }
    }
    frontier = next;
  }

  const now = Date.now();
  const win = processingWindow(now);
  return {
    code,
    link: `${BASE_URL}/?ref=${code}`,
    ratesPct: [...REFERRAL_RATES_PCT],
    weeklyRatesPct: [...WEEKLY_EQUITY_RATES_PCT],
    wallet: await savedWallet(uid),
    counts: { level1: levels[0].length, level2: levels[1].length, level3: levels[2].length },
    earnedUsdt: bal.earned,
    heldUsdt: bal.held,
    availableUsdt: bal.available,
    recentCommissions: commissions
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 20)
      .map((c) => ({
        id: `${c.sourceId}-L${c.level}`,
        level: c.level,
        ratePct: c.ratePct,
        amountUsdt: c.amountUsdt,
        basePaidUsdt: c.basePaidUsdt ?? null,
        sourceType: c.sourceType === 'subscription' || c.sourceType === 'profit_invoice' || c.sourceType === 'weekly_equity' || c.sourceType === 'daily_equity' ? c.sourceType : null,
        createdAt: c.createdAt,
      })),
    withdrawals: withdrawals
      .sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)))
      .map(publicWithdrawal),
    rules: { minUsdt: WITHDRAW_MIN_USDT, feePct: WITHDRAW_FEE_PCT, processingHours: PROCESSING_HOURS },
    schedule: { serverNow: new Date(now).toISOString(), nextCutoff: win.cutoff, nextExpectedBy: win.expectedBy },
  };
}

function publicWithdrawal(w: Doc) {
  return {
    id: w.id,
    gross: w.gross,
    fee: w.fee,
    feePct: w.feePct,
    net: w.net,
    status: w.status,
    wallet: w.wallet,
    requestedAt: w.requestedAt,
    cycleCutoff: w.cycleCutoff,
    expectedBy: w.expectedBy,
    txHash: w.txHash || null,
    reason: w.reason || null,
    updatedAt: w.updatedAt,
  };
}

export function requestWithdrawal(uid: string, amountRaw: unknown, walletRaw: unknown) {
  need();
  return locked(`wd:${uid}`, async () => {
    // The address typed now, or else the one saved in the Referral Hub.
    const wallet = String(walletRaw ?? '').trim() || (await savedWallet(uid));
    if (tronAddressToHex20(wallet) === null) throw new ReferralError('Enter a valid TRON (TRC20) wallet address that starts with T.');

    const commissions = (await queryEquals('referral_commissions', 'beneficiaryUid', uid)) as Doc[];
    const withdrawals = (await queryEquals('referral_withdrawals', 'userId', uid)) as Doc[];
    if (withdrawals.some((w) => w.status === 'pending' || w.status === 'processing')) {
      throw new ReferralError('You already have a withdrawal in progress. Wait until it is finished.', 409);
    }
    const bal = availableBalance(commissions as any, withdrawals as any);
    const v = validateWithdrawAmount(amountRaw, bal.available);
    if (!v.ok) throw new ReferralError(v.error);

    const nowMs = Date.now();
    const fee = computeWithdrawal(v.amount);
    const win = processingWindow(nowMs);
    const id = `wd-${uid}-${nowMs}`;
    const record: Doc = {
      id,
      userId: uid,
      gross: fee.gross,
      fee: fee.fee,
      feePct: WITHDRAW_FEE_PCT,
      net: fee.net,
      wallet,
      status: 'pending',
      requestedAt: new Date(nowMs).toISOString(),
      cycleCutoff: win.cutoff,
      expectedBy: win.expectedBy,
      txHash: '',
      updatedAt: new Date(nowMs).toISOString(),
    };
    await createDoc('referral_withdrawals', id, record);
    return publicWithdrawal(record);
  });
}

// ---------- Administrators ----------

export async function adminListWithdrawals() {
  need();
  const rows = (await listAll('referral_withdrawals')) as Doc[];
  return rows.sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt))).map((w) => ({ ...publicWithdrawal(w), userId: w.userId }));
}

async function loadWithdrawal(id: string): Promise<Doc> {
  const w = (await getDoc('referral_withdrawals', String(id))) as Doc | null;
  if (!w) throw new ReferralError('Withdrawal not found.', 404);
  return w;
}

export function adminSetStatus(adminUid: string, id: string, to: unknown, reason?: unknown) {
  need();
  return locked(`wd-admin:${id}`, async () => {
    if (to !== 'processing' && to !== 'rejected' && to !== 'failed') throw new ReferralError('Unknown status.');
    const w = await loadWithdrawal(id);
    if (!canMoveStatus(w.status as WithdrawalStatus, to)) throw new ReferralError(`A ${w.status} withdrawal cannot become ${to}.`, 409);
    if ((to === 'rejected' || to === 'failed') && !String(reason ?? '').trim()) throw new ReferralError('Please give a reason.');
    const updated = { ...w, status: to, reason: String(reason ?? '').slice(0, 300), updatedBy: adminUid, updatedAt: new Date().toISOString() };
    await setDoc('referral_withdrawals', w.id, updated);
    return publicWithdrawal(updated);
  });
}

/** Completed only when the payout is found on the TRON blockchain, confirmed, and large enough. */
export function adminComplete(adminUid: string, id: string, txHashRaw: unknown) {
  need();
  return locked(`wd-admin:${id}`, async () => {
    const txHash = String(txHashRaw ?? '').trim().toLowerCase();
    if (!HASH.test(txHash)) throw new ReferralError('Paste the 64-character transaction ID of the payout.');
    const w = await loadWithdrawal(id);
    if (!canMoveStatus(w.status as WithdrawalStatus, 'completed')) throw new ReferralError(`A ${w.status} withdrawal cannot be completed.`, 409);

    let events: any[];
    let final: boolean;
    try {
      [events, final] = await Promise.all([fetchTxEvents(txHash), isTxFinalAndSuccessful(txHash)]);
    } catch {
      throw new ReferralError('Could not reach the TRON network to check this payout. Try again in a minute.', 502);
    }
    const check = checkUsdtPayment(events, { treasury: String(w.wallet), minUsdt: Number(w.net), notBeforeMs: Date.parse(String(w.requestedAt)) - 15 * 60_000 });
    if (!check.ok) throw new ReferralError(check.error || 'That payout does not match this withdrawal.');
    if (!final) throw new ReferralError('That transaction is not fully confirmed yet. Try again in a few minutes.', 409);

    try {
      await createDoc('used_tx_hashes', txHash, { invoiceId: `withdrawal-${w.id}`, userId: w.userId, at: new Date().toISOString() });
    } catch (e) {
      if (!(e instanceof DocExistsError)) throw e;
      const used = (await getDoc('used_tx_hashes', txHash)) as Doc | null;
      if (!used || used.invoiceId !== `withdrawal-${w.id}`) throw new ReferralError('That transaction was already used for something else.', 409);
    }
    const updated = { ...w, status: 'completed', txHash, updatedBy: adminUid, updatedAt: new Date().toISOString() };
    await setDoc('referral_withdrawals', w.id, updated);
    return publicWithdrawal(updated);
  });
}

// ---------- Activity feed ----------

/** Records a real platform event once. `eventId` makes it idempotent. Never throws. */
export async function recordEvent(type: 'SUBSCRIBED' | 'ACCOUNT_CONNECTED' | 'PROFIT_SHARE_SELECTED', uid: string, eventId: string): Promise<void> {
  if (!isFirestoreAdminConfigured()) return;
  try {
    await createDoc('platform_events', eventId, { type, who: maskName(await displayName(uid)), at: new Date().toISOString() });
  } catch (e) {
    if (!(e instanceof DocExistsError)) console.warn('[EVENTS] could not record event:', (e as Error)?.message);
  }
}

export async function notificationsFor(uid: string) {
  if (!isFirestoreAdminConfigured()) return { items: [] as any[] };
  const items: Array<{ id: string; kind: 'personal' | 'activity'; title: string; message: string; at: string }> = [];

  // Only what belongs to this client's own account goes in here. Other clients' activity (plan choices, subscriptions,
  // connections) is never shown to anyone.
  const withdrawals = (await queryEquals('referral_withdrawals', 'userId', uid).catch(() => [])) as Doc[];
  const wdText: Record<string, string> = {
    pending: 'was submitted',
    processing: 'is being processed',
    completed: 'was paid',
    rejected: 'was rejected',
    failed: 'failed',
  };
  for (const w of withdrawals) {
    items.push({
      id: `wd-${w.id}-${w.status}`,
      kind: 'personal',
      title: 'Referral withdrawal',
      message: `Your withdrawal of $${Number(w.gross).toFixed(2)} ${wdText[w.status] ?? w.status}.${w.reason ? ` Reason: ${w.reason}` : ''}`,
      at: String(w.updatedAt || w.requestedAt),
    });
  }
  const commissions = (await queryEquals('referral_commissions', 'beneficiaryUid', uid).catch(() => [])) as Doc[];
  for (const c of commissions.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 10)) {
    items.push({
      id: `cm-${c.sourceId}-L${c.level}`,
      kind: 'personal',
      title: 'Referral commission',
      message: c.sourceType === 'weekly_equity' || c.sourceType === 'daily_equity'
        ? `Weekly commission: $${Number(c.amountUsdt).toFixed(2)} (level ${c.level}, ${c.ratePct}% of a client's equity at the close of the trading week).`
        : `You earned $${Number(c.amountUsdt).toFixed(2)} (level ${c.level}, ${c.ratePct}%).`,
      at: String(c.createdAt),
    });
  }
  // The daily Profit Share update (one per day, written by the billing service from the client's real closed trades).
  const daily = (await queryEquals('ps_daily', 'userId', uid).catch(() => [])) as Doc[];
  for (const d of daily.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 7)) {
    const text = dailyNoticeText({
      date: String(d.date),
      dayPnl: Number(d.dayPnl) || 0,
      dayTrades: Number(d.dayTrades) || 0,
      periodPnl: Number(d.periodPnl) || 0,
      shareSoFarUsdt: Number(d.shareSoFarUsdt) || 0,
      feePct: Number(d.feePct) || 50,
      nextSettlementAt: d.nextSettlementAt ? String(d.nextSettlementAt) : null,
    });
    items.push({ id: `ps-${d.date}`, kind: 'personal', title: text.title, message: text.message, at: String(d.createdAt) });
  }
  // An account that is connected but below the minimum equity says so plainly (and says when copying starts).
  const copyNotice = copyNoticeFor((await getDoc('mt5_accounts', uid).catch(() => null)) as Doc | null);
  if (copyNotice) items.push({ id: copyNotice.id, kind: 'personal', title: copyNotice.title, message: copyNotice.message, at: copyNotice.at });
  const invoices = (await queryEquals('profit_invoices', 'userId', uid).catch(() => [])) as Doc[];
  const nowMs = Date.now();
  for (const i of invoices) {
    const amount = Number(i.amountDueUsdt);
    const overdue = i.status === 'pending' && Date.parse(String(i.dueAt)) <= nowMs;
    if (overdue) {
      const t = overdueText(amount);
      items.push({ id: `inv-${i.id}-overdue`, kind: 'personal', title: t.title, message: t.message, at: String(i.dueAt) });
      continue;
    }
    items.push({
      id: `inv-${i.id}-${i.status}`,
      kind: 'personal',
      title: 'Profit-share invoice',
      message: i.status === 'paid' ? `Invoice of $${amount.toFixed(2)} was paid.` : `Invoice of $${amount.toFixed(2)} is due before midnight GMT on ${String(i.dueAt).slice(0, 10)} (23:59 GMT).`,
      at: String(i.status === 'paid' ? i.paidAt || i.createdAt : i.createdAt),
    });
  }
  // The hourly reminders, shown only while their invoice is still waiting for payment.
  const stillOwed = new Set(invoices.filter((i) => i.status === 'pending' && Date.parse(String(i.dueAt)) > nowMs).map((i) => String(i.id)));
  const reminders = (await queryEquals('invoice_reminders', 'userId', uid).catch(() => [])) as Doc[];
  for (const r of reminders) {
    if (!stillOwed.has(String(r.invoiceId))) continue;
    const t = reminderText(Number(r.amountDueUsdt), Number(r.hoursLeft), String(r.dueAt));
    items.push({ id: `rem-${r.invoiceId}-${r.hoursLeft}`, kind: 'personal', title: t.title, message: t.message, at: String(r.createdAt) });
  }
  items.sort((a, b) => b.at.localeCompare(a.at));
  return { items: items.slice(0, 40) };
}
