/**
 * Live prices for the dashboard's market watch, read from the master's real broker feed.
 *
 * Only what the feed actually reports is returned: bid, ask, the spread worked out from them, and the feed's own
 * time. There is no 24-hour change or any other figure the feed does not give. A symbol the feed has no price for
 * is reported as unavailable, never guessed. Pure functions around a small `PriceSource`, so they are unit-tested.
 */

export interface RawPrice {
  bid?: unknown;
  ask?: unknown;
  time?: unknown;
}

/** What the broker feed offers (the streaming connection's terminal state fits this). */
export interface PriceSource {
  price(symbol: string): RawPrice | undefined | null;
}

export interface MarketRow {
  symbol: string;
  available: boolean;
  bid?: number;
  ask?: number;
  /** ask minus bid, in price units. */
  spread?: number;
  /** ISO time of the quote as reported by the feed. */
  quotedAt?: string | null;
  /** Decimal places the page should use. */
  digits?: number;
}

export const DEFAULT_WATCH_SYMBOLS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY'];

/** Symbols from the setting (comma separated), or the defaults. Only plain symbol names are accepted. */
export function parseSymbols(raw: string | undefined | null, fallback = DEFAULT_WATCH_SYMBOLS): string[] {
  const list = String(raw ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z0-9._#-]{3,20}$/.test(s));
  const unique = Array.from(new Set(list)).slice(0, 12);
  return unique.length ? unique : fallback;
}

function decimalsOf(n: number): number {
  const s = String(n);
  const i = s.indexOf('.');
  return i === -1 ? 0 : Math.min(8, s.length - i - 1);
}

export function readRow(source: PriceSource | null | undefined, symbol: string): MarketRow {
  let p: RawPrice | undefined | null;
  try {
    p = source?.price(symbol);
  } catch {
    p = undefined;
  }
  const bid = Number(p?.bid);
  const ask = Number(p?.ask);
  if (!p || !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask < bid) {
    return { symbol, available: false };
  }
  const t = p.time instanceof Date ? p.time : p.time != null ? new Date(p.time as any) : null;
  const digits = Math.max(decimalsOf(bid), decimalsOf(ask));
  const spread = Number((ask - bid).toFixed(digits));
  return {
    symbol,
    available: true,
    bid,
    ask,
    spread,
    quotedAt: t && !isNaN(t.getTime()) ? t.toISOString() : null,
    digits,
  };
}

export function readMarkets(source: PriceSource | null | undefined, symbols: string[]): MarketRow[] {
  return symbols.map((s) => readRow(source, s));
}
