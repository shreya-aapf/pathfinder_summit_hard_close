import uuid

from conftest import AUTH_HEADERS


def _unique_gr_number():
    return f'TEST-{uuid.uuid4().hex[:10]}'


def _unique_po_number():
    return f'TEST-PO-{uuid.uuid4().hex[:10]}'


# ---------------------------------------------------------------------------
# UI routes
# ---------------------------------------------------------------------------

def test_index_page_loads(client):
    resp = client.get('/')
    assert resp.status_code == 200


def test_index_page_search_and_status_filter(client):
    resp = client.get('/?status=complete&search=test')
    assert resp.status_code == 200


def test_new_gr_form_loads(client):
    resp = client.get('/gr/new')
    assert resp.status_code == 200


def test_view_missing_gr_returns_404(client):
    resp = client.get('/gr/does-not-exist')
    assert resp.status_code == 404


def test_ui_create_view_and_delete_gr(client, cleanup_grs):
    gr_number = _unique_gr_number()
    po_number = _unique_po_number()
    cleanup_grs.append(gr_number)

    create_resp = client.post('/gr/new', data={
        'gr_number': gr_number,
        'po_number': po_number,
        'vendor_id': 'TEST-VEND-001',
        'vendor_name': 'Test Vendor Ltd',
        'received_date': '2024-11-05',
        'received_by': 'Test Receiver',
        'status': 'complete',
        'line_item_1_item_code': 'WIDGET-001',
        'line_item_1_description': 'Test Widget',
        'line_item_1_quantity_ordered': '10',
        'line_item_1_quantity_received': '10',
        'line_item_1_unit_price': '20.00',
        'line_item_1_condition': 'good',
    }, follow_redirects=True)
    assert create_resp.status_code == 200
    assert gr_number.encode() in create_resp.data

    view_resp = client.get(f'/gr/{gr_number}')
    assert view_resp.status_code == 200

    delete_resp = client.post(f'/gr/{gr_number}/delete', follow_redirects=True)
    assert delete_resp.status_code == 200

    view_after_delete = client.get(f'/gr/{gr_number}')
    assert view_after_delete.status_code == 404


# ---------------------------------------------------------------------------
# API auth — 401 missing, 403 invalid (differs from ProcureOS/MeridianGL)
# ---------------------------------------------------------------------------

def test_api_missing_key_returns_401(client):
    resp = client.get('/api/grs')
    assert resp.status_code == 401


def test_api_invalid_key_returns_403(client):
    resp = client.get('/api/grs', headers={'X-API-Key': 'wrong-key'})
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# API lifecycle
# ---------------------------------------------------------------------------

def test_api_create_get_list_update_delete_gr(client, cleanup_grs):
    gr_number = _unique_gr_number()
    po_number = _unique_po_number()
    cleanup_grs.append(gr_number)

    payload = {
        'gr_number': gr_number,
        'po_number': po_number,
        'vendor_id': 'TEST-VEND-001',
        'vendor_name': 'Test Vendor Ltd',
        'received_date': '2024-11-05',
        'received_by': 'M. Torres',
        'status': 'partial',
        'line_items': [{
            'line_number': 1,
            'item_code': 'CHAIR-001',
            'description': 'Office Chairs',
            'quantity_ordered': 10,
            'quantity_received': 6,
            'unit_price': 120.00,
            'condition': 'good',
        }],
    }

    create_resp = client.post('/api/grs', json=payload, headers=AUTH_HEADERS)
    assert create_resp.status_code == 201
    body = create_resp.get_json()
    assert body['gr_number'] == gr_number
    assert body['line_items'][0]['condition'] == 'good'

    # GET by gr_number
    get_resp = client.get(f'/api/gr/{gr_number}', headers=AUTH_HEADERS)
    assert get_resp.status_code == 200
    assert get_resp.get_json()['po_number'] == po_number

    # GET by po_number — primary automation endpoint, returns an array
    by_po_resp = client.get(f'/api/gr/by-po/{po_number}', headers=AUTH_HEADERS)
    assert by_po_resp.status_code == 200
    by_po_data = by_po_resp.get_json()
    assert isinstance(by_po_data, list)
    assert any(gr['gr_number'] == gr_number for gr in by_po_data)

    # Filtered list
    list_resp = client.get(f'/api/grs?po_number={po_number}', headers=AUTH_HEADERS)
    assert list_resp.status_code == 200
    numbers = [gr['gr_number'] for gr in list_resp.get_json()['data']]
    assert gr_number in numbers

    # Full replace via PUT — status + line items (condition now damaged)
    update_payload = {
        'status': 'complete',
        'line_items': [{
            'line_number': 1,
            'item_code': 'CHAIR-001',
            'description': 'Office Chairs',
            'quantity_ordered': 10,
            'quantity_received': 10,
            'unit_price': 120.00,
            'condition': 'damaged',
        }],
    }
    update_resp = client.put(f'/api/grs/{gr_number}', json=update_payload, headers=AUTH_HEADERS)
    assert update_resp.status_code == 200
    updated = update_resp.get_json()
    assert updated['status'] == 'complete'
    assert updated['line_items'][0]['condition'] == 'damaged'

    # Delete
    delete_resp = client.delete(f'/api/grs/{gr_number}', headers=AUTH_HEADERS)
    assert delete_resp.status_code == 204

    get_after_delete = client.get(f'/api/gr/{gr_number}', headers=AUTH_HEADERS)
    assert get_after_delete.status_code == 404


def test_api_get_by_po_returns_empty_array_when_none_exist(client):
    resp = client.get(f'/api/gr/by-po/{uuid.uuid4()}', headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.get_json() == []


def test_api_create_gr_missing_required_fields(client):
    resp = client.post('/api/grs', json={'gr_number': _unique_gr_number()}, headers=AUTH_HEADERS)
    assert resp.status_code == 400


def test_api_get_nonexistent_gr(client):
    resp = client.get(f'/api/gr/{uuid.uuid4()}', headers=AUTH_HEADERS)
    assert resp.status_code == 404


def test_api_delete_nonexistent_gr(client):
    resp = client.delete(f'/api/grs/{uuid.uuid4()}', headers=AUTH_HEADERS)
    assert resp.status_code == 404
