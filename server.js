import http from 'node:http';
import { createApp } from './src/app.js';
import { createClaudeRewriter, DEFAULT_MODEL } from './src/funmode.js';

// Fun Mode needs Claude. It's on when an API key is set; FUN_MODE=on turns it
// on with other credentials (an `ant auth login` profile), FUN_MODE=off turns
// it off.
const funSetting = (process.env.FUN_MODE || '').toLowerCase();
const funModeOn =
  funSetting === 'on' ||
  (funSetting !== 'off' && Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN));

const app = createApp({ rewriter: funModeOn ? createClaudeRewriter() : null });
const port = Number(process.env.PORT) || 3000;

const server = http.createServer(app.handler);
server.listen(port, () => {
  console.log(`TwoTrack is running at http://localhost:${port}`);
  console.log(
    funModeOn
      ? `Fun Mode is on (${process.env.FUN_MODE_MODEL || DEFAULT_MODEL}).`
      : 'Fun Mode is off. Set ANTHROPIC_API_KEY to turn it on.',
  );
});

setInterval(app.sweep, 10 * 60_000).unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
