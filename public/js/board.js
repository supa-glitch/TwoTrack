// The teacher's live board: one card per group, refreshed every 2 seconds.

import { $, api, duration, el, poll, store, ApiError } from './common.js';

const TEACHER_KEY = 'twotrack.teacher';
let auth = null; // { code, teacherKey }
let board = null;
let fetchedAt = 0; // performance.now() when `board` arrived, for the ticking timers
let stopPolling = null;
const cards = new Map(); // group id -> { root, parts... }
const placeholders = [];

const views = { signin: $('#signin-view'), ended: $('#ended-view'), board: $('#board-view') };
function show(view) {
  for (const [name, node] of Object.entries(views)) node.hidden = name !== view;
}

// --------------------------------------------------------------- sign in

function showSignin(message, code) {
  stopPolling?.();
  show('signin');
  if (code) $('#signin-code').value = code;
  $('#signin-error').hidden = !message;
  $('#signin-error').textContent = message || '';
  ($('#signin-code').value ? $('#signin-pin') : $('#signin-code')).focus();
}

$('#signin-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = $('#signin-code').value.trim().toUpperCase();
  const pin = $('#signin-pin').value.trim();
  try {
    const result = await api('POST', '/api/teacher/login', { body: { code, pin } });
    auth = { code: result.code, teacherKey: result.teacherKey };
    store.set(TEACHER_KEY, auth);
    history.replaceState(null, '', `/board#${auth.code}`);
    startBoard();
  } catch (err) {
    $('#signin-error').hidden = false;
    $('#signin-error').textContent = err.message;
  }
});

function showEnded(title, text) {
  stopPolling?.();
  store.remove(TEACHER_KEY);
  $('#ended-title').textContent = title;
  $('#ended-text').textContent = text;
  show('ended');
}

// ---------------------------------------------------------------- board

function startBoard() {
  show('board');
  $('#join-url').textContent = location.host;
  $('#phone-url').textContent = `${location.host}/board`;
  stopPolling?.();
  stopPolling = poll(refresh, 2000);
}

async function refresh() {
  try {
    render(await api('GET', `/api/classes/${auth.code}/board`, { teacherKey: auth.teacherKey }));
    $('#connection').hidden = true;
  } catch (err) {
    handleError(err);
  }
}

function handleError(err) {
  if (err instanceof ApiError && err.status === 404) {
    showEnded('This class has ended', 'It was cleared or expired, so its groups, names and exit tickets are gone.');
  } else if (err instanceof ApiError && err.status === 403) {
    store.remove(TEACHER_KEY);
    showSignin(err.message, auth?.code);
  } else {
    $('#connection').hidden = false;
    $('#connection').textContent = `${err.message} The board will keep trying.`;
  }
}

async function act(method, path, body) {
  try {
    const next = await api(method, `/api/classes/${auth.code}${path}`, { teacherKey: auth.teacherKey, body });
    if (next && next.groups) render(next);
    return next;
  } catch (err) {
    handleError(err);
    return null;
  }
}

function render(next) {
  board = next;
  fetchedAt = performance.now();
  document.title = `${board.code} · Live Board · TwoTrack`;
  $('#lesson-title').textContent = board.title;
  $('#class-code').textContent = board.code;
  $('#phone-code').textContent = board.code;
  $('#phone-pin').textContent = board.pin;
  $('#open-exit').hidden = board.exitOpen;
  $('#exit-open-note').hidden = !board.exitOpen;

  const needYou = board.groups.filter((g) => g.flags.length);
  const finished = board.groups.reduce((n, g) => n + g.finished, 0);
  const possible = board.groups.length * board.totalProblems;
  $('#stat-groups').textContent = `${board.groups.length} / ${board.groupCount}`;
  $('#stat-need').textContent = needYou.length;
  $('#stat-need-box').classList.toggle('alert', needYou.length > 0);
  $('#stat-progress').textContent = possible ? `${Math.round((finished / possible) * 100)}%` : '–';
  $('#stat-exit').textContent = board.exitResults.length;
  $('#need-list').hidden = !needYou.length;
  $('#need-list').textContent = needYou.length ? `Go to: ${needYou.map((g) => `${g.name} (${flagWords(g)})`).join(' · ')}` : '';

  const funError = board.funMode?.error;
  $('#fun-error').hidden = !funError;
  $('#fun-error').textContent = funError
    ? `Fun Mode isn’t reaching Claude${board.funMode.label ? ` (${board.funMode.label})` : ''}: ${(funError.detail || 'unknown error').replace(/\.$/, '')}. Groups see their problems as written.`
    : '';

  renderGroups();
  renderResults();
}

function flagWords(g) {
  return g.flags
    .map((f) => (f.type === 'stuck' ? `stuck on #${f.problem}` : `quiet ${Math.floor(f.seconds / 60)}m`))
    .join(', ');
}

// ---------------------------------------------------------- group cards

function makeCard(id) {
  const parts = {
    name: el('div', { class: 'name' }),
    fun: el('span', { class: 'fun-badge', hidden: true }),
    status: el('span', { class: 'status' }),
    activity: el('dd'),
    problem: el('dd'),
    finished: el('dd'),
    last: el('dd'),
    bar: el('span'),
    ack: el('button', { type: 'button', class: 'secondary', onclick: () => act('POST', `/groups/${id}/ack`) }, '✓ Checked on them'),
    skip: el('button', { type: 'button', class: 'secondary', onclick: () => skip(id) }, 'Skip this problem'),
    remove: el('button', { type: 'button', class: 'quiet-button', onclick: () => remove(id) }, 'Remove'),
  };
  parts.root = el(
    'article',
    { class: 'group-card' },
    el('div', { class: 'row spread' }, parts.name, parts.status),
    parts.fun,
    el('div', { class: 'bar', 'aria-hidden': 'true' }, parts.bar),
    el(
      'dl',
      { class: 'facts' },
      el('dt', {}, 'Activity'),
      parts.activity,
      el('dt', {}, 'Problem'),
      parts.problem,
      el('dt', {}, 'Finished'),
      parts.finished,
      el('dt', {}, 'Last answer'),
      parts.last,
    ),
    el('div', { class: 'card-actions no-print' }, parts.ack, parts.skip, parts.remove),
  );
  return parts;
}

function sinceLastAnswer(g) {
  const extra = (performance.now() - fetchedAt) / 1000;
  return g.sinceLastAnswer === null ? null : g.sinceLastAnswer + extra;
}

function updateCard(parts, g) {
  const stuck = g.flags.find((f) => f.type === 'stuck');
  const quiet = g.flags.find((f) => f.type === 'quiet');
  let kind = 'ok';
  let status = 'On track';
  if (g.stage === 'exit') {
    kind = 'exit';
    status = `Exit ticket · ${g.exitTickets} in`;
  } else if (g.stage === 'done') {
    kind = 'done';
    status = `Finished · ${g.exitTickets} tickets`;
  } else if (stuck) {
    kind = 'stuck';
    status = `Stuck on #${stuck.problem} · ${stuck.tries} tries`;
  } else if (quiet) {
    kind = 'quiet';
    status = `Quiet ${duration(quiet.seconds)}`;
  }
  parts.root.className = `group-card ${kind}`;
  parts.name.textContent = g.name;
  parts.status.className = `status ${kind}`;
  parts.status.textContent = status;
  parts.fun.hidden = !g.funMode;
  parts.fun.textContent = `🎮 Fun Mode: ${g.interest}`;
  parts.bar.style.width = `${g.total ? Math.round((g.finished / g.total) * 100) : 0}%`;
  parts.activity.textContent =
    g.stage === 'activities' ? `${g.activityNumber} of ${board.activities.length} · ${g.activityTitle}` : 'Worksheet over';
  parts.problem.textContent = g.stage === 'activities' ? `${g.problemNumber} of ${g.problemCount}${g.triesOnProblem ? ` · ${g.triesOnProblem} wrong` : ''}` : '–';
  parts.finished.textContent = `${g.finished} of ${g.total} problems${g.skipped ? ` (${g.skipped} skipped)` : ''}`;
  parts.ack.hidden = !g.flags.length;
  parts.skip.hidden = !stuck;
  parts.group = g;
  updateLast(parts);
}

function updateLast(parts) {
  const g = parts.group;
  const since = sinceLastAnswer(g);
  parts.last.textContent = since === null ? `none yet (joined ${duration(g.sinceJoined)} ago)` : `${duration(since)} ago`;
}

function renderGroups() {
  const container = $('#groups');
  const seen = new Set();
  const nodes = [];
  for (const g of board.groups) {
    seen.add(g.id);
    let parts = cards.get(g.id);
    if (!parts) {
      parts = makeCard(g.id);
      cards.set(g.id, parts);
    }
    updateCard(parts, g);
    nodes.push(parts.root);
  }
  for (const id of cards.keys()) if (!seen.has(id)) cards.delete(id);
  for (let i = board.groups.length; i < board.groupCount; i++) {
    placeholders[i] ||= el('article', { class: 'group-card waiting' }, el('div', { class: 'name' }, 'Waiting for a group…'), el('div', { class: 'small' }, 'Groups join with the class code.'));
    nodes.push(placeholders[i]);
  }
  // Only touch the DOM when the set of cards changed, so buttons don't move under a finger.
  const current = [...container.children];
  if (current.length !== nodes.length || current.some((node, i) => node !== nodes[i])) container.replaceChildren(...nodes);
}

// The "last answer" timers tick every second between refreshes.
setInterval(() => {
  if (board) for (const parts of cards.values()) updateLast(parts);
}, 1000);

async function skip(id) {
  const g = board.groups.find((x) => x.id === id);
  if (confirm(`Move ${g?.name ?? 'this group'} on to the next problem? It will count as skipped, not finished.`)) await act('POST', `/groups/${id}/skip`);
}

async function remove(id) {
  const g = board.groups.find((x) => x.id === id);
  if (confirm(`Remove ${g?.name ?? 'this group'} from the board? Their progress will be lost.`)) await act('DELETE', `/groups/${id}`);
}

// --------------------------------------------------------------- results

function renderResults() {
  const results = [...board.exitResults].sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name));
  $('#results').hidden = !board.exitOpen && !results.length && !board.groups.some((g) => g.stage !== 'activities');
  $('#no-results').hidden = results.length > 0;
  const table = $('#results-table');
  if (!results.length) {
    table.replaceChildren();
    return;
  }
  const questions = board.exitTicket;
  const percentRight = questions.map((_, i) => Math.round((results.filter((r) => r.correct[i]).length / results.length) * 100));
  table.replaceChildren(
    el(
      'thead',
      {},
      el('tr', {}, el('th', {}, 'Name'), el('th', {}, 'Group'), el('th', {}, 'Score'), questions.map((q, i) => el('th', { title: q.text }, `Q${i + 1}`))),
    ),
    el(
      'tbody',
      {},
      results.map((r) =>
        el(
          'tr',
          {},
          el('td', {}, r.name),
          el('td', {}, r.groupName),
          el('td', {}, el('strong', {}, `${r.score} / ${r.total}`)),
          r.answers.map((answer, i) =>
            el('td', { class: r.correct[i] ? 'mark-right' : 'mark-wrong', title: `Answered: ${answer || '(blank)'}` }, `${r.correct[i] ? '✓' : '✗'} `, el('span', { class: 'muted small' }, answer || '—')),
          ),
        ),
      ),
    ),
    el(
      'tfoot',
      {},
      el('tr', {}, el('th', { colspan: '3' }, 'Class got it right'), percentRight.map((p) => el('th', {}, `${p}%`))),
    ),
  );
}

$('#download').addEventListener('click', async () => {
  try {
    const res = await fetch(`/api/classes/${auth.code}/results.csv`, { headers: { 'x-teacher-key': auth.teacherKey } });
    if (!res.ok) throw new ApiError(res.status, 'Couldn’t download the results. Try again.');
    const url = URL.createObjectURL(await res.blob());
    const link = el('a', { href: url, download: `exit-tickets-${auth.code}.csv` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    $('#cleared-hint').hidden = false;
  } catch (err) {
    handleError(err);
  }
});

$('#print').addEventListener('click', () => window.print());

async function clearClass() {
  const message = board?.exitResults.length
    ? 'Delete all groups, names and exit tickets for this class? Download or print the results first. This can’t be undone.'
    : 'End this class and delete its groups and progress? This can’t be undone.';
  if (!confirm(message)) return;
  const result = await act('DELETE', '');
  if (result) showEnded('Class data cleared', 'All groups, names and exit tickets for this class have been deleted.');
}
$('#clear').addEventListener('click', clearClass);
$('#clear-bottom').addEventListener('click', clearClass);

// ---------------------------------------------------------- top buttons

$('#open-exit').addEventListener('click', async () => {
  if (!confirm('Move every group to the exit ticket now? Groups that haven’t finished the worksheet will stop where they are.')) return;
  await act('POST', '/exit-ticket');
});

$('#show-code').addEventListener('click', () => window.open(`/display#${auth.code}`, 'twotrack-display'));
$('#phone').addEventListener('click', () => $('#phone-dialog').showModal());

$('#settings').addEventListener('click', () => {
  $('#quiet-minutes').value = board.settings.quietMinutes;
  $('#stuck-tries').value = board.settings.stuckTries;
  $('#settings-dialog').returnValue = '';
  $('#settings-dialog').showModal();
});

$('#settings-dialog').addEventListener('close', () => {
  if ($('#settings-dialog').returnValue !== 'save') return;
  act('POST', '/settings', { quietMinutes: Number($('#quiet-minutes').value), stuckTries: Number($('#stuck-tries').value) });
});

// ------------------------------------------------------------------ start

const hashCode = location.hash.replace('#', '').toUpperCase();
const saved = store.get(TEACHER_KEY);
if (saved?.teacherKey && (!hashCode || hashCode === saved.code)) {
  auth = saved;
  if (!hashCode) history.replaceState(null, '', `/board#${auth.code}`);
  startBoard();
} else {
  showSignin('', hashCode);
}
