/**
 * WhatsApp phone verification (Twilio Verify) with one verified number per account.
 *
 * - Twilio generates, sends and checks the code. We never see or store it.
 * - The browser cannot mark itself verified: the result lives in `phone_verifications/{uid}`, which
 *   only this server can write (see firestore.rules).
 * - A verified number is claimed in `verified_phones/{hmac(number)}` with an atomic create, so two
 *   accounts can never both hold the same number, even if they verify at the same moment.
 *   Only an HMAC of the number is stored there, never the number itself.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export class PhoneError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'PHONE_ERROR') {
    super(message);
    this.name = 'PhoneError';
    this.status = status;
    this.code = code;
  }
}

/** "+256 700 123-456" -> "+256700123456". Returns null unless it is a plausible international number. */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/[\s\-().]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(cleaned) ? cleaned : null;
}

export function phoneHash(phone: string, secret: string): string {
  return createHmac('sha256', secret).update(phone).digest('hex');
}

function hashSecret(): string {
  const s = process.env.PHONE_HASH_SECRET;
  if (s && s.length >= 16) return s;
  // Fall back to the service-account private key so no extra setting is needed.
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (sa) return sa;
  throw new PhoneError('Phone verification is not set up on the server.', 503, 'PHONE_NOT_CONFIGURED');
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  serviceSid: string;
}

export function twilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  return accountSid && authToken && serviceSid ? { accountSid, authToken, serviceSid } : null;
}

export interface MetaConfig {
  token: string;
  phoneNumberId: string;
  template: string;
  language: string;
}

/** Meta WhatsApp Cloud API. Needs an approved "authentication" template with one code parameter. */
export function metaConfig(): MetaConfig | null {
  const token = process.env.WHATSAPP_API_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return null;
  return {
    token,
    phoneNumberId,
    template: process.env.WHATSAPP_TEMPLATE_NAME || 'castimofx_verification',
    language: process.env.WHATSAPP_TEMPLATE_LANG || 'en',
  };
}

/** True when codes can actually be sent and stored. Meta is used when set, otherwise Twilio. */
export function phoneVerificationConfigured(): boolean {
  return (metaConfig() !== null || twilioConfig() !== null) && Boolean(process.env.FIREBASE_SERVICE_ACCOUNT);
}

const OTP_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

function codeHash(code: string, phone: string, uid: string, secret: string): string {
  return createHmac('sha256', secret).update(`otp|${uid}|${phone}|${code}`).digest('hex');
}

async function metaSend(deps: PhoneDeps, cfg: MetaConfig, phone: string, code: string) {
  const res = await deps.fetchFn(`https://graph.facebook.com/v20.0/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: cfg.template,
        language: { code: cfg.language },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    }),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // ignore
  }
  return { ok: res.ok, status: res.status, body };
}

type Doc = Record<string, unknown>;

export interface PhoneDeps {
  fetchFn: typeof fetch;
  store: {
    getDoc: (collection: string, id: string) => Promise<Doc | null>;
    setDoc: (collection: string, id: string, data: Doc) => Promise<void>;
    createDoc: (collection: string, id: string, data: Doc) => Promise<void>;
  };
  now: () => number;
  secret?: string;
}

async function realDeps(): Promise<PhoneDeps> {
  const fs = await import('./firestoreAdmin');
  return { fetchFn: fetch, store: { getDoc: fs.getDoc, setDoc: fs.setDoc, createDoc: fs.createDoc }, now: () => Date.now() };
}

// Light per-account throttle on top of Twilio's own limits.
const lastSend = new Map<string, number[]>();
const MIN_GAP_MS = 30_000;
const MAX_PER_HOUR = 5;

export function __resetThrottleForTests() {
  lastSend.clear();
}

function throttle(uid: string, now: number) {
  const recent = (lastSend.get(uid) || []).filter((t) => now - t < 3_600_000);
  if (recent.length && now - recent[recent.length - 1] < MIN_GAP_MS) {
    throw new PhoneError('Please wait 30 seconds before asking for another code.', 429, 'PHONE_TOO_SOON');
  }
  if (recent.length >= MAX_PER_HOUR) {
    throw new PhoneError('Too many codes requested. Please try again in an hour.', 429, 'PHONE_RATE_LIMIT');
  }
  recent.push(now);
  lastSend.set(uid, recent);
}

async function twilio(deps: PhoneDeps, cfg: TwilioConfig, path: string, form: Record<string, string>) {
  const res = await deps.fetchFn(`https://verify.twilio.com/v2/Services/${encodeURIComponent(cfg.serviceSid)}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form).toString(),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // ignore
  }
  return { ok: res.ok, status: res.status, body };
}

export async function getPhoneStatus(uid: string, d?: PhoneDeps) {
  const deps = d ?? (await realDeps());
  const rec = await deps.store.getDoc('phone_verifications', uid);
  if (!rec || rec.verified !== true) return { verified: false as const };
  return { verified: true as const, phoneLast4: String(rec.phoneLast4 || ''), verifiedAt: String(rec.verifiedAt || '') };
}

export async function isPhoneVerified(uid: string, d?: PhoneDeps): Promise<boolean> {
  return (await getPhoneStatus(uid, d)).verified;
}

/** Sends a WhatsApp code. Refuses numbers already verified on another account. */
export async function startVerification(uid: string, rawPhone: unknown, d?: PhoneDeps) {
  const deps = d ?? (await realDeps());
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    throw new PhoneError('Enter your WhatsApp number with the country code, for example +256700123456.', 400, 'PHONE_INVALID');
  }
  const meta = metaConfig();
  const cfg = twilioConfig();
  if (!meta && !cfg) throw new PhoneError('WhatsApp verification is not available yet.', 503, 'PHONE_NOT_CONFIGURED');
  const secret = deps.secret ?? hashSecret();

  if ((await getPhoneStatus(uid, deps)).verified) {
    throw new PhoneError('Your WhatsApp number is already verified.', 409, 'PHONE_ALREADY_VERIFIED');
  }
  const owner = await deps.store.getDoc('verified_phones', phoneHash(phone, secret));
  if (owner && owner.uid !== uid) {
    throw new PhoneError('This number is already verified on another account.', 409, 'PHONE_IN_USE');
  }

  throttle(uid, deps.now());
  if (meta) {
    // We make the code, send it, and keep only a keyed hash of it.
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await deps.store.setDoc('phone_otps', uid, {
      codeHash: codeHash(code, phone, uid, secret),
      expiresAt: deps.now() + OTP_TTL_MS,
      attempts: 0,
    });
    const m = await metaSend(deps, meta, phone, code);
    if (!m.ok) {
      console.warn(`[PHONE] Meta send failed (HTTP ${m.status}, code ${m.body?.error?.code ?? 'n/a'}).`);
      throw new PhoneError('Could not send the WhatsApp code. Check the number and that it has WhatsApp.', 502, 'PHONE_SEND_FAILED');
    }
    return { sent: true as const };
  }
  const r = await twilio(deps, cfg!, 'Verifications', { To: phone, Channel: 'whatsapp' });
  if (!r.ok) {
    console.warn(`[PHONE] Twilio send failed (HTTP ${r.status}, code ${r.body?.code ?? 'n/a'}).`);
    throw new PhoneError('Could not send the WhatsApp code. Check the number and that it has WhatsApp.', 502, 'PHONE_SEND_FAILED');
  }
  return { sent: true as const };
}

/** Checks the code, then claims the number for this account. */
export async function checkVerification(uid: string, rawPhone: unknown, code: unknown, d?: PhoneDeps) {
  const deps = d ?? (await realDeps());
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new PhoneError('Enter your WhatsApp number with the country code.', 400, 'PHONE_INVALID');
  if (typeof code !== 'string' || !/^\d{4,10}$/.test(code.trim())) {
    throw new PhoneError('Enter the numeric code from WhatsApp.', 400, 'CODE_INVALID');
  }
  const meta = metaConfig();
  const cfg = twilioConfig();
  if (!meta && !cfg) throw new PhoneError('WhatsApp verification is not available yet.', 503, 'PHONE_NOT_CONFIGURED');
  const secret = deps.secret ?? hashSecret();

  if (meta) {
    const otp = await deps.store.getDoc('phone_otps', uid);
    const wrong = () => new PhoneError('That code is wrong or has expired. Request a new one.', 400, 'CODE_WRONG');
    if (!otp || typeof otp.codeHash !== 'string' || Number(otp.expiresAt) < deps.now()) throw wrong();
    const attempts = Number(otp.attempts) || 0;
    if (attempts >= MAX_ATTEMPTS) {
      throw new PhoneError('Too many wrong codes. Request a new code.', 429, 'CODE_LOCKED');
    }
    const given = Buffer.from(codeHash(code.trim(), phone, uid, secret));
    const want = Buffer.from(otp.codeHash);
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      await deps.store.setDoc('phone_otps', uid, { ...otp, attempts: attempts + 1 });
      throw wrong();
    }
    // Single use: burn the code before anything else.
    await deps.store.setDoc('phone_otps', uid, { codeHash: '', expiresAt: 0, attempts: MAX_ATTEMPTS });
  } else {
    const r = await twilio(deps, cfg!, 'VerificationCheck', { To: phone, Code: code.trim() });
    if (!r.ok && r.status !== 404) {
      throw new PhoneError('Could not check the code. Please try again.', 502, 'PHONE_CHECK_FAILED');
    }
    if (!r.ok || r.body?.status !== 'approved') {
      throw new PhoneError('That code is wrong or has expired. Request a new one.', 400, 'CODE_WRONG');
    }
  }

  const hash = phoneHash(phone, secret);
  try {
    await deps.store.createDoc('verified_phones', hash, { uid, claimedAt: new Date(deps.now()).toISOString() });
  } catch (e) {
    if ((e as Error)?.name !== 'DocExistsError') throw e;
    const owner = await deps.store.getDoc('verified_phones', hash);
    if (!owner || owner.uid !== uid) {
      throw new PhoneError('This number is already verified on another account.', 409, 'PHONE_IN_USE');
    }
  }
  const verifiedAt = new Date(deps.now()).toISOString();
  await deps.store.setDoc('phone_verifications', uid, { verified: true, phoneLast4: phone.slice(-4), phoneHash: hash, verifiedAt });
  return { verified: true as const, phoneLast4: phone.slice(-4), verifiedAt };
}
