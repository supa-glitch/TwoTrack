import http from 'node:http';
import { createConfiguredApp } from './src/configure.js';

const { app, fun, accounts } = createConfiguredApp();
const port = Number(process.env.PORT) || 3000;

const server = http.createServer(app.handler);
server.listen(port, () => {
  console.log(`TwoTrack is running at http://localhost:${port}`);
  const via = fun.provider === 'gateway' ? 'through Vercel AI Gateway' : fun.model;
  console.log(fun.on ? `Fun Mode is on (${via}).` : 'Fun Mode is off. Set ANTHROPIC_API_KEY to turn it on.');
  console.log(
    accounts
      ? 'Teacher accounts are on (Supabase).'
      : 'Teacher accounts are off, so nobody can log in. Set SUPABASE_URL and SUPABASE_ANON_KEY.',
  );
});

setInterval(app.sweep, 10 * 60_000).unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
