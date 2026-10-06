import { db } from '../_shared/db.ts';
import { err, json, readJson } from '../_shared/http.ts';
import { Router } from '../_shared/router.ts';

// NOTE: like the Flask AuditTrail app, these API routes are intentionally open (no authentication),
// because the Automation Anywhere bot calls them directly.

const CLOSE_STATUSES = ['cleared', 'exception_documented', 'escalated'];
const CLOSE_STATUS_FIELDS = ['status', 'owner', 'note'];

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const has = (o: Row, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isEmpty = (o: Row | null) => !o || Object.keys(o).length === 0;

const router = new Router();

router.get('/api/vendor-flags', async ({ query }) => {
  const status = query.get('status');
  let q = db.from('vendor_flags').select('*').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return err(error.message, 500);
  return json(data ?? []);
});

router.get('/api/vendor-flags/:flag_id', async ({ params }) => {
  const { data, error } = await db.from('vendor_flags').select('*').eq('id', params.flag_id).limit(1);
  if (error) return err(error.message, 500);
  if (!data || !data.length) return err('Vendor flag not found', 404);
  return json(data[0]);
});

router.get('/api/flux-analysis', async ({ query }) => {
  const category = query.get('category');
  const status = query.get('status');
  let q = db.from('flux_analysis').select('*').order('created_at', { ascending: false });
  if (category) q = q.eq('category', category);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return err(error.message, 500);
  return json(data ?? []);
});

router.get('/api/audit-trail', async ({ query }) => {
  const related = query.get('related_reference');
  let q = db.from('audit_trail').select('*').order('created_at', { ascending: false });
  if (related) q = q.eq('related_reference', related);
  const { data, error } = await q;
  if (error) return err(error.message, 500);
  return json(data ?? []);
});

router.post('/api/audit-trail', async ({ req }) => {
  const body = await readJson(req);
  if (isEmpty(body)) return err('Request body must be JSON', 400);
  const data = body as Row;

  const missing = ['action_checked', 'decision'].filter((f) => !has(data, f));
  if (missing.length) return err(`Missing required fields: ${missing.join(', ')}`, 400);

  const { data: rows, error } = await db.from('audit_trail').insert({
    agent_name: has(data, 'agent_name') ? data.agent_name : 'close-automation',
    action_checked: data.action_checked,
    decision: data.decision,
    evidence: data.evidence ?? null,
    escalation_reason: data.escalation_reason ?? null,
    related_reference: data.related_reference ?? null,
    created_at: new Date().toISOString(),
  }).select();
  if (error || !rows?.length) return err(`Failed to create audit trail entry: ${error?.message ?? 'no row returned'}`, 500);
  return json(rows[0], 201);
});

router.get('/api/close-status', async ({ query }) => {
  const status = query.get('status');
  const category = query.get('category');
  let q = db.from('close_status').select('*').order('updated_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) return err(error.message, 500);
  return json(data ?? []);
});

router.patch('/api/close-status/:item_id', async ({ req, params }) => {
  const body = await readJson(req);
  if (isEmpty(body)) return err('Request body must be JSON', 400);
  const data = body as Row;

  const updates: Row = {};
  for (const k of CLOSE_STATUS_FIELDS) if (has(data, k)) updates[k] = data[k];
  if (!Object.keys(updates).length) {
    return err(`Body must include at least one of: ${CLOSE_STATUS_FIELDS.join(', ')}`, 400);
  }
  if (has(updates, 'status') && !CLOSE_STATUSES.includes(updates.status)) {
    return err(`status must be one of: ${CLOSE_STATUSES.join(', ')}`, 400);
  }

  const check = await db.from('close_status').select('id').eq('id', params.item_id).limit(1);
  if (check.error) return err(check.error.message, 500);
  if (!check.data?.length) return err('Close status item not found', 404);

  updates.updated_at = new Date().toISOString();
  const upd = await db.from('close_status').update(updates).eq('id', params.item_id);
  if (upd.error) return err(`Failed to update close status item: ${upd.error.message}`, 500);

  const { data: fresh, error } = await db.from('close_status').select('*').eq('id', params.item_id).limit(1);
  if (error || !fresh?.length) return err(error?.message ?? 'Close status item not found', 500);
  return json(fresh[0]);
});

Deno.serve((req) => router.handle(req, 'audittrail'));
