/**
 * Payment reminders for 50% Profit Share clients (pure functions, no I/O, unit-tested).
 *
 * An invoice must be paid before midnight GMT (see invoiceDueAt). In the last REMINDER_WINDOW_HOURS hours before that, an hourly
 * watcher writes one reminder per hour left, so the client sees "6 hours left", "5 hours left" ... "1 hour left" in their notifications.
 */

/** How many hours before the due time the hourly reminders start. */
export const REMINDER_WINDOW_HOURS = 6;

/** Whole hours left until the due time (rounded up, so 59 minutes left is "1 hour"). 0 once it is past. */
export function hoursLeft(dueAtIso: string, nowMs: number): number {
  const due = Date.parse(dueAtIso);
  if (!Number.isFinite(due)) return 0;
  return Math.max(0, Math.ceil((due - nowMs) / 3_600_000));
}

/** The reminder an invoice needs right now, or null (not pending, already overdue, or still more than the window away). */
export function reminderDue(invoice: { status?: string; dueAt?: string }, nowMs: number): { hoursLeft: number } | null {
  if (invoice.status !== 'pending' || !invoice.dueAt) return null;
  const h = hoursLeft(invoice.dueAt, nowMs);
  return h >= 1 && h <= REMINDER_WINDOW_HOURS ? { hoursLeft: h } : null;
}

/** Fixed id per invoice and hours-left, so each reminder is written once however often the watcher runs. */
export function reminderId(invoiceId: string, hours: number): string {
  return `${invoiceId}-h${hours}`;
}

const gmtTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }) + ' GMT';

/** The friendly wording of a reminder. */
export function reminderText(amountUsdt: number, hours: number, dueAtIso: string): { title: string; message: string } {
  const left = `${hours} hour${hours === 1 ? '' : 's'}`;
  return {
    title: hours <= 1 ? 'Last hour to pay your share' : 'Reminder: your profit-share payment',
    message: `Your 50% share of $${amountUsdt.toFixed(2)} is due by ${gmtTime(dueAtIso)} tonight, about ${left} from now. If it is not paid by then, copying pauses until it is. Open the 50% Profit Share tab to pay.`,
  };
}

/** The wording for an invoice that has passed its due time unpaid. */
export function overdueText(amountUsdt: number): { title: string; message: string } {
  return {
    title: 'Copying paused: payment not received',
    message: `Your 50% share of $${amountUsdt.toFixed(2)} was not received before midnight GMT, so copying is paused. It resumes as soon as the payment is confirmed. Open the 50% Profit Share tab to pay.`,
  };
}

/** The reminders that are also sent by email (a few, not one every hour, so the inbox is not flooded): 6, 3 and 1 hours before the due time. */
export const EMAIL_REMINDER_HOURS: readonly number[] = [6, 3, 1];

export function emailWanted(hours: number): boolean {
  return EMAIL_REMINDER_HOURS.includes(hours);
}

export interface ReminderMail {
  subject: string;
  text: string;
  html: string;
}

const SITE = 'https://castimofx.com';
const wrap = (heading: string, body: string) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#0f172a"><h2 style="margin:0 0 12px">${heading}</h2>${body}` +
  `<p style="margin:20px 0"><a href="${SITE}" style="background:#e11d48;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:700">Open CASTIMOFX</a></p>` +
  `<p style="font-size:12px;color:#64748b">Trading involves risk. You are receiving this because you use the 50% Profit Share plan on CASTIMOFX.</p></div>`;

/** The email for a reminder (6, 3 or 1 hours before the due time). */
export function reminderEmail(amountUsdt: number, hours: number, dueAtIso: string): ReminderMail {
  const left = `${hours} hour${hours === 1 ? '' : 's'}`;
  const due = gmtTime(dueAtIso);
  const amount = `$${amountUsdt.toFixed(2)}`;
  return {
    subject: hours <= 1 ? `Last hour: your CASTIMOFX payment is due by ${due}` : `Reminder: your CASTIMOFX payment is due by ${due} tonight`,
    text: `Hello,\n\nA friendly reminder: your 50% Profit Share payment of ${amount} is due by ${due} tonight, about ${left} from now.\nIf it is not paid by then, copying pauses until it is paid.\n\nOpen the 50% Profit Share tab at ${SITE} to pay.\n\nTrading involves risk.`,
    html: wrap('Your payment is due tonight', `<p>A friendly reminder: your 50% Profit Share payment of <b>${amount}</b> is due by <b>${due}</b> tonight, about ${left} from now.</p><p>If it is not paid by then, copying pauses until it is paid.</p><p>Open the <b>50% Profit Share</b> tab to pay.</p>`),
  };
}

/** The email sent once when an invoice has not been paid in time and copying has paused. */
export function overdueEmail(amountUsdt: number): ReminderMail {
  const amount = `$${amountUsdt.toFixed(2)}`;
  return {
    subject: 'Copying paused: your CASTIMOFX payment was not received',
    text: `Hello,\n\nYour 50% Profit Share payment of ${amount} was not received before midnight GMT, so copying is paused.\nIt resumes as soon as the payment is confirmed.\n\nOpen the 50% Profit Share tab at ${SITE} to pay.\n\nTrading involves risk.`,
    html: wrap('Copying is paused', `<p>Your 50% Profit Share payment of <b>${amount}</b> was not received before midnight GMT, so copying is paused.</p><p>It resumes as soon as the payment is confirmed.</p><p>Open the <b>50% Profit Share</b> tab to pay.</p>`),
  };
}
