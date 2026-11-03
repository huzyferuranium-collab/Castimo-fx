import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyCopierAccount,
  validateSubmittedCredentials,
  isOwnedBy,
  clientAccountName,
  translateCopierError,
  classifyState,
  hasFigures,
  BrokerVerificationError,
  checkConnectEligibility,
  isBelowCopyMinimum,
} from '../src/backend/brokerVerification.ts';
import { DuplikiumError, type DuplikiumAccount } from '../src/backend/duplikiumClient.ts';

const creds = { login: '12345678', server: 'HFMarketsGlobal-Demo' };
const good: DuplikiumAccount = {
  accountId: 'A1', name: 'CastimoFX Client u1 #12345678', login: '12345678', server: 'HFMarketsGlobal-Demo', broker: 'mt5',
  type: 'slave', enabled: true, balance: 1000, equity: 1012.5, freeMargin: 990, currency: 'USD', state: 'CONNECTED',
  lastUpdate: '2026-10-30 10:00:00', groupId: 'T', subscriptionKey: null, openTrades: 0,
};
const code = (fn: () => unknown) => {
  try { fn(); } catch (e: any) { return e instanceof BrokerVerificationError ? e.code : 'OTHER:' + e?.message; }
  return 'NO_ERROR';
};

test('accepts a genuine broker answer and uses the broker\'s numbers', () => {
  const v = verifyCopierAccount(good, creds);
  assert.equal(v.equity, 1012.5);
  assert.equal(v.balance, 1000);
  assert.equal(v.freeMargin, 990);
  assert.equal(v.currency, 'USD');
  assert.equal(v.accountType, 'demo');
});

test('figures that the service does not report are not invented', () => {
  const v = verifyCopierAccount(good, creds);
  assert.equal(v.leverage, 0); // not reported, so none is shown
  assert.equal(v.accountHolderName, '');
});

test('real server is labelled real', () => {
  assert.equal(verifyCopierAccount({ ...good, server: 'HFMarketsGlobal-Live20' }, creds).accountType, 'real');
});

test('rejects missing / empty answers', () => {
  assert.equal(code(() => verifyCopierAccount(null, creds)), 'BAD_BROKER_RESPONSE');
  assert.equal(code(() => verifyCopierAccount(undefined, creds)), 'BAD_BROKER_RESPONSE');
});

test('rejects missing, negative or infinite money figures and a missing currency', () => {
  assert.equal(code(() => verifyCopierAccount({ ...good, equity: null }, creds)), 'BAD_BROKER_RESPONSE');
  assert.equal(code(() => verifyCopierAccount({ ...good, balance: null }, creds)), 'BAD_BROKER_RESPONSE');
  assert.equal(code(() => verifyCopierAccount({ ...good, balance: -5 }, creds)), 'BAD_BROKER_RESPONSE');
  assert.equal(code(() => verifyCopierAccount({ ...good, equity: Infinity }, creds)), 'BAD_BROKER_RESPONSE');
  assert.equal(code(() => verifyCopierAccount({ ...good, currency: '' }, creds)), 'BAD_BROKER_RESPONSE');
});

test('free margin falls back to equity only when the service did not report it', () => {
  assert.equal(verifyCopierAccount({ ...good, freeMargin: null }, creds).freeMargin, 1012.5);
});

test('rejects a login that differs from the one submitted', () => {
  assert.equal(code(() => verifyCopierAccount({ ...good, login: '99999999' }, creds)), 'LOGIN_MISMATCH');
});

test('rejects read-only (investor) logins', () => {
  assert.equal(code(() => verifyCopierAccount({ ...good, state: 'INVESTOR_PASSWORD' }, creds)), 'TRADING_NOT_ALLOWED');
});

test('the service\'s state words are read correctly', () => {
  for (const s of ['CONNECTED', 'ORDER_FAILED', 'ORDER_FAILED_MARGIN', 'SYMBOL_NOT_FOUND', 'SELLOUT_SL', 'CLOSE_ONLY_TP', 'FROZEN_SL', 'connected']) {
    assert.equal(classifyState(s), 'connected', s);
  }
  assert.equal(classifyState('INVESTOR_PASSWORD'), 'investor');
  assert.equal(classifyState('DISCONNECTED'), 'disconnected');
  assert.equal(classifyState('EMPTY_EWALLET'), 'service');
  for (const s of ['NONE', '', 'SOMETHING_NEW']) assert.equal(classifyState(s), 'pending', s);
});

test('figures count as real only when balance, equity and currency are all there', () => {
  assert.equal(hasFigures(good), true);
  assert.equal(hasFigures({ balance: null, equity: 1, currency: 'USD' }), false);
  assert.equal(hasFigures({ balance: 1, equity: null, currency: 'USD' }), false);
  assert.equal(hasFigures({ balance: 1, equity: 1, currency: '' }), false);
  assert.equal(hasFigures(null), false);
});

test('input validation', () => {
  assert.equal(code(() => validateSubmittedCredentials({ login: 'abc', password: 'x', server: 'Some-Server' })), 'BAD_INPUT');
  assert.equal(code(() => validateSubmittedCredentials({ login: '123', password: 'x', server: 'Some-Server' })), 'BAD_INPUT');
  assert.equal(code(() => validateSubmittedCredentials({ login: '12345678', password: '', server: 'Some-Server' })), 'BAD_INPUT');
  assert.equal(code(() => validateSubmittedCredentials({ login: '12345678', password: 'x', server: '' })), 'BAD_INPUT');
  assert.equal(code(() => validateSubmittedCredentials({ login: '12345678', password: 'x'.repeat(201), server: 'Some-Server' })), 'BAD_INPUT');
  assert.deepEqual(
    validateSubmittedCredentials({ login: ' 12345678 ', password: 'p', server: ' HFMarketsGlobal-Live20 ' }),
    { login: '12345678', password: 'p', server: 'HFMarketsGlobal-Live20' }
  );
});

test('copier service errors become calm, correct client messages and never leak raw text', () => {
  const t = (kind: any, message: string, c?: string) => translateCopierError(new DuplikiumError(kind, message, { code: c }), creds);
  // Our own login being refused is never blamed on the client
  assert.equal(t('AUTH', 'bad token').code, 'VERIFICATION_UNAVAILABLE');
  assert.equal(t('NOT_CONFIGURED', 'x').code, 'VERIFICATION_UNAVAILABLE');
  // Our own request allowance running out is never blamed on the client's broker: it is retryable and says we are busy
  const busy = t('RATE_LIMIT', 'busy');
  assert.equal(busy.code, 'VERIFICATION_UNAVAILABLE');
  assert.match(busy.message, /a little busy/i);
  assert.doesNotMatch(busy.message, /broker/i);
  assert.equal(t('NETWORK', 'down').code, 'BROKER_UNREACHABLE');
  assert.equal(t('BAD_RESPONSE', 'junk').code, 'VERIFICATION_UNAVAILABLE'); // our hiccup, retryable, never a final refusal
  // The service's own limits are ours to fix
  assert.equal(t('API', 'Account limit reached for your subscription').code, 'CAPACITY');
  assert.equal(t('API', 'Not enough credit in e-wallet').code, 'CAPACITY');
  assert.equal(t('API', 'Account already exists').code, 'ALREADY_LINKED');
  assert.equal(t('API', 'Unknown server').code, 'BROKER_SERVER_NOT_FOUND');
  assert.equal(t('API', 'Invalid password').code, 'BROKER_AUTH_FAILED');
  const other = t('API', 'ECONNRESET 10.0.0.5:443 secret-stack', '77');
  assert.equal(other.code, 'BROKER_UNREACHABLE');
  assert.ok(!other.message.includes('10.0.0.5'));
  assert.equal(other.ref, '77');
  // Unknown errors are calm and carry a short reference only
  const odd = translateCopierError(new TypeError('boom secret'), creds);
  assert.equal(odd.code, 'BROKER_UNREACHABLE');
  assert.ok(!odd.message.includes('secret'));
  // An error that is already a client-safe error passes through unchanged
  const mine = new BrokerVerificationError('TRADING_NOT_ALLOWED', 'x');
  assert.equal(translateCopierError(mine, creds), mine);
});

test('only the owner may reuse an existing copier account', () => {
  const name = clientAccountName('uidA', '12345678');
  assert.equal(isOwnedBy(name, 'uidA'), true);
  assert.equal(isOwnedBy(name, 'uidB'), false);
  assert.equal(isOwnedBy('Castimo master', 'uidA'), false);   // the master account
  assert.equal(isOwnedBy(undefined, 'uidA'), false);
  assert.equal(isOwnedBy(name, ''), false);
  // a user id that merely starts with another user's id must not match
  assert.equal(isOwnedBy(clientAccountName('uidAB', '1'), 'uidA'), false);
  // earlier name format still recognised for the same user only
  assert.equal(isOwnedBy('CastimoFX Client - uidA (#12345678)', 'uidA'), true);
  assert.equal(isOwnedBy('CastimoFX Client - uidA (#12345678)', 'uidB'), false);
});

import { normalizeBrokerServer } from '../src/backend/brokerVerification.ts';

test('normalizeBrokerServer fixes common spellings and leaves others alone', () => {
  assert.equal(normalizeBrokerServer('Exness-Real9'), 'Exness-MT5Real9');
  assert.equal(normalizeBrokerServer('HFMarkets-Live20'), 'HFMarketsGlobal-Live20');
  assert.equal(normalizeBrokerServer('  Some-Broker-Live  '), 'Some-Broker-Live');
});

import { countClientAccounts, readLimit } from '../src/backend/brokerVerification.ts';

test('countClientAccounts counts only client accounts, not the master', () => {
  assert.equal(
    countClientAccounts([{ name: 'CastimoFX Client u1 #1234' }, { name: 'Master' }, { name: 'CastimoFX Client u2 #5678' }, {}]),
    2
  );
});

test('readLimit uses fallback unless a whole number is given', () => {
  assert.equal(readLimit(undefined, 5), 5);
  assert.equal(readLimit('12', 5), 12);
  assert.equal(readLimit('0', 5), 0);
  assert.equal(readLimit('abc', 5), 5);
});

import { parseClientAccountName } from '../src/backend/brokerVerification.ts';

test('parseClientAccountName reads user and login back from the account name', () => {
  assert.deepEqual(parseClientAccountName('CastimoFX Client abc123 #477627851'), { userId: 'abc123', login: '477627851' });
  assert.deepEqual(parseClientAccountName('CastimoFX Client - abc123 (#4776)'), { userId: 'abc123', login: '4776' });
  assert.equal(parseClientAccountName('Master HFM'), null);
});

test('no account is refused for having little equity: it connects and simply is not copied yet', () => {
  for (const equity of [199.99, 0, 1, NaN, 200, 5000.5]) {
    assert.equal(code(() => checkConnectEligibility({ equity, currency: 'USD' })), 'NO_ERROR', `equity ${equity}`);
  }
  assert.equal(code(() => checkConnectEligibility({ equity: 5000.5, currency: 'usd' })), 'NO_ERROR');
});

test('copying needs at least $100 equity, and an unreadable figure holds copying back', () => {
  assert.equal(isBelowCopyMinimum(99.99), true);
  assert.equal(isBelowCopyMinimum(0), true);
  assert.equal(isBelowCopyMinimum(NaN), true);
  assert.equal(isBelowCopyMinimum(100), false);
  assert.equal(isBelowCopyMinimum(5000.5), false);
});

test('the minimum can be changed or switched off with the limit argument', () => {
  assert.equal(isBelowCopyMinimum(49, 50), true);
  assert.equal(isBelowCopyMinimum(50, 50), false);
  assert.equal(isBelowCopyMinimum(49, 0), false);
});

test('only USD accounts can connect', () => {
  assert.equal(code(() => checkConnectEligibility({ equity: 900, currency: 'EUR' })), 'UNSUPPORTED_CURRENCY');
});

test('an unreadable answer from the copier service is a calm, retryable hiccup on our side: it never removes the client\'s account', async () => {
  const { rejectsForGood, friendlyHint } = await import('../src/backend/clientBridge.ts');
  const e = translateCopierError(new DuplikiumError('BAD_RESPONSE', 'The copier service sent an answer we could not read.', { detail: 'HTTP 502, 40 characters, starts: "<html>…"' }), creds);
  assert.equal(e.code, 'VERIFICATION_UNAVAILABLE');
  assert.equal(e.ref, 'COPIER_BAD_RESPONSE');
  assert.match(e.detail ?? '', /HTTP 502/); // for the administrator's log
  assert.ok(!/could not read|answer/i.test(e.message), 'the client is not shown technical wording');
  assert.ok(!rejectsForGood.has(e.code), 'not treated as a final refusal (that would delete the account created by the attempt)');
  assert.match(friendlyHint(e.code), /Nothing is wrong with your account/);
});
