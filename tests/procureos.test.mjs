import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { call, pdf, purgeTestUsers, unique, userToken } from './helpers.mjs';

const KEY = { apiKey: 'demo-key-procureos' };
const created = [];
const poNumber = () => {
  const n = unique('TEST-PO');
  created.push(n);
  return n;
};

after(async () => {
  for (const n of created) await call('procureos', `/api/pos/${n}`, { method: 'DELETE', ...KEY });
  purgeTestUsers();
});

const JUSTIFICATION = {
  purchase_what: 'Annual licence for a log analytics tool',
  purchase_why: 'Incident reviews currently take two days',
  no_purchase_impact: 'On-call keeps grepping raw logs',
  criticality: 'keep_the_lights_on',
  alternative_tool: 'Existing APM covers about 70% of this',
  roi_benefit: 'Saves roughly 20 engineer hours a month',
  okr_alignment: 'Reduce MTTR by 30%',
};

const payload = (po_number, extra = {}) => ({
  po_number, vendor_id: 'TEST-VEND-001', vendor_name: 'Test Vendor Ltd',
  line_items: [{ item_code: 'LIC-001', description: 'Licence', quantity: 2, unit_price: 50 }], ...extra,
});

test('API requires a key', async () => {
  assert.equal((await call('procureos', '/api/pos')).status, 401);
  assert.equal((await call('procureos', '/api/pos', { apiKey: 'wrong-key' })).status, 401);
});

test('create, get, list, update and delete a PO', async () => {
  const n = poNumber();
  const body = {
    po_number: n, vendor_id: 'TEST-VEND-001', vendor_name: 'Test Vendor Ltd',
    issue_date: '2024-10-01', delivery_date: '2024-11-01', status: 'open',
    line_items: [{ line_number: 1, item_code: 'DESK-001', description: 'Standing Desk', quantity: 5, unit_price: 450 }],
  };
  const create = await call('procureos', '/api/pos', { method: 'POST', json: body, ...KEY });
  assert.equal(create.status, 201);
  assert.equal(create.data.po_number, n);
  assert.equal(create.data.total_amount, 2250);
  assert.equal(create.data.line_items[0].amount, 2250);

  assert.equal((await call('procureos', '/api/pos', { method: 'POST', json: body, ...KEY })).status, 409);

  const get = await call('procureos', `/api/po/${n}`, KEY);
  assert.equal(get.status, 200);
  assert.equal(get.data.vendor_name, 'Test Vendor Ltd');

  const list = await call('procureos', '/api/pos?status=open', KEY);
  assert.ok(list.data.purchase_orders.some((p) => p.po_number === n));

  const put = await call('procureos', `/api/pos/${n}`, {
    method: 'PUT', ...KEY,
    json: {
      vendor_id: 'TEST-VEND-001', vendor_name: 'Test Vendor Ltd (Updated)', status: 'partially_received',
      line_items: [
        { line_number: 1, item_code: 'DESK-001', description: 'Standing Desk', quantity: 3, unit_price: 450 },
        { line_number: 2, item_code: 'CHAIR-001', description: 'Office Chair', quantity: 2, unit_price: 120 },
      ],
    },
  });
  assert.equal(put.status, 200);
  assert.equal(put.data.status, 'partially_received');
  assert.equal(put.data.total_amount, 1590);
  assert.equal(put.data.line_items.length, 2);

  assert.equal((await call('procureos', `/api/pos/${n}`, { method: 'DELETE', ...KEY })).status, 204);
  assert.equal((await call('procureos', `/api/po/${n}`, KEY)).status, 404);
});

test('validation and not-found cases', async () => {
  assert.equal((await call('procureos', '/api/pos', { method: 'POST', json: { vendor_id: 'x' }, ...KEY })).status, 400);
  assert.equal((await call('procureos', `/api/po/${unique('NOPE')}`, KEY)).status, 404);
  assert.equal((await call('procureos', `/api/pos/${unique('NOPE')}`, { method: 'DELETE', ...KEY })).status, 404);
});

test('justification answers round trip and are validated', async () => {
  const n = poNumber();
  const create = await call('procureos', '/api/pos', { method: 'POST', json: payload(n, JUSTIFICATION), ...KEY });
  assert.equal(create.status, 201);
  assert.deepEqual(create.data.justification, JUSTIFICATION);

  const upd = await call('procureos', `/api/pos/${n}`, { method: 'PUT', json: payload(n, { roi_benefit: 'Updated via API' }), ...KEY });
  assert.equal(upd.data.justification.roi_benefit, 'Updated via API');
  assert.equal(upd.data.justification.purchase_what, JUSTIFICATION.purchase_what);

  const bad = await call('procureos', '/api/pos', { method: 'POST', json: payload(poNumber(), { criticality: 'whenever' }), ...KEY });
  assert.equal(bad.status, 400);
});

test('creating without justification still works', async () => {
  const create = await call('procureos', '/api/pos', { method: 'POST', json: payload(poNumber()), ...KEY });
  assert.equal(create.status, 201);
  assert.equal(create.data.justification.criticality, null);
});

test('document upload, signed url, download and replace', async () => {
  const n = poNumber();
  await call('procureos', '/api/pos', { method: 'POST', json: payload(n), ...KEY });
  assert.equal((await call('procureos', `/api/pos/${n}/document`, KEY)).status, 404);
  assert.equal((await call('procureos', `/api/pos/${n}/document/download`, KEY)).status, 404);

  const up = await call('procureos', `/api/pos/${n}/document`, { method: 'POST', form: pdf('quote.pdf'), ...KEY });
  assert.equal(up.status, 201);
  assert.equal(up.data.document_name, 'quote.pdf');

  const got = await call('procureos', `/api/pos/${n}/document`, KEY);
  assert.equal(got.status, 200);
  const fetched = Buffer.from(await (await fetch(got.data.url)).arrayBuffer());
  assert.equal(fetched.toString(), '%PDF-1.4\n% test\n');

  const dl = await call('procureos', `/api/pos/${n}/document/download`, KEY);
  assert.equal(dl.status, 200);
  assert.equal(dl.data.toString(), '%PDF-1.4\n% test\n');
  assert.match(dl.headers.get('content-disposition'), /attachment; filename="quote.pdf"/);

  const again = await call('procureos', `/api/pos/${n}/document`, { method: 'POST', form: pdf('second.pdf', '%PDF-1.4\n% replacement\n'), ...KEY });
  assert.notEqual(again.data.document_path, up.data.document_path);
  assert.equal((await call('procureos', `/api/po/${n}`, KEY)).data.document_name, 'second.pdf');
});

test('document upload validation', async () => {
  const n = poNumber();
  await call('procureos', '/api/pos', { method: 'POST', json: payload(n), ...KEY });
  const url = `/api/pos/${n}/document`;
  assert.equal((await call('procureos', url, { method: 'POST', form: new FormData(), ...KEY })).status, 400);
  assert.equal((await call('procureos', url, { method: 'POST', form: pdf('run.exe'), ...KEY })).status, 400);
  assert.equal((await call('procureos', url, { method: 'POST', form: pdf('empty.pdf', ''), ...KEY })).status, 400);
  assert.equal((await call('procureos', '/api/pos/NOPE-0000/document', { method: 'POST', form: pdf(), ...KEY })).status, 404);
});

test('document endpoints require a key', async () => {
  assert.equal((await call('procureos', '/api/pos/PO-2024-0099/document', { method: 'POST', form: pdf() })).status, 401);
  assert.equal((await call('procureos', '/api/pos/PO-2024-0099/document')).status, 401);
  assert.equal((await call('procureos', '/api/pos/PO-2024-0099/document/download')).status, 401);
});

test('a login token works in place of an API key', async () => {
  const token = await userToken();
  assert.equal((await call('procureos', '/api/pos?limit=1', { token })).status, 200);
});

test('API key management needs a login and returns the key once', async () => {
  assert.equal((await call('procureos', '/api/keys', KEY)).status, 401);
  const token = await userToken();

  const made = await call('procureos', '/api/keys', { method: 'POST', token, json: { label: 'test key' } });
  assert.equal(made.status, 201);
  assert.match(made.data.key, /^po-/);

  assert.equal((await call('procureos', '/api/pos?limit=1', { apiKey: made.data.key })).status, 200);

  const list = await call('procureos', '/api/keys', { token });
  assert.ok(list.data.keys.some((k) => k.id === made.data.id));
  assert.ok(!JSON.stringify(list.data).includes(made.data.key));

  assert.equal((await call('procureos', `/api/keys/${made.data.id}`, { method: 'DELETE', token })).status, 204);
  assert.equal((await call('procureos', '/api/pos?limit=1', { apiKey: made.data.key })).status, 401);
});
