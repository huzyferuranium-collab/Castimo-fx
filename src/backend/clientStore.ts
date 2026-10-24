/**
 * Remembers each client's connected account so they never have to enter it again.
 * Stored in Firestore (`mt5_accounts/{userId}`) by the server. NO password is ever stored here:
 * the broker password lives only inside MetaApi, which keeps the account logged in.
 */
import { getDoc, isFirestoreAdminConfigured, setDoc } from './firestoreAdmin';

export interface SavableClient {
  userId: string;
  accountId: string;
  login: string;
  server: string;
  status: string;
  brokerName?: string;
  accountType?: string;
  currency?: string;
}

export async function saveClientRecord(rec: SavableClient): Promise<void> {
  if (!isFirestoreAdminConfigured()) return;
  const existing = (await getDoc('mt5_accounts', rec.userId).catch(() => null)) as any;
  const now = new Date().toISOString();
  await setDoc('mt5_accounts', rec.userId, {
    userId: rec.userId,
    accountId: rec.accountId,
    login: rec.login,
    server: rec.server,
    brokerName: rec.brokerName ?? '',
    accountType: rec.accountType ?? '',
    currency: rec.currency ?? '',
    mirrorStatus: rec.status === 'IDLE' ? 'IDLE' : 'ACTIVE',
    connectedAt: existing?.connectedAt || now,
    updatedAt: now,
  });
}

/** The copy on/off choice the client last made, so a server restart does not undo it. */
export async function loadSavedStatus(userId: string): Promise<'ACTIVE' | 'IDLE' | null> {
  if (!isFirestoreAdminConfigured()) return null;
  const doc = (await getDoc('mt5_accounts', userId).catch(() => null)) as any;
  return doc?.mirrorStatus === 'IDLE' ? 'IDLE' : doc?.mirrorStatus === 'ACTIVE' ? 'ACTIVE' : null;
}
