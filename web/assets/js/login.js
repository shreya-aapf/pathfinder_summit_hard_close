import { api } from './api.js';
import { getSession, safeNext, saveSession } from './auth.js';
import { consumeFlash, param, showFlash } from './ui.js';

const next = safeNext(param('next'));
if (getSession()) location.replace(next);

const flash = document.getElementById('flash');
const pending = consumeFlash();
if (pending) showFlash(flash, pending.message, pending.category);

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('submit');
  flash.innerHTML = '';
  button.disabled = true;
  try {
    const session = await api('auth', '/login', {
      method: 'POST',
      auth: false,
      json: {
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
      },
    });
    saveSession(session);
    location.replace(next);
  } catch (e) {
    showFlash(flash, e.message, 'error');
    button.disabled = false;
  }
});
