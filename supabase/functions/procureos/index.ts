import { db } from '../_shared/db.ts';
import { err, fileResponse, json, noContent, readJson } from '../_shared/http.ts';
import { Router } from '../_shared/router.ts';
import { authenticate, type KeyAuthConfig } from '../_shared/auth.ts';
import { addKeyManagement } from '../_shared/keys.ts';
import { downloadObject, readFile, removeObject, secureFilename, signedUrl, UploadError, uploadDocument } from '../_shared/storage.ts';

const KEY_AUTH: KeyAuthConfig = {
  table: 'po_api_keys',
  demoHash: 'e2ea498f352094908ededbb13b347a72657a0ba3348b5f11bf504e0343ac2d86',
  missing: { message: 'Missing X-API-Key header', status: 401 },
  invalid: { message: 'Invalid API key', status: 401 },
};

const ALLOWED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'doc', 'docx', 'xls', 'xlsx'];
const JUSTIFICATION_TEXT_FIELDS = ['purchase_what', 'purchase_why', 'no_purchase_impact', 'alternative_tool', 'roi_benefit', 'okr_alignment'];
const CRITICALITY_VALUES = ['keep_the_lights_on', 'nice_to_have'];

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};
const has = (o: Row, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function justificationFromJson(body: Row): Row {
  const out: Row = {};
  for (const k of [...JUSTIFICATION_TEXT_FIELDS, 'criticality']) if (has(body, k)) out[k] = body[k];
  return out;
}

function parseLineItems(items: unknown): Row[] {
  if (!Array.isArray(items)) return [];
  return items.map((item: Row, idx: number) => {
    const quantity = num(item?.quantity);
    const unit_price = num(item?.unit_price);
    return {
      line_number: item?.line_number ?? idx + 1,
      item_code: item?.item_code ?? '',
      description: item?.description ?? '',
      quantity,
      unit_price,
      amount: round2(quantity * unit_price),
    };
  });
}

async function getPo(po_number: string): Promise<Row | null> {
  const { data, error } = await db.from('purchase_orders').select('*').eq('po_number', po_number).limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

async function getLineItems(po_id: string): Promise<Row[]> {
  const { data, error } = await db.from('po_line_items').select('*').eq('po_id', po_id).order('line_number');
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function replaceLines(po_id: string, lines: Row[]): Promise<void> {
  const del = await db.from('po_line_items').delete().eq('po_id', po_id);
  if (del.error) throw new Error(del.error.message);
  if (lines.length) {
    const ins = await db.from('po_line_items').insert(lines.map((l) => ({ ...l, po_id })));
    if (ins.error) throw new Error(ins.error.message);
  }
}

function poResponse(po: Row, lines: Row[]): Row {
  return {
    po_number: po.po_number,
    vendor_id: po.vendor_id,
    vendor_name: po.vendor_name,
    issue_date: po.issue_date,
    delivery_date: po.delivery_date,
    status: po.status,
    currency: po.currency || 'USD',
    total_amount: po.total_amount,
    document_name: po.document_name ?? null,
    justification: {
      purchase_what: po.purchase_what ?? null,
      purchase_why: po.purchase_why ?? null,
      no_purchase_impact: po.no_purchase_impact ?? null,
      criticality: po.criticality ?? null,
      alternative_tool: po.alternative_tool ?? null,
      roi_benefit: po.roi_benefit ?? null,
      okr_alignment: po.okr_alignment ?? null,
    },
    line_items: lines.map((li) => ({
      line_number: li.line_number,
      item_code: li.item_code,
      description: li.description,
      quantity: li.quantity,
      unit_price: li.unit_price,
      amount: li.amount,
    })),
  };
}

const router = new Router();
const guard = async (req: Request) => await authenticate(req, db, KEY_AUTH);

router.get('/api/po/:po_number', async ({ req, params }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const po = await getPo(params.po_number);
  if (!po) return err('Not found', 404);
  return json(poResponse(po, await getLineItems(po.id)));
});

router.get('/api/pos', async ({ req, query }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const vendor_id = (query.get('vendor_id') ?? '').trim();
  const status = (query.get('status') ?? '').trim();
  const page = Math.max(1, parseInt(query.get('page') ?? '1', 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.get('limit') ?? '50', 10) || 50));
  const offset = (page - 1) * limit;

  let q = db.from('purchase_orders').select('*').order('created_at', { ascending: false });
  if (vendor_id) q = q.eq('vendor_id', vendor_id);
  if (status) q = q.eq('status', status);
  const { data, error } = await q.range(offset, offset + limit - 1);
  if (error) return err(error.message, 500);
  return json({ page, limit, count: data.length, purchase_orders: data });
});

router.post('/api/pos', async ({ req }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const body = (await readJson(req)) ?? {};

  const po_number = String(body.po_number ?? '').trim();
  if (!po_number) return err('po_number is required', 400);
  if (await getPo(po_number)) return err(`PO ${po_number} already exists`, 409);

  const lines = parseLineItems(body.line_items);
  const justification = justificationFromJson(body);
  if (justification.criticality && !CRITICALITY_VALUES.includes(justification.criticality)) {
    return err(`criticality must be one of: ${CRITICALITY_VALUES.join(', ')}`, 400);
  }

  const now = new Date().toISOString();
  const { data, error } = await db.from('purchase_orders').insert({
    po_number,
    vendor_id: body.vendor_id ?? '',
    vendor_name: body.vendor_name ?? '',
    issue_date: body.issue_date || null,
    delivery_date: body.delivery_date || null,
    status: body.status ?? 'open',
    currency: body.currency ?? 'USD',
    ...justification,
    total_amount: round2(lines.reduce((sum, l) => sum + l.amount, 0)),
    created_at: now,
    updated_at: now,
  }).select().single();
  if (error) return err(error.message, 500);

  if (lines.length) {
    const ins = await db.from('po_line_items').insert(lines.map((l) => ({ ...l, po_id: data.id })));
    if (ins.error) return err(ins.error.message, 500);
  }
  return json(poResponse(data, await getLineItems(data.id)), 201);
});

router.put('/api/pos/:po_number', async ({ req, params }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const po = await getPo(params.po_number);
  if (!po) return err('Not found', 404);

  const body = (await readJson(req)) ?? {};
  const lines = parseLineItems(body.line_items);
  const justification = justificationFromJson(body);
  if (justification.criticality && !CRITICALITY_VALUES.includes(justification.criticality)) {
    return err(`criticality must be one of: ${CRITICALITY_VALUES.join(', ')}`, 400);
  }

  const pick = (key: string, fallback: unknown) => (has(body, key) ? body[key] : fallback);
  const updates = {
    vendor_id: pick('vendor_id', po.vendor_id),
    vendor_name: pick('vendor_name', po.vendor_name),
    issue_date: pick('issue_date', po.issue_date),
    delivery_date: pick('delivery_date', po.delivery_date),
    status: pick('status', po.status),
    currency: pick('currency', po.currency || 'USD'),
    total_amount: round2(lines.reduce((sum, l) => sum + l.amount, 0)),
    updated_at: new Date().toISOString(),
    ...justification,
  };
  const upd = await db.from('purchase_orders').update(updates).eq('id', po.id);
  if (upd.error) return err(upd.error.message, 500);
  await replaceLines(po.id, lines);

  const fresh = (await getPo(params.po_number))!;
  return json(poResponse(fresh, await getLineItems(fresh.id)));
});

router.post('/api/pos/:po_number/document', async ({ req, params }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const po = await getPo(params.po_number);
  if (!po) return err('Not found', 404);

  const file = await readFile(req, 'file');
  if (!file) return err('Multipart form field "file" is required', 400);

  try {
    const { path, name } = await uploadDocument(db, file, `purchase-orders/${secureFilename(po.po_number)}`, ALLOWED_EXTENSIONS);
    const upd = await db.from('purchase_orders')
      .update({ document_path: path, document_name: name, updated_at: new Date().toISOString() })
      .eq('id', po.id).select().single();
    if (upd.error) throw new Error(upd.error.message);
    if (po.document_path) await removeObject(db, po.document_path);
    return json({ po_number: params.po_number, document_name: upd.data.document_name, document_path: upd.data.document_path }, 201);
  } catch (e) {
    if (e instanceof UploadError) return err(e.message, 400);
    return err(`Upload failed: ${(e as Error).message}`, 500);
  }
});

router.get('/api/pos/:po_number/document', async ({ req, params }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const po = await getPo(params.po_number);
  if (!po) return err('Not found', 404);
  if (!po.document_path) return err('No document attached to this purchase order', 404);
  try {
    return json({ document_name: po.document_name, url: await signedUrl(db, po.document_path), expires_in: 3600 });
  } catch (e) {
    return err((e as Error).message, 500);
  }
});

router.get('/api/pos/:po_number/document/download', async ({ req, params }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const po = await getPo(params.po_number);
  if (!po) return err('Not found', 404);
  if (!po.document_path) return err('No document attached to this purchase order', 404);
  try {
    return fileResponse(await downloadObject(db, po.document_path), po.document_name);
  } catch (e) {
    return err(`Download failed: ${(e as Error).message}`, 500);
  }
});

router.delete('/api/pos/:po_number', async ({ req, params }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const po = await getPo(params.po_number);
  if (!po) return err('Not found', 404);
  const lines = await db.from('po_line_items').delete().eq('po_id', po.id);
  if (lines.error) return err(lines.error.message, 500);
  const del = await db.from('purchase_orders').delete().eq('id', po.id);
  if (del.error) return err(del.error.message, 500);
  if (po.document_path) await removeObject(db, po.document_path);
  return noContent();
});

addKeyManagement(router, db, 'po_api_keys', 'po');

Deno.serve((req) => router.handle(req, 'procureos'));
