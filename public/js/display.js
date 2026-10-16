// Shown on the smartboard: where to go, the class code, and who has joined.
// Uses only public information, so there's nothing to hide if it's projected.

import { $, api, poll } from './common.js';

const code = location.hash.replace('#', '').toUpperCase();
$('#join-url').textContent = `${location.host}/join`;
$('#code').textContent = code || '—';

if (code) {
  poll(async () => {
    try {
      const info = await api('GET', `/api/classes/${code}/public`);
      $('#lesson-title').textContent = info.title;
      $('#joined').textContent = info.groups.length ? `Joined: ${info.groups.join(' · ')}` : 'Waiting for groups to join…';
      $('#error').hidden = true;
    } catch (err) {
      $('#error').hidden = false;
      $('#error').textContent = err.status === 404 ? 'This class has ended.' : err.message;
    }
  }, 3000);
}
