import { db } from '../_shared/db.ts';
import { err, json, noContent, readJson } from '../_shared/http.ts';
import { Router } from '../_shared/router.ts';
import { authenticate, type KeyAuthConfig } from '../_shared/auth.ts';
import { addKeyManagement } from '../_shared/keys.ts';
import { sendWebhook } from '../_shared/webhook.ts';

const KEY_AUTH: KeyAuthConfig = {
  table: 'gr_api_keys',
  demoHash: 'f455355415937c4bb9db319ccef142b3d9b707a754ad93f30983c77538e84cf2',
  missing: { message: 'Missing X-API-Key header', status: 401 },
  invalid: { message: 'Invalid API key', status: 401 },
};

const REQUIRED = ['gr_number', 'po_number', 'vendor_id', 'vendor_name', 'received_date', 'received_by', 'status'];
const UPDATABLE = ['po_number', 'vendor_id', 'vendor_name', 'received_date', 'received_by', 'status'];

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const has = (o: Row, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const num = (v: unknown) => {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

async function getGr(gr_number: string): Promise<Row | null> {
  const { data, error } = await db.from('goods_received').select('*').eq('gr_number', gr_number).limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

async function getLines(gr_id: string): Promise<Row[]> {
  const { data, error } = await db.from('gr_line_items').select('*').eq('gr_id', gr_id).order('line_number');
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Only the known columns are written, so unexpected keys in a payload cannot break the insert.
function parseLines(items: unknown, gr_id: string): Row[] {
  if (!Array.isArray(items)) return [];
  return items.map((li: Row, i: number) => ({
    gr_id,
    line_number: li?.line_number ?? i + 1,
    item_code: li?.item_code ?? '',
    description: li?.description ?? '',
    quantity_ordered: num(li?.quantity_ordered),
    quantity_received: num(li?.quantity_received),
    unit_price: num(li?.unit_price),
    condition: li?.condition ?? 'good',
  }));
}

async function serialize(gr: Row): Promise<Row> {
  const lines = await getLines(gr.id);
  return {
    gr_number: gr.gr_number,
    po_number: gr.po_number,
    vendor_id: gr.vendor_id,
    vendor_name: gr.vendor_name,
    received_date: gr.received_date,
    received_by: gr.received_by,
    status: gr.status,
    line_items: lines.map((li) => ({
      line_number: li.line_number,
      item_code: li.item_code,
      description: li.description,
      quantity_ordered: li.quantity_ordered,
      quantity_received: li.quantity_received,
      unit_price: li.unit_price,
      condition: li.condition,
    })),
  };
}

const notFound = (gr_number: string) => err(`GR ${gr_number} not found`, 404);

const router = new Router();
const guard = async (req: Request) => await authenticate(req, db, KEY_AUTH);

// The literal "by-po" route is registered before the variable one.
router.get('/api/gr/by-po/:po_number', async ({ req, params }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const { data, error } = await db.from('goods_received').select('*').eq('po_number', params.po_number).order('created_at');
  if (error) return err(error.message, 500);
  return json(await Promise.all((data ?? []).map(serialize)));
});

router.get('/api/gr/:gr_number', async ({ req, params }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const gr = await getGr(params.gr_number);
  if (!gr) return notFound(params.gr_number);
  return json(await serialize(gr));
});

router.get('/api/grs', async ({ req, query }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const vendor_id = query.get('vendor_id') ?? '';
  const po_number = query.get('po_number') ?? '';
  const status = query.get('status') ?? '';
  const page = Math.max(1, parseInt(query.get('page') ?? '1', 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.get('limit') ?? '50', 10) || 50));
  const offset = (page - 1) * limit;

  let q = db.from('goods_received').select('*').order('created_at', { ascending: false });
  if (vendor_id) q = q.eq('vendor_id', vendor_id);
  if (po_number) q = q.eq('po_number', po_number);
  if (status) q = q.eq('status', status);
  const { data, error } = await q.range(offset, offset + limit - 1);
  if (error) return err(error.message, 500);
  return json({ data: await Promise.all((data ?? []).map(serialize)), page, limit });
});

router.post('/api/grs', async ({ req }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const body = (await readJson(req)) ?? {};
  const missing = REQUIRED.filter((f) => !body[f]);
  if (missing.length) return err(`Missing fields: ${missing.join(', ')}`, 400);

  const row: Row = {};
  for (const k of REQUIRED) row[k] = body[k];
  const { data, error } = await db.from('goods_received').insert(row).select().single();
  if (error) return err(error.code === '23505' ? `GR ${body.gr_number} already exists` : 'Insert failed', error.code === '23505' ? 409 : 500);

  const lines = parseLines(body.line_items, data.id);
  if (lines.length) {
    const ins = await db.from('gr_line_items').insert(lines);
    if (ins.error) return err(ins.error.message, 500);
  }

  const created = await serialize(data);
  await sendWebhook('receiptslog', 'goods_receipt.created', created);
  return json(created, 201);
});

router.put('/api/grs/:gr_number', async ({ req, params }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const existing = await getGr(params.gr_number);
  if (!existing) return notFound(params.gr_number);

  const body = (await readJson(req)) ?? {};
  const updates: Row = {};
  for (const k of UPDATABLE) if (has(body, k)) updates[k] = body[k];
  updates.updated_at = new Date().toISOString();
  const upd = await db.from('goods_received').update(updates).eq('id', existing.id);
  if (upd.error) return err(upd.error.message, 500);

  if (has(body, 'line_items')) {
    const del = await db.from('gr_line_items').delete().eq('gr_id', existing.id);
    if (del.error) return err(del.error.message, 500);
    const lines = parseLines(body.line_items, existing.id);
    if (lines.length) {
      const ins = await db.from('gr_line_items').insert(lines);
      if (ins.error) return err(ins.error.message, 500);
    }
  }

  const payload = await serialize((await getGr(params.gr_number))!);
  await sendWebhook('receiptslog', 'goods_receipt.updated', payload);
  return json(payload);
});

router.delete('/api/grs/:gr_number', async ({ req, params }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const existing = await getGr(params.gr_number);
  if (!existing) return notFound(params.gr_number);
  const lines = await db.from('gr_line_items').delete().eq('gr_id', existing.id);
  if (lines.error) return err(lines.error.message, 500);
  const del = await db.from('goods_received').delete().eq('id', existing.id);
  if (del.error) return err(del.error.message, 500);
  return noContent();
});

addKeyManagement(router, db, 'gr_api_keys', 'rl');

Deno.serve((req) => router.handle(req, 'receiptslog'));
