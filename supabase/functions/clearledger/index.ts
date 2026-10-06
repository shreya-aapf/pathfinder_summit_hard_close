import { db } from '../_shared/db.ts';
import { err, fileResponse, json, readJson } from '../_shared/http.ts';
import { Router } from '../_shared/router.ts';
import { authenticate, type KeyAuthConfig } from '../_shared/auth.ts';
import { addKeyManagement } from '../_shared/keys.ts';
import { sendWebhook } from '../_shared/webhook.ts';
import { downloadObject, readFile, removeObject, secureFilename, signedUrl, UploadError, uploadDocument } from '../_shared/storage.ts';

const KEY_AUTH: KeyAuthConfig = {
  table: 'cl_api_keys',
  demoHash: '2093db633edc2c04712a486f20ba4fe45e0af387b6bc0ecb1fd216b06df4094f',
  missing: { message: 'Missing X-API-Key header', status: 401 },
  invalid: { message: 'Invalid API key', status: 401 },
};

const ALLOWED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff'];
const ACTION_TO_STATUS: Record<string, string> = {
  approve: 'approved',
  contact_vendor: 'contacted',
  escalate: 'escalated',
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const has = (o: Row, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const webhook = (event: string, data: Row) => sendWebhook('clearledger', event, data, (p) => signedUrl(db, p));

const router = new Router();
const guard = async (req: Request) => await authenticate(req, db, KEY_AUTH);

// Returns the invoice row, null when it does not exist (including ids that are not UUIDs).
async function getInvoice(id: string): Promise<Row | null> {
  if (!UUID_RE.test(id)) return null;
  const { data, error } = await db.from('invoices').select('*').eq('id', id).limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

async function getThresholdPct(): Promise<number> {
  try {
    const { data, error } = await db.from('settings').select('value').eq('key', 'threshold_pct').limit(1);
    if (error || !data?.length) return 2.5;
    const v = parseFloat(data[0].value);
    return Number.isFinite(v) ? v : 2.5;
  } catch {
    return 2.5;
  }
}

async function attachDocument(invoice: Row, file: File): Promise<Row> {
  const folder = `invoices/${secureFilename(String(invoice.invoice_number))}`;
  const { path, name } = await uploadDocument(db, file, folder, ALLOWED_EXTENSIONS);
  const upd = await db.from('invoices')
    .update({ document_path: path, document_name: name, updated_at: new Date().toISOString() })
    .eq('id', invoice.id).select().single();
  if (upd.error) throw new Error(upd.error.message);
  if (invoice.document_path) await removeObject(db, invoice.document_path);
  return upd.data;
}

function uploadErrorResponse(e: unknown): Response {
  if (e instanceof UploadError) return err(e.message, 400);
  const m = msg(e);
  return err(m.startsWith('Upload failed') ? m : `Upload failed: ${m}`, 500);
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

router.post('/api/invoices', async ({ req }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const data = await readJson(req);
  if (!data || !Object.keys(data).length) return err('Request body must be JSON', 400);

  const required = ['invoice_number', 'vendor_id', 'vendor_name', 'invoice_date', 'po_number', 'total_amount', 'match_status'];
  const missing = required.filter((f) => !has(data, f));
  if (missing.length) return err(`Missing required fields: ${missing.join(', ')}`, 400);

  const dup = await db.from('invoices').select('id').eq('invoice_number', data.invoice_number);
  if (dup.error) return err(`Database error: ${dup.error.message}`, 500);
  if (dup.data.length) return err(`Invoice ${data.invoice_number} already exists`, 409);

  const now = new Date().toISOString();
  const ins = await db.from('invoices').insert({
    invoice_number: data.invoice_number,
    vendor_id: data.vendor_id,
    vendor_name: data.vendor_name,
    invoice_date: data.invoice_date,
    po_number: data.po_number,
    gr_number: data.gr_number ?? null,
    total_amount: data.total_amount,
    match_status: data.match_status,
    variance_amount: data.variance_amount ?? 0,
    variance_pct: data.variance_pct ?? 0,
    status: 'pending',
    created_at: now,
    updated_at: now,
  }).select().single();
  if (ins.error) return err(`Failed to create invoice: ${ins.error.message}`, 500);
  const invoice = ins.data;

  const items: Row[] = Array.isArray(data.line_items) ? data.line_items : [];
  if (items.length) {
    const rows = items.map((li) => ({
      invoice_id: invoice.id,
      line_number: li?.line_number ?? null,
      description: li?.description ?? null,
      invoice_qty: li?.invoice_qty ?? null,
      invoice_unit_price: li?.invoice_unit_price ?? null,
      po_qty: li?.po_qty ?? null,
      po_unit_price: li?.po_unit_price ?? null,
      gr_qty: li?.gr_qty ?? null,
      mismatch_type: li?.mismatch_type ?? 'ok',
      variance_amount: li?.variance_amount ?? 0,
    }));
    const li = await db.from('invoice_line_items').insert(rows);
    if (li.error) return err(`Invoice created but line items failed: ${li.error.message}`, 500);
  }

  await webhook('invoice.created', invoice);
  return json({ id: invoice.id, invoice_number: invoice.invoice_number }, 201);
});

// Additive: the UI upload form (multipart) creates an invoice together with its document.
router.post('/api/invoices/upload', async ({ req }) => {
  const denied = await guard(req);
  if (denied) return denied;

  let form: FormData | null = null;
  try {
    form = await req.formData();
  } catch { /* handled as missing fields below */ }

  const names = ['invoice_number', 'vendor_id', 'vendor_name', 'invoice_date', 'po_number', 'gr_number', 'total_amount'];
  const fields: Record<string, string> = {};
  for (const k of names) {
    const v = form?.get(k);
    fields[k] = typeof v === 'string' ? v.trim() : '';
  }
  const raw = form?.get('document');
  const file = raw instanceof File && raw.name ? raw : null;

  const missing = ['invoice_number', 'vendor_id', 'vendor_name', 'po_number', 'total_amount'].filter((k) => !fields[k]);
  if (missing.length) return err(`Missing required fields: ${missing.join(', ')}.`, 400);
  if (!file) return err('Please choose an invoice file to upload.', 400);
  const total_amount = Number(fields.total_amount);
  if (!Number.isFinite(total_amount)) return err('Total amount must be a number.', 400);

  let invoice: Row;
  try {
    const dup = await db.from('invoices').select('id').eq('invoice_number', fields.invoice_number);
    if (dup.error) throw new Error(dup.error.message);
    if (dup.data.length) return err(`Invoice ${fields.invoice_number} already exists.`, 400);
    const now = new Date().toISOString();
    const ins = await db.from('invoices').insert({
      invoice_number: fields.invoice_number,
      vendor_id: fields.vendor_id,
      vendor_name: fields.vendor_name,
      invoice_date: fields.invoice_date || null,
      po_number: fields.po_number,
      gr_number: fields.gr_number || null,
      total_amount,
      variance_amount: 0,
      variance_pct: 0,
      status: 'pending',
      created_at: now,
      updated_at: now,
    }).select().single();
    if (ins.error) throw new Error(ins.error.message);
    invoice = ins.data;
  } catch (e) {
    return err(`Could not create invoice: ${msg(e)}`, 400);
  }

  try {
    invoice = await attachDocument(invoice, file);
  } catch (e) {
    // Do not leave a file-less record behind when the upload itself failed.
    await db.from('invoices').delete().eq('id', invoice.id);
    return uploadErrorResponse(e);
  }

  await webhook('invoice.created', invoice);
  return json(invoice, 201);
});

// Additive: resolve an invoice number to its id (deep links from other apps).
router.get('/api/invoices/lookup/:invoice_number', async ({ req, params }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const { data, error } = await db.from('invoices').select('id').eq('invoice_number', params.invoice_number).limit(1);
  if (error) return err(error.message, 500);
  if (!data.length) return err('Invoice not found', 404);
  return json({ id: data[0].id });
});

router.get('/api/invoices', async ({ req, query }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const status = query.get('status');
  const vendor_id = query.get('vendor_id');
  const po_number = query.get('po_number'); // additive filter used by the queue page
  const page = Math.max(1, parseInt(query.get('page') ?? '1', 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.get('limit') ?? '50', 10) || 50));
  const offset = (page - 1) * limit;

  let q = db.from('invoices').select('*').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (vendor_id) q = q.eq('vendor_id', vendor_id);
  if (po_number) q = q.eq('po_number', po_number);
  const { data, error } = await q.range(offset, offset + limit - 1);
  if (error) return err(error.message, 500);
  return json(data ?? []);
});

router.get('/api/invoices/:invoice_id', async ({ req, params }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const invoice = await getInvoice(params.invoice_id);
  if (!invoice) return err('Invoice not found', 404);

  const li = await db.from('invoice_line_items').select('*').eq('invoice_id', invoice.id).order('line_number');
  invoice.line_items = li.error ? [] : li.data ?? [];
  const acts = await db.from('invoice_actions').select('*').eq('invoice_id', invoice.id).order('actioned_at', { ascending: false });
  invoice.actions = acts.error ? [] : acts.data ?? [];

  // Additive fields for the detail page.
  const flag = await db.from('vendor_flags').select('id, status, flag_type').eq('invoice_number', invoice.invoice_number);
  invoice.vendor_flag = flag.error || !flag.data?.length ? null : flag.data[0];
  invoice.threshold_pct = await getThresholdPct();
  return json(invoice);
});

router.patch('/api/invoices/:invoice_id/action', async ({ req, params }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const data = await readJson(req);
  if (!data || !Object.keys(data).length) return err('Request body must be JSON', 400);

  const action = data.action;
  if (typeof action !== 'string' || !has(ACTION_TO_STATUS, action)) {
    return err(`action must be one of: ${Object.keys(ACTION_TO_STATUS).join(', ')}`, 400);
  }
  const invoice = await getInvoice(params.invoice_id);
  if (!invoice) return err('Invoice not found', 404);

  const now = new Date().toISOString();
  const upd = await db.from('invoices').update({ status: ACTION_TO_STATUS[action], updated_at: now }).eq('id', invoice.id);
  if (upd.error) return err(`Failed to update invoice: ${upd.error.message}`, 500);

  const note = data.note ?? '';
  const log = await db.from('invoice_actions').insert({ invoice_id: invoice.id, action_type: action, note, actioned_at: now });
  if (log.error) return err(`Status updated but action log failed: ${log.error.message}`, 500);

  const updated = await getInvoice(invoice.id);
  if (!updated) return err('Invoice not found', 404);
  await webhook('invoice.updated', { ...updated, action, note });
  return json(updated);
});

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

router.post('/api/invoices/:invoice_id/document', async ({ req, params }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const file = await readFile(req, 'file');
  if (!file) return err('Multipart form field "file" is required', 400);
  const invoice = await getInvoice(params.invoice_id);
  if (!invoice) return err('Invoice not found', 404);

  let updated: Row;
  try {
    updated = await attachDocument(invoice, file);
  } catch (e) {
    return uploadErrorResponse(e);
  }
  await webhook('invoice.updated', updated);
  return json({ id: updated.id, document_name: updated.document_name, document_path: updated.document_path }, 201);
});

router.get('/api/invoices/:invoice_id/document', async ({ req, params }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const invoice = await getInvoice(params.invoice_id);
  if (!invoice) return err('Invoice not found', 404);
  if (!invoice.document_path) return err('No document attached to this invoice', 404);
  try {
    return json({ document_name: invoice.document_name, url: await signedUrl(db, invoice.document_path), expires_in: 3600 });
  } catch (e) {
    return err(msg(e), 500);
  }
});

router.get('/api/invoices/:invoice_id/document/download', async ({ req, params }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const invoice = await getInvoice(params.invoice_id);
  if (!invoice) return err('Invoice not found', 404);
  if (!invoice.document_path) return err('No document attached to this invoice', 404);
  try {
    return fileResponse(await downloadObject(db, invoice.document_path), invoice.document_name);
  } catch (e) {
    return err(`Download failed: ${msg(e)}`, 500);
  }
});

// ---------------------------------------------------------------------------
// Threshold setting
// ---------------------------------------------------------------------------

router.get('/api/settings/threshold', async ({ req }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const { data, error } = await db.from('settings').select('value, updated_at').eq('key', 'threshold_pct').limit(1);
  if (error) return err(error.message, 500);
  if (!data.length) return err('threshold_pct setting not found', 500);
  return json({ threshold_pct: parseFloat(data[0].value), updated_at: data[0].updated_at ?? null });
});

router.put('/api/settings/threshold', async ({ req }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const data = await readJson(req);
  if (!data || !has(data, 'threshold_pct')) return err('Body must include threshold_pct', 400);

  const raw = data.threshold_pct;
  const value = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '') ? Number(raw) : NaN;
  if (!Number.isFinite(value)) return err('threshold_pct must be a number', 400);
  if (value < 0 || value > 100) return err('threshold_pct must be between 0 and 100', 400);

  const now = new Date().toISOString();
  const { error } = await db.from('settings').update({ value: String(value), updated_at: now }).eq('key', 'threshold_pct');
  if (error) return err(error.message, 500);
  return json({ threshold_pct: value, updated_at: now });
});

addKeyManagement(router, db, 'cl_api_keys', 'cl');

Deno.serve((req) => router.handle(req, 'clearledger'));
