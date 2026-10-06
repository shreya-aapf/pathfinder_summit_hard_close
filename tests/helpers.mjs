import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const BASE = process.env.FUNCTIONS_BASE || 'https://jmbwyttobedzszswarhd.supabase.co/functions/v1';
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const unique = (prefix = 'TEST') => `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 10)}`;

export async function call(fn, path, { method = 'GET', headers = {}, json, form, token, apiKey } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (apiKey) h['X-API-Key'] = apiKey;
  let body;
  if (json !== undefined) {
    h['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }
  const res = await fetch(`${BASE}/${fn}${path}`, { method, headers: h, body });
  const type = res.headers.get('content-type') || '';
  let data = null;
  if (type.includes('application/json')) data = await res.json();
  else if (res.status !== 204) data = Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, headers: res.headers };
}

const createdUsers = new Set();
export const trackUser = (username) => createdUsers.add(username);

let cachedToken;
export async function userToken() {
  if (cachedToken) return cachedToken;
  const username = `test_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const password = 'correct-horse-battery';
  trackUser(username);
  const reg = await call('auth', '/register', { method: 'POST', json: { username, password } });
  if (reg.status !== 201) throw new Error(`could not register test user: ${reg.status} ${JSON.stringify(reg.data)}`);
  const login = await call('auth', '/login', { method: 'POST', json: { username, password } });
  cachedToken = login.data.token;
  return cachedToken;
}

// app_users is closed to the anon key, so test accounts are removed with the Supabase CLI. Test files
// run in parallel processes, so each removes only the users it created, plus any left over from
// crashed runs (older than an hour).
export function purgeTestUsers() {
  const names = [...createdUsers].map((u) => `'${u.replace(/'/g, "''")}'`).join(',');
  const clauses = [`(username like 'test\\_%' and created_at < now() - interval '1 hour')`];
  if (names) clauses.push(`username in (${names})`);
  try {
    execFileSync('supabase', ['db', 'query', '--linked', `delete from app_users where ${clauses.join(' or ')}`], {
      cwd: REPO_ROOT, stdio: 'ignore', timeout: 60000,
    });
  } catch { /* best effort */ }
}

export const pdf = (name = 'doc.pdf', content = '%PDF-1.4\n% test\n') => {
  const form = new FormData();
  form.set('file', new Blob([content], { type: 'application/pdf' }), name);
  return form;
};
