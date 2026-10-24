/**
 * Server-side Firestore access with a Google service account (no extra packages).
 *
 * The browser can never write money records (see firestore.rules). Only this server can, using a
 * private key kept in the FIREBASE_SERVICE_ACCOUNT environment variable on your host.
 */
import { createSign } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ---------- value conversion (plain objects <-> Firestore REST format) ----------

export type FsValue = any;

export function toFsValue(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === 'object') {
    const fields: Record<string, FsValue> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val !== undefined) fields[k] = toFsValue(val);
    }
    return { mapValue: { fields } };
  }
  throw new Error('Unsupported value for Firestore');
}

export function fromFsValue(v: FsValue): unknown {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFsValue);
  if ('mapValue' in v) return fromFsFields(v.mapValue.fields || {});
  return null;
}

export function toFsFields(obj: Record<string, unknown>): Record<string, FsValue> {
  const out: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = toFsValue(v);
  return out;
}

export function fromFsFields(fields: Record<string, FsValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fromFsValue(v);
  return out;
}

// ---------- service account ----------

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
}

function readServiceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const sa = JSON.parse(text);
    if (typeof sa.client_email === 'string' && typeof sa.private_key === 'string') return sa;
  } catch {
    // falls through
  }
  return null;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Builds the signed login request Google exchanges for an access token. Exported for tests. */
export function buildServiceAccountJwt(sa: ServiceAccount, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSec,
      exp: nowSec + 3600,
    })
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign(sa.private_key))}`;
}

let tokenCache: { token: string; expiresAt: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const jwt = buildServiceAccountJwt(sa, Math.floor(Date.now() / 1000));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error(`Could not sign in to Google (${res.status}).`);
  const data: any = await res.json();
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return tokenCache.token;
}

function settings(sa: ServiceAccount): { projectId: string; databaseId: string } {
  let projectId = process.env.FIREBASE_PROJECT_ID || sa.project_id || '';
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
  if (!projectId) throw new Error('Firebase project is not configured.');
  return { projectId, databaseId: databaseId || '(default)' };
}

export function isFirestoreAdminConfigured(): boolean {
  return readServiceAccount() !== null;
}

export class DocExistsError extends Error {
  constructor() {
    super('Document already exists.');
    this.name = 'DocExistsError';
  }
}

async function call(method: string, urlPath: string, body?: unknown, query = ''): Promise<any> {
  const sa = readServiceAccount();
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set on the server.');
  const { projectId, databaseId } = settings(sa);
  const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents`;
  const res = await fetch(`${base}${urlPath}${query}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken(sa)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 404) return null;
  if (res.status === 409) throw new DocExistsError();
  if (res.status === 400 && method === 'PATCH' && query.includes('currentDocument.exists=false')) throw new DocExistsError();
  if (!res.ok) throw new Error(`Firestore ${method} failed (${res.status}).`);
  return res.json();
}

const enc = encodeURIComponent;

export async function getDoc(collection: string, id: string): Promise<Record<string, unknown> | null> {
  const doc = await call('GET', `/${enc(collection)}/${enc(id)}`);
  return doc ? fromFsFields(doc.fields || {}) : null;
}

/** Creates or fully replaces a document. */
export async function setDoc(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
  await call('PATCH', `/${enc(collection)}/${enc(id)}`, { fields: toFsFields(data) });
}

/** Creates a document only if it does not exist yet. Throws DocExistsError otherwise. */
export async function createDoc(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
  await call('PATCH', `/${enc(collection)}/${enc(id)}`, { fields: toFsFields(data) }, '?currentDocument.exists=false');
}

/** Documents in a collection where `field == value` (value is a string). */
export async function queryEquals(collection: string, field: string, value: string): Promise<Record<string, unknown>[]> {
  const sa = readServiceAccount();
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set on the server.');
  const { projectId, databaseId } = settings(sa);
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken(sa)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } },
      },
    }),
  });
  if (!res.ok) throw new Error(`Firestore query failed (${res.status}).`);
  const rows: any[] = await res.json();
  return rows.filter((r) => r.document).map((r) => fromFsFields(r.document.fields || {}));
}

/** Every document in a collection (use only for small admin lists). */
export async function listAll(collection: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let pageToken = '';
  do {
    const data = await call('GET', `/${enc(collection)}`, undefined, `?pageSize=300${pageToken ? `&pageToken=${enc(pageToken)}` : ''}`);
    if (!data) break;
    for (const d of data.documents || []) out.push(fromFsFields(d.fields || {}));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}
