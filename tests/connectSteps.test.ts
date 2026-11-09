import test from 'node:test';
import assert from 'node:assert/strict';
import { connectSteps, mayLeaveWindow, needsCopyResume } from '../src/services/connectSteps.ts';
import { liveDetail } from '../src/services/pendingConnection.ts';

const states = (stage: string) => connectSteps(stage).map((s) => s.state);

test('a step is ticked only once what it says has happened', () => {
  assert.deepEqual(states('queued'), ['active', 'todo', 'todo', 'todo']);
  assert.deepEqual(states('checking'), ['active', 'todo', 'todo', 'todo']);
  assert.deepEqual(states('creating'), ['done', 'active', 'todo', 'todo']);
  // while Duplikium is logging in to the broker, "your broker accepts the login" is NOT ticked
  assert.deepEqual(states('syncing'), ['done', 'done', 'active', 'todo']);
  // only when the login has been seen working does the window move on to reading the balance
  assert.deepEqual(states('verifying'), ['done', 'done', 'done', 'active']);
  assert.deepEqual(states('done'), ['done', 'done', 'done', 'done']);
});

test('an unknown stage starts at the first step instead of ticking anything', () => {
  assert.deepEqual(states('something-new'), ['active', 'todo', 'todo', 'todo']);
});

test('the steps say what really happens: no terminal is started, and the login is the broker\'s to accept', () => {
  const text = connectSteps('checking').map((s) => s.text).join(' | ');
  assert.doesNotMatch(text, /terminal/i);
  assert.match(text, /adding your account/i);
  assert.match(text, /broker accepts the login/i);
});

test('the client may leave the window once the account is added and only the broker is awaited', () => {
  assert.equal(mayLeaveWindow('checking'), false);
  assert.equal(mayLeaveWindow('creating'), false);
  assert.equal(mayLeaveWindow('syncing'), true);
  assert.equal(mayLeaveWindow('verifying'), true);
});

test('the live line from the server is shown only when it says more than the step already does', () => {
  const working = (label: string) => ({ kind: 'working', label });
  assert.equal(liveDetail(working('Waiting for your broker to accept the login…'), 'Logging in to your broker…'), 'Waiting for your broker to accept the login…');
  assert.equal(liveDetail(working('Logging in to your broker…'), 'Logging in to your broker…'), '', 'the same words are not repeated');
  assert.equal(liveDetail(working('logging in to your broker'), 'Logging in to your broker…'), '', 'whatever the dots or capitals');
  assert.equal(liveDetail({ kind: 'failed', label: 'Could not connect' }, 'Logging in to your broker…'), '', 'a failure is shown elsewhere');
  assert.equal(liveDetail(null, 'x'), '');
  assert.equal(liveDetail('junk', 'x'), '');
});

test('after connecting, copying is only asked to be switched on for an account the server has not already put into service', () => {
  assert.equal(needsCopyResume('ACTIVE'), false, 'in service: nothing more to ask');
  assert.equal(needsCopyResume('active'), false, 'however it is written');
  assert.equal(needsCopyResume('IDLE'), true, 'a paused account is asked to resume, as before');
  assert.equal(needsCopyResume(undefined), true, 'unclear: ask, as has always been done');
  assert.equal(needsCopyResume(null), true);
  assert.equal(needsCopyResume(''), true);
});
