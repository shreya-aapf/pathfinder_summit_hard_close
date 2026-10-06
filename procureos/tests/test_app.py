import uuid

from conftest import AUTH_HEADERS


def _unique_po_number():
    return f'TEST-{uuid.uuid4().hex[:10]}'


# ---------------------------------------------------------------------------
# UI routes (no auth)
# ---------------------------------------------------------------------------

def test_index_page_loads(client):
    resp = client.get('/')
    assert resp.status_code == 200


def test_index_page_search_and_status_filter(client):
    resp = client.get('/?status=open&search=test')
    assert resp.status_code == 200


def test_new_po_form_loads(client):
    resp = client.get('/po/new')
    assert resp.status_code == 200


def test_view_missing_po_returns_404(client):
    resp = client.get('/po/does-not-exist')
    assert resp.status_code == 404


def test_ui_create_view_and_delete_po(client, cleanup_pos):
    po_number = _unique_po_number()
    cleanup_pos.append(po_number)

    create_resp = client.post('/po/new', data={
        'po_number': po_number,
        'vendor_id': 'TEST-VEND-001',
        'vendor_name': 'Test Vendor Ltd',
        'issue_date': '2024-10-01',
        'delivery_date': '2024-11-01',
        'status': 'open',
        'purchase_what': 'Test widgets',
        'purchase_why': 'Needed for testing',
        'no_purchase_impact': 'Tests would not run',
        'criticality': 'nice_to_have',
        'alternative_tool': 'No',
        'roi_benefit': 'Faster tests',
        'okr_alignment': 'Quality OKR',
        'line_item_1_item_code': 'WIDGET-001',
        'line_item_1_description': 'Test Widget',
        'line_item_1_quantity': '5',
        'line_item_1_unit_price': '20.00',
    }, follow_redirects=True)
    assert create_resp.status_code == 200
    assert po_number.encode() in create_resp.data

    view_resp = client.get(f'/po/{po_number}')
    assert view_resp.status_code == 200
    assert b'100.00' in view_resp.data  # 5 * 20.00 total

    delete_resp = client.post(f'/po/{po_number}/delete', follow_redirects=True)
    assert delete_resp.status_code == 200

    view_after_delete = client.get(f'/po/{po_number}')
    assert view_after_delete.status_code == 404


# ---------------------------------------------------------------------------
# API auth
# ---------------------------------------------------------------------------

def test_api_requires_key(client):
    resp = client.get('/api/pos')
    assert resp.status_code == 401


def test_api_rejects_wrong_key(client):
    resp = client.get('/api/pos', headers={'X-API-Key': 'wrong-key'})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# API lifecycle
# ---------------------------------------------------------------------------

def test_api_create_get_list_update_delete_po(client, cleanup_pos):
    po_number = _unique_po_number()
    cleanup_pos.append(po_number)

    payload = {
        'po_number': po_number,
        'vendor_id': 'TEST-VEND-001',
        'vendor_name': 'Test Vendor Ltd',
        'issue_date': '2024-10-01',
        'delivery_date': '2024-11-01',
        'status': 'open',
        'line_items': [{
            'line_number': 1,
            'item_code': 'DESK-001',
            'description': 'Standing Desk',
            'quantity': 5,
            'unit_price': 450.00,
        }],
    }

    create_resp = client.post('/api/pos', json=payload, headers=AUTH_HEADERS)
    assert create_resp.status_code == 201
    body = create_resp.get_json()
    assert body['po_number'] == po_number
    assert body['total_amount'] == 2250.00
    assert body['line_items'][0]['amount'] == 2250.00

    # Duplicate po_number rejected
    dup_resp = client.post('/api/pos', json=payload, headers=AUTH_HEADERS)
    assert dup_resp.status_code == 409

    # GET by po_number (primary automation endpoint)
    get_resp = client.get(f'/api/po/{po_number}', headers=AUTH_HEADERS)
    assert get_resp.status_code == 200
    assert get_resp.get_json()['vendor_name'] == 'Test Vendor Ltd'

    # Shows up in filtered list
    list_resp = client.get('/api/pos?status=open', headers=AUTH_HEADERS)
    assert list_resp.status_code == 200
    numbers = [po['po_number'] for po in list_resp.get_json()['purchase_orders']]
    assert po_number in numbers

    # Full replace via PUT recomputes total
    update_payload = {
        'vendor_id': 'TEST-VEND-001',
        'vendor_name': 'Test Vendor Ltd (Updated)',
        'status': 'partially_received',
        'line_items': [
            {'line_number': 1, 'item_code': 'DESK-001', 'description': 'Standing Desk', 'quantity': 3, 'unit_price': 450.00},
            {'line_number': 2, 'item_code': 'CHAIR-001', 'description': 'Office Chair', 'quantity': 2, 'unit_price': 120.00},
        ],
    }
    update_resp = client.put(f'/api/pos/{po_number}', json=update_payload, headers=AUTH_HEADERS)
    assert update_resp.status_code == 200
    updated = update_resp.get_json()
    assert updated['status'] == 'partially_received'
    assert updated['total_amount'] == 1590.00  # 3*450 + 2*120
    assert len(updated['line_items']) == 2

    # Delete
    delete_resp = client.delete(f'/api/pos/{po_number}', headers=AUTH_HEADERS)
    assert delete_resp.status_code == 204

    get_after_delete = client.get(f'/api/po/{po_number}', headers=AUTH_HEADERS)
    assert get_after_delete.status_code == 404


def test_api_create_po_missing_po_number(client):
    resp = client.post('/api/pos', json={'vendor_id': 'TEST-VEND-001'}, headers=AUTH_HEADERS)
    assert resp.status_code == 400


def test_api_get_nonexistent_po(client):
    resp = client.get(f'/api/po/{uuid.uuid4()}', headers=AUTH_HEADERS)
    assert resp.status_code == 404


def test_api_delete_nonexistent_po(client):
    resp = client.delete(f'/api/pos/{uuid.uuid4()}', headers=AUTH_HEADERS)
    assert resp.status_code == 404
