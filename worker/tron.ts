/** Validation for TRON (TRC20) payment details. */

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(s: string): Uint8Array | null {
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.push(Number(n & 0xffn));
    n >>= 8n;
  }
  bytes.reverse();
  // each leading '1' is a leading zero byte
  let zeros = 0;
  for (const ch of s) {
    if (ch === '1') zeros++;
    else break;
  }
  return new Uint8Array([...new Array(zeros).fill(0), ...bytes]);
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

/**
 * A TRON address is 34 base58 characters starting with "T", which decodes to
 * 0x41 + 20 address bytes + a 4 byte double-SHA256 checksum. We verify all of it,
 * so a mistyped address is rejected before any client is told to send money to it.
 */
export async function isValidTronAddress(address: string): Promise<boolean> {
  if (typeof address !== 'string' || address.length !== 34 || address[0] !== 'T') return false;
  const raw = base58Decode(address);
  if (!raw || raw.length !== 25 || raw[0] !== 0x41) return false;
  const payload = raw.slice(0, 21);
  const checksum = raw.slice(21);
  const hash = await sha256(await sha256(payload));
  for (let i = 0; i < 4; i++) {
    if (hash[i] !== checksum[i]) return false;
  }
  return true;
}

/** A TRON transaction id is 64 hexadecimal characters. */
export function isValidTxHash(hash: string): boolean {
  return typeof hash === 'string' && /^[0-9a-fA-F]{64}$/.test(hash);
}
