// The sign-up and log-in forms. The server talks to Supabase and sets the
// login cookie; this page only sends the form and follows the redirect.

import { $, api } from './common.js';

const form = $('#auth-form');
const params = new URLSearchParams(location.search);
const next = params.get('next') || '';

// Keep "where to go after logging in" when switching between the two pages.
if (next) {
  for (const link of document.querySelectorAll('a[data-keep-next]')) {
    link.href = `${link.getAttribute('href')}?next=${encodeURIComponent(next)}`;
  }
}

function note(text) {
  $('#auth-note').hidden = !text;
  $('#auth-note').textContent = text || '';
}

if (params.get('confirmed')) note('Your email is confirmed. Log in to continue.');
else if (next) note('Log in to open your classes.');

// In demo mode nobody needs an account, so skip straight to the app.
api('GET', '/api/health')
  .then((health) => {
    if (health.demo) location.replace(next.startsWith('/') && !next.startsWith('//') ? next : '/app');
  })
  .catch(() => {});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type=submit]');
  $('#auth-error').hidden = true;
  button.disabled = true;
  try {
    const result = await api('POST', form.dataset.endpoint, { body: { ...Object.fromEntries(new FormData(form)), next } });
    if (result.redirect) {
      location.assign(result.redirect);
      return;
    }
    note(result.message);
    form.querySelector('input[type=password]').value = '';
  } catch (err) {
    $('#auth-error').hidden = false;
    $('#auth-error').textContent = err.message;
  } finally {
    button.disabled = false;
  }
});
