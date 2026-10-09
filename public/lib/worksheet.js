// Turns a worksheet the teacher pasted as plain text into activities,
// problems and answers. The setup page runs it for the live preview and the
// server runs it again on the copy it keeps, so both always agree.
//
// The format it reads (see README for the full guide):
//
//   Lesson: Two-step equations
//   Activity 1: Warm-up
//   Directions: Solve each equation.
//   1. x + 5 = 12
//   Answer: 7
//   2. 3x = 21
//   Answer: x = 7 | 7
//   Exit ticket
//   1. 2x + 1 = 9
//   Answer: 4
//
// Answers can also come from an "Answer key" section with numbered lines.

const HEADING_WORDS = 'activity|part|section|station|task|round|level';
const HEADING_WITH_ID = new RegExp(
  `^(?:#{1,6}\\s*)?(?:${HEADING_WORDS})\\s+(\\d+|[a-z])\\b\\s*[:.)\\-–—]?\\s*(.*)$`,
  'i',
);
const HEADING_NO_ID = new RegExp(`^(?:#{1,6}\\s*)?(?:${HEADING_WORDS})\\s*(?:[:.\\-–—]\\s*(.*))?$`, 'i');
const MARKDOWN_HEADING = /^#{1,6}\s+(.+)$/;
const EXIT_HEADING = /^(?:#{1,6}\s*)?exit[\s-]*ticket\b\s*[:.\-–—]?\s*(.*)$/i;
const KEY_HEADING = /^(?:#{1,6}\s*)?(?:answer\s*key|answers|key)\s*[:.\-–—]?\s*$/i;
const TITLE_LINE = /^(?:lesson|title)\s*:\s*(.+)$/i;
const DIRECTIONS_LINE = /^(?:directions|instructions)\s*:\s*(.+)$/i;
const NUMBERED = /^(?:q(?:uestion)?\s*|problem\s*|#)?(\d{1,3})\s*(?:[.:]\s+|\)\s*)(.+)$/i;
const ANSWER_LINE = /^(?:(?:answer|ans)\s*[:=]|a\s*:)\s*(.+)$/i;
const INLINE_ANSWER = /\s*[([]?\b(?:answer|ans)\s*[:=]\s*(.+?)[)\]]?\s*$/i;
// Several numbered answers on one line: "1. 4   2. x = 7   3) -2"
const KEY_ITEM = /(?:^|\s)(\d{1,3})\s*[.)]\s+/g;

export function splitAnswers(text) {
  return String(text)
    .split('|')
    .map((a) => a.trim())
    .filter(Boolean);
}

function newSection(title, id) {
  return { title: title || '', id: id || '', directions: '', problems: [] };
}

function newProblem(label, text) {
  return { label, text: text.trim(), answers: [] };
}

function takeInlineAnswer(text) {
  const m = text.match(INLINE_ANSWER);
  if (!m || m.index === 0) return { text, answers: [] };
  return { text: text.slice(0, m.index).trim(), answers: splitAnswers(m[1]) };
}

function keyItems(line) {
  const marks = [...line.matchAll(KEY_ITEM)];
  if (!marks.length || line.slice(0, marks[0].index).trim()) return [];
  return marks
    .map((m, i) => {
      const start = m.index + m[0].length;
      const end = i + 1 < marks.length ? marks[i + 1].index : line.length;
      return { label: m[1], answer: line.slice(start, end).trim() };
    })
    .filter((item) => item.answer);
}

/**
 * Parse pasted worksheet text.
 * @param {string} text
 * @param {{ defaultSection?: 'activity' | 'exit' }} [options]
 *   'exit' treats problems before any heading as exit ticket problems
 *   (used for the separate exit ticket box on the setup page).
 * @returns {{ title: string, activities: object[], exitTicket: object[], issues: {level: string, message: string}[] }}
 */
export function parseWorksheet(text, options = {}) {
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const issues = [];
  const activities = [];
  const exit = newSection('Exit ticket');
  let title = '';

  let section = null; // the activity or exit section problems go into
  let problem = null; // the problem continuation lines and answers attach to
  let continuing = false; // false once a blank line or answer closes the problem
  let pending = []; // loose text lines, which become a problem or directions
  let keyMode = false;
  let keyTarget = null;

  const currentSection = () => {
    if (!section) {
      if (options.defaultSection === 'exit') section = exit;
      else {
        section = newSection('', '');
        activities.push(section);
      }
    }
    return section;
  };

  const flushPending = () => {
    if (!pending.length) return;
    const s = currentSection();
    s.directions = [s.directions, pending.join(' ')].filter(Boolean).join(' ');
    pending = [];
  };

  const startSection = (s) => {
    flushPending();
    section = s;
    problem = null;
    continuing = false;
  };

  const findSection = (id, heading) => {
    const all = [...activities, exit];
    return (
      all.find((s) => id && s.id && s.id.toLowerCase() === id.toLowerCase()) ||
      all.find((s) => heading && s.title && s.title.toLowerCase() === heading.toLowerCase()) ||
      null
    );
  };

  const applyKeyAnswer = (label, answerText) => {
    const answers = splitAnswers(answerText);
    if (!answers.length) return;
    const target = keyTarget || section;
    const pools = target ? [target, ...activities, exit] : [...activities, exit];
    for (const pool of pools) {
      const byLabel = pool.problems.find((p) => p.label === label && !p.answers.length);
      if (byLabel) {
        byLabel.answers = answers;
        return;
      }
    }
    const byPosition = target && target.problems[Number(label) - 1];
    if (byPosition && !byPosition.answers.length) {
      byPosition.answers = answers;
      return;
    }
    issues.push({ level: 'warning', message: `Answer key has #${label}, but no problem #${label} is waiting for an answer.` });
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) {
      continuing = false;
      continue;
    }

    let m;
    if (!title && !activities.length && !section && (m = line.match(TITLE_LINE))) {
      title = m[1].trim();
      continue;
    }

    if (KEY_HEADING.test(line)) {
      flushPending();
      keyMode = true;
      keyTarget = section;
      problem = null;
      continuing = false;
      continue;
    }

    if ((m = line.match(EXIT_HEADING))) {
      if (keyMode) {
        keyTarget = exit;
        continue;
      }
      startSection(exit);
      continue;
    }

    let headingWithId = line.match(HEADING_WITH_ID);
    // "Part A" is a heading, "Task a partner..." is not.
    if (headingWithId && /^[a-z]$/.test(headingWithId[1])) headingWithId = null;
    const headingNoId = !headingWithId && line.match(HEADING_NO_ID);
    const markdown = !headingWithId && !headingNoId && line.match(MARKDOWN_HEADING);
    if (headingWithId || headingNoId || markdown) {
      const id = headingWithId ? headingWithId[1] : '';
      let heading = (headingWithId ? headingWithId[2] : headingNoId ? headingNoId[1] : markdown[1]) || '';
      // A bare "Station 2" keeps its own name.
      if (!heading.trim() && headingWithId) heading = line.replace(/^#+\s*/, '').replace(/\s*[:.)\-–—]\s*$/, '');
      if (keyMode) {
        const existing = findSection(id, heading.trim());
        if (existing) {
          keyTarget = existing;
          continue;
        }
        keyMode = false;
        keyTarget = null;
      }
      const s = newSection(heading.trim(), id);
      activities.push(s);
      startSection(s);
      continue;
    }

    if (keyMode) {
      const items = keyItems(line);
      if (items.length) items.forEach((item) => applyKeyAnswer(item.label, item.answer));
      continue;
    }

    if ((m = line.match(DIRECTIONS_LINE))) {
      flushPending();
      const s = currentSection();
      s.directions = [s.directions, m[1].trim()].filter(Boolean).join(' ');
      continuing = false;
      continue;
    }

    if ((m = line.match(ANSWER_LINE))) {
      const answers = splitAnswers(m[1]);
      if (pending.length && problem && !problem.answers.length) {
        // A blank line split this problem's text; it's still the same problem.
        problem.text += '\n' + pending.join('\n');
        pending = [];
      } else if (pending.length) {
        // Loose text directly followed by an answer is an unnumbered problem.
        const s = currentSection();
        problem = newProblem(String(s.problems.length + 1), pending.join('\n'));
        s.problems.push(problem);
        pending = [];
      }
      if (problem) problem.answers.push(...answers.filter((a) => !problem.answers.includes(a)));
      else issues.push({ level: 'warning', message: `"${line}" isn't under a problem, so it was skipped.` });
      continuing = false;
      continue;
    }

    if ((m = line.match(NUMBERED))) {
      flushPending();
      const s = currentSection();
      const { text: problemText, answers } = takeInlineAnswer(m[2]);
      problem = newProblem(m[1], problemText);
      problem.answers = answers;
      s.problems.push(problem);
      continuing = !answers.length;
      continue;
    }

    if (problem && continuing) {
      const { text: more, answers } = takeInlineAnswer(line);
      if (more) problem.text += '\n' + more;
      if (answers.length) {
        problem.answers.push(...answers);
        continuing = false;
      }
      continue;
    }

    pending.push(line);
  }
  flushPending();

  // Name untitled activities and drop empty ones.
  const kept = [];
  activities.forEach((s) => {
    if (!s.problems.length) {
      if (s.title) issues.push({ level: 'warning', message: `"${s.title}" has no problems, so it was left out.` });
      return;
    }
    kept.push(s);
  });
  kept.forEach((s, i) => {
    if (!s.title) s.title = kept.length === 1 ? 'Worksheet' : `Activity ${i + 1}`;
  });

  const describe = (s, p) => `${s === exit ? 'Exit ticket' : s.title}, problem ${p.label}`;
  for (const s of [...kept, exit]) {
    for (const p of s.problems) {
      if (!p.text) issues.push({ level: 'error', message: `${describe(s, p)} has no question text.` });
      if (!p.answers.length) issues.push({ level: 'error', message: `${describe(s, p)} has no answer.` });
    }
  }

  const strip = (s) => ({
    title: s.title,
    directions: s.directions,
    problems: s.problems.map((p) => ({ label: p.label, text: p.text, answers: p.answers })),
  });

  return {
    title,
    activities: kept.map(strip),
    exitTicket: strip(exit).problems,
    issues,
  };
}

/**
 * Parse the worksheet box and the exit ticket box together, the way the
 * setup page sends them.
 */
export function parseLesson(worksheetText, exitTicketText) {
  const sheet = parseWorksheet(worksheetText);
  const exitBox = parseWorksheet(exitTicketText, { defaultSection: 'exit' });
  // Activities in the exit ticket box are treated as more exit ticket problems.
  const fromBoxActivities = exitBox.activities.flatMap((a) => a.problems);
  const exitTicket = [...sheet.exitTicket, ...exitBox.exitTicket, ...fromBoxActivities];
  const issues = [...sheet.issues, ...exitBox.issues.map((i) => ({ ...i, message: i.message.replace(/^Worksheet/, 'Exit ticket') }))];

  if (!sheet.activities.length) issues.push({ level: 'error', message: 'No worksheet problems found yet.' });
  if (!exitTicket.length) issues.push({ level: 'error', message: 'Add at least one exit ticket problem.' });

  return { title: sheet.title, activities: sheet.activities, exitTicket, issues };
}
