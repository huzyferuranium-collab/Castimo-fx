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
