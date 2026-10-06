from conftest import AUTH_HEADERS

# These tests assert against the known seed data loaded by ../supabase/schema.sql
# (idempotent seed — safe to assume present in the shared project).


# ---------------------------------------------------------------------------
# UI routes
# ---------------------------------------------------------------------------

def test_balance_sheet_page_loads(client):
    resp = client.get('/')
    assert resp.status_code == 200
    assert b'Accounts Payable' in resp.data


def test_balance_sheet_subsidiary_filter(client):
    resp = client.get('/?subsidiary=A')
    assert resp.status_code == 200
    assert b'Cash and Cash Equivalents' in resp.data


def test_intercompany_page_loads(client):
    resp = client.get('/intercompany')
    assert resp.status_code == 200
    assert b'IC-2024-0091' in resp.data


def test_accruals_page_loads(client):
    resp = client.get('/accruals')
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# API auth
# ---------------------------------------------------------------------------

def test_api_requires_key(client):
    resp = client.get('/api/gl/accounts')
    assert resp.status_code == 401


def test_api_rejects_wrong_key(client):
    resp = client.get('/api/gl/accounts', headers={'X-API-Key': 'wrong-key'})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/gl/accounts
# ---------------------------------------------------------------------------

def test_api_list_accounts_filtered_by_subsidiary(client):
    resp = client.get('/api/gl/accounts?subsidiary=A', headers=AUTH_HEADERS)
    assert resp.status_code == 200
    accounts = resp.get_json()
    codes = {a['account_code'] for a in accounts}
    assert {'1000', '2000'}.issubset(codes)
    assert all(a['subsidiary'] == 'A' for a in accounts)


# ---------------------------------------------------------------------------
# GET /api/gl/balances
# ---------------------------------------------------------------------------

def test_api_list_balances_shows_variance(client):
    resp = client.get('/api/gl/balances?subsidiary=A&period=2024-11', headers=AUTH_HEADERS)
    assert resp.status_code == 200
    balances = resp.get_json()
    ap_row = next(b for b in balances if b['account_code'] == '2000')
    assert ap_row['status'] == 'variance'
    assert float(ap_row['variance_amount']) == 2470.00
    assert ap_row['source_doc_ref'] == 'AP-SUBLEDGER-A-1124'


# ---------------------------------------------------------------------------
# GET /api/gl/intercompany
# ---------------------------------------------------------------------------

def test_api_intercompany_timing_difference(client):
    resp = client.get('/api/gl/intercompany?flag_type=timing_difference', headers=AUTH_HEADERS)
    assert resp.status_code == 200
    entries = resp.get_json()
    assert any(e['transaction_ref'] == 'IC-2024-0091' for e in entries)
    entry = next(e for e in entries if e['transaction_ref'] == 'IC-2024-0091')
    assert entry['posted_date_from'] != entry['posted_date_to']


def test_api_intercompany_filtered_by_subsidiary(client):
    resp = client.get('/api/gl/intercompany?subsidiary=B', headers=AUTH_HEADERS)
    assert resp.status_code == 200
    entries = resp.get_json()
    assert all('B' in (e['subsidiary_from'], e['subsidiary_to']) for e in entries)
    assert len(entries) >= 2  # B appears as both sender and receiver in seed data


# ---------------------------------------------------------------------------
# GET /api/gl/accruals
# ---------------------------------------------------------------------------

def test_api_accruals_flagged_over_tolerance(client):
    resp = client.get('/api/gl/accruals?status=flagged', headers=AUTH_HEADERS)
    assert resp.status_code == 200
    accruals = resp.get_json()
    row = next(a for a in accruals if a['subsidiary'] == 'A')
    assert float(row['variance_pct']) == 12.0
    assert float(row['tolerance_pct']) == 10.0
    assert row['blocked_by_open_ap'] is False


def test_api_accruals_blocked_by_open_ap(client):
    resp = client.get('/api/gl/accruals?status=blocked', headers=AUTH_HEADERS)
    assert resp.status_code == 200
    accruals = resp.get_json()
    row = next(a for a in accruals if a['subsidiary'] == 'B')
    assert row['blocked_by_open_ap'] is True
    assert row['ap_reference'] == 'AP-2024-2201'
