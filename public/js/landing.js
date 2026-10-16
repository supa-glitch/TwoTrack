// The landing page: send students who arrive with a class code to the join
// page, and send the contact form.

import { $, api } from './common.js';

// Old links and the smartboard used to point students at /?code=...
const params = new URLSearchParams(location.search);
if (params.get('code')) location.replace(`/join${location.search}`);

const form = $('#contact');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type=submit]');
  const data = Object.fromEntries(new FormData(form));
  $('#contact-error').hidden = true;
  button.disabled = true;
  try {
    await api('POST', '/api/contact', { body: data });
    form.reset();
    $('#contact-sent').hidden = false;
  } catch (err) {
    $('#contact-error').hidden = false;
    $('#contact-error').textContent = err.message;
  } finally {
    button.disabled = false;
  }
});
