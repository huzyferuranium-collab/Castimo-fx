import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { TERMS_VERSION } from '../legal/terms';

/** The record that a signed-in user accepted the current terms (one document per user and version). */
const docId = (uid: string) => `${uid}_${TERMS_VERSION}`;

export async function hasAcceptedTerms(uid: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, 'agreements', docId(uid)));
    return snap.exists();
  } catch {
    return false;
  }
}

export async function acceptTerms(uid: string): Promise<{ success: boolean; error?: string }> {
  try {
    await setDoc(doc(db, 'agreements', docId(uid)), {
      userId: uid,
      version: TERMS_VERSION,
      acceptedAt: new Date().toISOString(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : '',
    });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Could not save your acceptance. Please try again.' };
  }
}
