// The group's screen: join, work through the worksheet one problem at a
// time, Fun Mode, then the exit ticket with students taking turns.

import { $, api, el, poll, store, ApiError } from './common.js';
import { CHEERS, NUDGES, confetti, pick, replay } from './cheer.js';

const SESSION_KEY = 'twotrack.group';
const INTEREST_IDEAS = { basketball: '🏀', soccer: '⚽', 'video games': '🎮', music: '🎵', dance: '💃', cooking: '🍳', anime: '🌸', skateboarding: '🛹' };

let session = store.get(SESSION_KEY); // { code, token }
let state = null;
let stopPolling = null;
let busy = false;
let problemKey = null; // which problem the screen is showing
let seenActivity = null;
let pausedForCelebration = false;
let exitStep = 'intro'; // intro | answering | thanks
let exitName = '';
const funTexts = new Map();
let streak = 0; // right answers in a row, for the 🔥 badge
let stepsShown = null; // activity statuses the chips show
let dotsShown = null; // { activityIndex, problemIndex, count } the dots show

const views = {
  join: $('#join-view'),
  work: $('#work-view'),
};

function show(view) {
  for (const [name, node] of Object.entries(views)) node.hidden = name !== view;
}

// ------------------------------------------------------------------ join

function showJoin(message) {
  stopPolling?.();
  stopPolling = null;
  session = null;
  state = null;
  store.remove(SESSION_KEY);
  show('join');
  const params = new URLSearchParams(location.search);
  const code = params.get('code') || location.hash.replace('#', '');
  if (code && !$('#join-code').value) $('#join-code').value = code.toUpperCase();
  $('#join-error').hidden = !message;
  $('#join-error').textContent = message || '';
  if (message) replay($('#join-error'), 'shake');
  ($('#join-code').value ? $('#join-name') : $('#join-code')).focus();
}

$('#join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = $('#join-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const name = $('#join-name').value.trim();
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = await api('POST', `/api/classes/${code}/join`, { body: { name } });
    session = { code, token: result.token };
    store.set(SESSION_KEY, session);
    start(result.state);
  } catch (err) {
    $('#join-error').hidden = false;
    $('#join-error').textContent = err.message;
    replay($('#join-error'), 'shake');
  } finally {
    button.disabled = false;
  }
});

$('#leave').addEventListener('click', () => {
  if (confirm('Leave this class on this computer? You can join again with the same group name.')) showJoin();
});

// --------------------------------------------------------------- polling

function start(initial) {
  show('work');
  render(initial);
  stopPolling?.();
  stopPolling = poll(refresh, 3000);
}

async function refresh() {
  if (!session || busy) return;
  try {
    const next = await api('GET', `/api/classes/${session.code}/group`, { groupToken: session.token });
    $('#connection').hidden = true;
    render(next);
  } catch (err) {
    handleError(err);
  }
}

function handleError(err) {
  if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
    showJoin(err.status === 404 ? 'That class has ended. Check the code with your teacher.' : err.message);
    return;
  }
  $('#connection').hidden = false;
  $('#connection').textContent = err.message;
}

// ---------------------------------------------------------------- render

function render(next) {
  const previous = state;
  state = next;
  $('#group-name').textContent = state.groupName;
  $('#class-title').textContent = state.title;
  showAvatar(state.groupName);

  // Finishing an activity gets a moment of its own before the next one.
  if (previous && seenActivity !== null && previous.stage === 'activities' && state.activityIndex > seenActivity) {
    const finished = state.activities[seenActivity];
    const nextActivity = state.stage === 'activities' ? state.activities[state.activityIndex] : null;
    $('#activity-done-title').textContent = `${finished.title}: done!`;
    $('#activity-done-next').textContent = nextActivity ? `🔓 Unlocked: ${nextActivity.title}` : 'That was the last activity. Next up: the exit ticket.';
    $('#activity-continue').textContent = nextActivity ? `Start ${nextActivity.title}` : 'Go to the exit ticket';
    pausedForCelebration = true;
    confetti($('#activity-done-title'), 110);
  }
  if (previous && previous.stage !== 'done' && state.stage === 'done') confetti($('#done-section h1'), 140);
  seenActivity = state.activityIndex;

  $('#activity-section').hidden = state.stage !== 'activities' && !pausedForCelebration;
  $('#exit-section').hidden = state.stage !== 'exit' || pausedForCelebration;
  $('#done-section').hidden = state.stage !== 'done';

  if (state.stage === 'activities' || pausedForCelebration) renderActivities(previous);
  if (state.stage === 'exit' && !pausedForCelebration) renderExit();
}

function showAvatar(name) {
  const letter = [...name.trim()][0]?.toUpperCase() || '?';
  const avatar = $('#group-avatar');
  if (avatar.textContent === letter) return;
  const color = [...name].reduce((sum, ch) => sum + ch.codePointAt(0), 0) % 6;
  avatar.textContent = letter;
  avatar.className = `avatar c${color}`;
}

function renderActivities(previous) {
  // Rebuilt only when something changed, so their animations don't restart on every poll.
  const statuses = state.activities.map((a) => `${a.status}:${a.title}`);
  if (statuses.join('\n') !== stepsShown?.join('\n')) {
    const before = stepsShown;
    stepsShown = statuses;
    $('#steps').replaceChildren(
      ...state.activities.map((a, i) => {
        const justDone = a.status === 'done' && before && before[i] && !before[i].startsWith('done:');
        return el(
          'li',
          { class: `${a.status}${justDone ? ' fresh' : ''}`, 'aria-current': a.status === 'current' ? 'step' : null },
          `${a.status === 'done' ? '✓ ' : ''}${i + 1}. ${a.title}`,
        );
      }),
    );
  }

  $('#activity-done').hidden = !pausedForCelebration;
  $('#problem-card').hidden = pausedForCelebration;
  if (pausedForCelebration || !state.problem) return;

  $('#activity-title').textContent = state.activity.title;
  $('#activity-directions').textContent = state.activity.directions || '';
  $('#activity-directions').hidden = !state.activity.directions;
  const count = state.activity.problemCount;
  $('#problem-count').textContent = `Problem ${state.problemIndex + 1} of ${count}`;
  const dots = { activityIndex: state.activityIndex, problemIndex: state.problemIndex, count };
  if (JSON.stringify(dots) !== JSON.stringify(dotsShown)) {
    const advanced = dotsShown?.activityIndex === dots.activityIndex && dotsShown.problemIndex === dots.problemIndex - 1;
    dotsShown = dots;
    $('#dots').replaceChildren(
      ...Array.from({ length: count }, (_, i) =>
        el('span', {
          class: i < state.problemIndex ? `done${advanced && i === state.problemIndex - 1 ? ' fresh' : ''}` : i === state.problemIndex ? 'current' : '',
        }),
      ),
    );
  }

  const key = `${state.activityIndex}:${state.problemIndex}`;
  const newProblem = key !== problemKey;
  if (newProblem) {
    problemKey = key;
    const last = state.problemIndex === count - 1 && count > 1;
    const halfway = count >= 4 && state.problemIndex === Math.floor(count / 2);
    $('#problem-cheer').textContent = last ? 'Last one! 🏁' : halfway ? 'Halfway there! 💪' : '';
    $('#problem-cheer').hidden = !last && !halfway;
    replay($('#problem-text'), 'enter');
    replay($('#fun-story'), 'enter');
    $('#problem-text').textContent = state.problem.text;
    $('#fun-original').textContent = state.problem.text;
    $('#answer').value = '';
    if (!busy) setFeedback('', '');
    const skipped = previous && state.lastResult?.result === 'skipped' && previous.problemIndex !== state.problemIndex;
    $('#moved-on').hidden = !skipped;
    $('#answer').focus();
  }
  $('#stuck-note').hidden = !state.teacherFlagged;
  renderFun(newProblem);
}

function setFeedback(text, kind, badge = '') {
  const node = $('#feedback');
  node.replaceChildren(...(text ? [el('span', {}, text)] : []), ...(badge ? [el('span', { class: 'streak' }, badge)] : []));
  node.className = `feedback ${kind}`;
  if (text) replay(node, 'bump');
}

$('#activity-continue').addEventListener('click', () => {
  pausedForCelebration = false;
  render(state);
});

$('#answer-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const answer = $('#answer').value.trim();
  if (!answer || busy) return;
  busy = true;
  $('#check').disabled = true;
  try {
    const result = await api('POST', `/api/classes/${session.code}/group/answer`, {
      groupToken: session.token,
      body: { activityIndex: state.activityIndex, problemIndex: state.problemIndex, answer },
    });
    if (result.result === 'correct') {
      streak += 1;
      setFeedback(`✓ ${pick(CHEERS)}`, 'correct', streak >= 3 ? `🔥 ${streak} in a row!` : '');
      replay($('#problem-card'), 'glow');
      confetti($('#check'), streak >= 3 ? 60 : 36);
      // Let them see it before the next problem appears.
      await new Promise((resolve) => setTimeout(resolve, 900));
      setFeedback('', '');
    } else if (result.result === 'wrong') {
      streak = 0;
      const tries = result.state.triesOnProblem;
      setFeedback(`${pick(NUDGES)}${tries > 1 ? ` (${tries} tries)` : ''}`, 'wrong');
      replay($('#answer'), 'shake');
      $('#answer').select();
    }
    busy = false;
    render(result.state);
  } catch (err) {
    busy = false;
    handleError(err);
  } finally {
    busy = false;
    $('#check').disabled = false;
  }
});

// ---------------------------------------------------------------- Fun Mode

function renderFun(newProblem) {
  const fun = state.funMode;
  const toggle = $('#fun-toggle');
  toggle.hidden = !fun.available;
  toggle.setAttribute('aria-pressed', String(fun.on));
  toggle.textContent = fun.on ? '🎮 Fun Mode on' : '🎮 Fun Mode';

  const showStory = fun.available && fun.on && Boolean(fun.interest);
  $('#fun-story').hidden = !showStory;
  $('#problem-text').hidden = showStory;
  $('#change-interest').textContent = `Theme: ${fun.interest} · change`;
  if (!showStory) return;

  const key = `${state.activityIndex}:${state.problemIndex}:${fun.interest.toLowerCase()}`;
  const known = funTexts.get(key);
  if (known) {
    $('#fun-text').dataset.key = key;
    showFun(key, known);
    return;
  }
  if (newProblem || $('#fun-text').dataset.key !== key) {
    $('#fun-text').dataset.key = key;
    showFun(key, `Rewriting this one around ${fun.interest}…`, '', true);
    loadFunText(key);
  }
}

const FUN_FAILED = 'Fun Mode isn’t working right now, so here’s the problem as written.';

function showFun(key, text, why = '', loading = false) {
  if ($('#fun-text').dataset.key !== key) return;
  $('#fun-story').classList.toggle('loading', loading);
  if (!loading && $('#fun-text').textContent !== text) replay($('#fun-text'), 'appear');
  $('#fun-text').textContent = text;
  $('#fun-why').textContent = why ? `Why: ${why}` : '';
  $('#fun-why').hidden = !why;
}

/** Why the request itself failed, before the server could say. */
function requestProblem(err) {
  if (err.status === 504 || err.status === 0) return `the server took too long or couldn’t be reached (${err.status ? `HTTP ${err.status}` : 'no connection'})`;
  if (err.status === 404) return 'this copy of the server doesn’t know the class (HTTP 404)';
  return err.status ? `HTTP ${err.status}: ${err.message}` : err.message;
}

async function loadFunText(key, attempt = 1) {
  let result;
  try {
    result = await api('GET', `/api/classes/${session.code}/group/fun-text`, { groupToken: session.token });
  } catch (err) {
    // The request failed before the server answered: try once more.
    if (attempt === 1 && err.status !== 403) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return loadFunText(key, 2);
    }
    showFun(key, FUN_FAILED, requestProblem(err));
    return;
  }
  const resultKey = `${result.activityIndex}:${result.problemIndex}:${state.funMode.interest.toLowerCase()}`;
  if (resultKey !== key) return;
  if (result.ok) {
    funTexts.set(resultKey, result.text);
    showFun(key, result.text);
  } else if (result.reason === 'numbers') {
    showFun(key, 'Fun Mode couldn’t rewrite this one without changing the math, so here it is as written.');
  } else {
    showFun(key, FUN_FAILED, result.detail || result.reason);
  }
}

$('#fun-toggle').addEventListener('click', async () => {
  if (!state.funMode.interest) return openInterest();
  try {
    render(await api('POST', `/api/classes/${session.code}/group/fun`, { groupToken: session.token, body: { on: !state.funMode.on } }));
  } catch (err) {
    handleError(err);
  }
});

$('#change-interest').addEventListener('click', openInterest);

function openInterest() {
  $('#interest').value = state.funMode.interest || '';
  $('#interest-dialog').returnValue = '';
  const markChosen = () => {
    for (const chip of $('#interest-ideas').children) chip.setAttribute('aria-pressed', String(chip.dataset.idea === $('#interest').value.trim().toLowerCase()));
  };
  $('#interest-ideas').replaceChildren(
    ...Object.entries(INTEREST_IDEAS).map(([idea, emoji]) =>
      el('button', { type: 'button', 'data-idea': idea, 'aria-pressed': 'false', onclick: () => (($('#interest').value = idea), markChosen()) }, `${emoji} ${idea}`),
    ),
  );
  $('#interest').oninput = markChosen;
  markChosen();
  $('#interest-dialog').showModal();
  $('#interest').focus();
}

$('#interest-dialog').addEventListener('close', async () => {
  const dialog = $('#interest-dialog');
  if (dialog.returnValue !== 'save') return;
  const interest = $('#interest').value.trim();
  if (!interest) return;
  try {
    render(await api('POST', `/api/classes/${session.code}/group/interest`, { groupToken: session.token, body: { interest, funMode: true } }));
  } catch (err) {
    handleError(err);
  }
});

// ------------------------------------------------------------- exit ticket

function renderExit() {
  const submitted = state.exitTicket.submitted;
  $('#exit-submitted').hidden = !submitted.length;
  $('#exit-submitted').textContent = `Handed in: ${submitted.join(', ')}`;
  $('#exit-all-done').hidden = !submitted.length;
  $('#exit-intro').hidden = exitStep !== 'intro';
  $('#exit-form').hidden = exitStep !== 'answering';
  $('#exit-thanks').hidden = exitStep !== 'thanks';
}

$('#exit-name-form').addEventListener('submit', (event) => {
  event.preventDefault();
  exitName = $('#exit-name').value.trim();
  if (!exitName) return;
  $('#exit-form-title').textContent = `${exitName}’s exit ticket`;
  $('#exit-problems').replaceChildren(
    ...state.exitTicket.problems.map((p, i) =>
      el(
        'div',
        { class: 'exit-problem' },
        el('div', { class: 'problem-text', id: `exit-q-${i}` }, `${i + 1}. ${p.text}`),
        el('input', { type: 'text', maxlength: '200', 'aria-labelledby': `exit-q-${i}`, spellcheck: 'false', autocapitalize: 'off', 'data-index': i }),
      ),
    ),
  );
  $('#exit-error').hidden = true;
  exitStep = 'answering';
  renderExit();
  $('#exit-problems input')?.focus();
});

$('#exit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const inputs = [...$('#exit-problems').querySelectorAll('input')];
  const answers = inputs.map((input) => input.value.trim());
  if (answers.some((a) => !a) && !confirm('Some answers are blank. Hand it in anyway?')) return;
  const button = event.submitter;
  button.disabled = true;
  busy = true;
  try {
    const result = await api('POST', `/api/classes/${session.code}/group/exit`, { groupToken: session.token, body: { name: exitName, answers } });
    $('#exit-thanks-title').textContent = `Thanks, ${result.name}! 🌟`;
    // Clear their answers so the next person can't see them.
    $('#exit-problems').replaceChildren();
    $('#exit-name').value = '';
    exitStep = 'thanks';
    busy = false;
    render(result.state);
    confetti($('#exit-thanks-title'), 60);
  } catch (err) {
    $('#exit-error').hidden = false;
    $('#exit-error').textContent = err.message;
  } finally {
    busy = false;
    button.disabled = false;
  }
});

$('#exit-next').addEventListener('click', () => {
  exitStep = 'intro';
  renderExit();
  $('#exit-name').focus();
});

async function finishGroup() {
  if (!confirm('Has everyone in your group handed in their exit ticket?')) return;
  try {
    render(await api('POST', `/api/classes/${session.code}/group/exit-done`, { groupToken: session.token }));
  } catch (err) {
    handleError(err);
  }
}
$('#exit-finish').addEventListener('click', finishGroup);
$('#exit-all-done').addEventListener('click', finishGroup);

// ------------------------------------------------------------------ start

if (session) {
  // Back on the page with a saved group: pick up where it left off. A network
  // blip just shows a notice and keeps retrying; it doesn't forget the group.
  show('work');
  stopPolling = poll(refresh, 3000);
} else {
  showJoin();
}
