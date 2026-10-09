// Teacher setup: paste the worksheet, check the preview, start the class.

import { $, api, el, store } from './common.js';
import { parseLesson } from '../lib/worksheet.js';
import { SAMPLE_WORKSHEET, SAMPLE_EXIT_TICKET } from '../lib/sample.js';

const DRAFT_KEY = 'twotrack.draft';
const fields = { title: $('#title'), worksheet: $('#worksheet'), exitTicket: $('#exit-ticket'), groups: $('#groups') };

// The draft stays in this browser so the lesson can be prepared ahead of time
// and restarted with one click if needed.
const draft = store.get(DRAFT_KEY, {});
fields.title.value = draft.title || '';
fields.worksheet.value = draft.worksheet || '';
fields.exitTicket.value = draft.exitTicket || '';
fields.groups.value = draft.groups || 6;

const lastClass = store.get('twotrack.teacher');
if (lastClass?.code) {
  $('#resume').hidden = false;
  $('#resume').replaceChildren(
    'Class ',
    el('strong', {}, lastClass.code),
    ' may still be running. ',
    el('a', { href: `/board#${lastClass.code}` }, 'Go back to its board'),
    ' or start a new one below.',
  );
}

api('GET', '/api/health')
  .then((health) => {
    $('#fun-allowed-row').hidden = !health.funMode;
    $('#fun-allowed').checked = draft.funAllowed !== false;
  })
  .catch(() => {});

function saveDraft() {
  store.set(DRAFT_KEY, {
    title: fields.title.value,
    worksheet: fields.worksheet.value,
    exitTicket: fields.exitTicket.value,
    groups: fields.groups.value,
    funAllowed: $('#fun-allowed').checked,
  });
}

function answerText(problem) {
  return problem.answers.length ? `→ ${problem.answers.join('  or  ')}` : '→ no answer yet';
}

function renderProblems(problems) {
  return el(
    'ol',
    {},
    problems.map((p) =>
      el('li', {}, p.text, ' ', el('span', { class: `preview-answer${p.answers.length ? '' : ' missing'}` }, answerText(p))),
    ),
  );
}

function renderPreview() {
  const lesson = parseLesson(fields.worksheet.value, fields.exitTicket.value);
  const hasText = fields.worksheet.value.trim() || fields.exitTicket.value.trim();

  const issues = $('#issues');
  const shown = hasText ? lesson.issues : [];
  issues.hidden = !shown.length;
  issues.replaceChildren(...shown.map((i) => el('li', { class: `${i.level}-item` }, i.message)));

  const preview = $('#preview');
  if (!hasText) {
    preview.replaceChildren(el('p', { class: 'muted' }, 'Paste your worksheet to see it here.'));
    return lesson;
  }
  const title = fields.title.value.trim() || lesson.title;
  preview.replaceChildren(
    title ? el('p', {}, el('strong', {}, title)) : '',
    ...lesson.activities.map((a, i) =>
      el(
        'div',
        { class: 'preview-activity' },
        el('h3', { class: 'm0' }, `${i + 1}. ${a.title}`, el('span', { class: 'hint' }, ` · ${a.problems.length} problems`)),
        a.directions ? el('p', { class: 'muted small m0' }, a.directions) : '',
        renderProblems(a.problems),
      ),
    ),
    lesson.exitTicket.length
      ? el('div', { class: 'preview-activity' }, el('h3', { class: 'm0' }, 'Exit ticket', el('span', { class: 'hint' }, ` · ${lesson.exitTicket.length} problems`)), renderProblems(lesson.exitTicket))
      : '',
  );
  return lesson;
}

for (const input of [fields.title, fields.worksheet, fields.exitTicket, fields.groups, $('#fun-allowed')]) {
  input.addEventListener('input', () => {
    saveDraft();
    renderPreview();
  });
}

$('#sample').addEventListener('click', () => {
  const hasWork = fields.worksheet.value.trim() || fields.exitTicket.value.trim();
  if (hasWork && !confirm('Replace what you’ve typed with the sample lesson?')) return;
  fields.title.value = '';
  fields.worksheet.value = SAMPLE_WORKSHEET;
  fields.exitTicket.value = SAMPLE_EXIT_TICKET;
  saveDraft();
  renderPreview();
});

$('#setup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const lesson = renderPreview();
  const errors = lesson.issues.filter((i) => i.level === 'error');
  const errorBox = $('#setup-error');
  if (errors.length) {
    errorBox.hidden = false;
    errorBox.textContent = 'Fix the problems in red on the right first.';
    return;
  }
  errorBox.hidden = true;
  const button = $('#start');
  button.disabled = true;
  try {
    const created = await api('POST', '/api/classes', {
      body: {
        title: fields.title.value.trim(),
        worksheet: fields.worksheet.value,
        exitTicket: fields.exitTicket.value,
        groupCount: Number(fields.groups.value) || 6,
        funModeAllowed: $('#fun-allowed').checked,
      },
    });
    store.set('twotrack.teacher', { code: created.code, teacherKey: created.teacherKey });
    location.href = `/board#${created.code}`;
  } catch (err) {
    errorBox.hidden = false;
    errorBox.textContent = err.message;
    button.disabled = false;
  }
});

renderPreview();
