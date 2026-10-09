import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { SAMPLE_WORKSHEET, SAMPLE_EXIT_TICKET } from '../public/lib/sample.js';

let clock = Date.UTC(2026, 9, 9, 19, 0, 0);
const quietLog = { warn() {}, error() {} };
const rewrites = [];
// Stands in for Claude: keeps the numbers unless the theme is "cheat".
async function fakeRewriter({ problem, interest }) {
  rewrites.push({ problem, interest });
  if (interest === 'cheat') return `In ${interest}, the answer is 42. ${problem}`;
  return `${interest} edition: ${problem}`;
}

const app = createApp({ rewriter: fakeRewriter, now: () => clock, log: quietLog });
const server = http.createServer(app.handler);
let base;

before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function call(method, path, { body, teacher, group } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (teacher) headers['x-teacher-key'] = teacher;
  if (group) headers['x-group-token'] = group;
  const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.text(), headers: res.headers };
}

async function newClass() {
  const res = await call('POST', '/api/classes', {
    body: { worksheet: SAMPLE_WORKSHEET, exitTicket: SAMPLE_EXIT_TICKET, groupCount: 4 },
  });
  assert.equal(res.status, 200);
  return res.body;
}

test('pages are served with a strict content security policy', async () => {
  for (const page of ['/', '/teacher', '/board', '/display']) {
    const res = await call('GET', page);
    assert.equal(res.status, 200, page);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  }
  assert.equal((await call('GET', '/lib/worksheet.js')).status, 200);
  assert.equal((await call('GET', '/../src/app.js')).status, 404);
  assert.equal((await call('GET', '/%2e%2e/src/app.js')).status, 404);
});

test('a worksheet with problems missing answers is refused with the reason', async () => {
  const res = await call('POST', '/api/classes', { body: { worksheet: '1. x + 1 = 2', exitTicket: '' } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /has no answer/);
  assert.match(res.body.error, /exit ticket/);
});

test('a full lesson: join, answer, flags, skip, exit ticket, results, clear', async () => {
  const { code, teacherKey, pin } = await newClass();
  assert.match(code, /^[A-Z0-9]{5}$/);
  assert.match(pin, /^\d{6}$/);

  // Board needs the teacher key.
  assert.equal((await call('GET', `/api/classes/${code}/board`)).status, 403);
  let board = (await call('GET', `/api/classes/${code}/board`, { teacher: teacherKey })).body;
  assert.equal(board.groups.length, 0);
  assert.equal(board.totalProblems, 12);

  // Groups join with the code (any case) and a name.
  const tigers = await call('POST', `/api/classes/${code.toLowerCase()}/join`, { body: { name: 'Tigers' } });
  assert.equal(tigers.status, 200);
  const t = tigers.body.token;
  let state = tigers.body.state;
  assert.equal(state.stage, 'activities');
  assert.equal(state.problem.text, 'x + 7 = 15');
  assert.equal(JSON.stringify(state).includes('"answers"'), false, 'the answer key never goes to students');

  const owls = (await call('POST', `/api/classes/${code}/join`, { body: { name: 'Owls' } })).body.token;
  // Same name again resumes the same group.
  const again = await call('POST', `/api/classes/${code}/join`, { body: { name: ' tigers ' } });
  assert.equal(again.body.token, t);
  assert.equal((await call('POST', '/api/classes/NOPE1/join', { body: { name: 'X' } })).status, 404);

  // Right and wrong answers.
  let res = await call('POST', `/api/classes/${code}/group/answer`, {
    group: t,
    body: { activityIndex: 0, problemIndex: 0, answer: 'x = 8' },
  });
  assert.equal(res.body.result, 'correct');
  assert.equal(res.body.state.problem.text, 'x - 4 = 9');

  // A double submit for the old problem doesn't count.
  res = await call('POST', `/api/classes/${code}/group/answer`, {
    group: t,
    body: { activityIndex: 0, problemIndex: 0, answer: '8' },
  });
  assert.equal(res.body.result, 'stale');

  clock += 20_000;
  for (let i = 0; i < 3; i++) {
    res = await call('POST', `/api/classes/${code}/group/answer`, {
      group: t,
      body: { activityIndex: 0, problemIndex: 1, answer: '5' },
    });
    assert.equal(res.body.result, 'wrong');
  }
  assert.equal(res.body.state.teacherFlagged, true);

  // The board shows Tigers stuck and, four minutes on, Owls quiet.
  clock += 4 * 60_000;
  board = (await call('GET', `/api/classes/${code}/board`, { teacher: teacherKey })).body;
  const tigersRow = board.groups.find((g) => g.name === 'Tigers');
  const owlsRow = board.groups.find((g) => g.name === 'Owls');
  assert.equal(tigersRow.finished, 1);
  assert.equal(tigersRow.problemNumber, 2);
  assert.equal(tigersRow.activityTitle, 'Warm-up');
  assert.deepEqual(tigersRow.flags.map((f) => f.type), ['stuck', 'quiet']);
  assert.equal(tigersRow.sinceLastAnswer, 240);
  assert.deepEqual(owlsRow.flags.map((f) => f.type), ['quiet']);
  assert.equal(owlsRow.sinceLastAnswer, null);

  // "Checked on them" clears both flags for now.
  board = (await call('POST', `/api/classes/${code}/groups/${tigersRow.id}/ack`, { teacher: teacherKey })).body;
  assert.deepEqual(board.groups.find((g) => g.name === 'Tigers').flags, []);

  // The teacher skips the problem for them.
  board = (await call('POST', `/api/classes/${code}/groups/${tigersRow.id}/skip`, { teacher: teacherKey })).body;
  assert.equal(board.groups.find((g) => g.name === 'Tigers').skipped, 1);
  state = (await call('GET', `/api/classes/${code}/group`, { group: t })).body;
  assert.equal(state.problem.text, '5x = 35');
  assert.equal(state.lastResult.result, 'skipped');

  // Finishing an activity unlocks the next.
  await call('POST', `/api/classes/${code}/group/answer`, { group: t, body: { activityIndex: 0, problemIndex: 2, answer: '7' } });
  res = await call('POST', `/api/classes/${code}/group/answer`, {
    group: t,
    body: { activityIndex: 0, problemIndex: 3, answer: '18' },
  });
  assert.equal(res.body.state.activityIndex, 1);
  assert.equal(res.body.state.lastResult.step, 'activity-done');
  assert.deepEqual(res.body.state.activities.map((a) => a.status), ['done', 'current', 'locked']);

  // Teacher opens the exit ticket for everyone.
  board = (await call('POST', `/api/classes/${code}/exit-ticket`, { teacher: teacherKey })).body;
  assert.equal(board.exitOpen, true);
  state = (await call('GET', `/api/classes/${code}/group`, { group: owls })).body;
  assert.equal(state.stage, 'exit');
  assert.equal(state.exitTicket.problems.length, 3);
  assert.equal(JSON.stringify(state).includes('"answers"'), false);

  // Students take turns on the group computer.
  res = await call('POST', `/api/classes/${code}/group/exit`, {
    group: owls,
    body: { name: 'Maria', answers: ['4', 'x = -4', '6'] },
  });
  assert.equal(res.status, 200);
  await call('POST', `/api/classes/${code}/group/exit`, { group: owls, body: { name: 'Dev', answers: ['4', '-4', '5'] } });
  // Maria resubmits: replaces her first ticket.
  await call('POST', `/api/classes/${code}/group/exit`, { group: owls, body: { name: 'maria', answers: ['4', '-4', '5'] } });
  assert.equal((await call('POST', `/api/classes/${code}/group/exit`, { group: owls, body: { name: '', answers: [] } })).status, 400);
  state = (await call('POST', `/api/classes/${code}/group/exit-done`, { group: owls })).body;
  assert.equal(state.stage, 'done');

  board = (await call('GET', `/api/classes/${code}/board`, { teacher: teacherKey })).body;
  assert.deepEqual(
    board.exitResults.map((r) => [r.name, r.score]),
    [
      ['Dev', 3],
      ['maria', 3],
    ],
  );
  assert.equal(board.groups.find((g) => g.name === 'Owls').exitTickets, 2);

  const csv = await call('GET', `/api/classes/${code}/results.csv`, { teacher: teacherKey });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.equal(csv.body.split('\r\n')[0], 'Name,Group,Score,Out of,Q1 answer,Q1 right?,Q2 answer,Q2 right?,Q3 answer,Q3 right?');
  assert.equal(csv.body.split('\r\n')[1], 'Dev,Owls,3,3,4,yes,-4,yes,5,yes');

  // PIN sign-in for the teacher's phone.
  assert.equal((await call('POST', '/api/teacher/login', { body: { code, pin: '000000' === pin ? '111111' : '000000' } })).status, 403);
  const login = await call('POST', '/api/teacher/login', { body: { code, pin } });
  assert.equal(login.body.teacherKey, teacherKey);

  // Clearing the class deletes everything.
  assert.equal((await call('DELETE', `/api/classes/${code}`, { teacher: teacherKey })).status, 200);
  assert.equal((await call('GET', `/api/classes/${code}/group`, { group: t })).status, 404);
  assert.equal(app.classes.has(code), false);
});

test('Fun Mode rewrites keep the teacher’s numbers, or fall back to the original', async () => {
  const { code } = await newClass();
  const t = (await call('POST', `/api/classes/${code}/join`, { body: { name: 'Hawks' } })).body.token;

  let res = await call('GET', `/api/classes/${code}/group/fun-text`, { group: t });
  assert.deepEqual([res.body.ok, res.body.reason], [false, 'no-interest']);

  let state = (await call('POST', `/api/classes/${code}/group/interest`, { group: t, body: { interest: 'Soccer', funMode: true } })).body;
  assert.equal(state.funMode.on, true);
  res = await call('GET', `/api/classes/${code}/group/fun-text`, { group: t });
  assert.equal(res.body.ok, true);
  assert.equal(res.body.text, 'Soccer edition: x + 7 = 15');

  // Asking again uses the saved rewrite.
  const before = rewrites.length;
  await call('GET', `/api/classes/${code}/group/fun-text`, { group: t });
  assert.equal(rewrites.length, before);

  // A right answer starts rewriting the next problem straight away.
  await call('POST', `/api/classes/${code}/group/answer`, { group: t, body: { activityIndex: 0, problemIndex: 0, answer: '8' } });
  assert.equal(rewrites.at(-1).problem, 'x - 4 = 9');

  // A rewrite that adds a number (here, an answer) is thrown away.
  await call('POST', `/api/classes/${code}/group/interest`, { group: t, body: { interest: 'cheat' } });
  res = await call('GET', `/api/classes/${code}/group/fun-text`, { group: t });
  assert.deepEqual([res.body.ok, res.body.reason], [false, 'numbers']);

  // Fun Mode never changes what counts as right.
  res = await call('POST', `/api/classes/${code}/group/answer`, { group: t, body: { activityIndex: 0, problemIndex: 1, answer: '42' } });
  assert.equal(res.body.result, 'wrong');

  // Interests are trimmed and can't carry markup.
  state = (await call('POST', `/api/classes/${code}/group/interest`, { group: t, body: { interest: '<b>K-pop</b> and also a very long list of other things' } })).body;
  assert.equal(state.funMode.interest, 'bK-pop/b and also a very long list of ot');
});

test('Fun Mode can be turned off for a class', async () => {
  const res = await call('POST', '/api/classes', {
    body: { worksheet: SAMPLE_WORKSHEET, exitTicket: SAMPLE_EXIT_TICKET, groupCount: 2, funModeAllowed: false },
  });
  const { code } = res.body;
  const join = (await call('POST', `/api/classes/${code}/join`, { body: { name: 'Bears' } })).body;
  assert.equal(join.state.funMode.available, false);
  const state = (await call('POST', `/api/classes/${code}/group/fun`, { group: join.token, body: { on: true } })).body;
  assert.equal(state.funMode.on, false);
});

test('too many wrong PINs locks sign-in for a while', async () => {
  const { code, pin } = await newClass();
  const wrongPin = pin === '123456' ? '654321' : '123456';
  for (let i = 0; i < 10; i++) await call('POST', '/api/teacher/login', { body: { code, pin: wrongPin } });
  assert.equal((await call('POST', '/api/teacher/login', { body: { code, pin } })).status, 429);
  clock += 11 * 60_000;
  assert.equal((await call('POST', '/api/teacher/login', { body: { code, pin } })).status, 200);
});

test('old classes are swept away', async () => {
  const { code } = await newClass();
  clock += 13 * 60 * 60_000;
  app.sweep();
  assert.equal(app.classes.has(code), false);
});
