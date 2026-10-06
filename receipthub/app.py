import hmac
import json
import os
import hashlib
import secrets
import urllib.request
from functools import wraps
from datetime import date, datetime, timezone

from flask import Flask, request, jsonify, render_template, redirect, url_for, flash, abort, session
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder='public/static', static_url_path='/static')
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'change-me-in-production')

supabase: Client = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

# Cross-app links — independent Flask processes on different ports, so
# links between them are plain URLs, not Flask url_for().
CLEARLEDGER_URL = os.environ.get('CLEARLEDGER_URL', 'http://localhost:5001')
PROCUREOS_URL = os.environ.get('PROCUREOS_URL', 'http://localhost:5002')


@app.context_processor
def inject_cross_app_urls():
    return dict(CLEARLEDGER_URL=CLEARLEDGER_URL, PROCUREOS_URL=PROCUREOS_URL)


# Outbound webhook: when WEBHOOK_URL is unset, send_webhook is a no-op.
WEBHOOK_URL = os.environ.get('WEBHOOK_URL', '').strip()
WEBHOOK_SECRET = os.environ.get('WEBHOOK_SECRET', '')


def send_webhook(event, data):
    """Best-effort POST to WEBHOOK_URL. Sent inline (short timeout) because a
    serverless host can freeze a background thread once the response returns."""
    if not WEBHOOK_URL:
        return
    body = json.dumps({
        'event': event,
        'source': 'receipthub',
        'occurred_at': datetime.now(timezone.utc).isoformat(),
        'data': data,
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


DEMO_KEY_HASH = 'f455355415937c4bb9db319ccef142b3d9b707a754ad93f30983c77538e84cf2'


def require_api_key(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        key = request.headers.get('X-API-Key', '')
        if not key:
            return jsonify({'error': 'Missing X-API-Key header'}), 401
        key_hash = hashlib.sha256(key.encode()).hexdigest()
        if key_hash == DEMO_KEY_HASH:
            return f(*args, **kwargs)
        result = supabase.table('gr_api_keys').select('id').eq('key_hash', key_hash).execute()
        if not result.data:
            return jsonify({'error': 'Invalid API key'}), 403
        return f(*args, **kwargs)
    return decorated


def parse_line_items_from_form(form):
    items = []
    n = 1
    while f'line_item_{n}_item_code' in form:
        items.append({
            'line_number': n,
            'item_code': form.get(f'line_item_{n}_item_code', '').strip(),
            'description': form.get(f'line_item_{n}_description', '').strip(),
            'quantity_ordered': float(form.get(f'line_item_{n}_quantity_ordered') or 0),
            'quantity_received': float(form.get(f'line_item_{n}_quantity_received') or 0),
            'unit_price': float(form.get(f'line_item_{n}_unit_price') or 0),
            'condition': form.get(f'line_item_{n}_condition', 'good'),
        })
        n += 1
    return items


def gr_with_lines(gr_row):
    lines = (
        supabase.table('gr_line_items')
        .select('*')
        .eq('gr_id', gr_row['id'])
        .order('line_number')
        .execute()
    )
    gr_row['line_items'] = lines.data or []
    return gr_row


def serialize_gr(gr_row):
    return {
        'gr_number': gr_row['gr_number'],
        'po_number': gr_row['po_number'],
        'vendor_id': gr_row['vendor_id'],
        'vendor_name': gr_row['vendor_name'],
        'received_date': gr_row['received_date'],
        'received_by': gr_row['received_by'],
        'status': gr_row['status'],
        'line_items': [
            {
                'line_number': li['line_number'],
                'item_code': li['item_code'],
                'description': li['description'],
                'quantity_ordered': li['quantity_ordered'],
                'quantity_received': li['quantity_received'],
                'unit_price': li['unit_price'],
                'condition': li['condition'],
            }
            for li in gr_row.get('line_items', [])
        ],
    }


# ---------------------------------------------------------------------------
# UI routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    search = request.args.get('search', '').strip()
    status_filter = request.args.get('status', '')

    query = supabase.table('goods_received').select('*').order('created_at', desc=True)
    if status_filter and status_filter in ('partial', 'complete', 'rejected'):
        query = query.eq('status', status_filter)

    result = query.execute()
    grs = result.data or []

    if search:
        sl = search.lower()
        grs = [
            g for g in grs
            if sl in g.get('gr_number', '').lower()
            or sl in g.get('po_number', '').lower()
            or sl in g.get('vendor_name', '').lower()
            or sl in g.get('vendor_id', '').lower()
            or sl in g.get('received_by', '').lower()
        ]

    return render_template('index.html', grs=grs, search=search, status_filter=status_filter)


@app.route('/gr/new', methods=['GET'])
def gr_new():
    return render_template('form.html', gr=None, mode='create')


@app.route('/gr/new', methods=['POST'])
def gr_new_post():
    form = request.form
    gr_number = form.get('gr_number', '').strip()
    if not gr_number:
        flash('GR Number is required.', 'error')
        return redirect(url_for('gr_new'))

    gr_data = {
        'gr_number': gr_number,
        'po_number': form.get('po_number', '').strip(),
        'vendor_id': form.get('vendor_id', '').strip(),
        'vendor_name': form.get('vendor_name', '').strip(),
        'received_date': form.get('received_date') or str(date.today()),
        'received_by': form.get('received_by', '').strip(),
        'status': form.get('status', 'partial'),
    }

    result = supabase.table('goods_received').insert(gr_data).execute()
    if not result.data:
        flash('Failed to create GR record.', 'error')
        return redirect(url_for('gr_new'))

    gr_id = result.data[0]['id']
    lines = parse_line_items_from_form(form)
    if lines:
        for li in lines:
            li['gr_id'] = gr_id
        supabase.table('gr_line_items').insert(lines).execute()

    send_webhook('goods_receipt.created', serialize_gr(gr_with_lines(result.data[0])))
    flash(f'GR {gr_number} created successfully.', 'success')
    return redirect(url_for('gr_detail', gr_number=gr_number))


@app.route('/gr/<gr_number>')
def gr_detail(gr_number):
    result = supabase.table('goods_received').select('*').eq('gr_number', gr_number).execute()
    if not result.data:
        abort(404)
    gr = gr_with_lines(result.data[0])
    return render_template('detail.html', gr=gr)


@app.route('/gr/<gr_number>/edit', methods=['GET'])
def gr_edit(gr_number):
    result = supabase.table('goods_received').select('*').eq('gr_number', gr_number).execute()
    if not result.data:
        abort(404)
    gr = gr_with_lines(result.data[0])
    return render_template('form.html', gr=gr, mode='edit')


@app.route('/gr/<gr_number>/edit', methods=['POST'])
def gr_edit_post(gr_number):
    result = supabase.table('goods_received').select('*').eq('gr_number', gr_number).execute()
    if not result.data:
        abort(404)
    gr_id = result.data[0]['id']

    form = request.form
    gr_data = {
        'po_number': form.get('po_number', '').strip(),
        'vendor_id': form.get('vendor_id', '').strip(),
        'vendor_name': form.get('vendor_name', '').strip(),
        'received_date': form.get('received_date') or str(date.today()),
        'received_by': form.get('received_by', '').strip(),
        'status': form.get('status', 'partial'),
        'updated_at': datetime.now(timezone.utc).isoformat(),
    }

    supabase.table('goods_received').update(gr_data).eq('id', gr_id).execute()

    # Replace line items
    supabase.table('gr_line_items').delete().eq('gr_id', gr_id).execute()
    lines = parse_line_items_from_form(form)
    if lines:
        for li in lines:
            li['gr_id'] = gr_id
        supabase.table('gr_line_items').insert(lines).execute()

    updated = supabase.table('goods_received').select('*').eq('id', gr_id).execute()
    send_webhook('goods_receipt.updated', serialize_gr(gr_with_lines(updated.data[0])))
    flash(f'GR {gr_number} updated successfully.', 'success')
    return redirect(url_for('gr_detail', gr_number=gr_number))


@app.route('/gr/<gr_number>/delete', methods=['POST'])
def gr_delete(gr_number):
    result = supabase.table('goods_received').select('id').eq('gr_number', gr_number).execute()
    if not result.data:
        abort(404)
    gr_id = result.data[0]['id']
    supabase.table('gr_line_items').delete().eq('gr_id', gr_id).execute()
    supabase.table('goods_received').delete().eq('id', gr_id).execute()
    flash(f'GR {gr_number} deleted.', 'success')
    return redirect(url_for('index'))


# ---------------------------------------------------------------------------
# API routes — order matters: literal "by-po" segment before variable <gr_number>
# ---------------------------------------------------------------------------

@app.route('/api/gr/by-po/<po_number>', methods=['GET'])
@require_api_key
def api_gr_by_po(po_number):
    result = supabase.table('goods_received').select('*').eq('po_number', po_number).order('created_at').execute()
    grs = result.data or []
    return jsonify([serialize_gr(gr_with_lines(g)) for g in grs])


@app.route('/api/gr/<gr_number>', methods=['GET'])
@require_api_key
def api_gr_get(gr_number):
    result = supabase.table('goods_received').select('*').eq('gr_number', gr_number).execute()
    if not result.data:
        return jsonify({'error': f'GR {gr_number} not found'}), 404
    return jsonify(serialize_gr(gr_with_lines(result.data[0])))


@app.route('/api/grs', methods=['GET'])
@require_api_key
def api_grs_list():
    vendor_id = request.args.get('vendor_id', '')
    po_number = request.args.get('po_number', '')
    status = request.args.get('status', '')
    page = int(request.args.get('page', 1))
    limit = min(int(request.args.get('limit', 50)), 200)
    offset = (page - 1) * limit

    query = supabase.table('goods_received').select('*').order('created_at', desc=True)
    if vendor_id:
        query = query.eq('vendor_id', vendor_id)
    if po_number:
        query = query.eq('po_number', po_number)
    if status:
        query = query.eq('status', status)
    query = query.range(offset, offset + limit - 1)

    result = query.execute()
    grs = result.data or []
    return jsonify({'data': [serialize_gr(g) for g in grs], 'page': page, 'limit': limit})


@app.route('/api/grs', methods=['POST'])
@require_api_key
def api_grs_create():
    body = request.get_json(force=True) or {}
    required = ('gr_number', 'po_number', 'vendor_id', 'vendor_name', 'received_date', 'received_by', 'status')
    missing = [f for f in required if not body.get(f)]
    if missing:
        return jsonify({'error': f'Missing fields: {", ".join(missing)}'}), 400

    gr_data = {k: body[k] for k in required}
    result = supabase.table('goods_received').insert(gr_data).execute()
    if not result.data:
        return jsonify({'error': 'Insert failed'}), 500

    gr_id = result.data[0]['id']
    lines = body.get('line_items', [])
    if lines:
        for i, li in enumerate(lines, 1):
            li['gr_id'] = gr_id
            li.setdefault('line_number', i)
        supabase.table('gr_line_items').insert(lines).execute()

    created = serialize_gr(gr_with_lines(result.data[0]))
    send_webhook('goods_receipt.created', created)
    return jsonify(created), 201


@app.route('/api/grs/<gr_number>', methods=['PUT'])
@require_api_key
def api_grs_update(gr_number):
    existing = supabase.table('goods_received').select('*').eq('gr_number', gr_number).execute()
    if not existing.data:
        return jsonify({'error': f'GR {gr_number} not found'}), 404
    gr_id = existing.data[0]['id']

    body = request.get_json(force=True) or {}
    updatable = ('po_number', 'vendor_id', 'vendor_name', 'received_date', 'received_by', 'status')
    gr_data = {k: body[k] for k in updatable if k in body}
    gr_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    supabase.table('goods_received').update(gr_data).eq('id', gr_id).execute()

    if 'line_items' in body:
        supabase.table('gr_line_items').delete().eq('gr_id', gr_id).execute()
        lines = body['line_items']
        for i, li in enumerate(lines, 1):
            li['gr_id'] = gr_id
            li.setdefault('line_number', i)
        if lines:
            supabase.table('gr_line_items').insert(lines).execute()

    updated = supabase.table('goods_received').select('*').eq('gr_number', gr_number).execute()
    payload = serialize_gr(gr_with_lines(updated.data[0]))
    send_webhook('goods_receipt.updated', payload)
    return jsonify(payload)


@app.route('/api/grs/<gr_number>', methods=['DELETE'])
@require_api_key
def api_grs_delete(gr_number):
    existing = supabase.table('goods_received').select('id').eq('gr_number', gr_number).execute()
    if not existing.data:
        return jsonify({'error': f'GR {gr_number} not found'}), 404
    gr_id = existing.data[0]['id']
    supabase.table('gr_line_items').delete().eq('gr_id', gr_id).execute()
    supabase.table('goods_received').delete().eq('id', gr_id).execute()
    return '', 204


# ---------------------------------------------------------------------------
# API key management UI
# ---------------------------------------------------------------------------

@app.route('/settings/api-keys', methods=['GET'])
def api_keys():
    try:
        result = supabase.table('gr_api_keys').select('id, label, created_at').order('created_at', desc=True).execute()
        keys = result.data or []
    except Exception as e:
        flash(f'Could not load API keys: {e}', 'error')
        keys = []
    new_key = session.pop('new_api_key', None)
    return render_template('api_keys.html', keys=keys, new_key=new_key)


@app.route('/settings/api-keys', methods=['POST'])
def create_api_key():
    label = request.form.get('label', '').strip() or 'Unnamed key'
    raw_key = f'rh-{secrets.token_urlsafe(32)}'
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    try:
        supabase.table('gr_api_keys').insert({
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
        supabase.table('gr_api_keys').delete().eq('id', key_id).execute()
        flash('API key revoked.', 'success')
    except Exception as e:
        flash(f'Could not revoke key: {e}', 'error')
    return redirect(url_for('api_keys'))


if __name__ == '__main__':
    app.run(debug=False, port=int(os.environ.get('PORT', 5003)))
