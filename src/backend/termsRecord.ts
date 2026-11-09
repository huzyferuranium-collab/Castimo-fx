/**
 * Where a client's acceptance of the Terms is kept, read and written by the SERVER itself, so it never depends on the
 * client's browser or on the database rules being published. One document per client and terms version, created once.
 * (The browser also tries to save the same document; whichever comes first wins and the other is harmless.)
 */
import { DocExistsError } from './firestoreAdmin.ts';

export interface TermsDb {
  getDoc(collection: string, id: string): Promise<Record<string, unknown> | null>;
  createDoc(collection: string, id: string, data: Record<string, unknown>): Promise<void>;
}

export const termsDocId = (uid: string, version: string): string => `${uid}_${version}`;

/** true = a record exists, false = there is none, null = the database could not be read (so nobody is judged by it). */
export async function acceptedAccordingToServer(db: TermsDb, uid: string, version: string): Promise<boolean | null> {
  try {
    return Boolean(await db.getDoc('agreements', termsDocId(uid, version)));
  } catch {
    return null;
  }
}

/** Saves that the client accepted this version. Safe to repeat: an existing record is left exactly as it is. */
export async function recordAcceptance(
  db: TermsDb,
  uid: string,
  version: string,
  userAgent: string,
  now: Date = new Date()
): Promise<'recorded' | 'exists'> {
  try {
    await db.createDoc('agreements', termsDocId(uid, version), {
      userId: uid,
      version,
      acceptedAt: now.toISOString(),
      userAgent: userAgent.slice(0, 200),
      savedBy: 'server',
    });
    return 'recorded';
  } catch (e) {
    if (e instanceof DocExistsError) return 'exists';
    throw e;
  }
}
