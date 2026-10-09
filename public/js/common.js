// Small helpers shared by every page.

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Call the TwoTrack API. Throws ApiError with a message people can read. */
export async function api(method, path, { body, teacherKey, groupToken } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (teacherKey) headers['x-teacher-key'] = teacherKey;
  if (groupToken) headers['x-group-token'] = groupToken;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Can’t reach TwoTrack. Check the internet connection.');
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || 'Something went wrong. Try again.');
  return data;
}

// Browser storage can be blocked or cleared, so every use is wrapped.
export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* not saved; the page still works */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export const $ = (selector, root = document) => root.querySelector(selector);

/** Build an element: el('p', { class: 'muted' }, 'text', child) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** "45s", "3m 05s", "1h 02m" */
export function duration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Repeat fn every ms, waiting for each run to finish first. */
export function poll(fn, ms) {
  let timer = null;
  let stopped = false;
  const run = async () => {
    try {
      await fn();
    } finally {
      if (!stopped) timer = setTimeout(run, ms);
    }
  };
  run();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
