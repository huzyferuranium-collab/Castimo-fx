/**
 * Verifies Firebase ID tokens (the proof of sign-in the website sends) without any
 * library: RS256 signature check against Google's published public keys plus the
 * claim checks Firebase documents.
 */
import type { Env } from './env';
import { unauthorized } from './http';

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const KEY_CACHE_MS = 60 * 60 * 1000;
const CLOCK_SKEW_S = 60;

export interface AuthUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
  isAdmin: boolean;
}

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

export interface AuthDeps {
  fetch?: typeof fetch;
  now?: () => number; // ms
}

let keyCache: { fetchedAt: number; keys: Jwk[] } | null = null;

/** Test hook. */
export function resetAuthCache() {
  keyCache = null;
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJson<T>(s: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s))) as T;
}

async function getKeys(deps: AuthDeps, force = false): Promise<Jwk[]> {
  const now = (deps.now ?? Date.now)();
  if (!force && keyCache && now - keyCache.fetchedAt < KEY_CACHE_MS) return keyCache.keys;
  const res = await (deps.fetch ?? fetch)(JWKS_URL);
  if (!res.ok) throw unauthorized('Could not verify your sign-in right now. Please try again.');
  const body = (await res.json()) as { keys?: Jwk[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw unauthorized('Could not verify your sign-in right now. Please try again.');
  }
  keyCache = { fetchedAt: now, keys: body.keys };
  return body.keys;
}

interface TokenClaims {
  iss?: string;
  aud?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  auth_time?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  user_id?: string;
}

/** Throws a 401 HttpError unless the token is genuinely issued by Firebase for this project. */
export async function verifyFirebaseToken(
  token: string,
  projectId: string,
  deps: AuthDeps = {},
): Promise<TokenClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw unauthorized();

  let header: { alg?: string; kid?: string; typ?: string };
  let claims: TokenClaims;
  try {
    header = b64urlToJson(parts[0]!);
    claims = b64urlToJson(parts[1]!);
  } catch {
    throw unauthorized();
  }

  // Only RS256 is acceptable ("none" or HMAC tokens must never be trusted).
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw unauthorized();

  let keys = await getKeys(deps);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // Google rotates keys; refresh once before giving up.
    keys = await getKeys(deps, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw unauthorized();

  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(parts[2]!),
      new TextEncoder().encode(parts[0] + '.' + parts[1]),
    );
  } catch {
    valid = false;
  }
  if (!valid) throw unauthorized();

  const nowS = Math.floor((deps.now ?? Date.now)() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= nowS - CLOCK_SKEW_S) throw unauthorized('Your session expired. Please sign in again.');
  if (typeof claims.iat !== 'number' || claims.iat > nowS + CLOCK_SKEW_S) throw unauthorized();
  if (typeof claims.auth_time !== 'number' || claims.auth_time > nowS + CLOCK_SKEW_S) throw unauthorized();
  if (claims.aud !== projectId) throw unauthorized();
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) throw unauthorized();
  if (typeof claims.sub !== 'string' || claims.sub.length === 0 || claims.sub.length > 128) throw unauthorized();
  return claims;
}

export function parseAdminEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Reads the Authorization header, verifies it and works out whether the user is an admin. */
export async function authenticate(req: Request, env: Env, deps: AuthDeps = {}): Promise<AuthUser> {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(header);
  if (!match) throw unauthorized();
  if (!env.FIREBASE_PROJECT_ID) throw unauthorized('The server is not configured yet.');

  const claims = await verifyFirebaseToken(match[1]!, env.FIREBASE_PROJECT_ID, deps);
  const email = (claims.email ?? '').toLowerCase();
  const emailVerified = claims.email_verified === true;
  // Admin rights need BOTH: the address is on the admin list AND Firebase has verified
  // that the person really owns it (otherwise anyone could register with that address).
  const isAdmin = emailVerified && email !== '' && parseAdminEmails(env.ADMIN_EMAILS).has(email);
  return {
    uid: claims.sub!,
    email,
    emailVerified,
    name: typeof claims.name === 'string' ? claims.name.slice(0, 80) : '',
    isAdmin,
  };
}
