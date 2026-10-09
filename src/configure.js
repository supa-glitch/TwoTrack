// Builds the app from environment settings. Shared by the local server
// (server.js) and the Vercel function (api/index.js).

import { getVercelOidcToken } from '@vercel/oidc';
import { createApp } from './app.js';
import { createClaudeRewriter, createGatewayRewriter, DEFAULT_MODEL } from './funmode.js';

/**
 * Fun Mode needs Claude. In order:
 * - FUN_MODE=off turns it off.
 * - ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN, or FUN_MODE=on with an
 *   `ant auth login` profile) calls Claude directly.
 * - AI_GATEWAY_API_KEY, or running on Vercel, calls Claude through Vercel's
 *   AI Gateway. On Vercel this needs no key: it uses the deployment's OIDC token.
 *
 * An Anthropic key (sk-ant-...) saved as AI_GATEWAY_API_KEY by mistake is
 * still used as an Anthropic key, since the gateway would reject it.
 */
// Keys pasted into a dashboard often pick up spaces or quotes.
const cleanKey = (value) =>
  String(value ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim() || undefined;

export function funModeSettings(env = process.env) {
  const setting = (env.FUN_MODE || '').toLowerCase();
  if (setting === 'off') return { on: false, provider: null, model: null };
  const gatewayKey = cleanKey(env.AI_GATEWAY_API_KEY);
  const misplacedKey = gatewayKey?.startsWith('sk-ant-') ? gatewayKey : undefined;
  const apiKey = cleanKey(env.ANTHROPIC_API_KEY) || misplacedKey;
  if (setting === 'on' || apiKey || env.ANTHROPIC_AUTH_TOKEN) {
    return { on: true, provider: 'anthropic', model: env.FUN_MODE_MODEL || DEFAULT_MODEL, apiKey };
  }
  if (gatewayKey || env.VERCEL === '1') {
    return { on: true, provider: 'gateway', model: env.FUN_MODE_MODEL || null };
  }
  return { on: false, provider: null, model: null };
}

const PROVIDER_LABELS = { anthropic: 'Anthropic API', gateway: 'Vercel AI Gateway' };

async function gatewayToken(env) {
  const key = cleanKey(env.AI_GATEWAY_API_KEY);
  if (key) return key;
  try {
    return await getVercelOidcToken();
  } catch {
    return undefined;
  }
}

export function createConfiguredApp(env = process.env) {
  const fun = funModeSettings(env);
  let rewriter = null;
  if (fun.provider === 'anthropic') rewriter = createClaudeRewriter({ model: fun.model, apiKey: fun.apiKey });
  if (fun.provider === 'gateway') rewriter = createGatewayRewriter({ getToken: () => gatewayToken(env), model: fun.model || undefined });
  return { app: createApp({ rewriter, funModeLabel: PROVIDER_LABELS[fun.provider] || null }), fun };
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
