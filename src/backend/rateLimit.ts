/**
 * A small request limiter that needs no extra package. It counts requests per visitor address in a fixed time window
 * and answers "429 too many requests" once the limit is passed. It is a brake on floods and on guessing, not a
 * replacement for a firewall: for real attack traffic put Cloudflare in front of the site.
 *
 * Notes:
 *  - The server runs as ONE instance (see DEPLOY.md), so counting in memory is enough. A restart clears the counts.
 *  - Mobile networks often put many people behind one address, so the general limit is generous; only the sensitive
 *    routes (connecting an account, paying, email codes) are limited tightly.
 *  - The visitor address is Express's `req.ip`, which only trusts the proxy hops set with TRUST_PROXY_HOPS
 *    (1 for Render alone, 2 if Cloudflare is added in front). A caller cannot fake it with their own headers.
 *  - Emergency switch: set RATE_LIMIT_OFF=1 on Render to turn every limit off without changing code.
 */
export interface RateDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class RateWindow {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(max: number, windowMs: number, maxKeys = 100_000) {
    this.max = max;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  hit(key: string, now: number): RateDecision {
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= now) {
      if (this.hits.size >= this.maxKeys) this.purge(now);
      // If the table is somehow still full, let the request through: the limiter must never block everyone.
      if (this.hits.size >= this.maxKeys) return { allowed: true, retryAfterSeconds: 0 };
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    cur.count += 1;
    if (cur.count > this.max) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
    return { allowed: true, retryAfterSeconds: 0 };
  }

  purge(now: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }

  size(): number {
    return this.hits.size;
  }
}

interface ReqLike {
  ip?: string;
  method?: string;
}
interface ResLike {
  setHeader(name: string, value: string): unknown;
  status(code: number): { json(body: unknown): unknown };
}

export interface RateLimitOptions {
  max: number;
  windowMs: number;
  /** Requests for which this limiter does not count or block (for example plain reads). */
  skip?: (req: ReqLike) => boolean;
  now?: () => number;
  env?: Record<string, string | undefined>;
}

export function rateLimit(opts: RateLimitOptions) {
  const win = new RateWindow(opts.max, opts.windowMs);
  const now = opts.now ?? Date.now;
  const env = opts.env ?? process.env;
  if (!opts.now) {
    const timer = setInterval(() => win.purge(Date.now()), 60_000);
    if (typeof (timer as any).unref === 'function') (timer as any).unref();
  }
  return (req: ReqLike, res: ResLike, next: () => void): unknown => {
    if (env.RATE_LIMIT_OFF === '1') return next();
    if (opts.skip && opts.skip(req)) return next();
    const d = win.hit(req.ip || 'unknown', now());
    if (d.allowed) return next();
    res.setHeader('Retry-After', String(d.retryAfterSeconds));
    return res.status(429).json({ success: false, error: 'Too many requests. Please wait a moment and try again.' });
  };
}

/** How many proxy hops sit in front of the server (Render alone = 1). Anything unusable falls back to 1. */
export function trustProxyHops(env: Record<string, string | undefined> = process.env): number {
  const raw = String(env.TRUST_PROXY_HOPS ?? '').trim();
  const n = Number(raw);
  return raw !== '' && Number.isInteger(n) && n >= 0 && n <= 5 ? n : 1;
}

export const isReadOnly = (req: ReqLike): boolean => ['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase());
