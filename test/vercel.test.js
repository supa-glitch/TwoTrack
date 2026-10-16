import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { restoreApiPath } from '../src/configure.js';
import { SAMPLE_WORKSHEET, SAMPLE_EXIT_TICKET } from '../public/lib/sample.js';
import { startMockSupabase } from './helpers/mock-supabase.js';

test('restoreApiPath undoes the vercel.json rewrite', () => {
  assert.equal(restoreApiPath('/api/index?__path=classes%2FABCDE%2Fboard'), '/api/classes/ABCDE/board');
  assert.equal(restoreApiPath('/api/index?__path=classes/ABCDE/board'), '/api/classes/ABCDE/board');
  assert.equal(restoreApiPath('/api/index?__path=health&x=1'), '/api/health?x=1');
  assert.equal(restoreApiPath('/api/classes/ABCDE/board'), '/api/classes/ABCDE/board');
});

// Mimics Vercel: the URL arrives rewritten the way vercel.json says, and the
// body arrives already read and parsed as req.body, with nothing left on the
// stream. Supabase is the stand-in, set through the same environment
// variables Vercel would provide.
let server;
let base;
let mock;
before(async () => {
  mock = await startMockSupabase();
  process.env.SUPABASE_URL = mock.url;
  process.env.SUPABASE_ANON_KEY = mock.key;
  const { default: handler } = await import('../api/index.js');
  server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    Object.defineProperty(req, 'body', { get: () => (raw ? JSON.parse(raw) : undefined) });
    const { pathname, search } = new URL(req.url, 'http://x');
    const extra = search.replace('?', '&');
    if (pathname.startsWith('/api/')) req.url = `/api/index?__path=${encodeURIComponent(pathname.slice(5))}${extra}`;
    else req.url = `/api/index?__page=${encodeURIComponent(pathname.slice(1))}${extra}`;
    await handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});
after(async () => {
  server.close();
  await mock.close();
});

test('the Vercel function: sign up, open the app, run a class', async () => {
  let cookie = '';
  const go = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: { 'content-type': 'application/json', cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie().map((c) => c.split(';')[0]);
    if (set.length) cookie = set.join('; ');
    const type = res.headers.get('content-type') || '';
    return { status: res.status, location: res.headers.get('location'), body: type.includes('json') ? await res.json() : await res.text() };
  };

  assert.equal((await go('GET', '/app')).status, 302);
  assert.deepEqual((await go('POST', '/auth/signup', { name: 'Mr. A', email: 'a@example.com', password: 'longenough' })).body, { redirect: '/app' });
  const page = await go('GET', '/app');
  assert.equal(page.status, 200);
  assert.match(page.body, /Set up today’s lesson/);

  const created = await go('POST', '/api/classes', { worksheet: SAMPLE_WORKSHEET, exitTicket: SAMPLE_EXIT_TICKET, groupCount: 3 });
  assert.equal(created.status, 200);
  const { code, teacherKey } = created.body;

  const joined = await go('POST', `/api/classes/${code}/join`, { name: 'Tigers' }, { cookie: '' });
  assert.equal(joined.status, 200);
  const answer = await go('POST', `/api/classes/${code}/group/answer`, { activityIndex: 0, problemIndex: 0, answer: '8' }, { cookie: '', 'x-group-token': joined.body.token });
  assert.equal(answer.body.result, 'correct');

  const board = await go('GET', `/api/classes/${code}/board`, undefined, { 'x-teacher-key': teacherKey });
  assert.equal(board.body.groups[0].finished, 1);

  const out = await go('POST', '/auth/logout');
  assert.equal(out.status, 303);
  assert.equal(out.location, '/');
});
