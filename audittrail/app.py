import os
from datetime import datetime, timezone
from flask import Flask, request, jsonify, render_template, redirect, url_for, flash
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder='public/static', static_url_path='/static')

URL_PREFIX = '/audittrail'


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
app.config['SESSION_COOKIE_NAME'] = 'audittrail_session'
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'dev-secret-key')

supabase: Client = create_client(
    os.environ['SUPABASE_URL'],
    os.environ['SUPABASE_KEY']
)

# Cross-app link — independent Flask process on a different port, so the
# link is a plain URL, not Flask url_for(). ClearLedger exposes
# /invoices/lookup/<invoice_number> specifically so AuditTrail (which only
# knows invoice_number, not the invoice's UUID) can deep-link into it.
CLEARLEDGER_URL = os.environ.get('CLEARLEDGER_URL', '/clearledger' if os.environ.get('VERCEL') else 'http://localhost:5001')


@app.context_processor
def inject_cross_app_urls():
    return dict(CLEARLEDGER_URL=CLEARLEDGER_URL)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

VENDOR_FLAG_STATUSES = ('open', 'cleared', 'escalated')
FLUX_CATEGORIES = ('revenue', 'opex', 'cash')
FLUX_STATUSES = ('explained', 'unexplained')
CLOSE_STATUSES = ('cleared', 'exception_documented', 'escalated')
CLOSE_STATUS_FIELDS = ('status', 'owner', 'note')


# ---------------------------------------------------------------------------
# UI routes
# ---------------------------------------------------------------------------

@app.route('/')
def close_status_board():
    status_filter = request.args.get('status', '').strip()
    try:
        query = supabase.table('close_status').select('*').order('updated_at', desc=True)
        if status_filter and status_filter != 'all':
            query = query.eq('status', status_filter)
        result = query.execute()
        items = result.data or []
    except Exception as e:
        flash(f'Error loading close status board: {str(e)}', 'error')
        items = []

    try:
        counts_result = supabase.table('close_status').select('status').execute()
        all_rows = counts_result.data or []
    except Exception:
        all_rows = []

    counts = {'cleared': 0, 'exception_documented': 0, 'escalated': 0}
    for row in all_rows:
        s = row.get('status')
        if s in counts:
            counts[s] += 1
    counts['all'] = sum(counts.values())

    return render_template(
        'close_status.html',
        items=items,
        status_filter=status_filter or 'all',
        counts=counts,
    )


@app.route('/vendor-flags')
def vendor_flags():
    try:
        result = supabase.table('vendor_flags').select('*').order('created_at', desc=True).execute()
        flags = result.data or []
    except Exception as e:
        flash(f'Error loading vendor flags: {str(e)}', 'error')
        flags = []

    return render_template('vendor_flags.html', flags=flags)


@app.route('/vendor-flags/<flag_id>')
def vendor_flag_detail(flag_id):
    try:
        result = supabase.table('vendor_flags').select('*').eq('id', flag_id).single().execute()
        flag = result.data
        if not flag:
            flash('Vendor flag not found.', 'error')
            return redirect(url_for('vendor_flags'))
    except Exception:
        flash('Vendor flag not found.', 'error')
        return redirect(url_for('vendor_flags'))

    return render_template('vendor_flag_detail.html', flag=flag)


@app.route('/flux')
def flux():
    try:
        result = supabase.table('flux_analysis').select('*').order('created_at', desc=True).execute()
        rows = result.data or []
    except Exception as e:
        flash(f'Error loading flux analysis: {str(e)}', 'error')
        rows = []

    return render_template('flux.html', rows=rows)


@app.route('/audit-log')
def audit_log():
    try:
        result = supabase.table('audit_trail').select('*').order('created_at', desc=True).execute()
        entries = result.data or []
    except Exception as e:
        flash(f'Error loading audit trail: {str(e)}', 'error')
        entries = []

    return render_template('audit_log.html', entries=entries)


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

@app.route('/api/vendor-flags', methods=['GET'])
def api_list_vendor_flags():
    status_filter = request.args.get('status')

    try:
        query = supabase.table('vendor_flags').select('*').order('created_at', desc=True)
        if status_filter:
            query = query.eq('status', status_filter)
        result = query.execute()
        return jsonify(result.data or [])
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/vendor-flags/<flag_id>', methods=['GET'])
def api_get_vendor_flag(flag_id):
    try:
        result = supabase.table('vendor_flags').select('*').eq('id', flag_id).single().execute()
        if not result.data:
            return jsonify({'error': 'Vendor flag not found'}), 404
        return jsonify(result.data)
    except Exception as e:
        if 'PGRST116' in str(e):
            return jsonify({'error': 'Vendor flag not found'}), 404
        return jsonify({'error': str(e)}), 500


@app.route('/api/flux-analysis', methods=['GET'])
def api_list_flux_analysis():
    category_filter = request.args.get('category')
    status_filter = request.args.get('status')

    try:
        query = supabase.table('flux_analysis').select('*').order('created_at', desc=True)
        if category_filter:
            query = query.eq('category', category_filter)
        if status_filter:
            query = query.eq('status', status_filter)
        result = query.execute()
        return jsonify(result.data or [])
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/audit-trail', methods=['GET'])
def api_list_audit_trail():
    related_reference = request.args.get('related_reference')

    try:
        query = supabase.table('audit_trail').select('*').order('created_at', desc=True)
        if related_reference:
            query = query.eq('related_reference', related_reference)
        result = query.execute()
        return jsonify(result.data or [])
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/audit-trail', methods=['POST'])
def api_create_audit_trail():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body must be JSON'}), 400

    required = ['action_checked', 'decision']
    missing = [f for f in required if f not in data]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    now = datetime.now(timezone.utc).isoformat()
    entry_row = {
        'agent_name': data.get('agent_name', 'close-automation'),
        'action_checked': data['action_checked'],
        'decision': data['decision'],
        'evidence': data.get('evidence'),
        'escalation_reason': data.get('escalation_reason'),
        'related_reference': data.get('related_reference'),
        'created_at': now,
    }

    try:
        result = supabase.table('audit_trail').insert(entry_row).execute()
        entry = result.data[0]
    except Exception as e:
        return jsonify({'error': f'Failed to create audit trail entry: {str(e)}'}), 500

    return jsonify(entry), 201


@app.route('/api/close-status', methods=['GET'])
def api_list_close_status():
    status_filter = request.args.get('status')
    category_filter = request.args.get('category')

    try:
        query = supabase.table('close_status').select('*').order('updated_at', desc=True)
        if status_filter:
            query = query.eq('status', status_filter)
        if category_filter:
            query = query.eq('category', category_filter)
        result = query.execute()
        return jsonify(result.data or [])
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/close-status/<item_id>', methods=['PATCH'])
def api_update_close_status(item_id):
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body must be JSON'}), 400

    updates = {k: v for k, v in data.items() if k in CLOSE_STATUS_FIELDS}
    if not updates:
        return jsonify({'error': f'Body must include at least one of: {", ".join(CLOSE_STATUS_FIELDS)}'}), 400

    if 'status' in updates and updates['status'] not in CLOSE_STATUSES:
        return jsonify({'error': f'status must be one of: {", ".join(CLOSE_STATUSES)}'}), 400

    # Verify the close status item exists before acting on it
    try:
        check = supabase.table('close_status').select('id').eq('id', item_id).single().execute()
        if not check.data:
            return jsonify({'error': 'Close status item not found'}), 404
    except Exception as e:
        if 'PGRST116' in str(e):
            return jsonify({'error': 'Close status item not found'}), 404
        return jsonify({'error': str(e)}), 500

    updates['updated_at'] = datetime.now(timezone.utc).isoformat()

    try:
        supabase.table('close_status').update(updates).eq('id', item_id).execute()
    except Exception as e:
        return jsonify({'error': f'Failed to update close status item: {str(e)}'}), 500

    try:
        updated = supabase.table('close_status').select('*').eq('id', item_id).single().execute()
        return jsonify(updated.data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ---------------------------------------------------------------------------

if __name__ == '__main__':
    app.run(debug=False, port=int(os.environ.get('PORT', 5005)))
