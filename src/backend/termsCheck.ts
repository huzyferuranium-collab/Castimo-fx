import { AuthUser, loadFirebaseSettings } from './firebaseAuth';
import { TERMS_VERSION } from '../legal/terms';

// ---------- terms acceptance ----------


const termsCache = new Map<string, number>();

/**
 * True if the user accepted the current terms. Read with the user's OWN token, so the database rules
 * decide (a user can only read their own record). Accepted results are cached for 10 minutes.
 */
export async function hasAcceptedTermsServer(user: AuthUser): Promise<boolean> {
  const hit = termsCache.get(user.uid);
  if (hit && hit > Date.now()) return true;
  const { projectId, databaseId } = loadFirebaseSettings();
  const url =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
    `/databases/${encodeURIComponent(databaseId)}/documents/agreements/${encodeURIComponent(`${user.uid}_${TERMS_VERSION}`)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${user.idToken}` } });
  if (!res.ok) return false;
  termsCache.set(user.uid, Date.now() + 10 * 60_000);
  return true;
}
