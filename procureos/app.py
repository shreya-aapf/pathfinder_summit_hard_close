import os
import hashlib
import secrets
import uuid
from functools import wraps
from datetime import datetime, timezone

from flask import Flask, request, jsonify, render_template, redirect, url_for, flash, abort, Response, session
from supabase import create_client, Client
from dotenv import load_dotenv
from werkzeug.utils import secure_filename

load_dotenv()

app = Flask(__name__, static_folder='public/static', static_url_path='/static')

URL_PREFIX = '/procureos'


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
app.config['SESSION_COOKIE_NAME'] = 'procureos_session'
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'change-me-in-production')
app.config['MAX_CONTENT_LENGTH'] = 4 * 1024 * 1024  # 4 MB upload cap (Vercel rejects request bodies over 4.5 MB)

supabase: Client = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

# Cross-app links — independent Flask processes on different ports, so
# links between them are plain URLs, not Flask url_for().
CLEARLEDGER_URL = os.environ.get('CLEARLEDGER_URL', '/clearledger' if os.environ.get('VERCEL') else 'http://localhost:5001')
RECEIPTHUB_URL = os.environ.get('RECEIPTHUB_URL', '/receipthub' if os.environ.get('VERCEL') else 'http://localhost:5003')


@app.context_processor
def inject_cross_app_urls():
    return dict(CLEARLEDGER_URL=CLEARLEDGER_URL, RECEIPTHUB_URL=RECEIPTHUB_URL)


DEMO_KEY_HASH = 'e2ea498f352094908ededbb13b347a72657a0ba3348b5f11bf504e0343ac2d86'


def require_api_key(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        key = request.headers.get('X-API-Key', '')
        if not key:
            return jsonify({"error": "Unauthorized"}), 401
        key_hash = hashlib.sha256(key.encode()).hexdigest()
        # Fast path: hardcoded demo key so it works even if schema seed row is absent
        if key_hash == DEMO_KEY_HASH:
            return f(*args, **kwargs)
        result = supabase.table('po_api_keys').select('id').eq('key_hash', key_hash).execute()
        if not result.data:
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated


STORAGE_BUCKET = 'documents'
ALLOWED_EXTENSIONS = {'pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'doc', 'docx', 'xls', 'xlsx'}

# PO justification questions, in the order they appear on the form.
JUSTIFICATION_TEXT_FIELDS = (
    'purchase_what', 'purchase_why', 'no_purchase_impact',
    'alternative_tool', 'roi_benefit', 'okr_alignment',
)
CRITICALITY_VALUES = ('keep_the_lights_on', 'nice_to_have')


def _justification_from_form(form):
    data = {k: form.get(k, '').strip() for k in JUSTIFICATION_TEXT_FIELDS}
    data['criticality'] = form.get('criticality', '').strip()
    return data


def _justification_from_json(body):
    return {k: body[k] for k in (*JUSTIFICATION_TEXT_FIELDS, 'criticality') if k in body}


def _missing_justification(data):
    missing = [k for k in JUSTIFICATION_TEXT_FIELDS if not data.get(k)]
    if data.get('criticality') not in CRITICALITY_VALUES:
        missing.append('criticality')
    return missing


def _upload_document(file_storage, folder):
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


def _attach_po_document(po, file_storage):
    path, name = _upload_document(file_storage, f"purchase-orders/{secure_filename(po['po_number'])}")
    result = supabase.table('purchase_orders').update({
        'document_path': path,
        'document_name': name,
        'updated_at': datetime.now(timezone.utc).isoformat(),
    }).eq('id', po['id']).execute()
    if po.get('document_path'):
        try:
            supabase.storage.from_(STORAGE_BUCKET).remove([po['document_path']])
        except Exception:
            pass  # a leftover old file is harmless; the new upload already succeeded
    return result.data[0]


def _document_url(path):
    res = supabase.storage.from_(STORAGE_BUCKET).create_signed_url(path, 3600)
    return res.get('signedURL') or res.get('signedUrl')


def _parse_line_items_from_form(form):
    items = []
    i = 1
    while f'line_item_{i}_item_code' in form:
        item_code = form.get(f'line_item_{i}_item_code', '').strip()
        description = form.get(f'line_item_{i}_description', '').strip()
        try:
            quantity = float(form.get(f'line_item_{i}_quantity', 0))
        except ValueError:
            quantity = 0.0
        try:
            unit_price = float(form.get(f'line_item_{i}_unit_price', 0))
        except ValueError:
            unit_price = 0.0
        if item_code:
            items.append({
                'line_number': i,
                'item_code': item_code,
                'description': description,
                'quantity': quantity,
                'unit_price': unit_price,
                'amount': round(quantity * unit_price, 2),
            })
        i += 1
    return items


def _parse_line_items_from_json(data):
    items = []
    for idx, item in enumerate(data, start=1):
        try:
            quantity = float(item.get('quantity', 0))
        except (ValueError, TypeError):
            quantity = 0.0
        try:
            unit_price = float(item.get('unit_price', 0))
        except (ValueError, TypeError):
            unit_price = 0.0
        items.append({
            'line_number': item.get('line_number', idx),
            'item_code': item.get('item_code', ''),
            'description': item.get('description', ''),
            'quantity': quantity,
            'unit_price': unit_price,
            'amount': round(quantity * unit_price, 2),
        })
    return items


def _get_po_by_number(po_number):
    result = supabase.table('purchase_orders').select('*').eq('po_number', po_number).execute()
    return result.data[0] if result.data else None


def _get_line_items_for_po(po_id):
    result = (
        supabase.table('po_line_items')
        .select('*')
        .eq('po_id', po_id)
        .order('line_number')
        .execute()
    )
    return result.data


def _create_po_and_lines(po_data, line_items):
    total_amount = sum(item['amount'] for item in line_items)
    po_data['total_amount'] = round(total_amount, 2)
    po_data['created_at'] = datetime.now(timezone.utc).isoformat()
    po_data['updated_at'] = datetime.now(timezone.utc).isoformat()

    po_result = supabase.table('purchase_orders').insert(po_data).execute()
    po = po_result.data[0]

    if line_items:
        rows = [{**item, 'po_id': po['id']} for item in line_items]
        supabase.table('po_line_items').insert(rows).execute()

    return po


def _replace_po_lines(po_id, line_items):
    supabase.table('po_line_items').delete().eq('po_id', po_id).execute()
    if line_items:
        rows = [{**item, 'po_id': po_id} for item in line_items]
        supabase.table('po_line_items').insert(rows).execute()


def _po_to_api_response(po, line_items):
    return {
        'po_number': po['po_number'],
        'vendor_id': po['vendor_id'],
        'vendor_name': po['vendor_name'],
        'issue_date': po['issue_date'],
        'delivery_date': po['delivery_date'],
        'status': po['status'],
        'currency': po.get('currency') or 'USD',
        'total_amount': po['total_amount'],
        'document_name': po.get('document_name'),
        'justification': {
            'purchase_what': po.get('purchase_what'),
            'purchase_why': po.get('purchase_why'),
            'no_purchase_impact': po.get('no_purchase_impact'),
            'criticality': po.get('criticality'),
            'alternative_tool': po.get('alternative_tool'),
            'roi_benefit': po.get('roi_benefit'),
            'okr_alignment': po.get('okr_alignment'),
        },
        'line_items': [
            {
                'line_number': li['line_number'],
                'item_code': li['item_code'],
                'description': li['description'],
                'quantity': li['quantity'],
                'unit_price': li['unit_price'],
                'amount': li['amount'],
            }
            for li in line_items
        ],
    }


# ---------------------------------------------------------------------------
# UI Routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    search = request.args.get('search', '').strip()
    status_filter = request.args.get('status', '').strip()

    query = supabase.table('purchase_orders').select('*').order('created_at', desc=True)

    if status_filter:
        query = query.eq('status', status_filter)

    result = query.execute()
    pos = result.data

    if search:
        search_lower = search.lower()
        pos = [
            p for p in pos
            if search_lower in p['po_number'].lower()
            or search_lower in (p['vendor_name'] or '').lower()
        ]

    return render_template('index.html', pos=pos, search=search, status_filter=status_filter)


@app.route('/po/new', methods=['GET'])
def new_po_form():
    return render_template('form.html', po=None, line_items=[], mode='create')


@app.route('/po/new', methods=['POST'])
def create_po():
    form = request.form
    po_number = form.get('po_number', '').strip()
    if not po_number:
        flash('PO Number is required.', 'error')
        return redirect(url_for('new_po_form'))

    existing = _get_po_by_number(po_number)
    if existing:
        flash(f'PO number {po_number} already exists.', 'error')
        return redirect(url_for('new_po_form'))

    line_items = _parse_line_items_from_form(form)
    if not line_items:
        flash('At least one line item is required.', 'error')
        return redirect(url_for('new_po_form'))

    justification = _justification_from_form(form)
    missing = _missing_justification(justification)
    if missing:
        flash(f'Please answer all purchase justification questions (missing: {", ".join(missing)}).', 'error')
        return redirect(url_for('new_po_form'))

    po_data = {
        'po_number': po_number,
        'vendor_id': form.get('vendor_id', '').strip(),
        'vendor_name': form.get('vendor_name', '').strip(),
        'issue_date': form.get('issue_date') or None,
        'delivery_date': form.get('delivery_date') or None,
        'status': form.get('status', 'open'),
        'currency': form.get('currency', 'USD'),
        **justification,
    }

    try:
        po = _create_po_and_lines(po_data, line_items)
    except Exception as e:
        flash(f'Error creating PO: {e}', 'error')
        return redirect(url_for('new_po_form'))

    file = request.files.get('document')
    if file and file.filename:
        try:
            _attach_po_document(po, file)
        except Exception as e:
            flash(f'Purchase Order {po_number} created, but the document upload failed: {e}', 'error')
            return redirect(url_for('view_po', po_number=po['po_number']))

    flash(f'Purchase Order {po_number} created.', 'success')
    return redirect(url_for('view_po', po_number=po['po_number']))


@app.route('/po/<po_number>')
def view_po(po_number):
    po = _get_po_by_number(po_number)
    if not po:
        abort(404)
    line_items = _get_line_items_for_po(po['id'])
    return render_template('detail.html', po=po, line_items=line_items)


@app.route('/po/<po_number>/edit', methods=['GET'])
def edit_po_form(po_number):
    po = _get_po_by_number(po_number)
    if not po:
        abort(404)
    line_items = _get_line_items_for_po(po['id'])
    return render_template('form.html', po=po, line_items=line_items, mode='edit')


@app.route('/po/<po_number>/edit', methods=['POST'])
def update_po(po_number):
    po = _get_po_by_number(po_number)
    if not po:
        abort(404)

    form = request.form
    line_items = _parse_line_items_from_form(form)
    if not line_items:
        flash('At least one line item is required.', 'error')
        return redirect(url_for('edit_po_form', po_number=po_number))

    total_amount = round(sum(item['amount'] for item in line_items), 2)
    updates = {
        'vendor_id': form.get('vendor_id', '').strip(),
        'vendor_name': form.get('vendor_name', '').strip(),
        'issue_date': form.get('issue_date') or None,
        'delivery_date': form.get('delivery_date') or None,
        'status': form.get('status', 'open'),
        'currency': form.get('currency', 'USD'),
        'total_amount': total_amount,
        'updated_at': datetime.now(timezone.utc).isoformat(),
    }
    justification = _justification_from_form(form)
    if justification['criticality'] and justification['criticality'] not in CRITICALITY_VALUES:
        flash('Invalid criticality value.', 'error')
        return redirect(url_for('edit_po_form', po_number=po_number))
    updates.update({k: (v or None) for k, v in justification.items()})

    try:
        supabase.table('purchase_orders').update(updates).eq('id', po['id']).execute()
        _replace_po_lines(po['id'], line_items)
    except Exception as e:
        flash(f'Error updating PO: {e}', 'error')
        return redirect(url_for('edit_po_form', po_number=po_number))

    file = request.files.get('document')
    if file and file.filename:
        try:
            _attach_po_document(po, file)
        except Exception as e:
            flash(f'Purchase Order {po_number} updated, but the document upload failed: {e}', 'error')
            return redirect(url_for('view_po', po_number=po_number))

    flash(f'Purchase Order {po_number} updated.', 'success')
    return redirect(url_for('view_po', po_number=po_number))


@app.route('/po/<po_number>/document', methods=['GET'])
def view_po_document(po_number):
    po = _get_po_by_number(po_number)
    if not po:
        abort(404)
    if not po.get('document_path'):
        flash('No document attached to this purchase order.', 'error')
        return redirect(url_for('view_po', po_number=po_number))
    try:
        return redirect(_document_url(po['document_path']))
    except Exception as e:
        flash(f'Could not open document: {e}', 'error')
        return redirect(url_for('view_po', po_number=po_number))


@app.route('/po/<po_number>/delete', methods=['POST'])
def delete_po(po_number):
    po = _get_po_by_number(po_number)
    if not po:
        abort(404)

    try:
        supabase.table('po_line_items').delete().eq('po_id', po['id']).execute()
        supabase.table('purchase_orders').delete().eq('id', po['id']).execute()
    except Exception as e:
        flash(f'Error deleting PO: {e}', 'error')
        return redirect(url_for('view_po', po_number=po_number))

    flash(f'Purchase Order {po_number} deleted.', 'success')
    return redirect(url_for('index'))


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------

@app.route('/api/po/<po_number>', methods=['GET'])
@require_api_key
def api_get_po(po_number):
    po = _get_po_by_number(po_number)
    if not po:
        return jsonify({"error": "Not found"}), 404
    line_items = _get_line_items_for_po(po['id'])
    return jsonify(_po_to_api_response(po, line_items))


@app.route('/api/pos', methods=['GET'])
@require_api_key
def api_list_pos():
    vendor_id = request.args.get('vendor_id', '').strip()
    status = request.args.get('status', '').strip()
    try:
        page = max(1, int(request.args.get('page', 1)))
    except ValueError:
        page = 1
    try:
        limit = min(200, max(1, int(request.args.get('limit', 50))))
    except ValueError:
        limit = 50

    offset = (page - 1) * limit
    query = supabase.table('purchase_orders').select('*').order('created_at', desc=True)

    if vendor_id:
        query = query.eq('vendor_id', vendor_id)
    if status:
        query = query.eq('status', status)

    query = query.range(offset, offset + limit - 1)
    result = query.execute()

    return jsonify({
        'page': page,
        'limit': limit,
        'count': len(result.data),
        'purchase_orders': result.data,
    })


@app.route('/api/pos', methods=['POST'])
@require_api_key
def api_create_po():
    body = request.get_json(silent=True) or {}

    po_number = (body.get('po_number') or '').strip()
    if not po_number:
        return jsonify({"error": "po_number is required"}), 400

    existing = _get_po_by_number(po_number)
    if existing:
        return jsonify({"error": f"PO {po_number} already exists"}), 409

    line_items = _parse_line_items_from_json(body.get('line_items', []))

    justification = _justification_from_json(body)
    if justification.get('criticality') and justification['criticality'] not in CRITICALITY_VALUES:
        return jsonify({"error": f"criticality must be one of: {', '.join(CRITICALITY_VALUES)}"}), 400

    po_data = {
        'po_number': po_number,
        'vendor_id': body.get('vendor_id', ''),
        'vendor_name': body.get('vendor_name', ''),
        'issue_date': body.get('issue_date') or None,
        'delivery_date': body.get('delivery_date') or None,
        'status': body.get('status', 'open'),
        'currency': body.get('currency', 'USD'),
        **justification,
    }

    try:
        po = _create_po_and_lines(po_data, line_items)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    line_items_db = _get_line_items_for_po(po['id'])
    return jsonify(_po_to_api_response(po, line_items_db)), 201


@app.route('/api/pos/<po_number>', methods=['PUT'])
@require_api_key
def api_update_po(po_number):
    po = _get_po_by_number(po_number)
    if not po:
        return jsonify({"error": "Not found"}), 404

    body = request.get_json(silent=True) or {}
    line_items = _parse_line_items_from_json(body.get('line_items', []))
    total_amount = round(sum(item['amount'] for item in line_items), 2)

    updates = {
        'vendor_id': body.get('vendor_id', po['vendor_id']),
        'vendor_name': body.get('vendor_name', po['vendor_name']),
        'issue_date': body.get('issue_date', po['issue_date']),
        'delivery_date': body.get('delivery_date', po['delivery_date']),
        'status': body.get('status', po['status']),
        'currency': body.get('currency', po.get('currency') or 'USD'),
        'total_amount': total_amount,
        'updated_at': datetime.now(timezone.utc).isoformat(),
    }
    justification = _justification_from_json(body)
    if justification.get('criticality') and justification['criticality'] not in CRITICALITY_VALUES:
        return jsonify({"error": f"criticality must be one of: {', '.join(CRITICALITY_VALUES)}"}), 400
    updates.update(justification)

    try:
        supabase.table('purchase_orders').update(updates).eq('id', po['id']).execute()
        _replace_po_lines(po['id'], line_items)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    updated_po = _get_po_by_number(po_number)
    updated_lines = _get_line_items_for_po(updated_po['id'])
    return jsonify(_po_to_api_response(updated_po, updated_lines))


@app.route('/api/pos/<po_number>/document', methods=['POST'])
@require_api_key
def api_upload_po_document(po_number):
    po = _get_po_by_number(po_number)
    if not po:
        return jsonify({"error": "Not found"}), 404

    file = request.files.get('file')
    if not file or not file.filename:
        return jsonify({"error": 'Multipart form field "file" is required'}), 400

    try:
        updated = _attach_po_document(po, file)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Upload failed: {e}"}), 500

    return jsonify({'po_number': po_number, 'document_name': updated['document_name'],
                    'document_path': updated['document_path']}), 201


@app.route('/api/pos/<po_number>/document', methods=['GET'])
@require_api_key
def api_get_po_document(po_number):
    po = _get_po_by_number(po_number)
    if not po:
        return jsonify({"error": "Not found"}), 404
    if not po.get('document_path'):
        return jsonify({"error": "No document attached to this purchase order"}), 404
    try:
        return jsonify({'document_name': po['document_name'], 'url': _document_url(po['document_path']),
                        'expires_in': 3600})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/pos/<po_number>/document/download', methods=['GET'])
@require_api_key
def api_download_po_document(po_number):
    po = _get_po_by_number(po_number)
    if not po:
        return jsonify({"error": "Not found"}), 404
    if not po.get('document_path'):
        return jsonify({"error": "No document attached to this purchase order"}), 404

    try:
        file_bytes = supabase.storage.from_(STORAGE_BUCKET).download(po['document_path'])
    except Exception as e:
        return jsonify({"error": f"Download failed: {e}"}), 500

    return Response(
        file_bytes,
        mimetype='application/octet-stream',
        headers={'Content-Disposition': f'attachment; filename="{po["document_name"]}"'},
    )


@app.route('/api/pos/<po_number>', methods=['DELETE'])
@require_api_key
def api_delete_po(po_number):
    po = _get_po_by_number(po_number)
    if not po:
        return jsonify({"error": "Not found"}), 404

    try:
        supabase.table('po_line_items').delete().eq('po_id', po['id']).execute()
        supabase.table('purchase_orders').delete().eq('id', po['id']).execute()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return '', 204


# ---------------------------------------------------------------------------
# API key management UI
# ---------------------------------------------------------------------------

@app.route('/settings/api-keys', methods=['GET'])
def api_keys():
    try:
        result = supabase.table('po_api_keys').select('id, label, created_at').order('created_at', desc=True).execute()
        keys = result.data or []
    except Exception as e:
        flash(f'Could not load API keys: {e}', 'error')
        keys = []
    new_key = session.pop('new_api_key', None)
    return render_template('api_keys.html', keys=keys, new_key=new_key)


@app.route('/settings/api-keys', methods=['POST'])
def create_api_key():
    label = request.form.get('label', '').strip() or 'Unnamed key'
    raw_key = f'po-{secrets.token_urlsafe(32)}'
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    try:
        supabase.table('po_api_keys').insert({
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
        supabase.table('po_api_keys').delete().eq('id', key_id).execute()
        flash('API key revoked.', 'success')
    except Exception as e:
        flash(f'Could not revoke key: {e}', 'error')
    return redirect(url_for('api_keys'))


if __name__ == '__main__':
    app.run(debug=False, port=int(os.environ.get('PORT', 5002)))
