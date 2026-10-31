import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIpFrom } from '../src/backend/clientIp.ts';

test('Cloudflare header wins, then x-forwarded-for, then the socket', () => {
  assert.equal(clientIpFrom({ 'cf-connecting-ip': '41.90.1.2', 'x-forwarded-for': '9.9.9.9' }, '10.0.0.1'), '41.90.1.2');
  assert.equal(clientIpFrom({ 'x-forwarded-for': '41.90.1.2, 10.0.0.5' }, '10.0.0.1'), '41.90.1.2');
  assert.equal(clientIpFrom({}, '::ffff:41.90.1.2'), '41.90.1.2');
  assert.equal(clientIpFrom({}, '2001:db8::1'), '2001:db8::1');
});

test('junk is never returned as an address', () => {
  assert.equal(clientIpFrom({ 'x-forwarded-for': '<script>alert(1)</script>' }, null), '');
  assert.equal(clientIpFrom({ 'x-forwarded-for': '999.1.1.1' }, undefined), '');
  assert.equal(clientIpFrom({}, undefined), '');
});
