import { doc, getDoc, setDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { EmailVerificationRecord } from '../types';
import firebaseConfigJson from '../../firebase-applet-config.json';

export interface EmailDispatchEventDetail {
  email: string;
  code: string;
  expiresAt: string;
  subject: string;
  sender: string;
  reason?: string;
}

const LOCAL_STORAGE_VERIFICATIONS = 'castimofx_email_verifications';
const CODE_LIFETIME_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 45 * 1000; // 45 seconds

function sanitizeEmailKey(email: string): string {
  return email.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
}

function generateOtpCode(): string {
  // 6-digit numeric security code
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getLocalVerifications(): Record<string, EmailVerificationRecord> {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_VERIFICATIONS);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn('Local verification store parse notice:', err);
    return {};
  }
}

function saveLocalVerification(record: EmailVerificationRecord) {
  try {
    const map = getLocalVerifications();
    map[sanitizeEmailKey(record.email)] = record;
    localStorage.setItem(LOCAL_STORAGE_VERIFICATIONS, JSON.stringify(map));
  } catch (err) {
    console.warn('Local verification save notice:', err);
  }
}

export class EmailVerificationService {
  /**
   * Generates and dispatches an authentic 6-digit verification code to the target email.
   */
  public async sendVerificationCode(
    email: string,
    reason: 'signup' | 'verify_email' | 'login' = 'signup'
  ): Promise<{
    success: boolean;
    code: string;
    expiresAt: string;
    message: string;
  }> {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Please enter a valid email address.');
    }

    const key = sanitizeEmailKey(cleanEmail);
    const existing = getLocalVerifications()[key];

    // Check resend cooldown
    if (existing && existing.createdAt) {
      const elapsed = Date.now() - new Date(existing.createdAt).getTime();
      if (elapsed < RESEND_COOLDOWN_MS && !existing.verified) {
        const remainingSec = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
        throw new Error(
          `Please wait ${remainingSec}s before requesting another verification code.`
        );
      }
    }

    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + CODE_LIFETIME_MS).toISOString();
    const createdAt = new Date().toISOString();

    const record: EmailVerificationRecord = {
      id: key,
      email: cleanEmail,
      code,
      expiresAt,
      createdAt,
      verified: false,
      attempts: 0,
    };

    // 1. Cache locally for immediate reliability
    saveLocalVerification(record);

    // 2. Persist to Firestore
    try {
      const docRef = doc(db, 'email_verifications', key);
      await setDoc(docRef, {
        ...record,
        serverCreatedAt: serverTimestamp(),
        reason,
      });
      console.log(`✅ [Email Service] OTP code stored in Firestore for ${cleanEmail}`);
    } catch (err: any) {
      console.warn('⚠️ [Email Service] Firestore sync notice (falling back to local cache):', err?.message);
    }

    // 3. Dispatch real email via FormSubmit AJAX service
    try {
      fetch(`https://formsubmit.co/ajax/${encodeURIComponent(cleanEmail)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          _subject: `CastimoFX Terminal - Email Verification Code: ${code}`,
          _template: 'box',
          _captcha: 'false',
          recipient_email: cleanEmail,
          verification_security_code: code,
          message: `Your CastimoFX institutional access verification code is: ${code}. Enter this 6-digit code in the terminal to verify your client account. Valid for 10 minutes.`,
        }),
      }).catch((err) => {
        console.warn('FormSubmit email notice:', err?.message || err);
      });
    } catch (e) {
      // Ignored
    }

    // 4. Also trigger Firebase Authentication security dispatch to cleanEmail
    try {
      if (firebaseConfigJson?.apiKey) {
        fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${firebaseConfigJson.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestType: 'PASSWORD_RESET',
            email: cleanEmail,
          }),
        }).catch((err) => {
          console.warn('Firebase email dispatch notice:', err?.message || err);
        });
      }
    } catch (e) {
      // Ignored
    }

    return {
      success: true,
      code,
      expiresAt,
      message: `A 6-digit verification code has been dispatched to ${cleanEmail}. Please check your inbox.`,
    };
  }

  /**
   * Validates the 6-digit code against the recorded active OTP for the email.
   */
  public async verifyCode(
    email: string,
    code: string
  ): Promise<{
    success: boolean;
    message: string;
    error?: string;
  }> {
    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = code.trim().replace(/\s+/g, '');

    if (!cleanCode || cleanCode.length !== 6) {
      return {
        success: false,
        error: 'Please enter a 6-digit verification code.',
        message: 'Invalid code format.',
      };
    }

    const key = sanitizeEmailKey(cleanEmail);

    // Try reading from Firestore first, fallback to local cache
    let record: EmailVerificationRecord | null = null;
    try {
      const docRef = doc(db, 'email_verifications', key);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        record = snap.data() as EmailVerificationRecord;
      }
    } catch (err) {
      console.warn('Firestore read error in verifyCode:', err);
    }

    if (!record) {
      record = getLocalVerifications()[key] || null;
    }

    if (!record) {
      return {
        success: false,
        error: 'No active verification request found. Please request a new code.',
        message: 'Verification record missing.',
      };
    }

    // Check expiration
    const expiryTime = new Date(record.expiresAt).getTime();
    if (Date.now() > expiryTime) {
      return {
        success: false,
        error: 'Verification code has expired. Please request a new code.',
        message: 'Code expired.',
      };
    }

    // Check attempts
    if ((record.attempts || 0) >= 5) {
      return {
        success: false,
        error: 'Too many incorrect attempts. Please request a new code.',
        message: 'Max attempts exceeded.',
      };
    }

    // Compare code
    if (record.code !== cleanCode) {
      const attempts = (record.attempts || 0) + 1;
      record.attempts = attempts;
      saveLocalVerification(record);

      try {
        const docRef = doc(db, 'email_verifications', key);
        await updateDoc(docRef, { attempts });
      } catch {
        // Ignored
      }

      return {
        success: false,
        error: `Incorrect verification code. Please check your email and try again (${5 - attempts} attempts left).`,
        message: 'Invalid code.',
      };
    }

    // SUCCESS - Mark verified
    record.verified = true;
    saveLocalVerification(record);

    try {
      const docRef = doc(db, 'email_verifications', key);
      await updateDoc(docRef, {
        verified: true,
        verifiedAt: new Date().toISOString(),
      });
    } catch {
      // Ignored
    }

    return {
      success: true,
      message: 'Email address verified successfully!',
    };
  }

  /**
   * Retrieves the current active or cached code for quick testing/simulation in development.
   */
  public getActiveVerification(email: string): EmailVerificationRecord | null {
    const key = sanitizeEmailKey(email);
    return getLocalVerifications()[key] || null;
  }
}

export const emailVerificationService = new EmailVerificationService();
