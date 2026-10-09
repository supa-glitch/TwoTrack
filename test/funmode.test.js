import { test } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { cleanInterest, createClaudeRewriter, createGatewayRewriter, numbersIn, rewriteProblem, sameNumbers } from '../src/funmode.js';
import { funModeSettings } from '../src/configure.js';

const quietLog = { warn() {} };

test('numbersIn reads the numbers a rewrite has to keep', () => {
  assert.deepEqual([...numbersIn('A gym charges $25 to sign up and $15 a month, $100 in all.')], ['25', '15', '100']);
  assert.deepEqual([...numbersIn('3.50 and 3.5 and 1,000 and 2x^2')], ['3.5', '1000', '2']);
  assert.deepEqual([...numbersIn('x/2 + 6 = 10')], ['2', '6', '10']);
});

test('sameNumbers catches dropped, added and changed numbers', () => {
  const original = 'Solve 2x + 3 = 11';
  assert.equal(sameNumbers(original, 'Your team scores 2x + 3 = 11 points. Find x.').ok, true);
  assert.deepEqual(sameNumbers(original, 'Your team scores 2x + 3 points, 11 in all, in 4 quarters.').added, ['4']);
  assert.deepEqual(sameNumbers(original, 'Your team scores two x plus 3 to get 11.').missing, ['2']);
  assert.deepEqual(sameNumbers(original, 'Solve 2x + 3 = 12').missing, ['11']);
  // The answer showing up in the story counts as an added number.
  assert.equal(sameNumbers(original, '2x + 3 = 11, so x is 4.').ok, false);
});

test('rewriteProblem retries once, then falls back to the original', async () => {
  const bad = ['Score 4 goals: 2x + 3 = 11', 'Score 5 goals: 2x + 3 = 11'];
  let calls = 0;
  const result = await rewriteProblem(async () => bad[calls++], '2x + 3 = 11', 'soccer', quietLog);
  assert.deepEqual(result, { ok: false, reason: 'numbers' });
  assert.equal(calls, 2);

  calls = 0;
  const outputs = ['Score 4 goals: 2x + 3 = 11', 'Soccer time: 2x + 3 = 11'];
  const ok = await rewriteProblem(async () => outputs[calls++], '2x + 3 = 11', 'soccer', quietLog);
  assert.deepEqual(ok, { ok: true, text: 'Soccer time: 2x + 3 = 11' });

  const broken = await rewriteProblem(
    async () => {
      throw new Error('network down');
    },
    '2x + 3 = 11',
    'soccer',
    quietLog,
  );
  assert.deepEqual(broken, { ok: false, reason: 'unavailable' });
});

test('cleanInterest trims and strips markup', () => {
  assert.equal(cleanInterest('  <script>Basketball</script>  '), 'scriptBasketball/script');
  assert.equal(cleanInterest('x'.repeat(100)).length, 40);
});

function fakeClient(reply) {
  const requests = [];
  const client = new Anthropic({
    apiKey: 'test-key',
    baseURL: 'http://claude.test',
    maxRetries: 0,
    fetch: async (url, init) => {
      requests.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  return { client, requests };
}

const message = (content, stop_reason = 'end_turn') => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content,
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
});

test('the Claude request: model, fallbacks, low effort, theme passed as data', async () => {
  const { client, requests } = fakeClient(
    message([
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: 'Your soccer team: 2x + 3 = 11. Find x.' },
    ]),
  );
  const rewrite = createClaudeRewriter({ client });
  const text = await rewrite({ problem: '2x + 3 = 11', interest: 'soccer' });
  assert.equal(text, 'Your soccer team: 2x + 3 = 11. Find x.');

  const [req] = requests;
  assert.match(req.url, /\/v1\/messages/);
  assert.match(req.headers.get('anthropic-beta'), /server-side-fallback-2026-07-01/);
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.fallbacks, 'default');
  assert.deepEqual(req.body.output_config, { effort: 'low' });
  assert.equal(req.body.thinking, undefined);
  assert.match(req.body.system, /Do not solve the problem/);
  assert.equal(req.body.messages[0].content, '<problem>\n2x + 3 = 11\n</problem>\n<theme>soccer</theme>');
  assert.equal(JSON.stringify(req.body).includes('answer key'), true, 'the prompt says the teacher has the key');
});

test('a refusal becomes an error, which shows the original problem', async () => {
  const { client } = fakeClient(message([], 'refusal'));
  const rewrite = createClaudeRewriter({ client });
  const result = await rewriteProblem(rewrite, '2x + 3 = 11', 'soccer', quietLog);
  assert.deepEqual(result, { ok: false, reason: 'unavailable' });
});

function gatewayClient(handle) {
  const requests = [];
  const createClient = (apiKey) =>
    new Anthropic({
      apiKey,
      baseURL: 'http://gateway.test',
      maxRetries: 0,
      fetch: async (url, init) => {
        const req = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) };
        requests.push(req);
        const { status, body } = handle(req);
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      },
    });
  return { createClient, requests };
}

const notFound = { status: 404, body: { type: 'error', error: { type: 'not_found_error', message: 'Model not found' } } };

test('the AI Gateway rewriter finds a model the gateway accepts and keeps using it', async () => {
  const { createClient, requests } = gatewayClient((req) =>
    req.body.model === 'anthropic/claude-opus-5-5'
      ? { status: 200, body: message([{ type: 'text', text: 'Hoops: 2x + 3 = 11' }]) }
      : notFound,
  );
  let tokens = 0;
  const rewrite = createGatewayRewriter({ getToken: async () => `oidc-${++tokens}`, createClient });

  assert.equal(await rewrite({ problem: '2x + 3 = 11', interest: 'basketball' }), 'Hoops: 2x + 3 = 11');
  assert.deepEqual(
    requests.map((r) => r.body.model),
    ['anthropic/claude-opus-5.5', 'anthropic/claude-opus-5-5'],
  );
  const accepted = requests[1];
  assert.match(accepted.url, /\/v1\/messages/);
  assert.equal(accepted.headers.get('x-api-key'), 'oidc-1');
  assert.deepEqual(accepted.body.output_config, { effort: 'low' });
  assert.equal(accepted.body.fallbacks, undefined, 'no Anthropic-only parameters through the gateway');
  assert.equal(accepted.body.messages[0].content, '<problem>\n2x + 3 = 11\n</problem>\n<theme>basketball</theme>');

  // Second call: straight to the model that worked, with a fresh token.
  await rewrite({ problem: 'x + 1 = 2', interest: 'basketball' });
  assert.equal(requests.length, 3);
  assert.equal(requests[2].body.model, 'anthropic/claude-opus-5-5');
  assert.equal(requests[2].headers.get('x-api-key'), 'oidc-2');
});

test('the AI Gateway rewriter fails cleanly without a token or on an auth error', async () => {
  const noToken = createGatewayRewriter({ getToken: async () => undefined });
  assert.deepEqual(await rewriteProblem(noToken, '2x + 3 = 11', 'soccer', quietLog), { ok: false, reason: 'unavailable' });

  const { createClient, requests } = gatewayClient(() => ({
    status: 401,
    body: { type: 'error', error: { type: 'authentication_error', message: 'bad token' } },
  }));
  const denied = createGatewayRewriter({ getToken: async () => 't', createClient });
  assert.deepEqual(await rewriteProblem(denied, '2x + 3 = 11', 'soccer', quietLog), { ok: false, reason: 'unavailable' });
  assert.equal(requests.length, 1, 'an auth error is not retried with other models');
});

test('funModeSettings picks Anthropic, then the AI Gateway, then off', () => {
  assert.deepEqual(funModeSettings({}), { on: false, provider: null, model: null });
  assert.equal(funModeSettings({ ANTHROPIC_API_KEY: 'k', VERCEL: '1' }).provider, 'anthropic');
  assert.equal(funModeSettings({ VERCEL: '1' }).provider, 'gateway');
  assert.equal(funModeSettings({ AI_GATEWAY_API_KEY: 'k' }).provider, 'gateway');
  assert.equal(funModeSettings({ VERCEL: '1', FUN_MODE: 'off' }).on, false);
  assert.equal(funModeSettings({ VERCEL: '1', FUN_MODE_MODEL: 'anthropic/claude-sonnet-5.5' }).model, 'anthropic/claude-sonnet-5.5');
});

test('an Anthropic key saved as AI_GATEWAY_API_KEY is used as an Anthropic key', () => {
  const misplaced = funModeSettings({ VERCEL: '1', AI_GATEWAY_API_KEY: 'sk-ant-api03-abc' });
  assert.deepEqual(misplaced, { on: true, provider: 'anthropic', model: 'claude-opus-5-5', apiKey: 'sk-ant-api03-abc' });
  // ANTHROPIC_API_KEY wins if both are set; a real gateway key stays on the gateway.
  assert.equal(funModeSettings({ ANTHROPIC_API_KEY: 'sk-ant-1', AI_GATEWAY_API_KEY: 'sk-ant-2' }).apiKey, 'sk-ant-1');
  assert.equal(funModeSettings({ VERCEL: '1', AI_GATEWAY_API_KEY: 'vck_123' }).provider, 'gateway');
});
