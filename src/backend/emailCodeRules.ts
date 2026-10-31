/**
 * Rules for the 6-digit email confirmation code (pure functions, no I/O, unit-tested).
 *
 *  - The code is random (crypto), 6 digits, valid for 10 minutes, and only a salted hash of it is ever stored.
 *  - At most 5 wrong guesses per code, then it is locked and a new one must be requested.
 *  - A new code can be requested after 45 seconds, and at most 5 times per hour.
 *  - A code is tied to one account AND one email address; it cannot confirm any other.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const CODE_TTL_MS = 10 * 60_000;
export const RESEND_COOLDOWN_MS = 45_000;
export const MAX_ATTEMPTS = 5;
export const MAX_SENDS_PER_HOUR = 5;
const HOUR_MS = 3_600_000;

export interface CodeRecord {
  email: string;
  hash: string;
  salt: string;
  expiresAt: number;
  attempts: number;
  sentAt: number;
  windowStart: number;
  sendsInWindow: number;
}

export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function newSalt(): string {
  return randomBytes(16).toString('hex');
}

export function hashCode(uid: string, email: string, code: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${uid}:${email.trim().toLowerCase()}:${code}`).digest('hex');
}

export function canSend(rec: CodeRecord | null, now: number): { ok: true } | { ok: false; waitSeconds: number; reason: 'cooldown' | 'hourly' } {
  if (!rec) return { ok: true };
  const sinceLast = now - rec.sentAt;
  if (sinceLast < RESEND_COOLDOWN_MS) return { ok: false, waitSeconds: Math.ceil((RESEND_COOLDOWN_MS - sinceLast) / 1000), reason: 'cooldown' };
  const inWindow = now - rec.windowStart < HOUR_MS;
  if (inWindow && rec.sendsInWindow >= MAX_SENDS_PER_HOUR) {
    return { ok: false, waitSeconds: Math.ceil((rec.windowStart + HOUR_MS - now) / 1000), reason: 'hourly' };
  }
  return { ok: true };
}

/** A fresh record for a code just sent; keeps the hourly count going. */
export function recordFor(prev: CodeRecord | null, uid: string, email: string, code: string, now: number): CodeRecord {
  const salt = newSalt();
  const sameWindow = prev && now - prev.windowStart < HOUR_MS;
  return {
    email: email.trim().toLowerCase(),
    hash: hashCode(uid, email, code, salt),
    salt,
    expiresAt: now + CODE_TTL_MS,
    attempts: 0,
    sentAt: now,
    windowStart: sameWindow ? prev!.windowStart : now,
    sendsInWindow: sameWindow ? prev!.sendsInWindow + 1 : 1,
  };
}

export type CheckResult =
  | { ok: true }
  | { ok: false; reason: 'none' | 'expired' | 'locked' | 'format' | 'wrong'; attemptsLeft?: number };

/** Does not change the record; the caller stores `attempts + 1` after a 'wrong' result. */
export function checkCode(rec: CodeRecord | null, uid: string, email: string, codeRaw: unknown, now: number): CheckResult {
  if (!rec) return { ok: false, reason: 'none' };
  if (now >= rec.expiresAt) return { ok: false, reason: 'expired' };
  if (rec.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'locked' };
  const code = String(codeRaw ?? '').trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: 'format', attemptsLeft: MAX_ATTEMPTS - rec.attempts };
  if (rec.email !== email.trim().toLowerCase()) return { ok: false, reason: 'none' };
  const a = Buffer.from(hashCode(uid, email, code, rec.salt), 'hex');
  const b = Buffer.from(rec.hash, 'hex');
  if (a.length === b.length && timingSafeEqual(a, b)) return { ok: true };
  return { ok: false, reason: 'wrong', attemptsLeft: MAX_ATTEMPTS - rec.attempts - 1 };
}
