// HTTP routes for TwoTrack. Uses only Node's built-in http module so it runs
// anywhere Node runs, with nothing to configure but an optional API key.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { parseLesson } from '../public/lib/worksheet.js';
import { rewriteProblem } from './funmode.js';
import {
  UserError,
  acknowledge,
  boardView,
  createClass,
  currentProblem,
  finishExitTicket,
  groupView,
  joinGroup,
  newClassCode,
  normalizeCode,
  openExitTicket,
  removeGroup,
  resultsCsv,
  setInterest,
  skipProblem,
  submitAnswer,
  submitExitTicket,
  updateSettings,
} from './classroom.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PAGES = { '/': 'index.html', '/teacher': 'teacher.html', '/board': 'board.html', '/display': 'display.html' };
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const MAX_BODY = 256 * 1024;
const IDLE_LIMIT = 12 * 60 * 60_000; // a class nobody has touched for 12 hours
const AGE_LIMIT = 24 * 60 * 60_000; // any class older than a day
const PIN_WINDOW = 10 * 60_000;
const PIN_MAX_FAILURES = 10;
const FUN_CALLS_PER_GROUP = 60;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Couldn’t read that request.');
  }
}

async function readJson(req) {
  // Vercel reads the body before the function runs and offers it as
  // req.body; plain Node leaves it on the stream.
  let early;
  try {
    early = req.body;
  } catch {
    throw new HttpError(400, 'Couldn’t read that request.');
  }
  if (early !== undefined && early !== null) {
    const text = Buffer.isBuffer(early) ? early.toString('utf8') : typeof early === 'string' ? early : null;
    if (text === null) return early;
    if (text.length > MAX_BODY) throw new HttpError(413, 'That’s too much text. Try a shorter worksheet.');
    return text ? parseJson(text) : {};
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'That’s too much text. Try a shorter worksheet.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return parseJson(Buffer.concat(chunks).toString('utf8'));
}

function sameSecret(given, expected) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param {object} options
 * @param {((input: {problem: string, interest: string}) => Promise<string>) | null} options.rewriter
 *   Fun Mode's AI rewriter, or null to turn Fun Mode off.
 * @param {() => number} [options.now]
 * @param {Console} [options.log]
 */
export function createApp({ rewriter = null, funModeLabel = null, now = () => Date.now(), log = console } = {}) {
  /** @type {Map<string, ReturnType<typeof createClass>>} */
  const classes = new Map();
  const funModeAvailable = Boolean(rewriter);

  function getClass(rawCode) {
    const cls = classes.get(normalizeCode(rawCode));
    if (!cls) throw new HttpError(404, 'No class with that code. Check the code on the board.');
    return cls;
  }

  function asTeacher(req, cls) {
    if (!sameSecret(req.headers['x-teacher-key'], cls.teacherKey)) {
      throw new HttpError(403, 'This board link has expired. Sign in again with your class code and PIN.');
    }
  }

  function asGroup(req, cls) {
    const t = String(req.headers['x-group-token'] ?? '');
    const group = cls.groups.find((g) => sameSecret(t, g.token));
    if (!group) throw new HttpError(403, 'Your group isn’t in this class anymore. Join again.');
    group.lastSeenAt = now();
    return group;
  }

  function findGroup(cls, id) {
    const group = cls.groups.find((g) => g.id === Number(id));
    if (!group) throw new HttpError(404, 'That group has left the class.');
    return group;
  }

  /** The Fun Mode version of a group's current problem, made once and shared. */
  function funText(cls, group) {
    const problem = currentProblem(cls, group);
    if (!problem) return Promise.resolve({ ok: false, reason: 'no-problem' });
    if (!rewriter || !cls.funModeAllowed) return Promise.resolve({ ok: false, reason: 'off' });
    if (!group.interest) return Promise.resolve({ ok: false, reason: 'no-interest' });
    const key = `${group.activityIndex}:${group.problemIndex}:${group.interest.toLowerCase()}`;
    let pending = cls.funCache.get(key);
    if (!pending) {
      if (group.funCalls >= FUN_CALLS_PER_GROUP) return Promise.resolve({ ok: false, reason: 'limit' });
      group.funCalls++;
      pending = rewriteProblem(rewriter, problem.text, group.interest, log);
      cls.funCache.set(key, pending);
      pending.then((r) => {
        if (r.ok) cls.funError = null;
        if (r.reason !== 'unavailable') return;
        // Tell the teacher why, and let the next request try again.
        cls.funError = { detail: r.detail, at: now() };
        cls.funCache.delete(key);
      });
    }
    return pending;
  }

  /** The board, plus whether Fun Mode is reaching Claude. */
  function teacherView(cls) {
    return {
      ...boardView(cls, now()),
      funMode: { label: funModeLabel, error: cls.funError ?? null },
    };
  }

  function sweep() {
    const t = now();
    for (const [code, cls] of classes) {
      if (t - cls.lastActivityAt > IDLE_LIMIT || t - cls.createdAt > AGE_LIMIT) classes.delete(code);
    }
  }

  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

  route('GET', /^\/api\/health$/, () => ({ ok: true, funMode: funModeAvailable }));

  route('POST', /^\/api\/classes$/, async (req) => {
    const body = await readJson(req);
    const lesson = parseLesson(body.worksheet, body.exitTicket);
    const errors = lesson.issues.filter((i) => i.level === 'error');
    if (errors.length) throw new HttpError(400, errors.map((e) => e.message).join(' '));
    const code = newClassCode(classes);
    const cls = createClass(
      code,
      { ...lesson, title: String(body.title || lesson.title || '').trim().slice(0, 80) },
      { groupCount: body.groupCount, funModeAllowed: body.funModeAllowed },
      now(),
    );
    classes.set(code, cls);
    return { code, teacherKey: cls.teacherKey, pin: cls.pin };
  });

  route('POST', /^\/api\/teacher\/login$/, async (req) => {
    const body = await readJson(req);
    const cls = getClass(body.code);
    const t = now();
    cls.pinFailures = cls.pinFailures.filter((at) => t - at < PIN_WINDOW);
    if (cls.pinFailures.length >= PIN_MAX_FAILURES) {
      throw new HttpError(429, 'Too many wrong PINs. Wait 10 minutes, or use the board link on the computer you set up the lesson on.');
    }
    if (!sameSecret(String(body.pin ?? '').replace(/\D/g, ''), cls.pin)) {
      cls.pinFailures.push(t);
      throw new HttpError(403, 'That PIN doesn’t match this class.');
    }
    return { code: cls.code, teacherKey: cls.teacherKey };
  });

  // What anyone with the class code can see: used by the join screen and
  // the smartboard display.
  route('GET', /^\/api\/classes\/(\w+)\/public$/, (req, [code]) => {
    const cls = getClass(code);
    return { code: cls.code, title: cls.title, groups: cls.groups.map((g) => g.name) };
  });

  route('POST', /^\/api\/classes\/(\w+)\/join$/, async (req, [code]) => {
    const body = await readJson(req);
    const cls = getClass(code);
    const group = joinGroup(cls, body.name, now());
    return { token: group.token, state: groupView(cls, group, { funModeAvailable }) };
  });

  // ---- teacher

  route('GET', /^\/api\/classes\/(\w+)\/board$/, (req, [code]) => {
    const cls = getClass(code);
    asTeacher(req, cls);
    return teacherView(cls);
  });

  route('POST', /^\/api\/classes\/(\w+)\/exit-ticket$/, (req, [code]) => {
    const cls = getClass(code);
    asTeacher(req, cls);
    openExitTicket(cls, now());
    return teacherView(cls);
  });

  route('POST', /^\/api\/classes\/(\w+)\/settings$/, async (req, [code]) => {
    const cls = getClass(code);
    asTeacher(req, cls);
    updateSettings(cls, await readJson(req));
    return teacherView(cls);
  });

  route('POST', /^\/api\/classes\/(\w+)\/groups\/(\d+)\/ack$/, (req, [code, id]) => {
    const cls = getClass(code);
    asTeacher(req, cls);
    acknowledge(findGroup(cls, id), now());
    return teacherView(cls);
  });

  route('POST', /^\/api\/classes\/(\w+)\/groups\/(\d+)\/skip$/, (req, [code, id]) => {
    const cls = getClass(code);
    asTeacher(req, cls);
    skipProblem(cls, findGroup(cls, id), now());
    return teacherView(cls);
  });

  route('DELETE', /^\/api\/classes\/(\w+)\/groups\/(\d+)$/, (req, [code, id]) => {
    const cls = getClass(code);
    asTeacher(req, cls);
    removeGroup(cls, Number(id));
    return teacherView(cls);
  });

  route('GET', /^\/api\/classes\/(\w+)\/results\.csv$/, (req, [code]) => {
    const cls = getClass(code);
    asTeacher(req, cls);
    return {
      raw: resultsCsv(cls),
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="exit-tickets-${cls.code}.csv"`,
      },
    };
  });

  route('DELETE', /^\/api\/classes\/(\w+)$/, (req, [code]) => {
    const cls = getClass(code);
    asTeacher(req, cls);
    classes.delete(cls.code);
    return { ok: true };
  });

  // ---- group

  const groupState = (cls, group) => groupView(cls, group, { funModeAvailable });

  route('GET', /^\/api\/classes\/(\w+)\/group$/, (req, [code]) => {
    const cls = getClass(code);
    return groupState(cls, asGroup(req, cls));
  });

  route('POST', /^\/api\/classes\/(\w+)\/group\/answer$/, async (req, [code]) => {
    const cls = getClass(code);
    const group = asGroup(req, cls);
    const body = await readJson(req);
    const result = submitAnswer(cls, group, body, now());
    // Start rewriting the next problem while the group reads "Correct!".
    if (result === 'correct' && group.funMode) funText(cls, group);
    return { result, state: groupState(cls, group) };
  });

  route('POST', /^\/api\/classes\/(\w+)\/group\/interest$/, async (req, [code]) => {
    const cls = getClass(code);
    const group = asGroup(req, cls);
    const body = await readJson(req);
    setInterest(group, body.interest);
    if (group.interest && body.funMode !== undefined) {
      group.funMode = Boolean(body.funMode) && funModeAvailable && cls.funModeAllowed;
    }
    return groupState(cls, group);
  });

  route('POST', /^\/api\/classes\/(\w+)\/group\/fun$/, async (req, [code]) => {
    const cls = getClass(code);
    const group = asGroup(req, cls);
    const body = await readJson(req);
    group.funMode = Boolean(body.on) && funModeAvailable && cls.funModeAllowed && Boolean(group.interest);
    return groupState(cls, group);
  });

  route('GET', /^\/api\/classes\/(\w+)\/group\/fun-text$/, async (req, [code]) => {
    const cls = getClass(code);
    const group = asGroup(req, cls);
    const problem = currentProblem(cls, group);
    // The error detail is for the teacher's board, not the students.
    const { detail, ...result } = await funText(cls, group);
    // Say which problem this is for, in case the group moved on meanwhile.
    return { ...result, activityIndex: group.activityIndex, problemIndex: group.problemIndex, label: problem?.label };
  });

  route('POST', /^\/api\/classes\/(\w+)\/group\/exit$/, async (req, [code]) => {
    const cls = getClass(code);
    const group = asGroup(req, cls);
    const body = await readJson(req);
    const result = submitExitTicket(cls, group, body, now());
    return { name: result.name, state: groupState(cls, group) };
  });

  route('POST', /^\/api\/classes\/(\w+)\/group\/exit-done$/, (req, [code]) => {
    const cls = getClass(code);
    const group = asGroup(req, cls);
    finishExitTicket(group);
    return groupState(cls, group);
  });

  async function serveStatic(req, res, pathname) {
    const file = PAGES[pathname] ?? pathname.replace(/^\/+/, '');
    const full = path.normalize(path.join(PUBLIC_DIR, file));
    if (!full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'Not found');
    let data;
    try {
      data = await readFile(full);
    } catch {
      return send(res, 404, 'Not found');
    }
    const type = TYPES[path.extname(full)] ?? 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache' };
    if (type.startsWith('text/html')) {
      headers['Content-Security-Policy'] =
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
    }
    if (req.method === 'HEAD') return send(res, 200, '', headers);
    send(res, 200, data, headers);
  }

  async function handler(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname.startsWith('/api/')) {
        for (const r of routes) {
          const match = r.method === req.method && pathname.match(r.pattern);
          if (!match) continue;
          const result = await r.handler(req, match.slice(1));
          if (result && result.raw !== undefined) return send(res, 200, result.raw, result.headers);
          return send(res, 200, result);
        }
        throw new HttpError(404, 'Not found');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      await serveStatic(req, res, pathname);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      if (err instanceof UserError) return send(res, 400, { error: err.message });
      log.error(err);
      send(res, 500, { error: 'Something went wrong. Try again.' });
    }
  }

  return { handler, classes, sweep, funModeAvailable };
}
