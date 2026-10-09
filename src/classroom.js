// The state of one live class: the teacher's lesson, the groups working
// through it, and the exit tickets. Everything is kept in memory only and is
// deleted when the teacher clears the class or it expires.

import { randomBytes, randomInt } from 'node:crypto';
import { checkAnswer } from './answers.js';
import { cleanInterest } from './funmode.js';

// No 0/O, 1/I/L, 2/Z, 5/S or 8/B, so codes are easy to read off a smartboard.
const CODE_LETTERS = 'ACDEFGHJKMNPQRTUVWXY34679';
export const MAX_GROUP_NAME = 24;
export const MAX_STUDENT_NAME = 24;
export const DEFAULT_SETTINGS = { quietMinutes: 3, stuckTries: 3 };

const token = () => randomBytes(18).toString('base64url');

export function newClassCode(taken) {
  for (;;) {
    let code = '';
    for (let i = 0; i < 5; i++) code += CODE_LETTERS[randomInt(CODE_LETTERS.length)];
    if (!taken.has(code)) return code;
  }
}

export function normalizeCode(code) {
  return String(code ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const cleanName = (name, max) =>
  String(name ?? '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * @param {{ title: string, activities: object[], exitTicket: object[] }} lesson parsed by parseLesson
 * @param {{ groupCount: number, funModeAllowed: boolean }} options
 */
export function createClass(code, lesson, options, now) {
  return {
    code,
    teacherKey: token(),
    pin: String(randomInt(0, 1_000_000)).padStart(6, '0'),
    pinFailures: [],
    title: lesson.title || 'Today’s lesson',
    activities: lesson.activities,
    exitTicket: lesson.exitTicket,
    groupCount: Math.min(Math.max(Math.round(options.groupCount) || 6, 1), 16),
    funModeAllowed: options.funModeAllowed !== false,
    settings: { ...DEFAULT_SETTINGS },
    exitOpen: false,
    createdAt: now,
    lastActivityAt: now,
    nextGroupId: 1,
    groups: [],
    exitResults: [],
    funCache: new Map(),
  };
}

function totalProblems(cls) {
  return cls.activities.reduce((n, a) => n + a.problems.length, 0);
}

function newGroup(cls, name, now) {
  return {
    id: cls.nextGroupId++,
    token: token(),
    name,
    joinedAt: now,
    lastAnswerAt: null,
    lastSeenAt: now,
    ackAt: null,
    stage: cls.exitOpen ? 'exit' : 'activities',
    activityIndex: 0,
    problemIndex: 0,
    correct: 0,
    skipped: 0,
    triesOnProblem: 0,
    wrongStreak: 0,
    funMode: false,
    interest: '',
    funCalls: 0,
    lastResult: null,
  };
}

/**
 * Join with a group name. The same name rejoins the same group, so a
 * reloaded page or a swapped computer picks up where the group left off.
 */
export function joinGroup(cls, rawName, now) {
  const name = cleanName(rawName, MAX_GROUP_NAME);
  if (!name) throw new UserError('Type your group name.');
  let group = cls.groups.find((g) => sameName(g.name, name));
  if (!group) {
    group = newGroup(cls, name, now);
    cls.groups.push(group);
  }
  group.lastSeenAt = now;
  cls.lastActivityAt = now;
  return group;
}

export class UserError extends Error {}

function advance(cls, group) {
  group.problemIndex++;
  group.triesOnProblem = 0;
  group.wrongStreak = 0;
  const activity = cls.activities[group.activityIndex];
  if (group.problemIndex >= activity.problems.length) {
    group.activityIndex++;
    group.problemIndex = 0;
    if (group.activityIndex >= cls.activities.length) group.stage = 'exit';
    return 'activity-done';
  }
  return 'next';
}

export function currentProblem(cls, group) {
  if (group.stage !== 'activities') return null;
  return cls.activities[group.activityIndex]?.problems[group.problemIndex] ?? null;
}

/**
 * Check a group's answer to the problem they're on.
 * @returns {'correct' | 'wrong' | 'stale'}
 */
export function submitAnswer(cls, group, { activityIndex, problemIndex, answer }, now) {
  const problem = currentProblem(cls, group);
  // The page was showing an older problem (a double click, or the teacher
  // skipped it). Don't count it either way.
  if (!problem || activityIndex !== group.activityIndex || problemIndex !== group.problemIndex) return 'stale';
  const text = String(answer ?? '').slice(0, 200);
  if (!text.trim()) throw new UserError('Type an answer first.');

  group.lastAnswerAt = now;
  group.lastSeenAt = now;
  cls.lastActivityAt = now;

  if (checkAnswer(text, problem.answers)) {
    group.correct++;
    group.lastResult = { result: 'correct', at: now, step: advance(cls, group) };
    return 'correct';
  }
  group.triesOnProblem++;
  group.wrongStreak++;
  group.lastResult = { result: 'wrong', at: now };
  return 'wrong';
}

/** The teacher moves a stuck group on to the next problem. */
export function skipProblem(cls, group, now) {
  if (!currentProblem(cls, group)) return;
  group.skipped++;
  group.ackAt = now;
  group.lastResult = { result: 'skipped', at: now, step: advance(cls, group) };
  cls.lastActivityAt = now;
}

/** The teacher has checked on this group, so clear its flags for now. */
export function acknowledge(group, now) {
  group.ackAt = now;
  group.wrongStreak = 0;
}

export function openExitTicket(cls, now) {
  cls.exitOpen = true;
  for (const g of cls.groups) if (g.stage === 'activities') g.stage = 'exit';
  cls.lastActivityAt = now;
}

export function removeGroup(cls, groupId) {
  cls.groups = cls.groups.filter((g) => g.id !== groupId);
}

export function updateSettings(cls, { quietMinutes, stuckTries }) {
  const clamp = (v, lo, hi, fallback) => (Number.isFinite(Number(v)) ? Math.min(Math.max(Number(v), lo), hi) : fallback);
  cls.settings = {
    quietMinutes: clamp(quietMinutes, 1, 15, cls.settings.quietMinutes),
    stuckTries: Math.round(clamp(stuckTries, 2, 10, cls.settings.stuckTries)),
  };
}

export function setInterest(group, interest) {
  group.interest = cleanInterest(interest);
  if (!group.interest) group.funMode = false;
}

/** One student's exit ticket, typed on their group's computer. */
export function submitExitTicket(cls, group, { name, answers }, now) {
  if (group.stage === 'activities') throw new UserError('The exit ticket isn’t open yet.');
  const studentName = cleanName(name, MAX_STUDENT_NAME);
  if (!studentName) throw new UserError('Type your first name.');
  const given = cls.exitTicket.map((_, i) => String(answers?.[i] ?? '').slice(0, 200));
  const correct = cls.exitTicket.map((p, i) => checkAnswer(given[i], p.answers));
  const result = {
    name: studentName,
    groupId: group.id,
    groupName: group.name,
    answers: given,
    correct,
    score: correct.filter(Boolean).length,
    total: cls.exitTicket.length,
    at: now,
  };
  // Submitting again under the same name replaces the earlier ticket.
  cls.exitResults = cls.exitResults.filter((r) => !(r.groupId === group.id && sameName(r.name, studentName)));
  cls.exitResults.push(result);
  group.lastSeenAt = now;
  cls.lastActivityAt = now;
  return result;
}

export function finishExitTicket(group) {
  if (group.stage === 'exit') group.stage = 'done';
}

// ------------------------------------------------------------------ views

const seconds = (ms) => Math.max(0, Math.round(ms / 1000));

export function groupFlags(cls, group, now) {
  if (group.stage !== 'activities') return [];
  const flags = [];
  if (group.wrongStreak >= cls.settings.stuckTries) {
    const problem = currentProblem(cls, group);
    flags.push({ type: 'stuck', tries: group.triesOnProblem, problem: problem?.label ?? '' });
  }
  const lastMove = Math.max(group.lastAnswerAt ?? group.joinedAt, group.ackAt ?? 0);
  const quietFor = now - lastMove;
  if (quietFor >= cls.settings.quietMinutes * 60_000) flags.push({ type: 'quiet', seconds: seconds(quietFor) });
  return flags;
}

/** Everything the teacher's live board shows. */
export function boardView(cls, now) {
  const total = totalProblems(cls);
  const groups = cls.groups.map((g) => {
    const activity = cls.activities[Math.min(g.activityIndex, cls.activities.length - 1)];
    return {
      id: g.id,
      name: g.name,
      stage: g.stage,
      activityNumber: Math.min(g.activityIndex + 1, cls.activities.length),
      activityTitle: activity.title,
      problemNumber: g.stage === 'activities' ? g.problemIndex + 1 : null,
      problemCount: activity.problems.length,
      finished: g.correct + g.skipped,
      skipped: g.skipped,
      total,
      sinceLastAnswer: g.lastAnswerAt === null ? null : seconds(now - g.lastAnswerAt),
      sinceJoined: seconds(now - g.joinedAt),
      triesOnProblem: g.triesOnProblem,
      flags: groupFlags(cls, g, now),
      funMode: g.funMode,
      interest: g.interest,
      exitTickets: cls.exitResults.filter((r) => r.groupId === g.id).length,
    };
  });
  return {
    now,
    code: cls.code,
    pin: cls.pin,
    title: cls.title,
    groupCount: cls.groupCount,
    exitOpen: cls.exitOpen,
    settings: cls.settings,
    funModeAllowed: cls.funModeAllowed,
    activities: cls.activities.map((a) => ({ title: a.title, problemCount: a.problems.length })),
    totalProblems: total,
    groups,
    exitTicket: cls.exitTicket.map((p) => ({ label: p.label, text: p.text, answers: p.answers })),
    exitResults: cls.exitResults.map(({ name, groupName, answers, correct, score, total: outOf }) => ({
      name,
      groupName,
      answers,
      correct,
      score,
      total: outOf,
    })),
  };
}

/** What a group's screen shows. Never includes the answer key. */
export function groupView(cls, group, { funModeAvailable }) {
  const problem = currentProblem(cls, group);
  const activity = cls.activities[Math.min(group.activityIndex, cls.activities.length - 1)];
  return {
    code: cls.code,
    title: cls.title,
    groupName: group.name,
    stage: group.stage,
    activityIndex: group.activityIndex,
    problemIndex: group.problemIndex,
    activity: { title: activity.title, directions: activity.directions, problemCount: activity.problems.length },
    activities: cls.activities.map((a, i) => ({
      title: a.title,
      problemCount: a.problems.length,
      status: group.stage !== 'activities' || i < group.activityIndex ? 'done' : i === group.activityIndex ? 'current' : 'locked',
    })),
    problem: problem && { label: problem.label, text: problem.text },
    triesOnProblem: group.triesOnProblem,
    teacherFlagged: group.wrongStreak >= cls.settings.stuckTries,
    lastResult: group.lastResult,
    funMode: {
      available: funModeAvailable && cls.funModeAllowed,
      on: group.funMode,
      interest: group.interest,
    },
    exitTicket:
      group.stage === 'activities'
        ? null
        : {
            problems: cls.exitTicket.map((p) => ({ label: p.label, text: p.text })),
            submitted: cls.exitResults.filter((r) => r.groupId === group.id).map((r) => r.name),
          },
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  // Leading =, +, - or @ would run as a formula in a spreadsheet. Plain
  // numbers like -4 are safe and stay as they are.
  const safe = /^[=+\-@]/.test(text) && !/^[-+]?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Exit ticket results as a spreadsheet the teacher downloads. */
export function resultsCsv(cls) {
  const header = ['Name', 'Group', 'Score', 'Out of'];
  cls.exitTicket.forEach((p, i) => header.push(`Q${i + 1} answer`, `Q${i + 1} right?`));
  const rows = cls.exitResults.map((r) => {
    const row = [r.name, r.groupName, r.score, r.total];
    r.answers.forEach((a, i) => row.push(a, r.correct[i] ? 'yes' : 'no'));
    return row;
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
