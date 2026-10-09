import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { restoreApiPath } from '../src/configure.js';
import handler from '../api/index.js';
import { SAMPLE_WORKSHEET, SAMPLE_EXIT_TICKET } from '../public/lib/sample.js';

test('restoreApiPath undoes the vercel.json rewrite', () => {
  assert.equal(restoreApiPath('/api/index?__path=classes%2FABCDE%2Fboard'), '/api/classes/ABCDE/board');
  assert.equal(restoreApiPath('/api/index?__path=classes/ABCDE/board'), '/api/classes/ABCDE/board');
  assert.equal(restoreApiPath('/api/index?__path=health&x=1'), '/api/health?x=1');
  assert.equal(restoreApiPath('/api/classes/ABCDE/board'), '/api/classes/ABCDE/board');
});

// Mimics Vercel: the URL arrives rewritten and the body arrives already read
// and parsed as req.body, with nothing left on the stream.
let server;
let base;
before(async () => {
  server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    Object.defineProperty(req, 'body', { get: () => (raw ? JSON.parse(raw) : undefined) });
    const { pathname, search } = new URL(req.url, 'http://x');
    req.url = `/api/index?__path=${encodeURIComponent(pathname.replace(/^\/api\//, ''))}${search.replace('?', '&')}`;
    await handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

test('the Vercel function runs a class end to end', async () => {
  const post = (path, body, headers = {}) =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

  const created = await post('/api/classes', { worksheet: SAMPLE_WORKSHEET, exitTicket: SAMPLE_EXIT_TICKET, groupCount: 3 });
  assert.equal(created.status, 200);
  const { code, teacherKey } = created.body;

  const joined = await post(`/api/classes/${code}/join`, { name: 'Tigers' });
  assert.equal(joined.status, 200);
  const answer = await post(`/api/classes/${code}/group/answer`, { activityIndex: 0, problemIndex: 0, answer: '8' }, { 'x-group-token': joined.body.token });
  assert.equal(answer.body.result, 'correct');

  const board = await fetch(`${base}/api/classes/${code}/board`, { headers: { 'x-teacher-key': teacherKey } }).then((r) => r.json());
  assert.equal(board.groups[0].finished, 1);
});
