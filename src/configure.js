// Builds the app from environment settings. Shared by the local server
// (server.js) and the Vercel function (api/index.js).

import { createApp } from './app.js';
import { createClaudeRewriter, DEFAULT_MODEL } from './funmode.js';

/**
 * Fun Mode needs Claude. It's on when an API key is set; FUN_MODE=on turns it
 * on with other credentials (an `ant auth login` profile), FUN_MODE=off turns
 * it off.
 */
export function funModeSettings(env = process.env) {
  const setting = (env.FUN_MODE || '').toLowerCase();
  const on = setting === 'on' || (setting !== 'off' && Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN));
  return { on, model: env.FUN_MODE_MODEL || DEFAULT_MODEL };
}

export function createConfiguredApp(env = process.env) {
  const fun = funModeSettings(env);
  const app = createApp({ rewriter: fun.on ? createClaudeRewriter({ model: fun.model }) : null });
  return { app, fun };
}

/**
 * vercel.json rewrites /api/x/y to /api/index?__path=x/y. Put the original
 * path back so the app's router sees /api/x/y either way.
 */
export function restoreApiPath(rawUrl) {
  const url = new URL(rawUrl || '/', 'http://localhost');
  const moved = url.searchParams.get('__path');
  if (moved === null || !url.pathname.startsWith('/api')) return rawUrl;
  url.searchParams.delete('__path');
  const query = url.searchParams.toString();
  return `/api/${moved.replace(/^\/+/, '')}${query ? `?${query}` : ''}`;
}
