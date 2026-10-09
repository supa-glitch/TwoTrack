import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAnswer, readNumber } from '../src/answers.js';

const right = (given, ...key) => assert.equal(checkAnswer(given, key), true, `"${given}" should match ${JSON.stringify(key)}`);
const wrong = (given, ...key) => assert.equal(checkAnswer(given, key), false, `"${given}" should NOT match ${JSON.stringify(key)}`);

test('plain numbers and the ways students write them', () => {
  right('4', '4');
  right(' 4 ', '4');
  right('4.0', '4');
  right('-3', '-3');
  right('−3', '-3'); // unicode minus
  right('- 3', '-3');
  right('.5', '0.5');
  right('1/2', '0.5');
  right('0.5', '1/2');
  right('2/4', '1/2');
  right('1 1/2', '1.5');
  right('$12.50', '12.50');
  right('12.5', '$12.50');
  right('1,000', '1000');
  right('12 cm', '12');
  right('12', '12 cm');
  right('4.', '4');
  wrong('5', '4');
  wrong('-4', '4');
  wrong('40', '4');
  wrong('', '4');
  wrong('4 or 5', '4');
});

test('rounding is accepted only for fractions, to two or more places', () => {
  right('0.33', '1/3');
  right('0.333', '1/3');
  right('0.67', '2/3');
  wrong('0.66', '2/3');
  wrong('0.3', '1/3');
  wrong('2.57', '2.567'); // the teacher wrote the precision they want
});

test('x = 4 and 4 are the same answer', () => {
  right('x = 4', '4');
  right('4', 'x = 4');
  right('x=4', 'x = 4');
  right('X = 4', 'x = 4');
  right('4 = x', 'x = 4');
  right('x = 1/2', '0.5');
  wrong('y = 4', 'x = 4');
  wrong('x = 5', '4');
});

test('expressions match when only the order or notation differs', () => {
  right('3 + 2x', '2x + 3');
  right('2*x + 3', '2x + 3');
  right('-x + 3', '3 - x');
  right('x - 3', '-3 + x');
  right('(x+3)(x+2)', '(x + 2)(x + 3)');
  right('x²+5x+6', 'x^2 + 5x + 6');
  right('0.5x', 'x/2');
  right('3yx', '3xy');
  right('2√3', '2sqrt(3)');
  right('3x^2y', '3yx^2');
});

test('expressions that need work done still need the work', () => {
  wrong('x^2 + 5x + 6', '(x + 2)(x + 3)'); // factoring
  wrong('2(x + 3)', '2x + 6'); // distributing
  wrong('x + x', '2x');
  wrong('2x + 4', '2x + 3');
  wrong('2y + 3', '2x + 3');
  wrong('2', '2xy');
  wrong('3', '3 pi');
});

test('equations, in either order', () => {
  right('y = 2x + 3', 'y = 2x + 3');
  right('y = 3 + 2x', 'y = 2x + 3');
  right('2x + 3 = y', 'y = 2x + 3');
  right('2x + 3', 'y = 2x + 3');
  wrong('y = 2x - 3', 'y = 2x + 3');
});

test('inequalities', () => {
  right('x > 4', 'x > 4');
  right('4 < x', 'x > 4');
  right('x≥-2', 'x >= -2');
  right('x >= -2.0', 'x>=-2');
  wrong('x < 4', 'x > 4');
  wrong('x >= 4', 'x > 4');
  wrong('4', 'x > 4');
});

test('ordered pairs and systems', () => {
  right('(2, 3)', '(2,3)');
  right('x = 2, y = 3', '(2, 3)');
  right('(2, 3)', 'x=2, y=3');
  right('y = 3, x = 2', '(2, 3)');
  right('x = 2 and y = 3', '(2, 3)');
  right('(1/2, 3)', '(0.5, 3)');
  wrong('(3, 2)', '(2, 3)');
  wrong('2, 3', '(2, 3)');
});

test('lists of solutions in any order', () => {
  right('x = 2 or x = -3', 'x = -3, 2');
  right('-3, 2', '2, -3');
  right('x = 2, -3', '-3 or 2');
  right('{2, -3}', '2, -3');
  wrong('2, 3', '2, -3');
  wrong('2', '2, -3');
});

test('words compare as words', () => {
  right('No solution', 'no solution');
  right('no  solution.', 'no solution');
  right('none', 'no solution', 'none');
  wrong('on', 'no');
  wrong('solution no', 'no solution');
});

test('teacher alternatives', () => {
  right('7', '7', 'x = 7');
  right('seven', 'seven', '7');
  wrong('8', '7', 'x = 7');
});

test('readNumber', () => {
  assert.deepEqual(readNumber('3/4'), { value: 0.75, kind: 'fraction', places: 0 });
  assert.equal(readNumber('2x'), null);
  assert.equal(readNumber('abc'), null);
  assert.equal(readNumber('1/0'), null);
});
