import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { createSupabaseAuth, supabaseSettings } from '../src/auth.js';
import { createContactBox } from '../src/contact.js';
import { restoreApiPath } from '../src/configure.js';
import { SAMPLE_WORKSHEET, SAMPLE_EXIT_TICKET } from '../public/lib/sample.js';
import { startMockSupabase } from './helpers/mock-supabase.js';

const quietLog = { warn() {}, error() {} };

async function serve(app) {
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, resolve));
  return { base: `http://localhost:${server.address().port}`, close: () => server.close() };
}

/** fetch with a cookie jar, the way a browser keeps the login cookie. */
function browser(base) {
  const jar = new Map();
  return {
    jar,
    async go(method, path, body) {
      const headers = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
      const setCookies = res.headers.getSetCookie();
      for (const line of setCookies) {
        const [pair, ...attrs] = line.split(';');
        const eq = pair.indexOf('=');
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1);
        const expired = attrs.some((a) => /max-age=0\b/i.test(a.trim()) || /expires=thu, 01 jan 1970/i.test(a.trim()));
        if (expired || value === '') jar.delete(name);
        else jar.set(name, value);
      }
      const type = res.headers.get('content-type') || '';
      const data = type.includes('json') ? await res.json() : await res.text();
      return { status: res.status, body: data, location: res.headers.get('location'), setCookies };
    },
  };
}

describe('who can reach which page (stand-in login)', () => {
  // A stand-in for teacher accounts: the cookie "tt=1" means logged in.
  const fakeAuth = {
    configured: true,
    async currentUser(req) {
      return /(?:^|;\s*)tt=1/.test(req.headers.cookie || '') ? { id: 't1', email: 't@example.com', name: 'T' } : null;
    },
  };
  let site;
  before(async () => (site = await serve(createApp({ auth: fakeAuth, log: quietLog }))));
  after(() => site.close());

  test('public pages open for anyone', async () => {
    for (const page of ['/', '/join', '/signup', '/login', '/display']) {
      const res = await fetch(site.base + page, { redirect: 'manual' });
      assert.equal(res.status, 200, page);
      assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    }
    const landing = await (await fetch(site.base + '/')).text();
    assert.match(landing, /See every group at once\./);
    const join = await (await fetch(site.base + '/join')).text();
    assert.match(join, /Join your class/);
  });

  test('the app pages send anyone not logged in to the log-in page', async () => {
    for (const page of ['/app', '/board']) {
      const res = await fetch(site.base + page, { redirect: 'manual' });
      assert.equal(res.status, 302, page);
      assert.equal(res.headers.get('location'), `/login?next=${encodeURIComponent(page)}`);
    }
    // The old setup address moved.
    const moved = await fetch(site.base + '/teacher', { redirect: 'manual' });
    assert.equal(moved.status, 301);
    assert.equal(moved.headers.get('location'), '/app');
    // The teacher pages are not reachable as plain files either.
    for (const file of ['/app.html', '/board.html', '/teacher.html', '/pages/app.html', '/../pages/app.html']) {
      assert.equal((await fetch(site.base + file, { redirect: 'manual' })).status, 404, file);
    }
  });

  test('a logged-in teacher gets the app pages, with a Log out button', async () => {
    for (const page of ['/app', '/board']) {
      const res = await fetch(site.base + page, { headers: { cookie: 'tt=1' } });
      assert.equal(res.status, 200, page);
      assert.match(res.headers.get('cache-control'), /no-store/);
      assert.match(await res.text(), /action="\/auth\/logout"/);
    }
  });

  test('starting a class needs a logged-in teacher; students need nothing', async () => {
    const create = (cookie) =>
      fetch(site.base + '/api/classes', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cookie && { cookie }) },
        body: JSON.stringify({ worksheet: SAMPLE_WORKSHEET, exitTicket: SAMPLE_EXIT_TICKET, groupCount: 2 }),
      });
    assert.equal((await create()).status, 401);
    const ok = await create('tt=1');
    assert.equal(ok.status, 200);
    const { code } = await ok.json();
    // Students join without any account.
    const join = await fetch(`${site.base}/api/classes/${code}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Owls' }),
    });
    assert.equal(join.status, 200);
    // The phone PIN sign-in for a board needs the account too.
    const pin = await fetch(`${site.base}/api/teacher/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, pin: '000000' }),
    });
    assert.equal(pin.status, 401);
  });
});

describe('teacher accounts through Supabase (real Supabase client, stand-in server)', () => {
  let mock;
  let site;
  before(async () => {
    mock = await startMockSupabase({ accessTtlSeconds: 3600 });
    const settings = { url: mock.url, key: mock.key };
    site = await serve(createApp({ auth: createSupabaseAuth(settings), contact: createContactBox(settings), log: quietLog }));
  });
  after(async () => {
    site.close();
    await mock.close();
  });

  test('sign up goes straight to the app, and only name, email and password are sent', async () => {
    const b = browser(site.base);
    const res = await b.go('POST', '/auth/signup', { name: 'Ms. Rivera', email: 'Rivera@Example.com ', password: 'correct-horse' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { redirect: '/app' });
    // The login cookie is httpOnly, Lax, and never holds the password.
    assert.ok(res.setCookies.length > 0);
    for (const c of res.setCookies) {
      assert.match(c, /HttpOnly/i);
      assert.match(c, /SameSite=Lax/i);
      assert.equal(c.includes('correct-horse'), false);
    }
    assert.equal((await b.go('GET', '/app')).status, 200);
    const [user] = mock.users;
    assert.equal(user.email, 'rivera@example.com');
    assert.deepEqual(user.user_metadata, { full_name: 'Ms. Rivera' });
  });

  test('log out returns to the landing page and locks the app again', async () => {
    const b = browser(site.base);
    await b.go('POST', '/auth/signup', { name: 'Mr. A', email: 'a@example.com', password: 'longenough' });
    assert.equal((await b.go('GET', '/board')).status, 200);
    const out = await b.go('POST', '/auth/logout');
    assert.equal(out.status, 303);
    assert.equal(out.location, '/');
    assert.equal(b.jar.size, 0, 'the login cookies are cleared');
    const after = await b.go('GET', '/app');
    assert.equal(after.status, 302);
    assert.equal(after.location, '/login?next=%2Fapp');
  });

  test('log in, wrong password, and where it sends you', async () => {
    const b = browser(site.base);
    await b.go('POST', '/auth/signup', { name: 'Coach', email: 'coach@example.com', password: 'longenough' });
    await b.go('POST', '/auth/logout');

    const wrong = await b.go('POST', '/auth/login', { email: 'coach@example.com', password: 'nope-nope' });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error, 'Wrong email or password.');

    const right = await b.go('POST', '/auth/login', { email: 'COACH@example.com', password: 'longenough', next: '/board' });
    assert.deepEqual(right.body, { redirect: '/board' });
    assert.equal((await b.go('GET', '/app')).status, 200);

    // "next" can only point at the app's own pages.
    const evil = await browser(site.base).go('POST', '/auth/login', { email: 'coach@example.com', password: 'longenough', next: 'https://evil.example' });
    assert.deepEqual(evil.body, { redirect: '/app' });
  });

  test('sign-up checks', async () => {
    const b = browser(site.base);
    assert.equal((await b.go('POST', '/auth/signup', { name: '', email: 'x@example.com', password: 'longenough' })).body.error, 'Type your name.');
    assert.equal((await b.go('POST', '/auth/signup', { name: 'X', email: 'not-an-email', password: 'longenough' })).body.error, 'Type a valid email address.');
    assert.equal((await b.go('POST', '/auth/signup', { name: 'X', email: 'x@example.com', password: 'short' })).body.error, 'Use a password with at least 8 characters.');
    await b.go('POST', '/auth/signup', { name: 'X', email: 'dup@example.com', password: 'longenough' });
    const dup = await browser(site.base).go('POST', '/auth/signup', { name: 'Y', email: 'dup@example.com', password: 'longenough' });
    assert.equal(dup.status, 400);
    assert.match(dup.body.error, /already an account/);
  });

  test('a logged-in teacher can start a class', async () => {
    const b = browser(site.base);
    await b.go('POST', '/auth/signup', { name: 'Teach', email: 'teach@example.com', password: 'longenough' });
    const res = await b.go('POST', '/api/classes', { worksheet: SAMPLE_WORKSHEET, exitTicket: SAMPLE_EXIT_TICKET, groupCount: 3 });
    assert.equal(res.status, 200);
    assert.match(res.body.code, /^[A-Z0-9]{5}$/);
  });

  test('a forged cookie gets nothing', async () => {
    const b = browser(site.base);
    await b.go('POST', '/auth/signup', { name: 'Real', email: 'real@example.com', password: 'longenough' });
    const [name] = [...b.jar.keys()];
    const forged = await fetch(site.base + '/app', { headers: { cookie: `${name}=base64-${Buffer.from(JSON.stringify({ access_token: 'x.y.z', refresh_token: 'nope', expires_at: 9999999999 })).toString('base64url')}` }, redirect: 'manual' });
    assert.equal(forged.status, 302);
  });

  test('the contact form saves messages, drops bots, and checks input', async () => {
    const b = browser(site.base);
    assert.deepEqual((await b.go('POST', '/api/contact', { name: 'Ana', email: 'ana@school.org', message: 'Can my department try it?' })).body, { ok: true });
    assert.deepEqual(mock.messages.at(-1), { name: 'Ana', email: 'ana@school.org', message: 'Can my department try it?' });
    const count = mock.messages.length;
    assert.equal((await b.go('POST', '/api/contact', { name: 'Bot', email: 'b@b.co', message: 'spam', website: 'http://spam' })).status, 200);
    assert.equal(mock.messages.length, count, 'the honeypot drops bots quietly');
    assert.equal((await b.go('POST', '/api/contact', { name: 'Ana', email: 'nope', message: 'hi' })).status, 400);
  });
});

describe('when Supabase asks for email confirmation first', () => {
  let mock;
  let site;
  before(async () => {
    mock = await startMockSupabase({ confirmEmail: true });
    site = await serve(createApp({ auth: createSupabaseAuth({ url: mock.url, key: mock.key }), log: quietLog }));
  });
  after(async () => {
    site.close();
    await mock.close();
  });

  test('sign-up says to check email, and log-in waits for the confirmation', async () => {
    const b = browser(site.base);
    const res = await b.go('POST', '/auth/signup', { name: 'New', email: 'new@example.com', password: 'longenough' });
    assert.equal(res.status, 200);
    assert.match(res.body.message, /we sent you an email/);
    assert.equal((await b.go('GET', '/app')).status, 302);
    const early = await b.go('POST', '/auth/login', { email: 'new@example.com', password: 'longenough' });
    assert.match(early.body.error, /Confirm your email first/);
    mock.confirmAll();
    assert.deepEqual((await b.go('POST', '/auth/login', { email: 'new@example.com', password: 'longenough' })).body, { redirect: '/app' });
  });

  test('a confirmation link that can’t log in sends you to log in', async () => {
    const res = await browser(site.base).go('GET', '/auth/callback?code=not-a-real-code');
    assert.equal(res.status, 302);
    assert.equal(res.location, '/login?confirmed=1');
  });
});

describe('an expired login refreshes itself', () => {
  test('a short-lived token is renewed with the refresh token, and the cookie updated', async () => {
    // Tokens that expire in 5 seconds are "about to expire", so the client refreshes them.
    const mock = await startMockSupabase({ accessTtlSeconds: 5 });
    const site = await serve(createApp({ auth: createSupabaseAuth({ url: mock.url, key: mock.key }), log: quietLog }));
    try {
      const b = browser(site.base);
      await b.go('POST', '/auth/signup', { name: 'R', email: 'r@example.com', password: 'longenough' });
      const before = [...b.jar.values()].join();
      const res = await b.go('GET', '/app');
      assert.equal(res.status, 200);
      assert.ok(mock.calls.includes('POST /auth/v1/token?refresh_token'), 'refreshed at Supabase');
      assert.notEqual([...b.jar.values()].join(), before, 'new login cookie saved');
    } finally {
      site.close();
      await mock.close();
    }
  });
});

test('Supabase settings come from either naming scheme', () => {
  assert.equal(supabaseSettings({}), null);
  assert.equal(supabaseSettings({ SUPABASE_URL: 'https://x.supabase.co' }), null);
  assert.deepEqual(supabaseSettings({ SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_ANON_KEY: ' "k" ' }), { url: 'https://x.supabase.co', key: 'k' });
  assert.deepEqual(supabaseSettings({ NEXT_PUBLIC_SUPABASE_URL: 'https://y.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_1' }), {
    url: 'https://y.supabase.co',
    key: 'sb_publishable_1',
  });
});

test('Vercel rewrites for pages map back to the real path', () => {
  assert.equal(restoreApiPath('/api/index?__page=app'), '/app');
  assert.equal(restoreApiPath('/api/index?__page=auth%2Fcallback&code=abc'), '/auth/callback?code=abc');
  assert.equal(restoreApiPath('/api/index?__page=auth/login'), '/auth/login');
  assert.equal(restoreApiPath('/api/index?__path=health'), '/api/health');
});
