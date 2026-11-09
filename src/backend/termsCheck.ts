import { AuthUser, loadFirebaseSettings } from './firebaseAuth';
import { TERMS_VERSION } from '../legal/terms';
import { getDoc, createDoc, isFirestoreAdminConfigured } from './firestoreAdmin';
import { acceptedAccordingToServer, recordAcceptance } from './termsRecord';

// ---------- terms acceptance ----------


const termsCache = new Map<string, number>();

/**
 * True if the user accepted the current terms. Read with the user's OWN token, so the database rules
 * decide (a user can only read their own record). Accepted results are cached for 10 minutes.
 */
export async function hasAcceptedTermsServer(user: AuthUser): Promise<boolean> {
  const hit = termsCache.get(user.uid);
  if (hit && hit > Date.now()) return true;
  // The server's own access to the database is the reliable way to ask: it does not depend on the rules being published.
  if (isFirestoreAdminConfigured()) {
    const seen = await acceptedAccordingToServer({ getDoc, createDoc }, user.uid, TERMS_VERSION);
    if (seen === true) {
      termsCache.set(user.uid, Date.now() + 10 * 60_000);
      return true;
    }
    if (seen === false) return false;
    // null: the database could not be read this time; fall back to asking with the client's own token below.
  }
  const { projectId, databaseId } = loadFirebaseSettings();
  const url =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
    `/databases/${encodeURIComponent(databaseId)}/documents/agreements/${encodeURIComponent(`${user.uid}_${TERMS_VERSION}`)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${user.idToken}` } });
  if (res.ok) {
    termsCache.set(user.uid, Date.now() + 10 * 60_000);
    return true;
  }
  // 404 = the rules work and this user has not accepted. Any other answer (for example 403 while the
  // security rules are not published yet) means we cannot check, so we do not lock clients out.
  if (res.status === 404) return false;
  console.warn(`[TERMS] Could not verify acceptance (HTTP ${res.status}); allowing. Publish firestore.rules.`);
  return true;
}

/** Saves the client's acceptance through the server (used when the browser could not save it). Needs the server's database access. */
export async function recordTermsAcceptanceServer(user: AuthUser, userAgent: string): Promise<boolean> {
  if (!isFirestoreAdminConfigured()) return false;
  await recordAcceptance({ getDoc, createDoc }, user.uid, TERMS_VERSION, userAgent);
  termsCache.set(user.uid, Date.now() + 10 * 60_000);
  return true;
}
