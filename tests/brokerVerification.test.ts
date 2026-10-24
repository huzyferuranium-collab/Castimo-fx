import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyBrokerAccountInfo,
  validateSubmittedCredentials,
  isOwnedBy,
  clientAccountName,
  translateBrokerError,
  BrokerVerificationError,
} from '../src/backend/brokerVerification.ts';

const creds = { login: '12345678', server: 'HFMarketsGlobal-Demo' };
const good = {
  login: 12345678, server: 'HFMarketsGlobal-Demo', broker: 'HF Markets (SV) Ltd.', name: 'Jane Doe',
  currency: 'USD', balance: 1000, equity: 1012.5, freeMargin: 990, leverage: 500,
  tradeAllowed: true, investorMode: false,
};
const code = (fn: () => unknown) => {
  try { fn(); } catch (e: any) { return e instanceof BrokerVerificationError ? e.code : 'OTHER:' + e?.message; }
  return 'NO_ERROR';
};

test('accepts a genuine broker answer and uses the broker\'s numbers', () => {
  const v = verifyBrokerAccountInfo(good, creds);
  assert.equal(v.equity, 1012.5);
  assert.equal(v.balance, 1000);
  assert.equal(v.brokerName, 'HF Markets (SV) Ltd.');
  assert.equal(v.accountType, 'demo');
});

test('real server is labelled real', () => {
  assert.equal(verifyBrokerAccountInfo({ ...good, server: 'HFMarketsGlobal-Live20' }, creds).accountType, 'real');
});

test('rejects missing / empty answers', () => {
  assert.equal(code(() => verifyBrokerAccountInfo(null, creds)), 'BAD_BROKER_RESPONSE');
  assert.equal(code(() => verifyBrokerAccountInfo(undefined, creds)), 'BAD_BROKER_RESPONSE');
  assert.equal(code(() => verifyBrokerAccountInfo({} as any, creds)), 'BAD_BROKER_RESPONSE');
});

test('rejects an answer that does not name a broker', () => {
  assert.equal(code(() => verifyBrokerAccountInfo({ ...good, broker: '' }, creds)), 'BAD_BROKER_RESPONSE');
  assert.equal(code(() => verifyBrokerAccountInfo({ ...good, broker: undefined }, creds)), 'BAD_BROKER_RESPONSE');
});

test('rejects non-numeric, negative or infinite money figures', () => {
  assert.equal(code(() => verifyBrokerAccountInfo({ ...good, equity: '1000' }, creds)), 'BAD_BROKER_RESPONSE');
  assert.equal(code(() => verifyBrokerAccountInfo({ ...good, balance: -5 }, creds)), 'BAD_BROKER_RESPONSE');
  assert.equal(code(() => verifyBrokerAccountInfo({ ...good, equity: Infinity }, creds)), 'BAD_BROKER_RESPONSE');
  assert.equal(code(() => verifyBrokerAccountInfo({ ...good, balance: NaN }, creds)), 'BAD_BROKER_RESPONSE');
});

test('rejects a login that differs from the one submitted', () => {
  assert.equal(code(() => verifyBrokerAccountInfo({ ...good, login: 99999999 }, creds)), 'LOGIN_MISMATCH');
});

test('rejects read-only (investor) and trading-disabled logins', () => {
  assert.equal(code(() => verifyBrokerAccountInfo({ ...good, investorMode: true }, creds)), 'TRADING_NOT_ALLOWED');
  assert.equal(code(() => verifyBrokerAccountInfo({ ...good, tradeAllowed: false }, creds)), 'TRADING_NOT_ALLOWED');
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

test('only the owner may reuse an existing MetaApi account', () => {
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

test('broker error translation never leaks raw errors', () => {
  assert.equal(translateBrokerError({ details: { code: 'E_AUTH' }, message: 'x' }, creds).code, 'BROKER_AUTH_FAILED');
  assert.equal(translateBrokerError({ message: 'account connection validation failed' }, creds).code, 'BROKER_AUTH_FAILED');
  assert.equal(translateBrokerError({ details: { code: 'E_SRV_NOT_FOUND' }, message: 'x' }, creds).code, 'BROKER_SERVER_NOT_FOUND');
  assert.equal(translateBrokerError({ message: 'Please top up your account' }, creds).code, 'CAPACITY');
  const other = translateBrokerError({ message: 'ECONNRESET 10.0.0.5:443 secret-stack' }, creds);
  assert.equal(other.code, 'BROKER_UNREACHABLE');
  assert.ok(!other.message.includes('10.0.0.5'));
});

import { normalizeBrokerServer, pickServerAlias } from '../src/backend/brokerVerification.ts';

test('normalizeBrokerServer fixes common spellings and leaves others alone', () => {
  assert.equal(normalizeBrokerServer('Exness-Real9'), 'Exness-MT5Real9');
  assert.equal(normalizeBrokerServer('HFMarkets-Live20'), 'HFMarketsGlobal-Live20');
  assert.equal(normalizeBrokerServer('  Some-Broker-Live  '), 'Some-Broker-Live');
});

test('pickServerAlias only returns names from the supplied list', () => {
  assert.equal(pickServerAlias('exness-real9', ['Exness-MT5Real9', 'Exness-MT5Real10']), 'Exness-MT5Real9');
  assert.equal(pickServerAlias('Fake-Server', ['Exness-MT5Real9']), null);
  assert.equal(pickServerAlias('Exness-MT5Real9', ['Exness-MT5Real9']), null);
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
