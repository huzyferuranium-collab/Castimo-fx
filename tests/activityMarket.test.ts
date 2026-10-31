import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityLog, describeActivity } from '../src/backend/activityLog.ts';
import { readRow, readMarkets, parseSymbols, DEFAULT_WATCH_SYMBOLS } from '../src/backend/marketWatch.ts';

test('the log starts empty: nothing is made up', () => {
  const log = new ActivityLog(10);
  assert.equal(log.size(), 0);
  assert.deepEqual(log.recent(), []);
  assert.deepEqual(log.signals(), []);
});

test('entries are newest first, capped, and signals are only newly opened master trades', () => {
  let t = Date.parse('2026-11-01T10:00:00Z');
  const log = new ActivityLog(3, () => (t += 1000));
  log.add({ kind: 'master_opened', symbol: 'XAUUSD', side: 'BUY', volume: 0.05, price: 4012.3 });
  log.add({ kind: 'copied', symbol: 'XAUUSD', copied: 3, notCopied: 1 });
  log.add({ kind: 'master_closed', symbol: 'XAUUSD', side: 'BUY' });
  log.add({ kind: 'master_opened', symbol: 'EURUSD', side: 'SELL', volume: 0.1, price: 1.0841 });
  assert.equal(log.size(), 3);
  assert.equal(log.recent()[0].symbol, 'EURUSD');
  assert.deepEqual(log.signals().map((e) => e.symbol), ['EURUSD']);
  assert.ok(Date.parse(log.recent()[0].at) > Date.parse(log.recent()[1].at));
});

test('sentences use only the facts given', () => {
  assert.equal(describeActivity({ kind: 'master_opened', symbol: 'XAUUSD', side: 'BUY', volume: 0.05, price: 4012.3 }), 'The master opened a BUY 0.05 XAUUSD at 4012.3.');
  assert.equal(describeActivity({ kind: 'master_opened', symbol: 'XAUUSD', side: 'SELL', volume: 0.02 }), 'The master opened a SELL 0.02 XAUUSD.');
  assert.equal(describeActivity({ kind: 'copied', symbol: 'XAUUSD', copied: 1, notCopied: 0 }), 'The XAUUSD trade was copied to 1 client.');
  assert.equal(describeActivity({ kind: 'copied', symbol: 'XAUUSD', copied: 3, notCopied: 1 }), 'The XAUUSD trade was copied to 3 of 4 clients; 1 not copied.');
  assert.equal(describeActivity({ kind: 'copied', symbol: 'XAUUSD', copied: 0, notCopied: 0 }), 'No active clients to copy the XAUUSD trade to.');
});

test('a price is shown only when the feed gives a sane bid and ask', () => {
  const feed: any = {
    price: (s: string) =>
      ({
        XAUUSD: { bid: 4012.3, ask: 4012.55, time: new Date('2026-11-01T10:00:00Z') },
        EURUSD: { bid: 1.0841, ask: 1.0843 },
        BAD1: { bid: 0, ask: 1 },
        BAD2: { bid: 2, ask: 1 },
        BAD3: { bid: 'x', ask: 1 },
      } as any)[s],
  };
  const gold = readRow(feed, 'XAUUSD');
  assert.equal(gold.available, true);
  assert.equal(gold.spread, 0.25);
  assert.equal(gold.quotedAt, '2026-11-01T10:00:00.000Z');
  assert.equal(readRow(feed, 'EURUSD').spread, 0.0002);
  for (const s of ['BAD1', 'BAD2', 'BAD3', 'NOPE']) assert.deepEqual(readRow(feed, s), { symbol: s, available: false });
});

test('no feed, or a feed that throws, means unavailable, never a guess', () => {
  assert.deepEqual(readRow(null, 'XAUUSD'), { symbol: 'XAUUSD', available: false });
  const boom: any = { price: () => { throw new Error('socket closed'); } };
  assert.deepEqual(readMarkets(boom, ['XAUUSD', 'EURUSD']).map((r) => r.available), [false, false]);
});

test('the symbol setting is cleaned and falls back to the defaults', () => {
  assert.deepEqual(parseSymbols(undefined), DEFAULT_WATCH_SYMBOLS);
  assert.deepEqual(parseSymbols(''), DEFAULT_WATCH_SYMBOLS);
  assert.deepEqual(parseSymbols(' xauusd, EURUSD ,xauusd,<script>,GBPUSD.m'), ['XAUUSD', 'EURUSD', 'GBPUSD.M']);
  assert.equal(parseSymbols(Array.from({ length: 30 }, (_, i) => `SYM${i}`).join(',')).length, 12);
});
