/**
 * Sends the payment-reminder emails (through Resend, the same as the confirmation codes) to a client's CONFIRMED address, which is
 * looked up in Firebase Authentication by their id. Nothing is sent when Resend is not set up, when the client has no confirmed
 * address, or when the lookup fails; the in-app reminder is always written either way.
 *
 * Needs on Render: RESEND_API_KEY and EMAIL_FROM (the same two the email codes use).
 */
import { adminAccessToken, adminProjectId, isFirestoreAdminConfigured } from './firestoreAdmin.ts';
import type { ReminderMail } from './invoiceReminders.ts';

export type MailResult = 'sent' | 'skipped' | 'failed';
export interface ReminderMailer {
  send(uid: string, mail: ReminderMail): Promise<MailResult>;
}

export function reminderEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && isFirestoreAdminConfigured());
}

/** The client's email address when Firebase says it is confirmed; null otherwise. */
async function confirmedEmail(uid: string): Promise<string | null> {
  const token = await adminAccessToken('https://www.googleapis.com/auth/cloud-platform');
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(adminProjectId())}/accounts:lookup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: [uid] }),
  });
  if (!res.ok) throw new Error(`lookup ${res.status}`);
  const u = ((await res.json()) as any)?.users?.[0];
  const email = typeof u?.email === 'string' ? u.email.trim() : '';
  return u?.emailVerified === true && email ? email : null;
}

export const resendReminderMailer: ReminderMailer = {
  async send(uid, mail) {
    if (!reminderEmailConfigured()) return 'skipped';
    try {
      const to = await confirmedEmail(uid);
      if (!to) return 'skipped';
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: String(process.env.EMAIL_FROM), to: [to], subject: mail.subject, text: mail.text, html: mail.html }),
      });
      return res.ok ? 'sent' : 'failed';
    } catch {
      return 'failed';
    }
  },
};
