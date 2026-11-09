/**
 * Sign-in checking for the trade API.
 *
 * The browser sends its Firebase ID token in the Authorization header. We verify the
 * token's signature against Google's public keys, so the user ID can never be faked.
 * No extra packages: this uses Node's built-in crypto and fetch.
 */
import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export interface AuthUser {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  idToken: string;
}

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function parseJson(buf: Buffer): any {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new AuthError('Malformed sign-in token.');
  }
}

/**
 * Pure token check. Throws AuthError unless the token is a valid, unexpired Firebase ID
 * token for this project, signed by one of the supplied keys.
 */
export function verifyFirebaseIdToken(
  token: string,
  opts: { projectId: string; keys: Record<string, KeyObject>; nowSec?: number }
): { uid: string; email?: string; emailVerified?: boolean } {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) throw new AuthError('Malformed sign-in token.');
  const [h, p, s] = parts;

  const header = parseJson(b64urlToBuffer(h));
  if (header.alg !== 'RS256') throw new AuthError('Unsupported token algorithm.');
  const key = typeof header.kid === 'string' ? opts.keys[header.kid] : undefined;
  if (!key) throw new AuthError('Unknown signing key.');

  const okSig = cryptoVerify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, b64urlToBuffer(s));
  if (!okSig) throw new AuthError('Invalid token signature.');

  const payload = parseJson(b64urlToBuffer(p));
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const skew = 300;
  if (payload.aud !== opts.projectId) throw new AuthError('Token is for a different project.');
  if (payload.iss !== `https://securetoken.google.com/${opts.projectId}`) throw new AuthError('Bad token issuer.');
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new AuthError('Sign-in has expired. Please sign in again.');
  if (typeof payload.iat !== 'number' || payload.iat > now + skew) throw new AuthError('Token issued in the future.');
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 128) {
    throw new AuthError('Token has no user.');
  }
  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    emailVerified: payload.email_verified === true,
  };
}

/** Reads the role field from a Firestore REST document. Anything unexpected is "client". */
export function parseRoleFromFirestoreDoc(doc: any): 'admin' | 'client' {
  const v = doc?.fields?.role?.stringValue;
  return v === 'admin' ? 'admin' : 'client';
}

// ---------- Google's public keys (cached) ----------

const CERT_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let keyCache: { keys: Record<string, KeyObject>; expiresAt: number; fetchedAt: number } | null = null;

async function loadGoogleKeys(force = false): Promise<Record<string, KeyObject>> {
  const now = Date.now();
  if (keyCache && !force && now < keyCache.expiresAt) return keyCache.keys;
  // Do not hammer Google if a refresh was just done.
  if (keyCache && force && now - keyCache.fetchedAt < 60_000) return keyCache.keys;

  const res = await fetch(CERT_URL);
  if (!res.ok) throw new AuthError('Could not load sign-in keys. Try again shortly.', 503);
  const certs = (await res.json()) as Record<string, string>;
  const keys: Record<string, KeyObject> = {};
  for (const [kid, pem] of Object.entries(certs)) keys[kid] = createPublicKey(pem);
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1];
  keyCache = { keys, fetchedAt: now, expiresAt: now + (maxAge ? Number(maxAge) * 1000 : 3_600_000) };
  return keys;
}

// ---------- project settings ----------

export function loadFirebaseSettings(): { projectId: string; databaseId: string } {
  let projectId = process.env.FIREBASE_PROJECT_ID || '';
  let databaseId = process.env.FIREBASE_DATABASE_ID || '';
  if (!projectId || !databaseId) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf8'));
      projectId = projectId || cfg.projectId;
      databaseId = databaseId || cfg.firestoreDatabaseId || '(default)';
    } catch {
      // handled below
    }
  }
  if (!projectId) throw new AuthError('Server is missing the Firebase project setting.', 500);
  return { projectId, databaseId: databaseId || '(default)' };
}

export async function authenticateRequest(req: { headers: Record<string, any> }): Promise<AuthUser> {
  const header = String(req.headers['authorization'] || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new AuthError('Please sign in to continue.');
  const idToken = match[1].trim();
  const { projectId } = loadFirebaseSettings();

  let keys = await loadGoogleKeys();
  try {
    const u = verifyFirebaseIdToken(idToken, { projectId, keys });
    return { ...u, idToken };
  } catch (err) {
    // Google rotates keys; retry once with a fresh set if the key id was unknown.
    if (err instanceof AuthError && err.message === 'Unknown signing key.') {
      keys = await loadGoogleKeys(true);
      const u = verifyFirebaseIdToken(idToken, { projectId, keys });
      return { ...u, idToken };
    }
    throw err;
  }
}

// ---------- admin check ----------

const roleCache = new Map<string, { role: 'admin' | 'client'; expiresAt: number }>();

/**
 * Reads the user's role from Firestore using the user's OWN token, so the database rules
 * decide what they may read. Users cannot change their own role (see firestore.rules).
 */
export async function isAdminUser(user: AuthUser): Promise<boolean> {
  const cached = roleCache.get(user.uid);
  if (cached && cached.expiresAt > Date.now()) return cached.role === 'admin';

  const { projectId, databaseId } = loadFirebaseSettings();
  const url =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
    `/databases/${encodeURIComponent(databaseId)}/documents/users/${encodeURIComponent(user.uid)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${user.idToken}` } });
  const role = res.ok ? parseRoleFromFirestoreDoc(await res.json()) : 'client';
  roleCache.set(user.uid, { role, expiresAt: Date.now() + 60_000 });
  return role === 'admin';
}

// ---------- Express middleware ----------

type Req = any;
type Res = any;
type Next = (err?: any) => void;

function sendAuthError(res: Res, err: any) {
  const status = err instanceof AuthError ? err.status : 401;
  res.status(status).json({ success: false, error: err?.message || 'Not signed in.', code: 'AUTH_REQUIRED' });
}

export async function requireUser(req: Req, res: Res, next: Next) {
  try {
    req.authUser = await authenticateRequest(req);
    next();
  } catch (err) {
    sendAuthError(res, err);
  }
}

export async function requireAdmin(req: Req, res: Res, next: Next) {
  try {
    const user = await authenticateRequest(req);
    if (!(await isAdminUser(user))) {
      return res.status(403).json({ success: false, error: 'Administrators only.', code: 'ADMIN_REQUIRED' });
    }
    req.authUser = user;
    next();
  } catch (err) {
    sendAuthError(res, err);
  }
}

export function getAuthUser(req: Req): AuthUser {
  if (!req.authUser) throw new AuthError('Please sign in to continue.');
  return req.authUser as AuthUser;
}
