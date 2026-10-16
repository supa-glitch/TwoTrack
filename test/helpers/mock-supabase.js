// A stand-in for a Supabase project, for tests and local runs only. It speaks
// the parts of Supabase's Auth and REST APIs that TwoTrack uses, so the real
// @supabase/ssr and @supabase/supabase-js code runs against it unchanged.
//
//   node test/helpers/mock-supabase.js 54321     # run it on its own

import http from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

/**
 * @param {{ confirmEmail?: boolean, accessTtlSeconds?: number, port?: number }} options
 */
export async function startMockSupabase({ confirmEmail = false, accessTtlSeconds = 3600, port = 0 } = {}) {
  const secret = randomUUID();
  const users = []; // { id, email, password, user_metadata, confirmed }
  const refreshTokens = new Map(); // token -> user id
  const messages = []; // contact_messages rows
  const calls = []; // "METHOD /path?grant_type" for assertions

  function sign(payload) {
    const head = b64({ alg: 'HS256', typ: 'JWT' });
    const body = b64(payload);
    const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
    return `${head}.${body}.${sig}`;
  }

  function verify(token) {
    const [head, body, sig] = String(token).split('.');
    if (!sig) return null;
    const good = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
    if (good !== sig) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp * 1000 > Date.now() ? payload : null;
  }

  const publicUser = (u) => ({
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email,
    email_confirmed_at: u.confirmed ? new Date().toISOString() : null,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: u.user_metadata,
    identities: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  function session(u) {
    const now = Math.floor(Date.now() / 1000);
    const refresh = randomUUID();
    refreshTokens.set(refresh, u.id);
    return {
      access_token: sign({
        sub: u.id,
        email: u.email,
        role: 'authenticated',
        aud: 'authenticated',
        iat: now,
        exp: now + accessTtlSeconds,
        user_metadata: u.user_metadata,
        session_id: randomUUID(),
      }),
      token_type: 'bearer',
      expires_in: accessTtlSeconds,
      expires_at: now + accessTtlSeconds,
      refresh_token: refresh,
      user: publicUser(u),
    };
  }

  const error = (status, code, msg) => ({ status, body: { code, error_code: code, msg } });

  async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString();
    return text ? JSON.parse(text) : {};
  }

  async function route(req) {
    const url = new URL(req.url, 'http://localhost');
    const grant = url.searchParams.get('grant_type');
    calls.push(`${req.method} ${url.pathname}${grant ? `?${grant}` : ''}`);
    const body = req.method === 'POST' ? await readBody(req) : {};

    if (req.method === 'POST' && url.pathname === '/auth/v1/signup') {
      if (users.some((u) => u.email === body.email)) return error(422, 'user_already_exists', 'User already registered');
      if (String(body.password).length < 6) return error(422, 'weak_password', 'Password should be at least 6 characters.');
      const u = { id: randomUUID(), email: body.email, password: body.password, user_metadata: body.data || {}, confirmed: !confirmEmail };
      users.push(u);
      return { status: 200, body: confirmEmail ? publicUser(u) : session(u) };
    }
    if (req.method === 'POST' && url.pathname === '/auth/v1/token' && grant === 'password') {
      const u = users.find((x) => x.email === body.email && x.password === body.password);
      if (!u) return error(400, 'invalid_credentials', 'Invalid login credentials');
      if (!u.confirmed) return error(400, 'email_not_confirmed', 'Email not confirmed');
      return { status: 200, body: session(u) };
    }
    if (req.method === 'POST' && url.pathname === '/auth/v1/token' && grant === 'refresh_token') {
      const id = refreshTokens.get(body.refresh_token);
      refreshTokens.delete(body.refresh_token);
      const u = users.find((x) => x.id === id);
      if (!u) return error(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
      return { status: 200, body: session(u) };
    }
    if (req.method === 'GET' && url.pathname === '/auth/v1/user') {
      const claims = verify(String(req.headers.authorization || '').replace(/^Bearer /, ''));
      const u = claims && users.find((x) => x.id === claims.sub);
      if (!u) return error(401, 'bad_jwt', 'invalid JWT');
      return { status: 200, body: publicUser(u) };
    }
    if (req.method === 'POST' && url.pathname === '/auth/v1/logout') {
      return { status: 204, body: null };
    }
    if (req.method === 'POST' && url.pathname === '/rest/v1/contact_messages') {
      const rows = Array.isArray(body) ? body : [body];
      messages.push(...rows);
      return { status: 201, body: null };
    }
    return error(404, 'not_found', `No mock for ${req.method} ${url.pathname}`);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const { status, body } = await route(req);
      res.writeHead(status, { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' });
      res.end(body === null ? '' : JSON.stringify(body));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ msg: err.message }));
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    key: 'mock-anon-key',
    users,
    messages,
    calls,
    confirmAll: () => users.forEach((u) => (u.confirmed = true)),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mock = await startMockSupabase({ port: Number(process.argv[2]) || 54321 });
  console.log(`Mock Supabase running at ${mock.url} (anon key: ${mock.key})`);
}
