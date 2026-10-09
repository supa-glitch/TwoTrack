import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorksheet, parseLesson } from '../public/lib/worksheet.js';
import { SAMPLE_WORKSHEET, SAMPLE_EXIT_TICKET } from '../public/lib/sample.js';

const errors = (result) => result.issues.filter((i) => i.level === 'error');

test('activities with inline answers', () => {
  const r = parseWorksheet(`Lesson: Two-step equations

Activity 1: Warm-up
Directions: Solve each equation.
1. x + 5 = 12
Answer: 7
2. 3x = 21
Answer: x = 7 | 7

Activity 2: Two-step
1) 2x + 3 = 11  (Answer: 4)
2) 5x - 2 = 13
A: 3`);
  assert.equal(r.title, 'Two-step equations');
  assert.equal(r.activities.length, 2);
  assert.deepEqual(r.activities[0], {
    title: 'Warm-up',
    directions: 'Solve each equation.',
    problems: [
      { label: '1', text: 'x + 5 = 12', answers: ['7'] },
      { label: '2', text: '3x = 21', answers: ['x = 7', '7'] },
    ],
  });
  assert.deepEqual(r.activities[1].problems, [
    { label: '1', text: '2x + 3 = 11', answers: ['4'] },
    { label: '2', text: '5x - 2 = 13', answers: ['3'] },
  ]);
  assert.deepEqual(errors(r), []);
});

test('word problems that run over several lines', () => {
  const r = parseWorksheet(`Activity 1
1. Maya has $20. She buys 3 notebooks
that cost the same amount and has $8 left.
How much was each notebook?
Answer: 4
2. Solve the system:

y = 2x + 1
y = -x + 4
Answer: (1, 3)`);
  const [p1, p2] = r.activities[0].problems;
  assert.equal(p1.text, 'Maya has $20. She buys 3 notebooks\nthat cost the same amount and has $8 left.\nHow much was each notebook?');
  assert.equal(p2.text, 'Solve the system:\ny = 2x + 1\ny = -x + 4');
  assert.deepEqual(p2.answers, ['(1, 3)']);
  assert.deepEqual(errors(r), []);
});

test('a separate answer key, per activity or at the end', () => {
  const r = parseWorksheet(`Activity 1: Warm-up
1. x + 1 = 2
2. x + 2 = 5

Activity 2: Practice
1. 2x = 8
2. 3x = 9

Answer key
Activity 1
1. 1   2. 3
Activity 2
1. 4
2) x = 3`);
  assert.deepEqual(
    r.activities.map((a) => a.problems.map((p) => p.answers[0])),
    [
      ['1', '3'],
      ['4', 'x = 3'],
    ],
  );
  assert.deepEqual(errors(r), []);
});

test('answer key right after its own activity', () => {
  const r = parseWorksheet(`Part A - Slopes
1. Slope through (0,0) and (2,4)?
Answers:
1. 2
Part B - Intercepts
1. y-intercept of y = 3x + 5?
Answer key
1. 5`);
  assert.equal(r.activities.length, 2);
  assert.equal(r.activities[0].title, 'Slopes');
  assert.deepEqual(r.activities[0].problems[0].answers, ['2']);
  assert.equal(r.activities[1].title, 'Intercepts');
  assert.deepEqual(r.activities[1].problems[0].answers, ['5']);
});

test('an exit ticket section inside the worksheet box', () => {
  const r = parseWorksheet(`1. x + 2 = 3
Answer: 1
Exit Ticket
1. 4x = 12
Answer: 3`);
  assert.equal(r.activities.length, 1);
  assert.equal(r.activities[0].title, 'Worksheet');
  assert.deepEqual(r.exitTicket, [{ label: '1', text: '4x = 12', answers: ['3'] }]);
});

test('missing answers are errors the teacher sees', () => {
  const r = parseWorksheet(`Activity 1: Warm-up
1. x + 1 = 2
2. x + 2 = 5
Answer: 3`);
  assert.deepEqual(errors(r).map((e) => e.message), ['Warm-up, problem 1 has no answer.']);
});

test('lines that look like headings but are not', () => {
  const r = parseWorksheet(`Activity 1: Pairs
1. Task a partner with checking your work. What is 2 + 2?
Answer: 4
2. Evaluate 2a + b when
a = 3 and b = 4
Answer: 10`);
  assert.equal(r.activities.length, 1);
  assert.equal(r.activities[0].problems[1].text, 'Evaluate 2a + b when\na = 3 and b = 4');
  assert.deepEqual(r.activities[0].problems[1].answers, ['10']);
});

test('header junk at the top is ignored', () => {
  const r = parseWorksheet(`Name: ____________  Date: _______  Period: ___

Activity 1: Warm-up
1. x - 1 = 4
Answer: 5`);
  assert.equal(r.activities.length, 1);
  assert.equal(r.activities[0].title, 'Warm-up');
});

test('unnumbered problems, each followed by its answer', () => {
  const r = parseWorksheet(`Solve x + 4 = 10
Answer: 6
Solve 2x = 14
Answer: 7`);
  assert.deepEqual(
    r.activities[0].problems.map((p) => [p.text, p.answers[0]]),
    [
      ['Solve x + 4 = 10', '6'],
      ['Solve 2x = 14', '7'],
    ],
  );
});

test('parseLesson combines both boxes and requires an exit ticket', () => {
  const ok = parseLesson('1. x + 1 = 3\nAnswer: 2', '1. 2x = 6\nAnswer: 3');
  assert.equal(ok.exitTicket.length, 1);
  assert.deepEqual(errors(ok), []);

  const noExit = parseLesson('1. x + 1 = 3\nAnswer: 2', '');
  assert.deepEqual(errors(noExit).map((e) => e.message), ['Add at least one exit ticket problem.']);

  const empty = parseLesson('', '');
  assert.equal(errors(empty).length, 2);
});

test('the built-in sample lesson parses cleanly', () => {
  const r = parseLesson(SAMPLE_WORKSHEET, SAMPLE_EXIT_TICKET);
  assert.deepEqual(r.issues, []);
  assert.equal(r.activities.length, 3);
  assert.equal(r.exitTicket.length, 3);
});

test('Markdown headings, bare headings and Q-numbering', () => {
  const r = parseWorksheet('## Warm-up\nQ1: x + 1 = 2\nAns: 1\n## Station 2\nQ1) 2x = 4\nAnswer = 2');
  assert.deepEqual(
    r.activities.map((a) => [a.title, a.problems.map((p) => [p.text, p.answers[0]])]),
    [
      ['Warm-up', [['x + 1 = 2', '1']]],
      ['Station 2', [['2x = 4', '2']]],
    ],
  );
});
