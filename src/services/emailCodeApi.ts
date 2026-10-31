import { authHeaders } from './apiAuth';

async function call(path: string, body?: unknown): Promise<{ ok: boolean; error?: string; data?: any }> {
  try {
    const res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    return res.ok && d.success ? { ok: true, data: d } : { ok: false, error: d.error || 'Request failed.' };
  } catch {
    return { ok: false, error: 'Network error. Please try again.' };
  }
}

/** Whether the server can send codes. When it cannot, the page offers the verification link only. */
export async function emailCodesAvailable(): Promise<boolean> {
  const r = await call('/api/email-code/status');
  return r.ok && Boolean(r.data?.available);
}
export const sendEmailCode = () => call('/api/email-code/send', {});
export const verifyEmailCode = (code: string) => call('/api/email-code/verify', { code });
