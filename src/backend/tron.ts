/**
 * USDT (TRC20) payment checking against the TRON blockchain via TronGrid.
 * Pure helpers are unit-tested; the two fetch functions call TronGrid's public API.
 */
import { createHash } from 'node:crypto';

export const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Base58 TRON address -> 20-byte hex (lowercase, no prefix). Returns null if invalid. */
export function tronAddressToHex20(addr: string): string | null {
  if (typeof addr !== 'string' || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) return null;
  let n = 0n;
  for (const ch of addr) n = n * 58n + BigInt(B58.indexOf(ch));
  const hex = n.toString(16).padStart(50, '0'); // 25 bytes: 0x41 + 20 bytes + 4-byte checksum
  if (hex.length !== 50) return null;
  const payload = Buffer.from(hex.slice(0, 42), 'hex');
  const check = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest().subarray(0, 4);
  if (check.toString('hex') !== hex.slice(42)) return null;
  if (hex.slice(0, 2) !== '41') return null;
  return hex.slice(2, 42);
}

/** Accepts base58 ("T..."), or hex with optional 0x / 41 prefix, and returns 20-byte lowercase hex. */
export function normalizeTronAddress(a: unknown): string | null {
  if (typeof a !== 'string') return null;
  const s = a.trim();
  if (s.startsWith('T')) return tronAddressToHex20(s);
  const h = s.toLowerCase().replace(/^0x/, '');
  if (/^41[0-9a-f]{40}$/.test(h)) return h.slice(2);
  if (/^[0-9a-f]{40}$/.test(h)) return h;
  return null;
}

export interface PaymentCheck {
  ok: boolean;
  amountUsdt?: number;
  error?: string;
}

/**
 * Looks through a transaction's events for a USDT Transfer to the treasury wallet.
 * `events` is TronGrid's `data` array from /v1/transactions/{txid}/events.
 */
export function checkUsdtPayment(
  events: any[],
  opts: { treasury: string; minUsdt: number; usdtContract?: string }
): PaymentCheck {
  const treasuryHex = normalizeTronAddress(opts.treasury);
  const contractHex = normalizeTronAddress(opts.usdtContract || USDT_TRC20_CONTRACT);
  if (!treasuryHex || !contractHex) return { ok: false, error: 'Payment wallet is not configured correctly.' };

  let best = 0;
  for (const ev of events || []) {
    if (!ev || ev.event_name !== 'Transfer') continue;
    if (normalizeTronAddress(ev.contract_address) !== contractHex) continue;
    const to = normalizeTronAddress(ev.result?.to ?? ev.result?.['1']);
    if (to !== treasuryHex) continue;
    const raw = ev.result?.value ?? ev.result?.['2'];
    if (typeof raw !== 'string' && typeof raw !== 'number') continue;
    const amount = Number(raw) / 1_000_000; // USDT has 6 decimals
    if (Number.isFinite(amount) && amount > best) best = amount;
  }
  if (best <= 0) return { ok: false, error: 'No USDT transfer to our wallet was found in that transaction.' };
  if (best + 1e-9 < opts.minUsdt) {
    return { ok: false, amountUsdt: best, error: `Payment is too small: ${best.toFixed(2)} USDT received, ${opts.minUsdt.toFixed(2)} required.` };
  }
  return { ok: true, amountUsdt: best };
}

const GRID = 'https://api.trongrid.io';

function headers(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (process.env.TRONGRID_API_KEY) h['TRON-PRO-API-KEY'] = process.env.TRONGRID_API_KEY;
  return h;
}

/** Transaction events from TronGrid. Throws on network or service errors. */
export async function fetchTxEvents(txid: string): Promise<any[]> {
  const res = await fetch(`${GRID}/v1/transactions/${encodeURIComponent(txid)}/events`, { headers: headers() });
  if (!res.ok) throw new Error(`TronGrid error ${res.status}`);
  const data: any = await res.json();
  return Array.isArray(data?.data) ? data.data : [];
}

/** True only once the transaction is final (in a solidified block) and succeeded. */
export async function isTxFinalAndSuccessful(txid: string): Promise<boolean> {
  const res = await fetch(`${GRID}/walletsolidity/gettransactioninfobyid`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ value: txid }),
  });
  if (!res.ok) throw new Error(`TronGrid error ${res.status}`);
  const info: any = await res.json();
  if (!info || !info.id) return false; // not solidified yet (or unknown)
  const result = info.receipt?.result;
  return result === undefined || result === 'SUCCESS';
}
