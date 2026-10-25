import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { TERMS_VERSION } from '../legal/terms';

/**
 * The record that a signed-in user accepted the current terms (one document per user and version).
 * If the database refuses the write (for example the security rules are not published yet), the client
 * is still let in and their choice is remembered in this browser; it is saved to the database as soon
 * as that works.
 */
const docId = (uid: string) => `${uid}_${TERMS_VERSION}`;
const localKey = (uid: string) => `castimofx_terms_${docId(uid)}`;

function readLocal(uid: string): boolean {
  try {
    return localStorage.getItem(localKey(uid)) === '1';
  } catch {
    return false;
  }
}

function writeLocal(uid: string) {
  try {
    localStorage.setItem(localKey(uid), '1');
  } catch {
    // ignore
  }
}

async function saveRecord(uid: string): Promise<void> {
  await setDoc(doc(db, 'agreements', docId(uid)), {
    userId: uid,
    version: TERMS_VERSION,
    acceptedAt: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : '',
  });
}

export async function hasAcceptedTerms(uid: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, 'agreements', docId(uid)));
    if (snap.exists()) {
      writeLocal(uid);
      return true;
    }
  } catch {
    // cannot read the record: fall back to this browser's memory below
  }
  if (readLocal(uid)) {
    // Accepted earlier while the database was refusing writes: try to save it now.
    saveRecord(uid).catch(() => {});
    return true;
  }
  return false;
}

/** Always lets the client in after they tap "I Agree"; saving to the database is best-effort. */
export async function acceptTerms(uid: string): Promise<{ success: boolean; error?: string }> {
  writeLocal(uid);
  try {
    await saveRecord(uid);
  } catch (err: any) {
    console.warn('Terms acceptance could not be saved to the database yet:', err?.message || err);
  }
  return { success: true };
}
