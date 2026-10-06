import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { call, pdf, purgeTestUsers, unique, userToken, REPO_ROOT } from './helpers.mjs';

const FN = 'clearledger';
const KEY = { apiKey: 'demo-key-clearledger' };
const PDF_TEXT = '%PDF-1.4\n% test\n';

const cli = (args, input) => execFileSync('supabase', args, {
  cwd: REPO_ROOT, stdio: 'pipe', timeout: 180000, shell: process.platform === 'win32', encoding: 'utf8', input,
});

// DELETE invoice is not an API route, so rows and files with the TEST- prefix (only) are removed
// with the Supabase CLI.
after(() => {
  try {
    cli(['db', 'query', '--linked'], `
      delete from invoice_line_items where invoice_id in (select id from invoices where invoice_number like 'TEST-%');
      delete from invoice_actions where invoice_id in (select id from invoices where invoice_number like 'TEST-%');
      delete from invoices where invoice_number like 'TEST-%';`);
  } catch (e) {
    console.error('DB cleanup failed:', e.message);
  }
  try {
    const listing = cli(['storage', 'ls', '-r', 'ss:///documents/invoices/', '--linked', '--experimental']);
    const paths = listing.match(/\/documents\/invoices\/TEST-[^\s]+/g) ?? [];
    if (paths.length) cli(['storage', 'rm', ...paths.map((p) => `ss://${p}`), '--linked', '--experimental'], 'y');
  } catch (e) {
    console.error('Storage cleanup failed:', e.message);
  }
  purgeTestUsers();
});

const invoiceBody = (invoice_number, extra = {}) => ({
  invoice_number, vendor_id: 'TEST-VEND-001', vendor_name: 'Test Vendor Ltd', invoice_date: '2024-11-15',
  po_number: 'TEST-PO-0001', total_amount: 100.0, match_status: 'mismatch', ...extra,
});

async function createInvoice(extra = {}) {
  const number = unique('TEST');
  const res = await call(FN, '/api/invoices', { method: 'POST', json: invoiceBody(number, extra), ...KEY });
  assert.equal(res.status, 201);
  return { number, id: res.data.id };
}

function uploadForm(number, overrides = {}, file = pdf('invoice.pdf').get('file')) {
  const fields = {
    invoice_number: number, vendor_id: 'TEST-VEND-001', vendor_name: 'Test Vendor Ltd', invoice_date: '2024-11-15',
    po_number: 'TEST-PO-0001', gr_number: '', total_amount: '1250.00', ...overrides,
  };
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) form.set('document', file, file.name);
  return form;
}

test('API requires a key, with the original messages', async () => {
  const none = await call(FN, '/api/invoices', { method: 'POST', json: { invoice_number: unique('TEST') } });
  assert.equal(none.status, 401);
  assert.equal(none.data.error, 'Missing X-API-Key header');
  const bad = await call(FN, '/api/invoices', { apiKey: 'wrong-key' });
  assert.equal(bad.status, 401);
  assert.equal(bad.data.error, 'Invalid API key');
  for (const [path, method] of [['/api/settings/threshold', 'GET'], ['/api/invoices/lookup/x', 'GET'], ['/api/invoices/upload', 'POST']]) {
    assert.equal((await call(FN, path, { method })).status, 401);
  }
});

test('create invoice validation', async () => {
  const missing = await call(FN, '/api/invoices', { method: 'POST', json: { invoice_number: unique('TEST') }, ...KEY });
  assert.equal(missing.status, 400);
  assert.match(missing.data.error, /^Missing required fields: /);
  const raw = await fetch(`${process.env.FUNCTIONS_BASE || 'https://jmbwyttobedzszswarhd.supabase.co/functions/v1'}/${FN}/api/invoices`, {
    method: 'POST', headers: { 'X-API-Key': 'demo-key-clearledger' }, body: 'not json',
  });
  assert.equal(raw.status, 400);
  assert.equal((await raw.json()).error, 'Request body must be JSON');
});

test('create invoice and full lifecycle', async () => {
  const number = unique('TEST');
  const payload = invoiceBody(number, {
    gr_number: 'TEST-GR-0001', total_amount: 1250.0, variance_amount: 50.0, variance_pct: 4.0,
    line_items: [{
      line_number: 1, description: 'Test Widget', invoice_qty: 10, invoice_unit_price: 125.0,
      po_qty: 10, po_unit_price: 120.0, gr_qty: 10, mismatch_type: 'price_variance', variance_amount: 50.0,
    }],
  });
  const create = await call(FN, '/api/invoices', { method: 'POST', json: payload, ...KEY });
  assert.equal(create.status, 201);
  assert.equal(create.data.invoice_number, number);
  const id = create.data.id;

  assert.equal((await call(FN, '/api/invoices', { method: 'POST', json: payload, ...KEY })).status, 409);

  const get = await call(FN, `/api/invoices/${id}`, KEY);
  assert.equal(get.status, 200);
  assert.equal(get.data.status, 'pending');
  assert.equal(get.data.line_items.length, 1);
  assert.equal(get.data.line_items[0].mismatch_type, 'price_variance');
  assert.deepEqual(get.data.actions, []);
  assert.equal(get.data.vendor_flag, null);
  assert.equal(typeof get.data.threshold_pct, 'number');

  const list = await call(FN, '/api/invoices?status=pending&limit=200', KEY);
  assert.equal(list.status, 200);
  assert.ok(list.data.some((i) => i.invoice_number === number));
  const byPo = await call(FN, '/api/invoices?po_number=TEST-PO-0001&limit=200', KEY);
  assert.ok(byPo.data.some((i) => i.invoice_number === number));

  const badAction = await call(FN, `/api/invoices/${id}/action`, { method: 'PATCH', json: { action: 'nope' }, ...KEY });
  assert.equal(badAction.status, 400);
  assert.equal(badAction.data.error, 'action must be one of: approve, contact_vendor, escalate');

  const act = await call(FN, `/api/invoices/${id}/action`, {
    method: 'PATCH', json: { action: 'approve', note: 'Variance within acceptable range.' }, ...KEY,
  });
  assert.equal(act.status, 200);
  assert.equal(act.data.status, 'approved');

  const final = await call(FN, `/api/invoices/${id}`, KEY);
  assert.equal(final.data.actions.length, 1);
  assert.equal(final.data.actions[0].action_type, 'approve');
  assert.equal(final.data.actions[0].note, 'Variance within acceptable range.');
});

test('action and get on a missing invoice return 404', async () => {
  const id = '00000000-0000-4000-8000-000000000000';
  assert.equal((await call(FN, `/api/invoices/${id}/action`, { method: 'PATCH', json: { action: 'approve' }, ...KEY })).status, 404);
  assert.equal((await call(FN, `/api/invoices/${id}`, KEY)).status, 404);
  assert.equal((await call(FN, '/api/invoices/not-a-uuid', KEY)).status, 404);
});

test('action without a JSON body is rejected', async () => {
  const { id } = await createInvoice();
  const res = await call(FN, `/api/invoices/${id}/action`, { method: 'PATCH', json: {}, ...KEY });
  assert.equal(res.status, 400);
});

test('threshold round trip', async () => {
  const original = (await call(FN, '/api/settings/threshold', KEY)).data.threshold_pct;
  try {
    const put = await call(FN, '/api/settings/threshold', { method: 'PUT', json: { threshold_pct: 7.5 }, ...KEY });
    assert.equal(put.status, 200);
    assert.equal(put.data.threshold_pct, 7.5);
    const get = await call(FN, '/api/settings/threshold', KEY);
    assert.equal(get.status, 200);
    assert.equal(get.data.threshold_pct, 7.5);
  } finally {
    await call(FN, '/api/settings/threshold', { method: 'PUT', json: { threshold_pct: original }, ...KEY });
  }
  assert.equal((await call(FN, '/api/settings/threshold', KEY)).data.threshold_pct, original);
});

test('threshold validation', async () => {
  const high = await call(FN, '/api/settings/threshold', { method: 'PUT', json: { threshold_pct: 150 }, ...KEY });
  assert.equal(high.status, 400);
  assert.equal(high.data.error, 'threshold_pct must be between 0 and 100');
  const text = await call(FN, '/api/settings/threshold', { method: 'PUT', json: { threshold_pct: 'not-a-number' }, ...KEY });
  assert.equal(text.status, 400);
  assert.equal(text.data.error, 'threshold_pct must be a number');
  const none = await call(FN, '/api/settings/threshold', { method: 'PUT', json: { other: 1 }, ...KEY });
  assert.equal(none.data.error, 'Body must include threshold_pct');
});

test('a login token works in place of an API key', async () => {
  const token = await userToken();
  assert.equal((await call(FN, '/api/invoices?limit=1', { token })).status, 200);
  assert.equal((await call(FN, '/api/settings/threshold', { token })).status, 200);
});

test('API key management needs a login and returns the key once', async () => {
  assert.equal((await call(FN, '/api/keys', KEY)).status, 401);
  const token = await userToken();
  const made = await call(FN, '/api/keys', { method: 'POST', token, json: { label: 'test key' } });
  assert.equal(made.status, 201);
  assert.match(made.data.key, /^cl-/);
  assert.equal((await call(FN, '/api/invoices?limit=1', { apiKey: made.data.key })).status, 200);

  const list = await call(FN, '/api/keys', { token });
  assert.ok(list.data.keys.some((k) => k.id === made.data.id));
  assert.ok(!JSON.stringify(list.data).includes(made.data.key));

  assert.equal((await call(FN, `/api/keys/${made.data.id}`, { method: 'DELETE', token })).status, 204);
  const after = await call(FN, '/api/invoices?limit=1', { apiKey: made.data.key });
  assert.equal(after.status, 401);
  assert.equal(after.data.error, 'Invalid API key');
});

test('lookup resolves an invoice number to its id', async () => {
  const { number, id } = await createInvoice();
  const hit = await call(FN, `/api/invoices/lookup/${encodeURIComponent(number)}`, KEY);
  assert.equal(hit.status, 200);
  assert.equal(hit.data.id, id);
  const miss = await call(FN, `/api/invoices/lookup/${unique('TEST-NOPE')}`, KEY);
  assert.equal(miss.status, 404);
  assert.equal(miss.data.error, 'Invoice not found');
  assert.equal((await call(FN, `/api/invoices/lookup/${number}`, { token: await userToken() })).status, 200);
});

test('upload endpoint stores the record and the document', async () => {
  const number = unique('TEST');
  const res = await call(FN, '/api/invoices/upload', { method: 'POST', form: uploadForm(number), ...KEY });
  assert.equal(res.status, 201);
  assert.equal(res.data.invoice_number, number);
  assert.equal(res.data.status, 'pending');
  assert.equal(res.data.match_status, null);
  assert.equal(res.data.document_name, 'invoice.pdf');
  assert.ok(res.data.document_path.startsWith(`invoices/${number}/`));

  const detail = await call(FN, `/api/invoices/${res.data.id}`, KEY);
  assert.equal(detail.data.match_status, null);

  const got = await call(FN, `/api/invoices/${res.data.id}/document`, KEY);
  const fetched = Buffer.from(await (await fetch(got.data.url)).arrayBuffer());
  assert.equal(fetched.toString(), PDF_TEXT);
});

test('upload endpoint accepts a login token', async () => {
  const number = unique('TEST');
  const res = await call(FN, '/api/invoices/upload', { method: 'POST', form: uploadForm(number), token: await userToken() });
  assert.equal(res.status, 201);
});

test('upload endpoint validation', async () => {
  const noFile = unique('TEST');
  const r1 = await call(FN, '/api/invoices/upload', { method: 'POST', form: uploadForm(noFile, {}, null), ...KEY });
  assert.equal(r1.status, 400);
  assert.match(r1.data.error, /choose an invoice file/);
  assert.equal((await call(FN, `/api/invoices/lookup/${noFile}`, KEY)).status, 404);

  const r2 = await call(FN, '/api/invoices/upload', { method: 'POST', form: uploadForm(unique('TEST'), { vendor_id: '' }), ...KEY });
  assert.equal(r2.data.error, 'Missing required fields: vendor_id.');

  const r3 = await call(FN, '/api/invoices/upload', { method: 'POST', form: uploadForm(unique('TEST'), { total_amount: 'abc' }), ...KEY });
  assert.equal(r3.data.error, 'Total amount must be a number.');

  const badType = unique('TEST');
  const r4 = await call(FN, '/api/invoices/upload', { method: 'POST', form: uploadForm(badType, {}, new File(['x'], 'malware.exe')), ...KEY });
  assert.equal(r4.status, 400);
  assert.match(r4.data.error, /Unsupported file type/);
  assert.equal((await call(FN, `/api/invoices/lookup/${badType}`, KEY)).status, 404, 'no record left behind');

  const { number } = await createInvoice();
  const dup = await call(FN, '/api/invoices/upload', { method: 'POST', form: uploadForm(number), ...KEY });
  assert.equal(dup.status, 400);
  assert.equal(dup.data.error, `Invoice ${number} already exists.`);
});

test('document upload, signed url, download and replace', async () => {
  const { number, id } = await createInvoice();
  assert.equal((await call(FN, `/api/invoices/${id}/document`, KEY)).status, 404);
  assert.equal((await call(FN, `/api/invoices/${id}/document/download`, KEY)).status, 404);

  const up = await call(FN, `/api/invoices/${id}/document`, { method: 'POST', form: pdf('first.pdf'), ...KEY });
  assert.equal(up.status, 201);
  assert.equal(up.data.document_name, 'first.pdf');
  assert.ok(up.data.document_path.startsWith(`invoices/${number}/`));

  const got = await call(FN, `/api/invoices/${id}/document`, KEY);
  assert.equal(got.status, 200);
  assert.equal(got.data.document_name, 'first.pdf');
  assert.equal(got.data.expires_in, 3600);
  assert.equal(Buffer.from(await (await fetch(got.data.url)).arrayBuffer()).toString(), PDF_TEXT);

  const dl = await call(FN, `/api/invoices/${id}/document/download`, KEY);
  assert.equal(dl.status, 200);
  assert.equal(dl.data.toString(), PDF_TEXT);
  assert.match(dl.headers.get('content-disposition'), /attachment; filename="first.pdf"/);

  const again = await call(FN, `/api/invoices/${id}/document`, { method: 'POST', form: pdf('second.pdf', '%PDF-1.4\n% replacement\n'), ...KEY });
  assert.equal(again.status, 201);
  assert.notEqual(again.data.document_path, up.data.document_path);
  // the old object was removed: only the replacement remains in the invoice folder
  const folder = cli(['storage', 'ls', `ss:///documents/invoices/${number}/`, '--linked', '--experimental']);
  assert.ok(folder.includes(again.data.document_path.split('/').pop()));
  assert.ok(!folder.includes(up.data.document_path.split('/').pop()));
  assert.equal((await call(FN, `/api/invoices/${id}`, KEY)).data.document_name, 'second.pdf');
});

test('document upload validation', async () => {
  const { id } = await createInvoice();
  const url = `/api/invoices/${id}/document`;
  const none = await call(FN, url, { method: 'POST', form: new FormData(), ...KEY });
  assert.equal(none.status, 400);
  assert.equal(none.data.error, 'Multipart form field "file" is required');
  assert.equal((await call(FN, url, { method: 'POST', form: pdf('notes.txt'), ...KEY })).status, 400);
  assert.equal((await call(FN, url, { method: 'POST', form: pdf('empty.pdf', ''), ...KEY })).status, 400);
  const missing = await call(FN, '/api/invoices/00000000-0000-4000-8000-000000000000/document', { method: 'POST', form: pdf(), ...KEY });
  assert.equal(missing.status, 404);
});

test('document endpoints require a key', async () => {
  const id = '00000000-0000-4000-8000-000000000000';
  assert.equal((await call(FN, `/api/invoices/${id}/document`, { method: 'POST', form: pdf() })).status, 401);
  assert.equal((await call(FN, `/api/invoices/${id}/document`)).status, 401);
  assert.equal((await call(FN, `/api/invoices/${id}/document/download`)).status, 401);
});

test('webhook-firing operations succeed whether or not a webhook receiver is reachable', async () => {
  const { id } = await createInvoice();
  const action = await call(FN, `/api/invoices/${id}/action`, { method: 'PATCH', json: { action: 'escalate', note: 'looks off' }, ...KEY });
  assert.equal(action.status, 200);
  assert.equal(action.data.status, 'escalated');
  assert.equal((await call(FN, `/api/invoices/${id}/document`, { method: 'POST', form: pdf(), ...KEY })).status, 201);
  const contact = await call(FN, `/api/invoices/${id}/action`, { method: 'PATCH', json: { action: 'contact_vendor' }, ...KEY });
  assert.equal(contact.data.status, 'contacted');
  const history = (await call(FN, `/api/invoices/${id}`, KEY)).data.actions;
  assert.equal(history.length, 2);
});
