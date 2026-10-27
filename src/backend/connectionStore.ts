/**
 * Where pending connections are remembered (`client_connections/{userId}` in Firestore, written only by
 * the server). A pending connection is a client's terminal that exists in MetaApi but is not yet verified.
 * Saving it means a server restart (every deploy) never loses a connection that was in progress.
 *
 * NO password is ever stored: the broker password lives only inside MetaApi.
 */
import type { PendingConnection } from './terminalPolicy.ts';

export interface ConnectionStore {
  get(userId: string): Promise<PendingConnection | null>;
  put(rec: PendingConnection): Promise<void>;
  delete(userId: string): Promise<void>;
  list(): Promise<PendingConnection[]>;
}

/** In-memory store: used by tests, and as the fallback when Firestore is not configured. */
export class MemoryConnectionStore implements ConnectionStore {
  private rows = new Map<string, PendingConnection>();
  /** Counts writes, so tests can prove that idle ticks do not write. */
  writes = 0;

  async get(userId: string) {
    const r = this.rows.get(userId);
    return r ? { ...r } : null;
  }
  async put(rec: PendingConnection) {
    this.writes++;
    this.rows.set(rec.userId, { ...rec });
  }
  async delete(userId: string) {
    this.rows.delete(userId);
  }
  async list() {
    return Array.from(this.rows.values()).map((r) => ({ ...r }));
  }
}

const COLLECTION = 'client_connections';

/** Keeps only the fields we own and the right types, so a damaged document can never crash the supervisor. */
export function sanitizeRecord(raw: Record<string, unknown> | null | undefined): PendingConnection | null {
  if (!raw || typeof raw !== 'object') return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const userId = str(raw.userId);
  const accountId = str(raw.accountId);
  if (!userId || !accountId) return null;
  const err = raw.error && typeof raw.error === 'object' ? (raw.error as Record<string, unknown>) : null;
  const rec: PendingConnection = {
    userId,
    accountId,
    login: str(raw.login),
    server: str(raw.server),
    stage: raw.stage === 'FAILED' ? 'FAILED' : 'PENDING',
    verifiedBefore: raw.verifiedBefore === true,
    startedAt: num(raw.startedAt),
    updatedAt: num(raw.updatedAt),
    deadlineAt: num(raw.deadlineAt),
    redeploys: num(raw.redeploys),
    verifyFailures: num(raw.verifyFailures),
  };
  if (typeof raw.lastRedeployAt === 'number') rec.lastRedeployAt = raw.lastRedeployAt;
  if (typeof raw.disconnectedSince === 'number') rec.disconnectedSince = raw.disconnectedSince;
  if (typeof raw.lastState === 'string') rec.lastState = raw.lastState;
  if (typeof raw.lastConnectionStatus === 'string') rec.lastConnectionStatus = raw.lastConnectionStatus;
  if (typeof raw.lastAction === 'string') rec.lastAction = raw.lastAction as PendingConnection['lastAction'];
  if (err && typeof err.code === 'string') {
    rec.error = { code: err.code, message: str(err.message), hint: str(err.hint), ref: typeof err.ref === 'string' ? err.ref : undefined };
  }
  return rec;
}

/** Firestore-backed store. The functions are passed in so this file never imports the Firestore client in tests. */
export function firestoreConnectionStore(api: {
  getDoc: (c: string, id: string) => Promise<Record<string, unknown> | null>;
  setDoc: (c: string, id: string, data: Record<string, unknown>) => Promise<void>;
  deleteDoc: (c: string, id: string) => Promise<void>;
  listAll: (c: string) => Promise<Record<string, unknown>[]>;
}): ConnectionStore {
  return {
    async get(userId) {
      return sanitizeRecord(await api.getDoc(COLLECTION, userId));
    },
    async put(rec) {
      await api.setDoc(COLLECTION, rec.userId, rec as unknown as Record<string, unknown>);
    },
    async delete(userId) {
      await api.deleteDoc(COLLECTION, userId);
    },
    async list() {
      return (await api.listAll(COLLECTION)).map(sanitizeRecord).filter((r): r is PendingConnection => r !== null);
    },
  };
}

/**
 * Answers "was this very terminal verified for this user before?" from what the server saved when the
 * client was put into service (`mt5_accounts/{userId}`, which holds the terminal's account id).
 *  - 'yes'     the saved record names this terminal
 *  - 'no'      there is no saved record, or it names a different terminal
 *  - 'unknown' the lookup failed: callers treat that as "connected before" so nobody is ever judged in doubt
 */
export function verifiedTerminalLookup(
  read: (userId: string) => Promise<Record<string, unknown> | null>
): (userId: string, accountId: string) => Promise<'yes' | 'no' | 'unknown'> {
  return async (userId, accountId) => {
    try {
      const doc = await read(userId);
      if (!doc) return 'no';
      return typeof doc.accountId === 'string' && doc.accountId === accountId ? 'yes' : 'no';
    } catch {
      return 'unknown';
    }
  };
}
