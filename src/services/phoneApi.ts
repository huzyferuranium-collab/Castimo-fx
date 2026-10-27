import { authHeaders } from './apiAuth';

export interface PhoneStatus {
  available: boolean;
  verified: boolean;
  phoneLast4?: string;
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; error?: string; code?: string }> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok && data.success ? { ok: true } : { ok: false, error: data.error || 'Request failed.', code: data.code };
  } catch {
    return { ok: false, error: 'Network error. Please try again.' };
  }
}

export async function getPhoneStatus(): Promise<PhoneStatus | null> {
  try {
    const res = await fetch('/api/phone/status', { headers: await authHeaders() });
    if (!res.ok) return null;
    const d = await res.json();
    return { available: d.available === true, verified: d.verified === true, phoneLast4: d.phoneLast4 };
  } catch {
    return null;
  }
}

export const sendPhoneCode = (phone: string) => post('/api/phone/send', { phone });
export const verifyPhoneCode = (phone: string, code: string) => post('/api/phone/verify', { phone, code });
