/** Small helpers shared by the backend: errors, JSON responses and input validation. */

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (code: string, message: string) => new HttpError(400, code, message);
export const unauthorized = (message = 'Please sign in again.') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'You are not allowed to do that.') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
export const unavailable = (code: string, message: string) => new HttpError(503, code, message);

const SECURITY_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: SECURITY_HEADERS });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ error: err.code, message: err.message }, err.status);
  }
  // Never echo unexpected error text (it could contain secrets or internals).
  return json({ error: 'internal_error', message: 'Something went wrong. Please try again.' }, 500);
}

// ---------- input validation ----------

export function asObject(v: unknown): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw badRequest('invalid_body', 'Send a JSON object.');
  }
  return v as Record<string, unknown>;
}

export function str(
  v: unknown,
  field: string,
  opts: { min?: number; max?: number; pattern?: RegExp; optional?: boolean } = {},
): string {
  const { min = 1, max = 200, pattern, optional = false } = opts;
  if (v === undefined || v === null || v === '') {
    if (optional) return '';
    throw badRequest('invalid_' + field, `${field} is required.`);
  }
  if (typeof v !== 'string') throw badRequest('invalid_' + field, `${field} must be text.`);
  if (v.length < min || v.length > max) {
    throw badRequest('invalid_' + field, `${field} must be between ${min} and ${max} characters.`);
  }
  if (pattern && !pattern.test(v)) throw badRequest('invalid_' + field, `${field} has an invalid format.`);
  return v;
}

export function num(
  v: unknown,
  field: string,
  opts: { min?: number; max?: number } = {},
): number {
  const { min = -Infinity, max = Infinity } = opts;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw badRequest('invalid_' + field, `${field} must be a number.`);
  if (v < min || v > max) throw badRequest('invalid_' + field, `${field} must be between ${min} and ${max}.`);
  return v;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function isoNow(d: Date): string {
  return d.toISOString();
}
