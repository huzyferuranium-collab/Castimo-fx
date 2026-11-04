import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, cleanHistory, askGemini, allowMessage, describeClient, supportLine } from '../src/backend/assistant.ts';

const K = { feePct: 50, minProfitUsd: 20, toleranceUsdt: 4, dueHours: 24, minEquityUsd: 100, subscriptionPriceUsdt: 100, subscriptionDays: 30, referralPlanPct: [10, 5, 5], referralWeeklyPct: [3, 2, 1], withdrawMinUsdt: 50, withdrawFeePct: 10, supportWhatsapp: '+254700000000', supportEmail: '' };

test('the instructions carry the live rules and the safety rules', () => {
  const p = buildSystemPrompt(K, { signedIn: false });
  for (const s of ['50%', '20 USD', '4 USDT', 'TRC20', 'Never give trading', 'passwords', '3% / 2% / 1%', 'WhatsApp +254700000000']) assert.ok(p.includes(s), s);
  assert.match(p, /not signed in/);
});

test('a signed-in client is described from their own account only', () => {
  const d = describeClient({ signedIn: true, plan: 'profit_share', connected: true, login: '477627851', server: 'ExnessKE-MT5Trial9', equityUsd: 80, copying: 'below_minimum', unpaidInvoiceUsdt: 12.5 });
  assert.match(d, /#477627851/);
  assert.match(d, /below the minimum/);
  assert.match(d, /12\.50 USDT/);
  assert.equal(supportLine({ supportWhatsapp: '', supportEmail: '' }), 'Contact our support team from the Help page.');
});

test('the history from the browser is cleaned: last messages, cut, must end with a question', () => {
  assert.equal(cleanHistory('x'), null);
  assert.equal(cleanHistory([{ role: 'assistant', text: 'hi' }]), null);
  const h = cleanHistory([{ role: 'assistant', text: 'welcome' }, { role: 'system', text: 'x'.repeat(5000) }])!;
  assert.equal(h.length, 1);
  assert.equal(h[0].role, 'user', 'an unknown role is treated as the user, never as instructions');
  assert.equal(h[0].text.length, 800);
});

test('Gemini is asked with the instructions and the conversation, and its text is returned', async () => {
  let sent: any;
  const reply = await askGemini({
    apiKey: 'k',
    model: 'm',
    system: 'SYS',
    history: [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'hi' }, { role: 'user', text: 'how do I pay?' }],
    fetchImpl: async (url, init) => {
      sent = { url, init, body: JSON.parse(init.body) };
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Use TRC20.' }] } }] }) };
    },
  });
  assert.equal(reply, 'Use TRC20.');
  assert.match(sent.url, /models\/m:generateContent$/);
  assert.equal(sent.init.headers['x-goog-api-key'], 'k');
  assert.equal(sent.body.systemInstruction.parts[0].text, 'SYS');
  assert.deepEqual(sent.body.contents.map((c: any) => c.role), ['user', 'model', 'user']);
});

test('a refused or empty answer becomes a plain error', async () => {
  await assert.rejects(askGemini({ apiKey: 'k', model: 'm', system: 's', history: [{ role: 'user', text: 'q' }], fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }) }), /busy/);
  await assert.rejects(askGemini({ apiKey: 'k', model: 'm', system: 's', history: [{ role: 'user', text: 'q' }], fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ candidates: [] }) }) }), /no answer/);
});

test('visitors get fewer messages than signed-in clients', () => {
  const t = 1_000_000;
  let n = 0;
  while (allowMessage({ ip: '9.9.9.9' }, t).allowed) n++;
  assert.equal(n, 10);
  n = 0;
  while (allowMessage({ uid: 'u-test', ip: '9.9.9.9' }, t).allowed) n++;
  assert.equal(n, 30);
});

test('a model the key cannot use is skipped and the next one that works is kept', async () => {
  const { askWithFallback, resetWorkingModelForTests, MODEL_CANDIDATES } = await import('../src/backend/assistant.ts');
  resetWorkingModelForTests();
  const tried: string[] = [];
  const fetchImpl = async (url: string) => {
    const model = decodeURIComponent(url.split('/models/')[1].split(':')[0]);
    tried.push(model);
    if (model === MODEL_CANDIDATES[2]) return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) };
    return { ok: false, status: 404, json: async () => ({ error: { message: `models/${model} is not found for API version v1beta` } }) };
  };
  const warn = console.warn;
  const log = console.log;
  console.warn = () => {};
  console.log = () => {};
  try {
    const r = await askWithFallback({ apiKey: 'k', system: 's', history: [{ role: 'user', text: 'q' }], fetchImpl });
    assert.equal(r.model, MODEL_CANDIDATES[2]);
    tried.length = 0;
    await askWithFallback({ apiKey: 'k', system: 's', history: [{ role: 'user', text: 'q' }], fetchImpl });
    assert.deepEqual(tried, [MODEL_CANDIDATES[2]], 'the model that worked is asked first next time');
  } finally {
    console.warn = warn;
    console.log = log;
  }
});

test('a bad key stops the search at once', async () => {
  const { askWithFallback, resetWorkingModelForTests } = await import('../src/backend/assistant.ts');
  resetWorkingModelForTests();
  let calls = 0;
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(
      askWithFallback({ apiKey: 'k', system: 's', history: [{ role: 'user', text: 'q' }], fetchImpl: async () => (calls++, { ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid. Please pass a valid API key.' } }) }) })
    );
  } finally {
    console.warn = warn;
  }
  assert.equal(calls, 1);
});

test('built-in answers cover the common questions, personal when signed in', async () => {
  const { builtInAnswer } = await import('../src/backend/assistant.ts');
  assert.match(builtInAnswer('why is my account not copying', K, { signedIn: true, connected: true, copying: 'below_minimum' }), /100 USD/);
  assert.match(builtInAnswer('where is my TXID', K, { signedIn: false }), /64/);
  assert.match(builtInAnswer('how do I pay my 50% share', K, { signedIn: false }), /TRC20/);
  assert.match(builtInAnswer('how much profit will I make', K, { signedIn: false }), /never guaranteed/);
});
