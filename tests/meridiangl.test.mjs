import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { call, purgeTestUsers, userToken } from './helpers.mjs';

const KEY = { apiKey: 'demo-key-meridiangl' };

after(purgeTestUsers);

// These tests assert against the known seed data in the shared project (read-only app).

test('API requires a key (401 Missing X-API-Key header)', async () => {
  const res = await call('meridiangl', '/api/gl/accounts');
  assert.equal(res.status, 401);
  assert.equal(res.data.error, 'Missing X-API-Key header');
});

test('API rejects a wrong key (401 Invalid API key)', async () => {
  const res = await call('meridiangl', '/api/gl/accounts', { apiKey: 'wrong-key' });
  assert.equal(res.status, 401);
  assert.equal(res.data.error, 'Invalid API key');
});

test('every API route is protected', async () => {
  for (const p of ['/api/gl/balances', '/api/gl/intercompany', '/api/gl/accruals', '/api/gl/balance-sheet']) {
    assert.equal((await call('meridiangl', p)).status, 401, p);
  }
});

test('a login token is accepted instead of a key', async () => {
  const token = await userToken();
  const res = await call('meridiangl', '/api/gl/accounts?subsidiary=A', { token });
  assert.equal(res.status, 200);
  assert.ok(res.data.length > 0);
  assert.equal((await call('meridiangl', '/api/gl/accounts', { token: 'bogus.token' })).status, 401);
});

test('list accounts filtered by subsidiary', async () => {
  const res = await call('meridiangl', '/api/gl/accounts?subsidiary=A', KEY);
  assert.equal(res.status, 200);
  const codes = new Set(res.data.map((a) => a.account_code));
  assert.ok(codes.has('1000') && codes.has('2000'));
  assert.ok(res.data.every((a) => a.subsidiary === 'A'));
});

test('subsidiary filter is case-insensitive and unfiltered list covers all subsidiaries', async () => {
  const lower = await call('meridiangl', '/api/gl/accounts?subsidiary=a', KEY);
  assert.ok(lower.data.length > 0 && lower.data.every((a) => a.subsidiary === 'A'));
  const all = await call('meridiangl', '/api/gl/accounts', KEY);
  assert.deepEqual([...new Set(all.data.map((a) => a.subsidiary))].sort().slice(0, 3), ['A', 'B', 'C']);
});

test('balances show variance with source document', async () => {
  const res = await call('meridiangl', '/api/gl/balances?subsidiary=A&period=2024-11', KEY);
  assert.equal(res.status, 200);
  const ap = res.data.find((b) => b.account_code === '2000');
  assert.equal(ap.status, 'variance');
  assert.equal(parseFloat(ap.variance_amount), 2470.0);
  assert.equal(ap.source_doc_ref, 'AP-SUBLEDGER-A-1124');
});

test('intercompany timing difference', async () => {
  const res = await call('meridiangl', '/api/gl/intercompany?flag_type=timing_difference', KEY);
  assert.equal(res.status, 200);
  const entry = res.data.find((e) => e.transaction_ref === 'IC-2024-0091');
  assert.ok(entry);
  assert.notEqual(entry.posted_date_from, entry.posted_date_to);
});

test('intercompany filtered by subsidiary', async () => {
  const res = await call('meridiangl', '/api/gl/intercompany?subsidiary=B', KEY);
  assert.equal(res.status, 200);
  assert.ok(res.data.every((e) => e.subsidiary_from === 'B' || e.subsidiary_to === 'B'));
  assert.ok(res.data.length >= 2);
});

test('accruals flagged over tolerance', async () => {
  const res = await call('meridiangl', '/api/gl/accruals?status=flagged', KEY);
  assert.equal(res.status, 200);
  const row = res.data.find((a) => a.subsidiary === 'A');
  assert.equal(parseFloat(row.variance_pct), 12.0);
  assert.equal(parseFloat(row.tolerance_pct), 10.0);
  assert.equal(row.blocked_by_open_ap, false);
});

test('accruals blocked by open AP', async () => {
  const res = await call('meridiangl', '/api/gl/accruals?status=blocked', KEY);
  assert.equal(res.status, 200);
  const row = res.data.find((a) => a.subsidiary === 'B');
  assert.equal(row.blocked_by_open_ap, true);
  assert.equal(row.ap_reference, 'AP-2024-2201');
});

test('accruals period filter (additive)', async () => {
  const res = await call('meridiangl', '/api/gl/accruals?period=2024-11', KEY);
  assert.equal(res.status, 200);
  assert.ok(res.data.length > 0 && res.data.every((a) => a.period === '2024-11'));
});

test('balance-sheet page model (additive) returns account with latest balance', async () => {
  const res = await call('meridiangl', '/api/gl/balance-sheet?subsidiary=A', KEY);
  assert.equal(res.status, 200);
  assert.equal(res.data.subsidiary, 'A');
  assert.ok(res.data.rows.every((r) => r.account.subsidiary === 'A'));
  const names = res.data.rows.map((r) => r.account.account_name);
  assert.ok(names.includes('Cash and Cash Equivalents'));
  const all = await call('meridiangl', '/api/gl/balance-sheet?subsidiary=bogus', KEY);
  assert.equal(all.data.subsidiary, 'all');
  assert.ok(all.data.rows.some((r) => r.account.account_name === 'Accounts Payable'));
});

test('unknown route returns 404', async () => {
  assert.equal((await call('meridiangl', '/api/gl/nope', KEY)).status, 404);
});
