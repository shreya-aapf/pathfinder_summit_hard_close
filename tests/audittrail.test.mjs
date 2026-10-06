import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { call, REPO_ROOT, unique } from './helpers.mjs';

const FN = 'audittrail';
const NIL = '00000000-0000-4000-8000-000000000000';
const snapshots = new Map();

// Audit events created by tests carry a TEST- related_reference; the API has no delete route,
// so they are removed with the Supabase CLI.
after(async () => {
  for (const [id, o] of snapshots) {
    await call(FN, `/api/close-status/${id}`, { method: 'PATCH', json: { status: o.status, owner: o.owner, note: o.note } });
  }
  try {
    execFileSync('supabase', ['db', 'query', '--linked', `"delete from audit_trail where related_reference like 'TEST-%'"`], {
      cwd: REPO_ROOT, stdio: 'ignore', timeout: 90000, shell: process.platform === 'win32',
    });
  } catch {
    console.error('WARNING: could not delete TEST- audit_trail rows; remove them manually.');
  }
});

const closeItems = async (qs = '') => (await call(FN, `/api/close-status${qs}`)).data;
const snapshot = (item) => snapshots.set(item.id, { status: item.status, owner: item.owner, note: item.note });

// Static pages are served by the web host, so the UI-route tests of the Flask suite are covered
// by checking the data each page renders from.
test('close status board data loads (seed item present)', async () => {
  const r = await call(FN, '/api/close-status');
  assert.equal(r.status, 200);
  assert.ok(r.data.some((i) => JSON.stringify(i).includes('Sub A/B intercompany timing difference')));
});

test('close status board filter', async () => {
  assert.equal((await call(FN, '/api/close-status?status=escalated')).status, 200);
});

test('vendor flags page data loads (Acme Supplies)', async () => {
  const r = await call(FN, '/api/vendor-flags');
  assert.equal(r.status, 200);
  assert.ok(r.data.some((f) => f.vendor_name.includes('Acme Supplies')));
});

test('vendor flag detail not found', async () => {
  assert.equal((await call(FN, `/api/vendor-flags/${NIL}`)).status, 404);
});

test('flux and audit log data load', async () => {
  assert.equal((await call(FN, '/api/flux-analysis')).status, 200);
  assert.equal((await call(FN, '/api/audit-trail')).status, 200);
});

test('API list vendor flags', async () => {
  const r = await call(FN, '/api/vendor-flags');
  assert.equal(r.status, 200);
  const acme = r.data.find((f) => f.vendor_name === 'Acme Supplies Ltd');
  assert.equal(acme.flag_type, 'bank_mismatch');
  assert.notEqual(acme.registered_bank_details, acme.submitted_bank_details);
});

test('API get single vendor flag', async () => {
  const acme = (await call(FN, '/api/vendor-flags')).data.find((f) => f.vendor_name === 'Acme Supplies Ltd');
  const r = await call(FN, `/api/vendor-flags/${acme.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.invoice_number, 'INV-2024-001');
});

test('API get vendor flag not found', async () => {
  const r = await call(FN, `/api/vendor-flags/${NIL}`);
  assert.equal(r.status, 404);
  assert.equal(r.data.error, 'Vendor flag not found');
});

test('API flux analysis filter by category', async () => {
  const r = await call(FN, '/api/flux-analysis?category=revenue');
  assert.equal(r.status, 200);
  assert.ok(r.data.every((x) => x.category === 'revenue'));
  assert.ok(r.data.some((x) => x.subsidiary === 'C'));
});

test('API flux analysis linked to held invoice', async () => {
  const r = await call(FN, '/api/flux-analysis?status=unexplained');
  assert.equal(r.status, 200);
  assert.ok(r.data.some((x) => x.linked_reference === 'INV-2024-001'));
});

test('API create audit trail missing fields', async () => {
  const r = await call(FN, '/api/audit-trail', { method: 'POST', json: { agent_name: 'test-agent' } });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'Missing required fields: action_checked, decision');
});

test('API create audit trail rejects empty body', async () => {
  const r = await call(FN, '/api/audit-trail', { method: 'POST', json: {} });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'Request body must be JSON');
});

test('API create and list audit trail entry', async () => {
  const tag = unique('TEST');
  const create = await call(FN, '/api/audit-trail', {
    method: 'POST',
    json: {
      action_checked: 'Vendor bank details vs. ERP registration',
      decision: 'Escalated — bank details do not match registered record',
      evidence: 'Registered: First National ****4471. Submitted: Coastal Trust ****9902.',
      escalation_reason: 'Possible payment fraud — do not release payment.',
      related_reference: tag,
    },
  });
  assert.equal(create.status, 201);
  assert.equal(create.data.agent_name, 'close-automation');
  assert.equal(create.data.related_reference, tag);

  const list = await call(FN, `/api/audit-trail?related_reference=${tag}`);
  assert.equal(list.status, 200);
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].decision, 'Escalated — bank details do not match registered record');
});

test('API create audit trail entry defaults agent name', async () => {
  const r = await call(FN, '/api/audit-trail', {
    method: 'POST',
    json: { action_checked: 'Flux variance review', decision: 'Cleared — within seasonal range', related_reference: unique('TEST') },
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.agent_name, 'close-automation');
});

test('API list close status filter', async () => {
  const r = await call(FN, '/api/close-status?status=escalated');
  assert.equal(r.status, 200);
  assert.ok(r.data.every((i) => i.status === 'escalated'));
  assert.ok(r.data.length >= 1);
});

test('API patch close status round trip', async () => {
  const item = (await closeItems('?category=Intercompany'))[0];
  snapshot(item);
  const note = 'Confirmed via test — will be restored automatically.';
  const r = await call(FN, `/api/close-status/${item.id}`, { method: 'PATCH', json: { status: 'cleared', note } });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'cleared');
  assert.equal(r.data.note, note);
});

test('API patch close status invalid status', async () => {
  const item = (await closeItems())[0];
  const r = await call(FN, `/api/close-status/${item.id}`, { method: 'PATCH', json: { status: 'not-a-real-status' } });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'status must be one of: cleared, exception_documented, escalated');
});

test('API patch close status empty body', async () => {
  const item = (await closeItems())[0];
  const r = await call(FN, `/api/close-status/${item.id}`, { method: 'PATCH', json: { irrelevant_field: 'x' } });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'Body must include at least one of: status, owner, note');
});

test('API patch close status not found', async () => {
  const r = await call(FN, `/api/close-status/${NIL}`, { method: 'PATCH', json: { status: 'cleared' } });
  assert.equal(r.status, 404);
  assert.equal(r.data.error, 'Close status item not found');
});
