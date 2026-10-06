import { api } from './api.js';
import { flashNext, showFlash } from './ui.js';

const flash = document.getElementById('flash');

document.getElementById('register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('submit');
  flash.innerHTML = '';
  button.disabled = true;
  try {
    await api('auth', '/register', {
      method: 'POST',
      auth: false,
      json: {
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
        confirm_password: document.getElementById('confirm_password').value,
      },
    });
    flashNext('Account created. Sign in below.', 'success');
    location.href = '/login.html';
  } catch (e) {
    showFlash(flash, e.message, 'error');
    button.disabled = false;
  }
});
