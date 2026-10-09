// The Vercel function. vercel.json sends every /api/... request here and
// Vercel serves the pages in public/ itself.
//
// Classes live in this function's memory, so they last only as long as
// Vercel keeps this instance running. See "Hosting on Vercel" in the README.

import { createConfiguredApp, restoreApiPath } from '../src/configure.js';

const { app } = createConfiguredApp();
let lastSweep = 0;

export default async function handler(req, res) {
  req.url = restoreApiPath(req.url);
  if (Date.now() - lastSweep > 60_000) {
    lastSweep = Date.now();
    app.sweep();
  }
  await app.handler(req, res);
}
