import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssetLinks } from '../src/backend/assetLinks.ts';

const FP1 = Array.from({ length: 32 }, (_, i) => (i * 7 + 3).toString(16).padStart(2, '0').toUpperCase().slice(-2)).join(':');
const FP2 = Array.from({ length: 32 }, (_, i) => (255 - i).toString(16).padStart(2, '0').toUpperCase()).join(':');

test('nothing is served until both settings exist', () => {
  assert.equal(buildAssetLinks({}), null);
  assert.equal(buildAssetLinks({ ANDROID_PACKAGE_NAME: 'com.castimofx.app' }), null);
  assert.equal(buildAssetLinks({ ANDROID_SHA256_FINGERPRINTS: FP1 }), null);
  assert.equal(buildAssetLinks({ ANDROID_PACKAGE_NAME: '', ANDROID_SHA256_FINGERPRINTS: '' }), null);
});

test('builds the statement Android expects', () => {
  const out = buildAssetLinks({ ANDROID_PACKAGE_NAME: 'com.castimofx.app', ANDROID_SHA256_FINGERPRINTS: FP1 });
  assert.deepEqual(out, [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'com.castimofx.app', sha256_cert_fingerprints: [FP1] },
    },
  ]);
});

test('accepts several fingerprints separated by commas, spaces or lines, in any letter case, without repeats', () => {
  const out = buildAssetLinks({
    ANDROID_PACKAGE_NAME: ' com.castimofx.app ',
    ANDROID_SHA256_FINGERPRINTS: `${FP1.toLowerCase()},\n ${FP2}  ${FP1}`,
  });
  assert.deepEqual(out?.[0].target.sha256_cert_fingerprints, [FP1, FP2]);
  assert.equal(out?.[0].target.package_name, 'com.castimofx.app');
});

test('a bad package name is refused', () => {
  for (const bad of ['castimofx', 'com..app', '1com.app', 'com.castimofx.app!', 'com.cast imofx.app', '../etc']) {
    assert.equal(buildAssetLinks({ ANDROID_PACKAGE_NAME: bad, ANDROID_SHA256_FINGERPRINTS: FP1 }), null, bad);
  }
});

test('one bad fingerprint refuses the whole file', () => {
  const short = FP1.split(':').slice(0, 31).join(':');
  const notHex = FP1.replace(/^../, 'ZZ');
  const noColons = FP1.replace(/:/g, '');
  for (const bad of [short, notHex, noColons, `${FP1}, ${short}`]) {
    assert.equal(buildAssetLinks({ ANDROID_PACKAGE_NAME: 'com.castimofx.app', ANDROID_SHA256_FINGERPRINTS: bad }), null, bad);
  }
});
