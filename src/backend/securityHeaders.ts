/**
 * Browser security headers, set by the server itself. (`public/_headers` only works on Cloudflare Pages; on Render the
 * Express server is what answers, so the headers have to come from here.)
 *
 *  - nosniff:        the browser must not guess a file's type (stops a text file being run as a script).
 *  - SAMEORIGIN:     other websites cannot show this site inside a frame (stops click-hijacking).
 *  - Referrer-Policy: other sites only see our address, never the page path.
 *  - Permissions-Policy: the site does not need the camera, microphone, location or payment sheet, so they are off.
 *  - HSTS (production only): once a browser has seen the site over HTTPS it refuses to use plain HTTP for 180 days.
 *
 * Deliberately NOT set here: a Content-Security-Policy and Cross-Origin-Opener-Policy. Both can break Firebase sign-in
 * pop-ups, Google Fonts or the inline styles unless they are tested against the live site first.
 */
interface HeaderRes {
  setHeader(name: string, value: string): unknown;
}

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

export const HSTS_VALUE = 'max-age=15552000';

export function securityHeaders(opts: { production: boolean }) {
  return (_req: unknown, res: HeaderRes, next: () => void): void => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    if (opts.production) res.setHeader('Strict-Transport-Security', HSTS_VALUE);
    next();
  };
}
