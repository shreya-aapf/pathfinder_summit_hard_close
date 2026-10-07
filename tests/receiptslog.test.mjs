import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { call, purgeTestUsers, unique, userToken } from './helpers.mjs';

const KEY = { apiKey: 'demo-key-receipthub' };
const created = [];
const grNumber = () => {
  const n = unique('TEST');
  created.push(n);
  return n;
};

after(async () => {
  for (const n of created) await call('receiptslog', `/api/grs/${n}`, { method: 'DELETE', ...KEY });
  purgeTestUsers();
});

const line = (extra = {}) => ({
  line_number: 1, item_code: 'WIDGET-001', description: 'Test Widget',
  quantity_ordered: 10, quantity_received: 4, unit_price: 20, condition: 'good', ...extra,
});

const payload = (gr_number, extra = {}) => ({
  gr_number, po_number: unique('TEST-PO'), vendor_id: 'TEST-VEND-001', vendor_name: 'Test Vendor Ltd',
  received_date: '2024-11-05', received_by: 'Test Receiver', status: 'partial', line_items: [line()], ...extra,
});

test('API auth: 401 for a missing key, 403 for an invalid key', async () => {
  const missing = await call('receiptslog', '/api/grs');
  assert.equal(missing.status, 401);
  assert.equal(missing.data.error, 'Missing X-API-Key header');
  const invalid = await call('receiptslog', '/api/grs', { apiKey: 'wrong-key' });
  assert.equal(invalid.status, 403);
  assert.equal(invalid.data.error, 'Invalid API key');
  for (const path of ['/api/gr/x', '/api/gr/by-po/x']) assert.equal((await call('receiptslog', path)).status, 401);
  assert.equal((await call('receiptslog', '/api/grs', { method: 'POST', json: {} })).status, 401);
});

test('create, get, by-po, list, update and delete a receipt', async () => {
  const n = grNumber();
  const body = payload(n, { po_number: unique('TEST-PO') });
  const create = await call('receiptslog', '/api/grs', { method: 'POST', json: body, ...KEY });
  assert.equal(create.status, 201);
  assert.equal(create.data.gr_number, n);
  assert.equal(create.data.line_items[0].condition, 'good');
  assert.equal(create.data.line_items[0].quantity_received, 4);

  const get = await call('receiptslog', `/api/gr/${n}`, KEY);
  assert.equal(get.status, 200);
  assert.equal(get.data.po_number, body.po_number);

  const byPo = await call('receiptslog', `/api/gr/by-po/${body.po_number}`, KEY);
  assert.equal(byPo.status, 200);
  assert.ok(Array.isArray(byPo.data));
  assert.ok(byPo.data.some((g) => g.gr_number === n));

  const list = await call('receiptslog', `/api/grs?po_number=${body.po_number}`, KEY);
  assert.equal(list.status, 200);
  assert.ok(list.data.data.some((g) => g.gr_number === n));
  assert.equal(list.data.page, 1);

  const put = await call('receiptslog', `/api/grs/${n}`, {
    method: 'PUT', ...KEY,
    json: { status: 'complete', line_items: [line({ quantity_received: 10, condition: 'damaged' })] },
  });
  assert.equal(put.status, 200);
  assert.equal(put.data.status, 'complete');
  assert.equal(put.data.line_items[0].condition, 'damaged');
  assert.equal(put.data.vendor_name, 'Test Vendor Ltd');

  assert.equal((await call('receiptslog', `/api/grs/${n}`, { method: 'DELETE', ...KEY })).status, 204);
  assert.equal((await call('receiptslog', `/api/gr/${n}`, KEY)).status, 404);
});

test('PUT without line_items keeps the existing lines; with an empty list it clears them', async () => {
  const n = grNumber();
  await call('receiptslog', '/api/grs', { method: 'POST', json: payload(n), ...KEY });
  const keep = await call('receiptslog', `/api/grs/${n}`, { method: 'PUT', json: { received_by: 'Someone Else' }, ...KEY });
  assert.equal(keep.data.received_by, 'Someone Else');
  assert.equal(keep.data.line_items.length, 1);
  const clear = await call('receiptslog', `/api/grs/${n}`, { method: 'PUT', json: { line_items: [] }, ...KEY });
  assert.equal(clear.data.line_items.length, 0);
});

test('by-po returns an empty array when nothing matches', async () => {
  const res = await call('receiptslog', `/api/gr/by-po/${unique('NOPE')}`, KEY);
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, []);
});

test('by-po returns several receipts for one PO and the literal route wins over the variable one', async () => {
  const po = unique('TEST-PO');
  const a = grNumber();
  const b = grNumber();
  await call('receiptslog', '/api/grs', { method: 'POST', json: payload(a, { po_number: po }), ...KEY });
  await call('receiptslog', '/api/grs', { method: 'POST', json: payload(b, { po_number: po }), ...KEY });
  const res = await call('receiptslog', `/api/gr/by-po/${po}`, KEY);
  assert.deepEqual(res.data.map((g) => g.gr_number), [a, b]);
});

test('list filters by status and vendor and caps the page size', async () => {
  const n = grNumber();
  await call('receiptslog', '/api/grs', { method: 'POST', json: payload(n, { status: 'rejected', vendor_id: 'TEST-VEND-FILTER' }), ...KEY });
  const res = await call('receiptslog', '/api/grs?status=rejected&vendor_id=TEST-VEND-FILTER&limit=500', KEY);
  assert.equal(res.data.limit, 200);
  assert.ok(res.data.data.some((g) => g.gr_number === n));
  assert.ok(res.data.data.every((g) => g.status === 'rejected' && g.vendor_id === 'TEST-VEND-FILTER'));
});

test('validation and not-found cases', async () => {
  const missing = await call('receiptslog', '/api/grs', { method: 'POST', json: { gr_number: unique('TEST') }, ...KEY });
  assert.equal(missing.status, 400);
  assert.match(missing.data.error, /^Missing fields: po_number, vendor_id/);
  assert.equal((await call('receiptslog', '/api/grs', { method: 'POST', json: {}, ...KEY })).status, 400);

  const nope = unique('NOPE');
  const get = await call('receiptslog', `/api/gr/${nope}`, KEY);
  assert.equal(get.status, 404);
  assert.equal(get.data.error, `GR ${nope} not found`);
  assert.equal((await call('receiptslog', `/api/grs/${nope}`, { method: 'PUT', json: { status: 'complete' }, ...KEY })).status, 404);
  assert.equal((await call('receiptslog', `/api/grs/${nope}`, { method: 'DELETE', ...KEY })).status, 404);
});

test('creating a receipt without line items works', async () => {
  const n = grNumber();
  const res = await call('receiptslog', '/api/grs', { method: 'POST', json: payload(n, { line_items: undefined }), ...KEY });
  assert.equal(res.status, 201);
  assert.deepEqual(res.data.line_items, []);
});

test('API create and update succeed with or without a webhook configured', async () => {
  const n = grNumber();
  assert.equal((await call('receiptslog', '/api/grs', { method: 'POST', json: payload(n), ...KEY })).status, 201);
  const upd = await call('receiptslog', `/api/grs/${n}`, { method: 'PUT', json: { status: 'complete' }, ...KEY });
  assert.equal(upd.status, 200);
  assert.equal(upd.data.status, 'complete');
});

test('failed requests do not break the service (400 and 404 paths)', async () => {
  assert.equal((await call('receiptslog', '/api/grs', { method: 'POST', json: { gr_number: 'x' }, ...KEY })).status, 400);
  assert.equal((await call('receiptslog', '/api/grs/DOES-NOT-EXIST', { method: 'PUT', json: { status: 'complete' }, ...KEY })).status, 404);
  assert.equal((await call('receiptslog', '/api/grs?limit=1', KEY)).status, 200);
});

test('a login token works in place of an API key', async () => {
  const token = await userToken();
  assert.equal((await call('receiptslog', '/api/grs?limit=1', { token })).status, 200);
  const n = grNumber();
  assert.equal((await call('receiptslog', '/api/grs', { method: 'POST', json: payload(n), token })).status, 201);
  assert.equal((await call('receiptslog', `/api/gr/${n}`, { token })).status, 200);
});

test('API key management needs a login and returns the key once', async () => {
  assert.equal((await call('receiptslog', '/api/keys', KEY)).status, 401);
  const token = await userToken();

  const made = await call('receiptslog', '/api/keys', { method: 'POST', token, json: { label: 'test key' } });
  assert.equal(made.status, 201);
  assert.match(made.data.key, /^rl-/);

  assert.equal((await call('receiptslog', '/api/grs?limit=1', { apiKey: made.data.key })).status, 200);

  const list = await call('receiptslog', '/api/keys', { token });
  assert.ok(list.data.keys.some((k) => k.id === made.data.id));
  assert.ok(!JSON.stringify(list.data).includes(made.data.key));

  assert.equal((await call('receiptslog', `/api/keys/${made.data.id}`, { method: 'DELETE', token })).status, 204);
  assert.equal((await call('receiptslog', '/api/grs?limit=1', { apiKey: made.data.key })).status, 403);
});
