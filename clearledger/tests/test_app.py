import uuid

from conftest import AUTH_HEADERS


def _unique_invoice_number():
    return f'TEST-{uuid.uuid4().hex[:10]}'


# ---------------------------------------------------------------------------
# UI routes
# ---------------------------------------------------------------------------

def test_queue_page_loads(client):
    resp = client.get('/')
    assert resp.status_code == 200
    assert b'Invoice Queue' in resp.data


def test_queue_page_status_filter(client):
    resp = client.get('/?status=pending')
    assert resp.status_code == 200


def test_settings_page_loads(client):
    resp = client.get('/settings')
    assert resp.status_code == 200
    assert b'Matching Threshold' in resp.data


def test_api_keys_page_loads(client):
    resp = client.get('/settings/api-keys')
    assert resp.status_code == 200
    assert b'API Keys' in resp.data


def test_detail_page_missing_invoice_redirects_to_queue(client):
    resp = client.get(f'/invoices/{uuid.uuid4()}', follow_redirects=True)
    assert resp.status_code == 200
    assert b'Invoice Queue' in resp.data


# ---------------------------------------------------------------------------
# POST /api/invoices
# ---------------------------------------------------------------------------

def test_api_requires_key(client):
    resp = client.post('/api/invoices', json={'invoice_number': _unique_invoice_number()})
    assert resp.status_code == 401


def test_create_invoice_missing_fields(client):
    resp = client.post('/api/invoices', json={'invoice_number': _unique_invoice_number()},
                       headers=AUTH_HEADERS)
    assert resp.status_code == 400
    assert 'error' in resp.get_json()


def test_create_invoice_rejects_non_json_body(client):
    resp = client.post('/api/invoices', data='not json', headers=AUTH_HEADERS)
    assert resp.status_code == 400


def test_create_invoice_and_full_lifecycle(client, cleanup_invoices):
    invoice_number = _unique_invoice_number()
    cleanup_invoices.append(invoice_number)

    payload = {
        'invoice_number': invoice_number,
        'vendor_id': 'TEST-VEND-001',
        'vendor_name': 'Test Vendor Ltd',
        'invoice_date': '2024-11-15',
        'po_number': 'TEST-PO-0001',
        'gr_number': 'TEST-GR-0001',
        'total_amount': 1250.00,
        'match_status': 'mismatch',
        'variance_amount': 50.00,
        'variance_pct': 4.0,
        'line_items': [{
            'line_number': 1,
            'description': 'Test Widget',
            'invoice_qty': 10,
            'invoice_unit_price': 125.00,
            'po_qty': 10,
            'po_unit_price': 120.00,
            'gr_qty': 10,
            'mismatch_type': 'price_variance',
            'variance_amount': 50.00,
        }],
    }

    create_resp = client.post('/api/invoices', json=payload, headers=AUTH_HEADERS)
    assert create_resp.status_code == 201
    body = create_resp.get_json()
    assert body['invoice_number'] == invoice_number
    invoice_id = body['id']

    # Duplicate invoice_number is rejected with 409
    dup_resp = client.post('/api/invoices', json=payload, headers=AUTH_HEADERS)
    assert dup_resp.status_code == 409

    # GET single invoice returns line items
    get_resp = client.get(f'/api/invoices/{invoice_id}', headers=AUTH_HEADERS)
    assert get_resp.status_code == 200
    fetched = get_resp.get_json()
    assert fetched['status'] == 'pending'
    assert len(fetched['line_items']) == 1
    assert fetched['line_items'][0]['mismatch_type'] == 'price_variance'
    assert fetched['actions'] == []

    # Shows up in the pending list
    list_resp = client.get('/api/invoices?status=pending', headers=AUTH_HEADERS)
    assert list_resp.status_code == 200
    assert any(inv['invoice_number'] == invoice_number for inv in list_resp.get_json())

    # Detail page renders it
    detail_resp = client.get(f'/invoices/{invoice_id}')
    assert detail_resp.status_code == 200
    assert invoice_number.encode() in detail_resp.data

    # Invalid action value is rejected
    bad_action_resp = client.patch(f'/api/invoices/{invoice_id}/action',
                                   json={'action': 'nope'}, headers=AUTH_HEADERS)
    assert bad_action_resp.status_code == 400

    # Approve it
    action_resp = client.patch(
        f'/api/invoices/{invoice_id}/action',
        json={'action': 'approve', 'note': 'Variance within acceptable range.'},
        headers=AUTH_HEADERS,
    )
    assert action_resp.status_code == 200
    assert action_resp.get_json()['status'] == 'approved'

    # Action history now has one entry
    final_resp = client.get(f'/api/invoices/{invoice_id}', headers=AUTH_HEADERS)
    actions = final_resp.get_json()['actions']
    assert len(actions) == 1
    assert actions[0]['action_type'] == 'approve'
    assert actions[0]['note'] == 'Variance within acceptable range.'


def test_invoice_action_on_missing_invoice_returns_404(client):
    resp = client.patch(f'/api/invoices/{uuid.uuid4()}/action',
                        json={'action': 'approve'}, headers=AUTH_HEADERS)
    assert resp.status_code == 404


def test_get_invoice_not_found(client):
    resp = client.get(f'/api/invoices/{uuid.uuid4()}', headers=AUTH_HEADERS)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Settings / threshold
# ---------------------------------------------------------------------------

def test_threshold_round_trip(client):
    original = client.get('/api/settings/threshold', headers=AUTH_HEADERS).get_json()['threshold_pct']
    try:
        put_resp = client.put('/api/settings/threshold', json={'threshold_pct': 7.5},
                              headers=AUTH_HEADERS)
        assert put_resp.status_code == 200
        assert put_resp.get_json()['threshold_pct'] == 7.5

        get_resp = client.get('/api/settings/threshold', headers=AUTH_HEADERS)
        assert get_resp.status_code == 200
        assert get_resp.get_json()['threshold_pct'] == 7.5
    finally:
        client.put('/api/settings/threshold', json={'threshold_pct': original},
                   headers=AUTH_HEADERS)


def test_threshold_rejects_out_of_range(client):
    resp = client.put('/api/settings/threshold', json={'threshold_pct': 150},
                      headers=AUTH_HEADERS)
    assert resp.status_code == 400


def test_threshold_rejects_non_numeric(client):
    resp = client.put('/api/settings/threshold', json={'threshold_pct': 'not-a-number'},
                      headers=AUTH_HEADERS)
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Vercel path prefix and key-free UI routes
# ---------------------------------------------------------------------------

def test_serves_under_url_prefix(client):
    resp = client.get('/clearledger/settings/api-keys')
    assert resp.status_code == 200
    assert b'/clearledger/static/style.css' in resp.data
    assert b'href="/clearledger/settings"' in resp.data


def test_ui_threshold_route_needs_no_key_but_api_does(client):
    original = client.get('/api/settings/threshold', headers=AUTH_HEADERS).get_json()['threshold_pct']
    try:
        assert client.put('/ui/settings/threshold', json={'threshold_pct': 7.5}).status_code == 200
        assert client.put('/api/settings/threshold', json={'threshold_pct': 7.5}).status_code == 401
    finally:
        client.put('/api/settings/threshold', json={'threshold_pct': original}, headers=AUTH_HEADERS)


def test_ui_action_route_needs_no_key_but_api_does(client, cleanup_invoices):
    number = _unique_invoice_number()
    cleanup_invoices.append(number)
    invoice_id = client.post('/api/invoices', headers=AUTH_HEADERS, json={
        'invoice_number': number, 'vendor_id': 'TEST-VEND-001', 'vendor_name': 'Test Vendor Ltd',
        'invoice_date': '2024-11-15', 'po_number': 'TEST-PO-0001', 'total_amount': 100.0,
        'match_status': 'mismatch',
    }).get_json()['id']
    assert client.patch(f'/api/invoices/{invoice_id}/action', json={'action': 'approve'}).status_code == 401
    resp = client.patch(f'/ui/invoices/{invoice_id}/action', json={'action': 'approve'})
    assert resp.status_code == 200
    assert resp.get_json()['status'] == 'approved'
