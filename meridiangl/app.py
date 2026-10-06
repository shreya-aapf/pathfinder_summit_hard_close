import os
import hashlib
from functools import wraps

from flask import Flask, request, jsonify, render_template, flash
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder='public/static', static_url_path='/static')

URL_PREFIX = '/meridiangl'


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
app.config['SESSION_COOKIE_NAME'] = 'meridiangl_session'
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'change-me-in-production')

supabase: Client = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])


DEMO_KEY_HASH = '13a70133e81abd62377bc38332fc4507ff5f8ef9d56e309611f59b6546af0fb4'

SUBSIDIARIES = ('A', 'B', 'C')


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
        result = supabase.table('gl_api_keys').select('id').eq('key_hash', key_hash).execute()
        if not result.data:
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _latest_balance_per_account(balances):
    """Given a list of gl_balances rows, return a dict of account_id -> the
    row with the lexicographically latest period (periods are 'YYYY-MM')."""
    latest = {}
    for b in balances:
        acc_id = b['account_id']
        current = latest.get(acc_id)
        if current is None or b['period'] > current['period']:
            latest[acc_id] = b
    return latest


def _get_accounts(subsidiary=None):
    query = supabase.table('gl_accounts').select('*').order('subsidiary').order('account_code')
    if subsidiary:
        query = query.eq('subsidiary', subsidiary)
    result = query.execute()
    return result.data or []


def _get_balances(period=None):
    query = supabase.table('gl_balances').select('*')
    if period:
        query = query.eq('period', period)
    result = query.execute()
    return result.data or []


# ---------------------------------------------------------------------------
# UI Routes
# ---------------------------------------------------------------------------

@app.route('/')
def balance_sheet():
    subsidiary_filter = request.args.get('subsidiary', '').strip().upper()
    if subsidiary_filter not in SUBSIDIARIES:
        subsidiary_filter = ''

    try:
        accounts = _get_accounts(subsidiary_filter or None)
    except Exception as e:
        flash(f'Error loading accounts: {str(e)}', 'error')
        accounts = []

    try:
        balances = _get_balances()
    except Exception as e:
        flash(f'Error loading balances: {str(e)}', 'error')
        balances = []

    latest_by_account = _latest_balance_per_account(balances)

    rows = []
    for acc in accounts:
        rows.append({
            'account': acc,
            'balance': latest_by_account.get(acc['id']),
        })

    return render_template(
        'balance_sheet.html',
        rows=rows,
        subsidiary_filter=subsidiary_filter or 'all',
    )


@app.route('/intercompany')
def intercompany():
    subsidiary_filter = request.args.get('subsidiary', '').strip().upper()
    if subsidiary_filter not in SUBSIDIARIES:
        subsidiary_filter = ''

    flag_filter = request.args.get('flag_type', '').strip()
    if flag_filter not in ('matched', 'timing_difference', 'error'):
        flag_filter = ''

    try:
        query = supabase.table('intercompany_log').select('*').order('posted_date_from', desc=True)
        if flag_filter:
            query = query.eq('flag_type', flag_filter)
        result = query.execute()
        entries = result.data or []
    except Exception as e:
        flash(f'Error loading intercompany log: {str(e)}', 'error')
        entries = []

    if subsidiary_filter:
        entries = [
            e for e in entries
            if e.get('subsidiary_from') == subsidiary_filter or e.get('subsidiary_to') == subsidiary_filter
        ]

    return render_template(
        'intercompany.html',
        entries=entries,
        subsidiary_filter=subsidiary_filter or 'all',
        flag_filter=flag_filter or 'all',
    )


@app.route('/accruals')
def accruals():
    subsidiary_filter = request.args.get('subsidiary', '').strip().upper()
    if subsidiary_filter not in SUBSIDIARIES:
        subsidiary_filter = ''

    period_filter = request.args.get('period', '').strip()

    try:
        query = supabase.table('accruals').select('*').order('subsidiary').order('period', desc=True)
        if subsidiary_filter:
            query = query.eq('subsidiary', subsidiary_filter)
        if period_filter:
            query = query.eq('period', period_filter)
        result = query.execute()
        rows = result.data or []
    except Exception as e:
        flash(f'Error loading accruals: {str(e)}', 'error')
        rows = []

    return render_template(
        'accruals.html',
        rows=rows,
        subsidiary_filter=subsidiary_filter or 'all',
        period_filter=period_filter,
    )


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------

@app.route('/api/gl/accounts', methods=['GET'])
@require_api_key
def api_list_accounts():
    subsidiary = request.args.get('subsidiary', '').strip().upper()
    try:
        query = supabase.table('gl_accounts').select('*').order('subsidiary').order('account_code')
        if subsidiary:
            query = query.eq('subsidiary', subsidiary)
        result = query.execute()
        return jsonify(result.data or [])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/gl/balances', methods=['GET'])
@require_api_key
def api_list_balances():
    subsidiary = request.args.get('subsidiary', '').strip().upper()
    period = request.args.get('period', '').strip()

    try:
        acc_query = supabase.table('gl_accounts').select('*')
        if subsidiary:
            acc_query = acc_query.eq('subsidiary', subsidiary)
        accounts = acc_query.execute().data or []
        accounts_by_id = {a['id']: a for a in accounts}

        bal_query = supabase.table('gl_balances').select('*')
        if period:
            bal_query = bal_query.eq('period', period)
        balances = bal_query.execute().data or []
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    results = []
    for b in balances:
        acc = accounts_by_id.get(b['account_id'])
        if subsidiary and not acc:
            # Balance belongs to an account outside the requested subsidiary
            continue
        entry = dict(b)
        if acc:
            entry['subsidiary'] = acc['subsidiary']
            entry['account_code'] = acc['account_code']
            entry['account_name'] = acc['account_name']
            entry['account_type'] = acc['account_type']
        results.append(entry)

    return jsonify(results)


@app.route('/api/gl/intercompany', methods=['GET'])
@require_api_key
def api_list_intercompany():
    subsidiary = request.args.get('subsidiary', '').strip().upper()
    flag_type = request.args.get('flag_type', '').strip()

    try:
        query = supabase.table('intercompany_log').select('*').order('posted_date_from', desc=True)
        if flag_type:
            query = query.eq('flag_type', flag_type)
        result = query.execute()
        entries = result.data or []
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    if subsidiary:
        entries = [
            e for e in entries
            if e.get('subsidiary_from') == subsidiary or e.get('subsidiary_to') == subsidiary
        ]

    return jsonify(entries)


@app.route('/api/gl/accruals', methods=['GET'])
@require_api_key
def api_list_accruals():
    subsidiary = request.args.get('subsidiary', '').strip().upper()
    status = request.args.get('status', '').strip()

    try:
        query = supabase.table('accruals').select('*').order('subsidiary').order('period', desc=True)
        if subsidiary:
            query = query.eq('subsidiary', subsidiary)
        if status:
            query = query.eq('status', status)
        result = query.execute()
        return jsonify(result.data or [])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(debug=False, port=int(os.environ.get('PORT', 5004)))
