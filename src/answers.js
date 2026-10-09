// Checks a group's typed answer against the teacher's answer key.
//
// The key is the only source of truth: an answer is right when it says the
// same thing as one of the teacher's accepted answers, allowing for the ways
// students write the same answer differently ("x = 4" vs "4", "1/2" vs "0.5",
// "3 + 2x" vs "2x + 3", "(2, 3)" vs "x=2, y=3"). It never tries to solve the
// problem itself, and it doesn't treat "x^2 + 5x + 6" as the same as
// "(x + 2)(x + 3)", so factoring and simplifying problems still mean something.

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)$/;
const FRACTION = /^([-+]?\d+(?:\.\d+)?)\/([-+]?\d+(?:\.\d+)?)$/;
const MIXED = /^([-+]?)(\d+)\s+(\d+)\/(\d+)$/;
const THOUSANDS = /^([-+]?\d{1,3}(?:,\d{3})+)(\.\d+)?$/;
// "12 cm", "4 dollars". Needs the space so "2xy" stays an expression.
const UNIT_SUFFIX = /^(.*\d)\s+([a-z]{2,}(?:\s+[a-z]{2,})*)$/;
const VAR_PREFIX = /^([a-z])=(?!=)(.+)$/;
const VAR_SUFFIX = /^(.+?)=([a-z])$/;
const INEQUALITY = /^(.+?)(<=|>=|!=|<|>)(.+)$/;
const FLIP = { '<': '>', '>': '<', '<=': '>=', '>=': '<=', '!=': '!=' };

/** Tidy the symbols students and teachers type differently. Keeps spaces. */
export function tidy(text) {
  return String(text ?? '')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[−–—‐]/g, '-')
    .replace(/[×·∙✕]/g, '*')
    .replace(/÷/g, '/')
    .replace(/≤|=</g, '<=')
    .replace(/≥|=>/g, '>=')
    .replace(/≠/g, '!=')
    .replace(/√/g, 'sqrt')
    .replace(/π/g, 'pi')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '')
    .trim();
}

const squash = (s) => s.replace(/\s+/g, '');

// ---------------------------------------------------------------- numbers

/**
 * Read a plain number: 4, -2.5, .5, 3/4, 1 1/2, $12.50, 1,000, 12 cm.
 * @returns {{ value: number, kind: 'number' | 'decimal' | 'fraction', places: number } | null}
 */
export function readNumber(text) {
  let s = tidy(text).replace(/^\$\s*/, '').replace(/^([-+])\s*\$/, '$1').replace(/%$/, '').trim();
  const unit = s.match(UNIT_SUFFIX);
  if (unit && !/^(?:pi|sqrt)\b/.test(unit[2])) s = unit[1].trim();
  const thousands = s.match(THOUSANDS);
  if (thousands) s = thousands[1].replace(/,/g, '') + (thousands[2] || '');

  let m;
  if ((m = s.match(MIXED))) {
    const value = Number(m[2]) + Number(m[3]) / Number(m[4]);
    if (!Number(m[4])) return null;
    return { value: m[1] === '-' ? -value : value, kind: 'fraction', places: 0 };
  }
  s = squash(s);
  if ((m = s.match(FRACTION))) {
    const bottom = Number(m[2]);
    if (!bottom) return null;
    return { value: Number(m[1]) / bottom, kind: 'fraction', places: 0 };
  }
  if (NUMBER.test(s)) {
    const places = s.includes('.') ? s.split('.')[1].length : 0;
    return { value: Number(s), kind: places ? 'decimal' : 'number', places };
  }
  return null;
}

const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

function numbersMatch(given, key) {
  if (close(given.value, key.value)) return true;
  // The key says 1/3 and the student rounded to 0.33: right, as long as they
  // kept at least two decimal places and rounded correctly.
  if (key.kind === 'fraction' && given.kind === 'decimal' && given.places >= 2) {
    return Math.abs(given.value - key.value) <= 0.5 * 10 ** -given.places + 1e-12;
  }
  return false;
}

// ------------------------------------------------------------ expressions

function tokenize(s) {
  // Three or more letters in a row is a word ("none"), not x times y times z.
  if (/[a-z]{3,}/.test(s.replace(/sqrt|pi/g, ' '))) return null;
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') {
      i++;
      continue;
    }
    const num = s.slice(i).match(/^(?:\d+\.?\d*|\.\d+)/);
    if (num) {
      tokens.push({ type: 'num', value: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    if (s.startsWith('sqrt', i)) {
      tokens.push({ type: 'fn', name: 'sqrt' });
      i += 4;
      continue;
    }
    if (s.startsWith('pi', i)) {
      tokens.push({ type: 'var', name: 'pi' });
      i += 2;
      continue;
    }
    if (/[a-z]/.test(c)) {
      tokens.push({ type: 'var', name: c });
      i++;
      continue;
    }
    if ('+-*/^()'.includes(c)) {
      tokens.push({ type: c });
      i++;
      continue;
    }
    return null;
  }
  return tokens;
}

const num = (value) => ({ t: 'num', value });

/** Parse an algebraic expression into a tree, or return null. */
export function parseExpression(text) {
  const tokens = tokenize(text);
  if (!tokens || !tokens.length) return null;
  let pos = 0;
  const peek = () => tokens[pos];
  const startsOperand = (tok) => tok && ['num', 'var', 'fn', '('].includes(tok.type);

  function expr() {
    let terms = [term()];
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = tokens[pos++].type;
      const right = term();
      terms.push(op === '-' ? { t: 'mul', items: [num(-1), right] } : right);
    }
    return terms.length === 1 ? terms[0] : { t: 'add', items: terms };
  }

  function term() {
    let factors = [unary()];
    for (;;) {
      const tok = peek();
      if (tok && tok.type === '*') {
        pos++;
        factors.push(unary());
      } else if (tok && tok.type === '/') {
        pos++;
        factors.push({ t: 'pow', base: unary(), exp: num(-1) });
      } else if (startsOperand(tok)) {
        factors.push(power()); // implicit: 2x, 3(x + 1), (x + 1)(x - 1)
      } else break;
    }
    return factors.length === 1 ? factors[0] : { t: 'mul', items: factors };
  }

  function unary() {
    const tok = peek();
    if (tok && tok.type === '-') {
      pos++;
      return { t: 'mul', items: [num(-1), unary()] };
    }
    if (tok && tok.type === '+') {
      pos++;
      return unary();
    }
    return power();
  }

  function power() {
    const base = atom();
    if (peek() && peek().type === '^') {
      pos++;
      return { t: 'pow', base, exp: unary() };
    }
    return base;
  }

  function atom() {
    const tok = tokens[pos++];
    if (!tok) throw new Error('end');
    if (tok.type === 'num') return num(tok.value);
    if (tok.type === 'var') return { t: 'var', name: tok.name };
    if (tok.type === 'fn') return { t: 'fn', name: tok.name, arg: peek() && peek().type === '(' ? atom() : power() };
    if (tok.type === '(') {
      const inside = expr();
      if (!peek() || peek().type !== ')') throw new Error('paren');
      pos++;
      return inside;
    }
    throw new Error('unexpected');
  }

  try {
    const tree = expr();
    return pos === tokens.length ? tree : null;
  } catch {
    return null;
  }
}

const fmt = (n) => String(Number(n.toPrecision(12)));

/**
 * Write a tree in one standard form: terms and factors sorted, numbers in a
 * product multiplied together, "a - b" as "a + (-1)b". Sums are not
 * collected, so "x + x" and "2x" stay different.
 */
export function canonical(node) {
  return key(normalize(node));
}

function normalize(node) {
  switch (node.t) {
    case 'num':
    case 'var':
      return node;
    case 'fn':
      return { t: 'fn', name: node.name, arg: normalize(node.arg) };
    case 'pow': {
      const base = normalize(node.base);
      const exp = normalize(node.exp);
      if (base.t === 'num' && exp.t === 'num') {
        const value = base.value ** exp.value;
        if (Number.isFinite(value)) return num(value);
      }
      if (exp.t === 'num' && exp.value === 1) return base;
      return { t: 'pow', base, exp };
    }
    case 'add': {
      const items = [];
      for (const item of node.items.map(normalize)) {
        if (item.t === 'add') items.push(...item.items);
        else items.push(item);
      }
      const nonZero = items.filter((i) => !(i.t === 'num' && i.value === 0));
      if (!nonZero.length) return num(0);
      if (nonZero.length === 1) return nonZero[0];
      return { t: 'add', items: nonZero.sort(byKey) };
    }
    case 'mul': {
      let coefficient = 1;
      const others = [];
      const take = (item) => {
        if (item.t === 'mul') item.items.forEach(take);
        else if (item.t === 'num') coefficient *= item.value;
        else others.push(item);
      };
      node.items.map(normalize).forEach(take);
      if (coefficient === 0) return num(0);
      if (!others.length) return num(coefficient);
      if (coefficient === 1 && others.length === 1) return others[0];
      const items = others.sort(byKey);
      return { t: 'mul', items: coefficient === 1 ? items : [num(coefficient), ...items] };
    }
    default:
      throw new Error(`unknown node ${node.t}`);
  }
}

function key(node) {
  switch (node.t) {
    case 'num':
      return fmt(node.value);
    case 'var':
      return node.name;
    case 'fn':
      return `${node.name}(${key(node.arg)})`;
    case 'pow':
      return `(${key(node.base)})^(${key(node.exp)})`;
    case 'add':
      return `+[${node.items.map(key).join(',')}]`;
    case 'mul':
      return `*[${node.items.map(key).join(',')}]`;
  }
}

const byKey = (a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

// Only letters ("no", "none", "all real numbers") is a word answer, compared
// as text. With a digit, operator or bracket ("3xy") it's an expression.
const isWords = (s) => /^[a-z ]+$/.test(s) && squash(s).length > 1;

function expressionsMatch(given, answer) {
  if (isWords(given) || isWords(answer)) return false;
  const a = parseExpression(given);
  const b = parseExpression(answer);
  return Boolean(a && b) && canonical(a) === canonical(b);
}

// ------------------------------------------------------------ comparisons

/** One value: a number or an expression. */
function valuesMatch(given, answer) {
  if (squash(given) === squash(answer)) return true;
  const g = readNumber(given);
  const k = readNumber(answer);
  if (k) return Boolean(g) && numbersMatch(g, k);
  if (g) return false;
  return expressionsMatch(given, answer);
}

/** "x = 4" or "4 = x" -> { name: 'x', rest: '4' } */
function stripVar(s) {
  const flat = squash(s);
  const m = flat.match(VAR_PREFIX);
  if (m && !m[2].includes('=')) return { name: m[1], rest: m[2] };
  const r = flat.match(VAR_SUFFIX);
  if (r && !r[1].includes('=') && !/^[a-z]$/.test(r[1])) return { name: r[2], rest: r[1] };
  return null;
}

/**
 * Split "x = 2, y = 3", "(2, 3)", "2 or -3", "{-3, 2}" into parts.
 * @returns {{ ordered: boolean, items: string[] } | null}
 */
function readList(s) {
  let text = s.replace(/\s+(?:or|and)\s+/g, ',').replace(/^\{(.*)\}$/, '$1');
  let ordered = false;
  const paren = text.match(/^\((.*)\)$/);
  if (paren && paren[1].includes(',')) {
    text = paren[1];
    ordered = true;
  }
  if (!text.includes(',')) return null;
  const parts = text.split(',').map((p) => p.trim());
  if (parts.some((p) => !p)) return null;

  // "x = 2, y = 3" is the ordered pair (2, 3); "x = 2, x = -3" is a list.
  const named = parts.map(stripVar);
  if (named.every(Boolean)) {
    const names = named.map((n) => n.name);
    if (new Set(names).size === names.length && names.length > 1) {
      const sorted = [...named].sort((a, b) => (a.name < b.name ? -1 : 1));
      return { ordered: true, items: sorted.map((n) => n.rest) };
    }
    return { ordered: false, items: named.map((n) => n.rest) };
  }
  // "x = 2, -3": the variable is only written once.
  if (named[0] && named.slice(1).every((n) => !n)) {
    return { ordered: false, items: [named[0].rest, ...parts.slice(1)] };
  }
  return { ordered, items: parts };
}

function listsMatch(given, answer) {
  if (given.items.length !== answer.items.length) return false;
  if (answer.ordered || given.ordered) {
    if (answer.ordered !== given.ordered) return false;
    return answer.items.every((item, i) => valuesMatch(given.items[i], item));
  }
  // Unordered, e.g. the two solutions of a quadratic.
  const left = [...given.items];
  return answer.items.every((item) => {
    const i = left.findIndex((g) => valuesMatch(g, item));
    if (i === -1) return false;
    left.splice(i, 1);
    return true;
  });
}

function readInequality(s) {
  const m = squash(s).match(INEQUALITY);
  if (!m || m[3].includes('<') || m[3].includes('>')) return null;
  let [, left, op, right] = m;
  // "4 < x" is the same as "x > 4".
  if (!/^[a-z]$/.test(left) && /^[a-z]$/.test(right)) [left, op, right] = [right, FLIP[op], left];
  if (!/^[a-z]$/.test(left)) return null;
  return { name: left, op, value: right };
}

function matchesOne(given, answer) {
  if (!given || !answer) return false;
  if (squash(given) === squash(answer)) return true;

  const gn = readNumber(given);
  const an = readNumber(answer);
  if (gn && an) return numbersMatch(gn, an);

  const gi = readInequality(given);
  const ai = readInequality(answer);
  if (gi || ai) return Boolean(gi && ai) && gi.name === ai.name && gi.op === ai.op && valuesMatch(gi.value, ai.value);

  const gl = readList(given);
  const al = readList(answer);
  if (gl || al) return Boolean(gl && al) && listsMatch(gl, al);

  // "x = 4" and "4" are the same answer, unless they name different variables.
  const gv = stripVar(given);
  const av = stripVar(answer);
  if (gv && av && gv.name !== av.name) return false;
  const g = gv ? gv.rest : given;
  const a = av ? av.rest : answer;

  const gEq = g.split('=');
  const aEq = a.split('=');
  if (gEq.length === 2 && aEq.length === 2) {
    // An equation like "y = 2x + 3": same sides, in either order.
    return (
      (valuesMatch(gEq[0], aEq[0]) && valuesMatch(gEq[1], aEq[1])) ||
      (valuesMatch(gEq[0], aEq[1]) && valuesMatch(gEq[1], aEq[0]))
    );
  }
  if (gEq.length !== aEq.length) return false;
  return valuesMatch(g, a);
}

/**
 * @param {string} given what the group typed
 * @param {string[]} accepted the teacher's accepted answers for this problem
 */
export function checkAnswer(given, accepted) {
  const g = tidy(given);
  if (!g) return false;
  return accepted.some((answer) => matchesOne(g, tidy(answer)));
}
