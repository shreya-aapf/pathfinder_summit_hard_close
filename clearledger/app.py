import hashlib
import hmac
import json
import os
import secrets
import urllib.request
import uuid
from datetime import datetime, timezone
from functools import wraps
from flask import Flask, request, jsonify, render_template, redirect, url_for, flash, Response, session
from supabase import create_client, Client
from dotenv import load_dotenv
from auth_gate import install_auth_gate
from werkzeug.utils import secure_filename

load_dotenv()

app = Flask(__name__, static_folder='public/static', static_url_path='/static')

URL_PREFIX = '/clearledger'


class _PrefixMiddleware:
    # Vercel forwards the full public path; strip the prefix but keep it in SCRIPT_NAME.
    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        path = environ.get('PATH_INFO', '')
        if path == URL_PREFIX or path.startswith(URL_PREFIX + '/'):
            environ['SCRIPT_NAME'] = URL_PREFIX
            environ['PATH_INFO'] = path[len(URL_PREFIX):] or '/'
        return self.wsgi_app(environ, start_response)


app.wsgi_app = _PrefixMiddleware(app.wsgi_app)
app.config['SESSION_COOKIE_NAME'] = 'clearledger_session'
install_auth_gate(app)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'dev-secret-key')
app.config['MAX_CONTENT_LENGTH'] = 4 * 1024 * 1024  # 4 MB upload cap (Vercel rejects request bodies over 4.5 MB)

supabase: Client = create_client(
    os.environ['SUPABASE_URL'],
    os.environ['SUPABASE_KEY']
)

# Cross-app links — all five apps share one Supabase project but are
# independent Flask processes on different ports, so links between them
# are plain URLs, not Flask url_for().
PROCUREOS_URL = os.environ.get('PROCUREOS_URL', '/procureos' if os.environ.get('VERCEL') else 'http://localhost:5002')
RECEIPTHUB_URL = os.environ.get('RECEIPTHUB_URL', '/receipthub' if os.environ.get('VERCEL') else 'http://localhost:5003')
AUDITTRAIL_URL = os.environ.get('AUDITTRAIL_URL', '/audittrail' if os.environ.get('VERCEL') else 'http://localhost:5005')


@app.context_processor
def inject_cross_app_urls():
    return dict(PROCUREOS_URL=PROCUREOS_URL, RECEIPTHUB_URL=RECEIPTHUB_URL, AUDITTRAIL_URL=AUDITTRAIL_URL)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ACTION_TO_STATUS = {
    'approve': 'approved',
    'contact_vendor': 'contacted',
    'escalate': 'escalated',
}

MISMATCH_LABELS = {
    'price_variance': 'Price Variance',
    'qty_mismatch': 'Qty Mismatch',
    'missing_gr': 'Missing GR',
    'ok': 'OK',
}


STORAGE_BUCKET = 'documents'
ALLOWED_EXTENSIONS = {'pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff'}

# Outbound webhook: when WEBHOOK_URL is unset, send_webhook is a no-op.
WEBHOOK_URL = os.environ.get('WEBHOOK_URL', '').strip()
WEBHOOK_SECRET = os.environ.get('WEBHOOK_SECRET', '')

# API key auth — demo key ships with the schema seed ("demo-key-meridiangl")
DEMO_KEY_HASH = '13a70133e81abd62377bc38332fc4507ff5f8ef9d56e309611f59b6546af0fb4'


def require_api_key(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        key = request.headers.get('X-API-Key', '')
        if not key:
            return jsonify({'error': 'Missing X-API-Key header'}), 401
        key_hash = hashlib.sha256(key.encode()).hexdigest()
        if key_hash == DEMO_KEY_HASH:
            return f(*args, **kwargs)
        result = supabase.table('gl_api_keys').select('id').eq('key_hash', key_hash).execute()
        if not result.data:
            return jsonify({'error': 'Invalid API key'}), 401
        return f(*args, **kwargs)
    return decorated


def send_webhook(event, data):
    """Best-effort POST to WEBHOOK_URL. Sent inline (short timeout) because a
    serverless host can freeze a background thread once the response returns."""
    if not WEBHOOK_URL:
        return
    payload_data = dict(data)
    if payload_data.get('document_path'):
        try:
            payload_data['document_url'] = document_url(payload_data['document_path'])
        except Exception:
            payload_data['document_url'] = None
    else:
        payload_data['document_url'] = None
    body = json.dumps({
        'event': event,
        'source': 'clearledger',
        'occurred_at': datetime.now(timezone.utc).isoformat(),
        'data': payload_data,
    }, default=str).encode()
    headers = {'Content-Type': 'application/json', 'X-Webhook-Event': event}
    if WEBHOOK_SECRET:
        digest = hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
        headers['X-Webhook-Signature'] = f'sha256={digest}'

    try:
        req = urllib.request.Request(WEBHOOK_URL, data=body, headers=headers, method='POST')
        urllib.request.urlopen(req, timeout=3).close()
    except Exception as e:
        app.logger.warning('Webhook %s to %s failed: %s', event, WEBHOOK_URL, e)


def upload_document(file_storage, folder):
    """Validates and uploads to the Supabase bucket. Returns (path, filename).
    Raises ValueError with a user-facing message on bad input."""
    name = secure_filename(file_storage.filename or '')
    ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
    if not name or ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f'Unsupported file type. Allowed: {", ".join(sorted(ALLOWED_EXTENSIONS))}.')
    data = file_storage.read()
    if not data:
        raise ValueError('The uploaded file is empty.')
    path = f'{folder}/{uuid.uuid4().hex[:8]}_{name}'
    supabase.storage.from_(STORAGE_BUCKET).upload(
        path, data, {'content-type': file_storage.mimetype or 'application/octet-stream'}
    )
    return path, name


def attach_document(invoice, file_storage):
    folder = f"invoices/{secure_filename(invoice['invoice_number'])}"
    path, name = upload_document(file_storage, folder)
    result = supabase.table('invoices').update({
        'document_path': path,
        'document_name': name,
        'updated_at': datetime.now(timezone.utc).isoformat(),
    }).eq('id', invoice['id']).execute()
    if invoice.get('document_path'):
        try:
            supabase.storage.from_(STORAGE_BUCKET).remove([invoice['document_path']])
        except Exception:
            pass  # a leftover old file is harmless; the new upload already succeeded
    return result.data[0]


def document_url(path):
    res = supabase.storage.from_(STORAGE_BUCKET).create_signed_url(path, 3600)
    return res.get('signedURL') or res.get('signedUrl')


def get_threshold_pct():
    try:
        result = supabase.table('settings').select('value').eq('key', 'threshold_pct').single().execute()
        return float(result.data['value'])
    except Exception:
        return 2.5


def enrich_invoices(invoices):
    for inv in invoices:
        inv['mismatch_label'] = MISMATCH_LABELS.get(inv.get('match_status', ''), inv.get('match_status', ''))
    return invoices


# ---------------------------------------------------------------------------
# UI routes
# ---------------------------------------------------------------------------

@app.route('/')
def queue():
    status_filter = request.args.get('status', '').strip()
    po_number_filter = request.args.get('po_number', '').strip()
    vendor_id_filter = request.args.get('vendor_id', '').strip()
    try:
        query = supabase.table('invoices').select(
            'id, invoice_number, vendor_id, vendor_name, invoice_date, po_number, '
            'gr_number, total_amount, match_status, variance_amount, variance_pct, '
            'status, created_at'
        ).order('created_at', desc=True)

        if status_filter and status_filter != 'all':
            query = query.eq('status', status_filter)
        if po_number_filter:
            query = query.eq('po_number', po_number_filter)
        if vendor_id_filter:
            query = query.eq('vendor_id', vendor_id_filter)

        result = query.execute()
        invoices = result.data or []
        invoices = enrich_invoices(invoices)
    except Exception as e:
        flash(f'Error loading invoices: {str(e)}', 'error')
        invoices = []

    # Compute per-status counts for the summary chips
    try:
        counts_result = supabase.table('invoices').select('status').execute()
        all_rows = counts_result.data or []
    except Exception:
        all_rows = []

    counts = {'pending': 0, 'approved': 0, 'escalated': 0, 'contacted': 0}
    for row in all_rows:
        s = row.get('status')
        if s in counts:
            counts[s] += 1
    counts['all'] = sum(counts.values())

    return render_template(
        'queue.html',
        invoices=invoices,
        status_filter=status_filter or 'all',
        po_number_filter=po_number_filter,
        vendor_id_filter=vendor_id_filter,
        counts=counts,
    )


@app.route('/invoices/lookup/<invoice_number>')
def invoice_lookup(invoice_number):
    """Deep-link target for other apps (e.g. AuditTrail) that only know an
    invoice_number, not the UUID that /invoices/<id> requires."""
    try:
        result = supabase.table('invoices').select('id').eq('invoice_number', invoice_number).single().execute()
        if not result.data:
            flash(f'No invoice found with number {invoice_number}.', 'error')
            return redirect(url_for('queue'))
        return redirect(url_for('detail', invoice_id=result.data['id']))
    except Exception:
        flash(f'No invoice found with number {invoice_number}.', 'error')
        return redirect(url_for('queue'))


@app.route('/invoices/new', methods=['GET'])
def new_invoice_form():
    return render_template('upload_invoice.html', form={})


@app.route('/invoices/new', methods=['POST'])
def create_invoice_upload():
    form = request.form
    fields = {k: form.get(k, '').strip() for k in
              ('invoice_number', 'vendor_id', 'vendor_name', 'invoice_date', 'po_number', 'gr_number', 'total_amount')}
    file = request.files.get('document')

    def fail(message):
        flash(message, 'error')
        return render_template('upload_invoice.html', form=fields), 400

    missing = [k for k in ('invoice_number', 'vendor_id', 'vendor_name', 'po_number', 'total_amount') if not fields[k]]
    if missing:
        return fail(f'Missing required fields: {", ".join(missing)}.')
    if not file or not file.filename:
        return fail('Please choose an invoice file to upload.')
    try:
        total_amount = float(fields['total_amount'])
    except ValueError:
        return fail('Total amount must be a number.')

    try:
        if supabase.table('invoices').select('id').eq('invoice_number', fields['invoice_number']).execute().data:
            return fail(f'Invoice {fields["invoice_number"]} already exists.')
        now = datetime.now(timezone.utc).isoformat()
        invoice = supabase.table('invoices').insert({
            'invoice_number': fields['invoice_number'],
            'vendor_id': fields['vendor_id'],
            'vendor_name': fields['vendor_name'],
            'invoice_date': fields['invoice_date'] or None,
            'po_number': fields['po_number'],
            'gr_number': fields['gr_number'] or None,
            'total_amount': total_amount,
            'variance_amount': 0,
            'variance_pct': 0,
            'status': 'pending',
            'created_at': now,
            'updated_at': now,
        }).execute().data[0]
    except Exception as e:
        return fail(f'Could not create invoice: {e}')

    try:
        invoice = attach_document(invoice, file)
    except Exception as e:
        # Don't leave a file-less record behind when the upload itself failed.
        supabase.table('invoices').delete().eq('id', invoice['id']).execute()
        return fail(str(e) if isinstance(e, ValueError) else f'Upload failed: {e}')

    send_webhook('invoice.created', invoice)
    flash(f'Invoice {invoice["invoice_number"]} uploaded.', 'success')
    return redirect(url_for('detail', invoice_id=invoice['id']))


@app.route('/invoices/<invoice_id>/document', methods=['POST'])
def upload_invoice_document(invoice_id):
    file = request.files.get('document')
    if not file or not file.filename:
        flash('Please choose a file to upload.', 'error')
        return redirect(url_for('detail', invoice_id=invoice_id))
    try:
        invoice = supabase.table('invoices').select('*').eq('id', invoice_id).single().execute().data
        updated = attach_document(invoice, file)
    except ValueError as e:
        flash(str(e), 'error')
        return redirect(url_for('detail', invoice_id=invoice_id))
    except Exception as e:
        flash(f'Upload failed: {e}', 'error')
        return redirect(url_for('detail', invoice_id=invoice_id))

    send_webhook('invoice.updated', updated)
    flash(f'Document "{updated["document_name"]}" attached.', 'success')
    return redirect(url_for('detail', invoice_id=invoice_id))


@app.route('/invoices/<invoice_id>/document', methods=['GET'])
def view_invoice_document(invoice_id):
    try:
        invoice = supabase.table('invoices').select('document_path').eq('id', invoice_id).single().execute().data
        if not invoice or not invoice.get('document_path'):
            raise LookupError
        return redirect(document_url(invoice['document_path']))
    except Exception:
        flash('No document found for this invoice.', 'error')
        return redirect(url_for('detail', invoice_id=invoice_id))


@app.route('/invoices/<invoice_id>')
def detail(invoice_id):
    try:
        inv_result = supabase.table('invoices').select('*').eq('id', invoice_id).single().execute()
        invoice = inv_result.data
        if not invoice:
            flash('Invoice not found.', 'error')
            return redirect(url_for('queue'))
    except Exception:
        flash('Invoice not found.', 'error')
        return redirect(url_for('queue'))

    try:
        li_result = supabase.table('invoice_line_items').select('*').eq('invoice_id', invoice_id).order('line_number').execute()
        line_items = li_result.data or []
    except Exception:
        line_items = []

    try:
        actions_result = supabase.table('invoice_actions').select('*').eq('invoice_id', invoice_id).order('actioned_at', desc=True).execute()
        actions = actions_result.data or []
    except Exception:
        actions = []

    threshold_pct = get_threshold_pct()

    # AuditTrail (hard-tier system) shares this Supabase project — check whether
    # this invoice has an open vendor fraud flag so we can surface a warning
    # here rather than requiring the reviewer to already know to look there.
    try:
        flag_result = (
            supabase.table('vendor_flags')
            .select('id, status, flag_type')
            .eq('invoice_number', invoice['invoice_number'])
            .execute()
        )
        vendor_flag = flag_result.data[0] if flag_result.data else None
    except Exception:
        vendor_flag = None

    return render_template(
        'detail.html',
        invoice=invoice,
        line_items=line_items,
        actions=actions,
        threshold_pct=threshold_pct,
        mismatch_labels=MISMATCH_LABELS,
        vendor_flag=vendor_flag,
    )


@app.route('/settings')
def settings():
    try:
        result = supabase.table('settings').select('*').eq('key', 'threshold_pct').single().execute()
        setting = result.data or {}
    except Exception:
        setting = {'value': 2.5, 'updated_at': None}

    return render_template('settings.html', setting=setting)


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

@app.route('/api/invoices', methods=['POST'])
@require_api_key
def api_create_invoice():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body must be JSON'}), 400

    required = ['invoice_number', 'vendor_id', 'vendor_name', 'invoice_date',
                'po_number', 'total_amount', 'match_status']
    missing = [f for f in required if f not in data]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    # Check for duplicate at the API layer because the unique constraint error from
    # Supabase/Postgres is less predictable to parse across client versions.
    try:
        dup_check = supabase.table('invoices').select('id').eq('invoice_number', data['invoice_number']).execute()
        if dup_check.data:
            return jsonify({'error': f'Invoice {data["invoice_number"]} already exists'}), 409
    except Exception as e:
        return jsonify({'error': f'Database error: {str(e)}'}), 500

    now = datetime.now(timezone.utc).isoformat()
    invoice_row = {
        'invoice_number': data['invoice_number'],
        'vendor_id': data['vendor_id'],
        'vendor_name': data['vendor_name'],
        'invoice_date': data['invoice_date'],
        'po_number': data['po_number'],
        'gr_number': data.get('gr_number'),
        'total_amount': data['total_amount'],
        'match_status': data['match_status'],
        'variance_amount': data.get('variance_amount', 0),
        'variance_pct': data.get('variance_pct', 0),
        'status': 'pending',
        'created_at': now,
        'updated_at': now,
    }

    try:
        inv_result = supabase.table('invoices').insert(invoice_row).execute()
        invoice = inv_result.data[0]
    except Exception as e:
        return jsonify({'error': f'Failed to create invoice: {str(e)}'}), 500

    line_items = data.get('line_items', [])
    if line_items:
        li_rows = []
        for li in line_items:
            li_rows.append({
                'invoice_id': invoice['id'],
                'line_number': li.get('line_number'),
                'description': li.get('description'),
                'invoice_qty': li.get('invoice_qty'),
                'invoice_unit_price': li.get('invoice_unit_price'),
                'po_qty': li.get('po_qty'),
                'po_unit_price': li.get('po_unit_price'),
                'gr_qty': li.get('gr_qty'),
                'mismatch_type': li.get('mismatch_type', 'ok'),
                'variance_amount': li.get('variance_amount', 0),
            })
        try:
            supabase.table('invoice_line_items').insert(li_rows).execute()
        except Exception as e:
            return jsonify({'error': f'Invoice created but line items failed: {str(e)}'}), 500

    send_webhook('invoice.created', invoice)
    return jsonify({'id': invoice['id'], 'invoice_number': invoice['invoice_number']}), 201


@app.route('/api/invoices', methods=['GET'])
@require_api_key
def api_list_invoices():
    status_filter = request.args.get('status')
    vendor_id = request.args.get('vendor_id')
    page = max(1, int(request.args.get('page', 1)))
    limit = min(200, max(1, int(request.args.get('limit', 50))))
    offset = (page - 1) * limit

    try:
        query = supabase.table('invoices').select('*').order('created_at', desc=True).range(offset, offset + limit - 1)
        if status_filter:
            query = query.eq('status', status_filter)
        if vendor_id:
            query = query.eq('vendor_id', vendor_id)
        result = query.execute()
        return jsonify(result.data or [])
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/invoices/<invoice_id>', methods=['GET'])
@require_api_key
def api_get_invoice(invoice_id):
    try:
        inv_result = supabase.table('invoices').select('*').eq('id', invoice_id).single().execute()
        if not inv_result.data:
            return jsonify({'error': 'Invoice not found'}), 404
        invoice = inv_result.data
    except Exception as e:
        if 'PGRST116' in str(e):
            return jsonify({'error': 'Invoice not found'}), 404
        return jsonify({'error': str(e)}), 500

    try:
        li_result = supabase.table('invoice_line_items').select('*').eq('invoice_id', invoice_id).order('line_number').execute()
        invoice['line_items'] = li_result.data or []
    except Exception:
        invoice['line_items'] = []

    try:
        actions_result = supabase.table('invoice_actions').select('*').eq('invoice_id', invoice_id).order('actioned_at', desc=True).execute()
        invoice['actions'] = actions_result.data or []
    except Exception:
        invoice['actions'] = []

    return jsonify(invoice)


@app.route('/ui/invoices/<invoice_id>/action', methods=['PATCH'])
def ui_invoice_action(invoice_id):
    return _invoice_action(invoice_id)


@app.route('/api/invoices/<invoice_id>/action', methods=['PATCH'])
@require_api_key
def api_invoice_action(invoice_id):
    return _invoice_action(invoice_id)


def _invoice_action(invoice_id):
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body must be JSON'}), 400

    action = data.get('action')
    if action not in ACTION_TO_STATUS:
        return jsonify({'error': f'action must be one of: {", ".join(ACTION_TO_STATUS.keys())}'}), 400

    # Verify the invoice exists before acting on it
    try:
        check = supabase.table('invoices').select('id').eq('id', invoice_id).single().execute()
        if not check.data:
            return jsonify({'error': 'Invoice not found'}), 404
    except Exception as e:
        if 'PGRST116' in str(e):
            return jsonify({'error': 'Invoice not found'}), 404
        return jsonify({'error': str(e)}), 500

    now = datetime.now(timezone.utc).isoformat()
    new_status = ACTION_TO_STATUS[action]

    try:
        supabase.table('invoices').update({'status': new_status, 'updated_at': now}).eq('id', invoice_id).execute()
    except Exception as e:
        return jsonify({'error': f'Failed to update invoice: {str(e)}'}), 500

    try:
        supabase.table('invoice_actions').insert({
            'invoice_id': invoice_id,
            'action_type': action,
            'note': data.get('note', ''),
            'actioned_at': now,
        }).execute()
    except Exception as e:
        return jsonify({'error': f'Status updated but action log failed: {str(e)}'}), 500

    try:
        updated = supabase.table('invoices').select('*').eq('id', invoice_id).single().execute()
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    send_webhook('invoice.updated', {**updated.data, 'action': action, 'note': data.get('note', '')})
    return jsonify(updated.data)


@app.route('/api/invoices/<invoice_id>/document', methods=['POST'])
@require_api_key
def api_upload_invoice_document(invoice_id):
    file = request.files.get('file')
    if not file or not file.filename:
        return jsonify({'error': 'Multipart form field "file" is required'}), 400

    try:
        invoice = supabase.table('invoices').select('*').eq('id', invoice_id).single().execute().data
    except Exception as e:
        if 'PGRST116' in str(e):
            return jsonify({'error': 'Invoice not found'}), 404
        return jsonify({'error': str(e)}), 500

    try:
        updated = attach_document(invoice, file)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f'Upload failed: {e}'}), 500

    send_webhook('invoice.updated', updated)
    return jsonify({'id': updated['id'], 'document_name': updated['document_name'],
                    'document_path': updated['document_path']}), 201


@app.route('/api/invoices/<invoice_id>/document', methods=['GET'])
@require_api_key
def api_get_invoice_document(invoice_id):
    try:
        invoice = supabase.table('invoices').select('document_name, document_path').eq('id', invoice_id).single().execute().data
    except Exception as e:
        if 'PGRST116' in str(e):
            return jsonify({'error': 'Invoice not found'}), 404
        return jsonify({'error': str(e)}), 500

    if not invoice.get('document_path'):
        return jsonify({'error': 'No document attached to this invoice'}), 404
    try:
        return jsonify({'document_name': invoice['document_name'], 'url': document_url(invoice['document_path']),
                        'expires_in': 3600})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/invoices/<invoice_id>/document/download', methods=['GET'])
@require_api_key
def api_download_invoice_document(invoice_id):
    try:
        invoice = supabase.table('invoices').select('document_name, document_path').eq('id', invoice_id).single().execute().data
    except Exception as e:
        if 'PGRST116' in str(e):
            return jsonify({'error': 'Invoice not found'}), 404
        return jsonify({'error': str(e)}), 500

    if not invoice.get('document_path'):
        return jsonify({'error': 'No document attached to this invoice'}), 404

    try:
        file_bytes = supabase.storage.from_(STORAGE_BUCKET).download(invoice['document_path'])
    except Exception as e:
        return jsonify({'error': f'Download failed: {e}'}), 500

    return Response(
        file_bytes,
        mimetype='application/octet-stream',
        headers={'Content-Disposition': f'attachment; filename="{invoice["document_name"]}"'},
    )


@app.route('/api/settings/threshold', methods=['GET'])
@require_api_key
def api_get_threshold():
    try:
        result = supabase.table('settings').select('value, updated_at').eq('key', 'threshold_pct').single().execute()
        return jsonify({'threshold_pct': float(result.data['value']), 'updated_at': result.data.get('updated_at')})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/ui/settings/threshold', methods=['PUT'])
def ui_set_threshold():
    return _set_threshold()


@app.route('/api/settings/threshold', methods=['PUT'])
@require_api_key
def api_set_threshold():
    return _set_threshold()


def _set_threshold():
    data = request.get_json(silent=True)
    if not data or 'threshold_pct' not in data:
        return jsonify({'error': 'Body must include threshold_pct'}), 400

    try:
        value = float(data['threshold_pct'])
    except (TypeError, ValueError):
        return jsonify({'error': 'threshold_pct must be a number'}), 400

    if not (0 <= value <= 100):
        return jsonify({'error': 'threshold_pct must be between 0 and 100'}), 400

    now = datetime.now(timezone.utc).isoformat()
    try:
        supabase.table('settings').update({'value': str(value), 'updated_at': now}).eq('key', 'threshold_pct').execute()
        return jsonify({'threshold_pct': value, 'updated_at': now})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ---------------------------------------------------------------------------
# API key management UI
# ---------------------------------------------------------------------------

@app.route('/settings/api-keys', methods=['GET'])
def api_keys():
    try:
        result = supabase.table('gl_api_keys').select('id, label, created_at').order('created_at', desc=True).execute()
        keys = result.data or []
    except Exception as e:
        flash(f'Could not load API keys: {e}', 'error')
        keys = []
    new_key = session.pop('new_api_key', None)
    return render_template('api_keys.html', keys=keys, new_key=new_key)


@app.route('/settings/api-keys', methods=['POST'])
def create_api_key():
    label = request.form.get('label', '').strip() or 'Unnamed key'
    raw_key = f'cl-{secrets.token_urlsafe(32)}'
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    try:
        supabase.table('gl_api_keys').insert({
            'key_hash': key_hash,
            'label': label,
            'created_at': datetime.now(timezone.utc).isoformat(),
        }).execute()
        session['new_api_key'] = raw_key
    except Exception as e:
        flash(f'Could not create key: {e}', 'error')
    return redirect(url_for('api_keys'))


@app.route('/settings/api-keys/<key_id>/revoke', methods=['POST'])
def revoke_api_key(key_id):
    try:
        supabase.table('gl_api_keys').delete().eq('id', key_id).execute()
        flash('API key revoked.', 'success')
    except Exception as e:
        flash(f'Could not revoke key: {e}', 'error')
    return redirect(url_for('api_keys'))


# ---------------------------------------------------------------------------

if __name__ == '__main__':
    app.run(debug=False, port=int(os.environ.get('PORT', 5001)))
