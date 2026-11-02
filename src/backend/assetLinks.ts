/**
 * The file Android needs at /.well-known/assetlinks.json to trust that the Castimofx app and this website belong
 * together (so the app opens the site full screen, without a browser address bar).
 *
 * It is built from two Render settings, so nothing has to be committed or guessed:
 *   ANDROID_PACKAGE_NAME          e.g. com.castimofx.app
 *   ANDROID_SHA256_FINGERPRINTS   one or more SHA-256 certificate fingerprints, separated by commas, spaces or lines,
 *                                 written like AB:CD:...:EF (32 pairs). Copy them from Google Play Console
 *                                 (Setup, App signing) and, if you test with your own key, from PWABuilder.
 * If either is missing or not in the right shape, nothing is served (the route answers "not found").
 */
export interface AssetLinkStatement {
  relation: string[];
  target: { namespace: 'android_app'; package_name: string; sha256_cert_fingerprints: string[] };
}

const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function buildAssetLinks(env: { ANDROID_PACKAGE_NAME?: string; ANDROID_SHA256_FINGERPRINTS?: string }): AssetLinkStatement[] | null {
  const pkg = String(env.ANDROID_PACKAGE_NAME ?? '').trim();
  if (!PACKAGE_NAME.test(pkg)) return null;

  const parts = String(env.ANDROID_SHA256_FINGERPRINTS ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (parts.length === 0) return null;
  // One bad entry makes the whole file untrustworthy, so it is refused rather than partly served.
  if (!parts.every((p) => FINGERPRINT.test(p))) return null;

  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: Array.from(new Set(parts)) },
    },
  ];
}
