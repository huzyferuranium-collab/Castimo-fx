import test from 'node:test';
import assert from 'node:assert/strict';
import { emailWanted, hoursLeft, overdueEmail, overdueText, reminderEmail, REMINDER_WINDOW_HOURS, reminderDue, reminderId, reminderText } from '../src/backend/invoiceReminders.ts';

const due = '2026-11-09T23:59:00.000Z';
const at = (iso: string) => Date.parse(iso);

test('hours left are counted up to the due time, rounding up', () => {
  assert.equal(hoursLeft(due, at('2026-11-09T18:00:00Z')), 6);
  assert.equal(hoursLeft(due, at('2026-11-09T22:59:00Z')), 1);
  assert.equal(hoursLeft(due, at('2026-11-09T23:30:00Z')), 1, '29 minutes left is "1 hour"');
  assert.equal(hoursLeft(due, at('2026-11-10T00:00:00Z')), 0);
  assert.equal(hoursLeft('not a date', at('2026-11-09T18:00:00Z')), 0);
});

test('reminders start in the last 6 hours and stop at the due time', () => {
  const inv = { status: 'pending', dueAt: due };
  assert.equal(REMINDER_WINDOW_HOURS, 6);
  assert.equal(reminderDue(inv, at('2026-11-09T12:00:00Z')), null, 'too early');
  assert.equal(reminderDue(inv, at('2026-11-09T17:58:00Z')), null, '6 hours and a bit left');
  assert.deepEqual(reminderDue(inv, at('2026-11-09T18:00:00Z')), { hoursLeft: 6 });
  assert.deepEqual(reminderDue(inv, at('2026-11-09T21:10:00Z')), { hoursLeft: 3 });
  assert.deepEqual(reminderDue(inv, at('2026-11-09T23:40:00Z')), { hoursLeft: 1 });
  assert.equal(reminderDue(inv, at('2026-11-10T00:01:00Z')), null, 'overdue: the sweep pauses copying instead');
  assert.equal(reminderDue({ status: 'paid', dueAt: due }, at('2026-11-09T21:00:00Z')), null, 'a paid invoice gets none');
  assert.equal(reminderDue({ status: 'pending' }, at('2026-11-09T21:00:00Z')), null, 'no due time, no reminder');
});

test('each hour has its own fixed reminder id, so the watcher never repeats one', () => {
  assert.equal(reminderId('inv-u1-20261109', 3), 'inv-u1-20261109-h3');
  assert.notEqual(reminderId('inv-u1-20261109', 3), reminderId('inv-u1-20261109', 2));
});

test('the reminder and the overdue notice say what is owed, by when, and what happens', () => {
  const r = reminderText(36.5, 3, due);
  assert.match(r.message, /\$36\.50/);
  assert.match(r.message, /23:59 GMT/);
  assert.match(r.message, /3 hours/);
  assert.match(r.message, /copying pauses/);
  assert.equal(reminderText(36.5, 1, due).title, 'Last hour to pay your share');
  assert.match(reminderText(36.5, 1, due).message, /1 hour from now/);
  const o = overdueText(36.5);
  assert.match(o.message, /\$36\.50/);
  assert.match(o.message, /copying is paused/);
});

test('only 6, 3 and 1 hours before the due time are also sent by email', () => {
  assert.deepEqual([6, 5, 4, 3, 2, 1].filter(emailWanted), [6, 3, 1]);
});

test('the reminder emails are friendly, name the amount and the deadline, and carry the risk line', () => {
  const m = reminderEmail(36.5, 3, due);
  assert.match(m.subject, /23:59 GMT/);
  for (const part of [m.text, m.html]) {
    assert.match(part, /\$36\.50/);
    assert.match(part, /copying pauses/);
  }
  assert.match(m.text, /Trading involves risk/);
  assert.match(reminderEmail(36.5, 1, due).subject, /Last hour/);
  const o = overdueEmail(36.5);
  assert.match(o.subject, /Copying paused/);
  assert.match(o.text, /\$36\.50/);
  assert.match(o.html, /copying is paused/);
});
