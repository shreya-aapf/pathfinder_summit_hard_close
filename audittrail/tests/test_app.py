import uuid

# These tests assert against the known seed data loaded by ../supabase/schema.sql
# (idempotent seed — safe to assume present in the shared project): the Acme
# Supplies bank-mismatch vendor flag, three flux_analysis rows, and six
# close_status rows.


# ---------------------------------------------------------------------------
# UI routes
# ---------------------------------------------------------------------------

def test_close_status_board_loads(client):
    resp = client.get('/')
    assert resp.status_code == 200
    assert b'Sub A/B intercompany timing difference' in resp.data


def test_close_status_board_filter(client):
    resp = client.get('/?status=escalated')
    assert resp.status_code == 200


def test_vendor_flags_page_loads(client):
    resp = client.get('/vendor-flags')
    assert resp.status_code == 200
    assert b'Acme Supplies' in resp.data


def test_vendor_flag_detail_not_found_redirects(client):
    resp = client.get(f'/vendor-flags/{uuid.uuid4()}', follow_redirects=True)
    assert resp.status_code == 200
    assert b'Vendor Flags' in resp.data or b'vendor-flags' in resp.data


def test_flux_page_loads(client):
    resp = client.get('/flux')
    assert resp.status_code == 200


def test_audit_log_page_loads(client):
    resp = client.get('/audit-log')
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# GET /api/vendor-flags
# ---------------------------------------------------------------------------

def test_api_list_vendor_flags(client):
    resp = client.get('/api/vendor-flags')
    assert resp.status_code == 200
    flags = resp.get_json()
    acme = next(f for f in flags if f['vendor_name'] == 'Acme Supplies Ltd')
    assert acme['flag_type'] == 'bank_mismatch'
    assert acme['registered_bank_details'] != acme['submitted_bank_details']


def test_api_get_single_vendor_flag(client):
    flags = client.get('/api/vendor-flags').get_json()
    acme = next(f for f in flags if f['vendor_name'] == 'Acme Supplies Ltd')

    resp = client.get(f'/api/vendor-flags/{acme["id"]}')
    assert resp.status_code == 200
    assert resp.get_json()['invoice_number'] == 'INV-2024-001'


def test_api_get_vendor_flag_not_found(client):
    resp = client.get(f'/api/vendor-flags/{uuid.uuid4()}')
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/flux-analysis
# ---------------------------------------------------------------------------

def test_api_flux_analysis_filter_by_category(client):
    resp = client.get('/api/flux-analysis?category=revenue')
    assert resp.status_code == 200
    rows = resp.get_json()
    assert all(r['category'] == 'revenue' for r in rows)
    assert any(r['subsidiary'] == 'C' for r in rows)


def test_api_flux_analysis_linked_to_held_invoice(client):
    resp = client.get('/api/flux-analysis?status=unexplained')
    assert resp.status_code == 200
    rows = resp.get_json()
    assert any(r['linked_reference'] == 'INV-2024-001' for r in rows)


# ---------------------------------------------------------------------------
# GET/POST /api/audit-trail
# ---------------------------------------------------------------------------

def test_api_create_audit_trail_missing_fields(client):
    resp = client.post('/api/audit-trail', json={'agent_name': 'test-agent'})
    assert resp.status_code == 400


def test_api_create_and_list_audit_trail_entry(client):
    tag = f'TEST-{uuid.uuid4().hex[:10]}'

    create_resp = client.post('/api/audit-trail', json={
        'action_checked': 'Vendor bank details vs. ERP registration',
        'decision': 'Escalated — bank details do not match registered record',
        'evidence': 'Registered: First National ****4471. Submitted: Coastal Trust ****9902.',
        'escalation_reason': 'Possible payment fraud — do not release payment.',
        'related_reference': tag,
    })
    assert create_resp.status_code == 201
    entry = create_resp.get_json()
    assert entry['agent_name'] == 'close-automation'
    assert entry['related_reference'] == tag

    list_resp = client.get(f'/api/audit-trail?related_reference={tag}')
    assert list_resp.status_code == 200
    entries = list_resp.get_json()
    assert len(entries) == 1
    assert entries[0]['decision'] == 'Escalated — bank details do not match registered record'


def test_api_create_audit_trail_entry_defaults_agent_name(client):
    tag = f'TEST-{uuid.uuid4().hex[:10]}'
    resp = client.post('/api/audit-trail', json={
        'action_checked': 'Flux variance review',
        'decision': 'Cleared — within seasonal range',
        'related_reference': tag,
    })
    assert resp.status_code == 201
    assert resp.get_json()['agent_name'] == 'close-automation'


# ---------------------------------------------------------------------------
# GET/PATCH /api/close-status
# ---------------------------------------------------------------------------

def test_api_list_close_status_filter(client):
    resp = client.get('/api/close-status?status=escalated')
    assert resp.status_code == 200
    items = resp.get_json()
    assert all(i['status'] == 'escalated' for i in items)
    assert len(items) >= 1


def test_api_patch_close_status_round_trip(client, restore_close_status):
    items = client.get('/api/close-status?category=Intercompany').get_json()
    item = items[0]
    restore_close_status(item['id'])

    patch_resp = client.patch(f'/api/close-status/{item["id"]}', json={
        'status': 'cleared',
        'note': 'Confirmed via test — will be restored automatically.',
    })
    assert patch_resp.status_code == 200
    updated = patch_resp.get_json()
    assert updated['status'] == 'cleared'
    assert updated['note'] == 'Confirmed via test — will be restored automatically.'


def test_api_patch_close_status_invalid_status(client):
    items = client.get('/api/close-status').get_json()
    item_id = items[0]['id']
    resp = client.patch(f'/api/close-status/{item_id}', json={'status': 'not-a-real-status'})
    assert resp.status_code == 400


def test_api_patch_close_status_empty_body(client):
    items = client.get('/api/close-status').get_json()
    item_id = items[0]['id']
    resp = client.patch(f'/api/close-status/{item_id}', json={'irrelevant_field': 'x'})
    assert resp.status_code == 400


def test_api_patch_close_status_not_found(client):
    resp = client.patch(f'/api/close-status/{uuid.uuid4()}', json={'status': 'cleared'})
    assert resp.status_code == 404
