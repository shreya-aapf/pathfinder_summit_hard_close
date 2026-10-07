import { api } from './api.js';
import { safeNext, saveSession } from './auth.js';
import { flashNext, param, showFlash } from './ui.js';
import { url } from './site.js';
import { wirePasswordToggle } from './password-toggle.js';

const flash = document.getElementById('flash');
const next = safeNext(param('next'));

wirePasswordToggle(
  document.getElementById('show-password'),
  [document.getElementById('password'), document.getElementById('confirm_password')],
);

if (param('next')) {
  document.getElementById('login-link').href = url(`login.html?next=${encodeURIComponent(param('next'))}`);
}

document.getElementById('register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('submit');
  flash.innerHTML = '';
  button.disabled = true;

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    await api('auth', '/register', {
      method: 'POST',
      auth: false,
      json: { username, password, confirm_password: document.getElementById('confirm_password').value },
    });
  } catch (e) {
    showFlash(flash, e.message, 'error');
    button.disabled = false;
    return;
  }

  // Sign the new user straight in so they land on the dashboard without typing their details again.
  try {
    saveSession(await api('auth', '/login', { method: 'POST', auth: false, json: { username, password } }));
    location.replace(next);
  } catch {
    flashNext('Account created. Sign in below.', 'success');
    location.href = url('login.html');
  }
});
