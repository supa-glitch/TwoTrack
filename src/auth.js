// Teacher accounts, through Supabase Auth.
//
// Supabase stores the accounts and hashes the passwords; this app never sees
// a password after passing it on. The session lives in cookies that page
// scripts can't read (httpOnly), set and refreshed by Supabase's own server
// library (@supabase/ssr). Students never get accounts.

import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';

const clean = (value) =>
  String(value ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim() || null;

/**
 * Supabase project settings from the environment. Accepts the names Supabase
 * and Vercel's Supabase integration use. Returns null if either is missing.
 */
export function supabaseSettings(env = process.env) {
  const url = clean(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL);
  const key = clean(
    env.SUPABASE_PUBLISHABLE_KEY ||
      env.SUPABASE_ANON_KEY ||
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  return url && key ? { url: url.replace(/\/+$/, ''), key } : null;
}

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MESSAGES = {
  invalid_credentials: 'Wrong email or password.',
  email_not_confirmed: 'Confirm your email first: open the link we sent you, then log in.',
  user_already_exists: 'There’s already an account with that email. Log in instead.',
  email_exists: 'There’s already an account with that email. Log in instead.',
  over_request_rate_limit: 'Too many tries. Wait a minute and try again.',
  over_email_send_rate_limit: 'Too many emails sent. Wait a few minutes and try again.',
};

function friendly(error) {
  return new AuthError(error.status && error.status < 500 ? 400 : 503, MESSAGES[error.code] || error.message);
}

const isHttps = (req) =>
  req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket?.encrypted) || process.env.VERCEL === '1';

/** The site's own address, for the link in Supabase's confirmation email. */
export function siteOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${isHttps(req) ? 'https' : 'http'}://${host}`;
}

/**
 * @param {{ url: string, key: string }} settings
 */
export function createSupabaseAuth(settings) {
  // One Supabase client per request, as @supabase/ssr requires.
  function clientFor(req, res) {
    const secure = isHttps(req);
    return createServerClient(settings.url, settings.key, {
      cookies: {
        getAll() {
          return parseCookieHeader(req.headers.cookie ?? '').map(({ name, value }) => ({ name, value: value ?? '' }));
        },
        setAll(cookies, headers = {}) {
          if (res.headersSent) return;
          const previous = res.getHeader('Set-Cookie') ?? [];
          const list = Array.isArray(previous) ? previous : [String(previous)];
          for (const { name, value, options } of cookies) {
            list.push(serializeCookieHeader(name, value, { ...options, path: '/', sameSite: 'lax', httpOnly: true, secure }));
          }
          res.setHeader('Set-Cookie', list);
          for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
        },
      },
    });
  }

  return {
    configured: true,

    /** The logged-in teacher, or null. Refreshes an expired session if it can. */
    async currentUser(req, res) {
      const { data, error } = await clientFor(req, res).auth.getClaims();
      if (error || !data?.claims?.sub) return null;
      const { sub, email, user_metadata: meta = {} } = data.claims;
      return { id: sub, email, name: meta.full_name || meta.name || '' };
    },

    /**
     * @returns {Promise<{ loggedIn: boolean }>} loggedIn is false when Supabase
     *   wants the email confirmed first.
     */
    async signUp(req, res, { name, email, password }) {
      const { data, error } = await clientFor(req, res).auth.signUp({
        email,
        password,
        options: { data: { full_name: name }, emailRedirectTo: `${siteOrigin(req)}/auth/callback` },
      });
      if (error) throw friendly(error);
      return { loggedIn: Boolean(data.session) };
    },

    async logIn(req, res, { email, password }) {
      const { error } = await clientFor(req, res).auth.signInWithPassword({ email, password });
      if (error) throw friendly(error);
    },

    async logOut(req, res) {
      // Ends the session at Supabase too; the cookies are cleared either way.
      await clientFor(req, res).auth.signOut();
    },

    /** The link in the confirmation email. True if it logged the teacher in. */
    async confirm(req, res, { code, tokenHash, type }) {
      const auth = clientFor(req, res).auth;
      if (code) return !(await auth.exchangeCodeForSession(code)).error;
      if (tokenHash) return !(await auth.verifyOtp({ token_hash: tokenHash, type: type || 'email' })).error;
      return false;
    },
  };
}

/** Used when Supabase isn't set up: nobody can log in, and the app says why. */
export const authNotSetUp = {
  configured: false,
  async currentUser() {
    return null;
  },
  async signUp() {
    throw new AuthError(503, 'Teacher accounts aren’t set up on this server yet. (The site owner needs to connect Supabase.)');
  },
  async logIn() {
    throw new AuthError(503, 'Teacher accounts aren’t set up on this server yet. (The site owner needs to connect Supabase.)');
  },
  async logOut() {},
  async confirm() {
    return false;
  },
};
