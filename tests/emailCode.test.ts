import test from 'node:test';
import assert from 'node:assert/strict';
import { CODE_TTL_MS, MAX_ATTEMPTS, MAX_SENDS_PER_HOUR, RESEND_COOLDOWN_MS, canSend, checkCode, hashCode, newCode, recordFor } from '../src/backend/emailCodeRules.ts';

const now = Date.parse('2026-11-01T10:00:00Z');
const U = 'uid-1';
const E = 'Client@Example.com';

test('codes are 6 digits and not all the same', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const c = newCode();
    assert.match(c, /^\d{6}$/);
    seen.add(c);
  }
  assert.ok(seen.size > 40);
});

test('the right code passes; the record holds only a hash', () => {
  const rec = recordFor(null, U, E, '123456', now);
  assert.equal(JSON.stringify(rec).includes('123456'), false);
  assert.equal(rec.hash, hashCode(U, E, '123456', rec.salt));
  assert.deepEqual(checkCode(rec, U, E, '123456', now + 1000), { ok: true });
  assert.deepEqual(checkCode(rec, U, ' client@example.com ', ' 123456 ', now + 1000), { ok: true });
});

test('wrong codes count down and then lock, even the right code is refused once locked', () => {
  const rec = recordFor(null, U, E, '123456', now);
  let r: any = checkCode(rec, U, E, '000000', now);
  assert.deepEqual(r, { ok: false, reason: 'wrong', attemptsLeft: MAX_ATTEMPTS - 1 });
  rec.attempts = MAX_ATTEMPTS;
  assert.equal((checkCode(rec, U, E, '123456', now) as any).reason, 'locked');
});

test('an expired, missing, malformed or other-account code never passes', () => {
  const rec = recordFor(null, U, E, '123456', now);
  assert.equal((checkCode(rec, U, E, '123456', now + CODE_TTL_MS) as any).reason, 'expired');
  assert.equal((checkCode(null, U, E, '123456', now) as any).reason, 'none');
  assert.equal((checkCode(rec, U, E, '12345', now) as any).reason, 'format');
  assert.equal((checkCode(rec, U, E, 'abcdef', now) as any).reason, 'format');
  assert.equal(checkCode(rec, 'someone-else', E, '123456', now).ok, false);
  assert.equal(checkCode(rec, U, 'other@example.com', '123456', now).ok, false);
});

test('sending is limited: 45 seconds apart, and 5 per hour', () => {
  assert.deepEqual(canSend(null, now), { ok: true });
  let rec = recordFor(null, U, E, '111111', now);
  const early: any = canSend(rec, now + 10_000);
  assert.equal(early.ok, false);
  assert.equal(early.reason, 'cooldown');
  assert.equal(early.waitSeconds, 35);
  let t = now;
  for (let i = 1; i < MAX_SENDS_PER_HOUR; i++) {
    t += RESEND_COOLDOWN_MS + 1;
    assert.equal(canSend(rec, t).ok, true);
    rec = recordFor(rec, U, E, '222222', t);
  }
  t += RESEND_COOLDOWN_MS + 1;
  const hourly: any = canSend(rec, t);
  assert.equal(hourly.ok, false);
  assert.equal(hourly.reason, 'hourly');
  assert.equal(canSend(rec, now + 3_600_001).ok, true);
});
