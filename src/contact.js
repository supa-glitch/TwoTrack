// The landing page's contact form. Messages go into a Supabase table
// (contact_messages, see README), read from the Supabase dashboard. No email
// address is published on the site.

import { createClient } from '@supabase/supabase-js';

export const CONTACT_LIMITS = { name: 100, email: 200, message: 4000 };
const WINDOW = 10 * 60_000;
const PER_WINDOW = 5;

export class ContactError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Check and tidy a submitted message. Returns null for a bot (honeypot filled). */
export function cleanContact(body) {
  if (String(body?.website ?? '').trim()) return null;
  const name = String(body?.name ?? '').trim();
  const email = String(body?.email ?? '').trim();
  const message = String(body?.message ?? '').trim();
  if (!name || !email || !message) throw new ContactError(400, 'Fill in your name, email and message.');
  if (!EMAIL.test(email)) throw new ContactError(400, 'That email address doesn’t look right.');
  if (name.length > CONTACT_LIMITS.name || email.length > CONTACT_LIMITS.email || message.length > CONTACT_LIMITS.message) {
    throw new ContactError(400, 'That message is too long.');
  }
  return { name, email, message };
}

/**
 * @param {{ url: string, key: string } | null} settings Supabase settings, or null if not set up
 */
export function createContactBox(settings, { now = () => Date.now() } = {}) {
  const client = settings ? createClient(settings.url, settings.key, { auth: { persistSession: false } }) : null;
  const recent = new Map(); // ip -> timestamps

  return async function send(body, ip) {
    const row = cleanContact(body);
    if (!row) return; // quietly drop bots
    const t = now();
    const times = (recent.get(ip) || []).filter((at) => t - at < WINDOW);
    if (times.length >= PER_WINDOW) throw new ContactError(429, 'You’ve sent a few messages already. Try again later.');
    if (!client) throw new ContactError(503, 'The contact form isn’t set up yet.');
    const { error } = await client.from('contact_messages').insert(row);
    if (error) throw new ContactError(503, 'Couldn’t send that right now. Try again later.');
    recent.set(ip, [...times, t]);
  };
}
