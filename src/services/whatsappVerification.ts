/**
 * Client service for WhatsApp Verification
 */

export interface SendWhatsAppCodeResult {
  success: boolean;
  message?: string;
  phone?: string;
  error?: string;
  expiresInSeconds?: number;
  directLink?: string;
  channel?: string;
}

export interface VerifyWhatsAppCodeResult {
  success: boolean;
  verified?: boolean;
  message?: string;
  error?: string;
  phone?: string;
}

export async function requestWhatsAppOtp(phone: string): Promise<SendWhatsAppCodeResult> {
  try {
    const res = await fetch('/api/auth/send-whatsapp-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to send WhatsApp verification code.' };
    }
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Could not connect to WhatsApp verification service.' };
  }
}

export async function submitWhatsAppOtp(phone: string, code: string): Promise<VerifyWhatsAppCodeResult> {
  try {
    const res = await fetch('/api/auth/verify-whatsapp-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to verify WhatsApp code.' };
    }
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Verification connection failed.' };
  }
}
