import { db } from '../_shared/db.ts';
import { err, json, readJson } from '../_shared/http.ts';
import { Router } from '../_shared/router.ts';
import { requireUser, signToken } from '../_shared/auth.ts';

const REGISTER_ERRORS: Record<string, string> = {
  invalid_username: 'Usernames are 3-32 characters: letters, numbers, dot, dash or underscore.',
  invalid_password: 'Passwords must be at least 8 characters and no more than 72 bytes.',
  username_taken: 'That username is already taken.',
};

const router = new Router();

router.post('/register', async ({ req }) => {
  const body = (await readJson(req)) ?? {};
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  if (body.confirm_password !== undefined && body.confirm_password !== password) {
    return err('The two passwords do not match.', 400);
  }
  const { data, error } = await db.rpc('register_app_user', { p_username: username, p_password: password });
  if (error) return err('Registration is unavailable right now. Please try again shortly.', 503);
  if (data !== 'ok') return err(REGISTER_ERRORS[data as string] ?? 'Could not create the account.', 400);
  return json({ ok: true }, 201);
});

router.post('/login', async ({ req }) => {
  const body = (await readJson(req)) ?? {};
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  const { data, error } = await db.rpc('verify_app_user', { p_username: username, p_password: password });
  if (error) return err('Sign-in is unavailable right now. Please try again shortly.', 503);
  if (data === 'locked') return err('Too many failed attempts. Try again in 5 minutes.', 429);
  if (data !== 'ok') return err('Incorrect username or password.', 401);
  const { token, expires_at } = await signToken(username);
  return json({ token, expires_at, username });
});

// Swaps a still-valid token for a new one with a full lifetime.
router.post('/refresh', async ({ req }) => {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const { token, expires_at } = await signToken(auth.user);
  return json({ token, expires_at, username: auth.user });
});

router.get('/me', async ({ req }) => {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  return json({ username: auth.user });
});

Deno.serve((req) => router.handle(req, 'auth'));
