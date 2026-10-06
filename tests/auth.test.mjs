import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { call, purgeTestUsers, trackUser } from './helpers.mjs';

after(purgeTestUsers);

const PASSWORD = 'correct-horse-battery';
const name = () => {
  const n = `test_${Math.random().toString(36).slice(2, 12)}`;
  trackUser(n);
  return n;
};

test('register, login and /me round trip', async () => {
  const username = name();
  const reg = await call('auth', '/register', { method: 'POST', json: { username, password: PASSWORD, confirm_password: PASSWORD } });
  assert.equal(reg.status, 201);

  const login = await call('auth', '/login', { method: 'POST', json: { username, password: PASSWORD } });
  assert.equal(login.status, 200);
  assert.ok(login.data.token.includes('.'));

  const me = await call('auth', '/me', { token: login.data.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.username, username);
});

test('duplicate usernames are rejected case-insensitively', async () => {
  const username = name();
  await call('auth', '/register', { method: 'POST', json: { username, password: PASSWORD } });
  const again = await call('auth', '/register', { method: 'POST', json: { username: username.toUpperCase(), password: PASSWORD } });
  assert.equal(again.status, 400);
  assert.match(again.data.error, /already taken/);
});

test('registration validates input', async () => {
  const bad = await call('auth', '/register', { method: 'POST', json: { username: 'a b', password: PASSWORD } });
  assert.match(bad.data.error, /Usernames are/);
  const short = await call('auth', '/register', { method: 'POST', json: { username: name(), password: 'short' } });
  assert.match(short.data.error, /Passwords must be/);
  const mismatch = await call('auth', '/register', { method: 'POST', json: { username: name(), password: PASSWORD, confirm_password: 'different-password' } });
  assert.equal(mismatch.status, 400);
});

test('wrong password and unknown user give the same 401', async () => {
  const username = name();
  await call('auth', '/register', { method: 'POST', json: { username, password: PASSWORD } });
  const wrong = await call('auth', '/login', { method: 'POST', json: { username, password: 'not-the-password' } });
  const unknown = await call('auth', '/login', { method: 'POST', json: { username: name(), password: PASSWORD } });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.data.error, unknown.data.error);
});

test('five failures lock the account', async () => {
  const username = name();
  await call('auth', '/register', { method: 'POST', json: { username, password: PASSWORD } });
  for (let i = 0; i < 5; i++) {
    const r = await call('auth', '/login', { method: 'POST', json: { username, password: 'wrong-wrong' } });
    assert.equal(r.status, 401);
  }
  const locked = await call('auth', '/login', { method: 'POST', json: { username, password: PASSWORD } });
  assert.equal(locked.status, 429);
});

test('/me rejects missing and tampered tokens', async () => {
  assert.equal((await call('auth', '/me')).status, 401);
  assert.equal((await call('auth', '/me', { token: 'abc.def' })).status, 401);
});

test('CORS preflight, 404 and 405', async () => {
  const pre = await call('auth', '/login', { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.equal((await call('auth', '/nope')).status, 404);
  assert.equal((await call('auth', '/login')).status, 405);
});
