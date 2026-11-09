import { loadFirestore } from '../config/firebase';
import { TERMS_VERSION } from '../legal/terms';
import { authHeaders } from './apiAuth';

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
  const { fs, db } = await loadFirestore();
  await fs.setDoc(fs.doc(db, 'agreements', docId(uid)), {
    userId: uid,
    version: TERMS_VERSION,
    acceptedAt: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : '',
  });
}

/** Asks the server to keep the record too, so the connect step can see it whatever the database rules say. */
async function recordViaServer(): Promise<boolean> {
  try {
    const headers = await authHeaders();
    if (!headers.Authorization) return false;
    const res = await fetch('/api/trade/accept-terms', { method: 'POST', headers });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * For a client the server says has not accepted, although this browser remembers they did (the save to the database
 * had failed). Saves it through the server so they are not asked again. False means they never accepted here.
 */
export async function recoverAcceptance(uid: string): Promise<boolean> {
  if (!uid || !readLocal(uid)) return false;
  return recordViaServer();
}

export async function hasAcceptedTerms(uid: string): Promise<boolean> {
  try {
    const { fs, db } = await loadFirestore();
    const snap = await fs.getDoc(fs.doc(db, 'agreements', docId(uid)));
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
    void recordViaServer();
    return true;
  }
  return false;
}

/** Always lets the client in after they tap "I Agree"; saving to the database is best-effort. */
export async function acceptTerms(uid: string): Promise<{ success: boolean; error?: string }> {
  writeLocal(uid);
  // Saved two ways at once (the browser and the server); either one is enough, and the second finds the first and does nothing.
  const [browser, server] = await Promise.allSettled([saveRecord(uid), recordViaServer()]);
  if (browser.status === 'rejected' && !(server.status === 'fulfilled' && server.value)) {
    console.warn('Terms acceptance could not be saved to the database yet:', (browser.reason as any)?.message || browser.reason);
  }
  return { success: true };
}
