/**
 * Sends a 6-digit confirmation code by email and, when the person types it correctly, marks their email as
 * confirmed in Firebase (the same flag the verification link sets), so the rest of the site needs no change.
 *
 * Needs on Render:  RESEND_API_KEY (from resend.com)  and  EMAIL_FROM (an address on a domain verified there, for
 * example "CASTIMOFX <noreply@castimofx.com>").  Without them the feature reports "not available" and the
 * verification link keeps working. The code itself is never logged and only its salted hash is stored.
 */
import { adminAccessToken, adminProjectId, getDoc, isFirestoreAdminConfigured, setDoc, deleteDoc } from './firestoreAdmin';
import { CodeRecord, canSend, checkCode, newCode, recordFor } from './emailCodeRules';

export class EmailCodeError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'EmailCodeError';
    this.status = status;
  }
}

export function emailCodeConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && isFirestoreAdminConfigured());
}

async function sendEmail(to: string, code: string): Promise<void> {
  const from = String(process.env.EMAIL_FROM);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Your CASTIMOFX confirmation code: ${code}`,
      text: `Your CASTIMOFX confirmation code is ${code}.\n\nIt works for 10 minutes. If you did not ask for it, you can safely ignore this email.`,
      html: `<p>Your CASTIMOFX confirmation code is</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>It works for 10 minutes. If you did not ask for it, you can safely ignore this email.</p>`,
    }),
  });
  if (!res.ok) throw new EmailCodeError('We could not send the email just now. Please try again in a moment.', 502);
}

/** Marks the email as confirmed in Firebase Authentication. */
async function markVerified(uid: string): Promise<void> {
  const token = await adminAccessToken('https://www.googleapis.com/auth/cloud-platform');
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(adminProjectId())}/accounts:update`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid, emailVerified: true }),
  });
  if (!res.ok) throw new EmailCodeError('The code was right, but we could not record it just now. Please try again in a moment.', 502);
}

export interface CodeUser {
  uid: string;
  email?: string;
  emailVerified?: boolean;
}

export async function sendCode(user: CodeUser): Promise<{ sent: true; expiresInMinutes: number } | { sent: false; alreadyVerified: true }> {
  if (!emailCodeConfigured()) throw new EmailCodeError('Email codes are not available yet. Please use the verification link.', 503);
  if (user.emailVerified) return { sent: false, alreadyVerified: true };
  const email = String(user.email || '').trim().toLowerCase();
  if (!email) throw new EmailCodeError('Your account has no email address.');
  const now = Date.now();
  const prev = (await getDoc('email_codes', user.uid)) as unknown as CodeRecord | null;
  const gate = canSend(prev, now);
  if (!gate.ok) {
    throw new EmailCodeError(
      gate.reason === 'cooldown' ? `Please wait ${gate.waitSeconds} seconds before asking for another code.` : 'Too many codes were requested. Please try again later.',
      429
    );
  }
  const code = newCode();
  await sendEmail(email, code); // the code is stored only after the email was accepted
  await setDoc('email_codes', user.uid, recordFor(prev, user.uid, email, code, now) as any);
  return { sent: true, expiresInMinutes: 10 };
}

export async function verifyCode(user: CodeUser, codeRaw: unknown): Promise<{ verified: true }> {
  if (!emailCodeConfigured()) throw new EmailCodeError('Email codes are not available yet. Please use the verification link.', 503);
  const email = String(user.email || '').trim().toLowerCase();
  const rec = (await getDoc('email_codes', user.uid)) as unknown as CodeRecord | null;
  const r = checkCode(rec, user.uid, email, codeRaw, Date.now());
  if (r.ok) {
    await markVerified(user.uid);
    await deleteDoc('email_codes', user.uid);
    return { verified: true };
  }
  if (r.reason === 'wrong' && rec) await setDoc('email_codes', user.uid, { ...rec, attempts: rec.attempts + 1 } as any);
  const message: Record<string, string> = {
    none: 'No code is waiting. Please ask for a new one.',
    expired: 'That code has expired. Please ask for a new one.',
    locked: 'Too many wrong tries. Please ask for a new code.',
    format: 'Enter the 6 digits from the email.',
    wrong: `That code is not right.${r.attemptsLeft !== undefined ? ` ${r.attemptsLeft} ${r.attemptsLeft === 1 ? 'try' : 'tries'} left.` : ''}`,
  };
  throw new EmailCodeError(message[r.reason] || 'That code could not be checked.', r.reason === 'wrong' ? 400 : 409);
}
