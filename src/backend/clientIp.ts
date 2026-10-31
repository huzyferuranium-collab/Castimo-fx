/**
 * The address a request came from, as the server can best tell. Behind Cloudflare/Render the connection itself comes
 * from a proxy, so the proxy's own header is used: Cloudflare's `cf-connecting-ip`, else the first `x-forwarded-for`
 * entry, else the socket address. It is shown to the person whose own action it is, as information only; it is not
 * used for any security decision (a caller can influence these headers).
 */
const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;

function clean(v: unknown): string {
  let s = Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
  s = s.split(',')[0].trim();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  if (IPV4.test(s)) return s.split('.').every((p) => Number(p) <= 255) ? s : '';
  return s.includes(':') && IPV6.test(s) && s.length <= 45 ? s : '';
}

export function clientIpFrom(headers: Record<string, unknown>, socketAddress?: string | null): string {
  return clean(headers['cf-connecting-ip']) || clean(headers['x-forwarded-for']) || clean(socketAddress);
}
