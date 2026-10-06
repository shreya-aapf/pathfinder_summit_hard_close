import hashlib
import hmac
import uuid

from conftest import AUTH_HEADERS


def _unique_gr_number():
    return f'TEST-{uuid.uuid4().hex[:10]}'


def _gr_payload(gr_number, **overrides):
    payload = {
        'gr_number': gr_number,
        'po_number': f'TEST-PO-{uuid.uuid4().hex[:8]}',
        'vendor_id': 'TEST-VEND-001',
        'vendor_name': 'Test Vendor Ltd',
        'received_date': '2024-11-05',
        'received_by': 'Test Receiver',
        'status': 'partial',
        'line_items': [{
            'item_code': 'WIDGET-001', 'description': 'Test Widget',
            'quantity_ordered': 10, 'quantity_received': 4, 'unit_price': 20.0, 'condition': 'good',
        }],
    }
    payload.update(overrides)
    return payload


def test_api_create_and_update_fire_webhooks(client, cleanup_grs, webhook_receiver):
    gr_number = _unique_gr_number()
    cleanup_grs.append(gr_number)

    created = client.post('/api/grs', headers=AUTH_HEADERS, json=_gr_payload(gr_number))
    assert created.status_code == 201
    updated = client.put(f'/api/grs/{gr_number}', headers=AUTH_HEADERS, json={
        'status': 'complete',
        'line_items': [{'item_code': 'WIDGET-001', 'description': 'Test Widget', 'quantity_ordered': 10,
                        'quantity_received': 10, 'unit_price': 20.0, 'condition': 'good'}],
    })
    assert updated.status_code == 200

    received = webhook_receiver.wait_for(2)
    assert len(received) == 2
    events = {r['body']['event']: r for r in received}

    create_hook = events['goods_receipt.created']
    assert create_hook['body']['source'] == 'receipthub'
    assert create_hook['body']['data']['gr_number'] == gr_number
    assert create_hook['body']['data']['status'] == 'partial'
    assert create_hook['body']['data']['line_items'][0]['quantity_received'] == 4
    assert create_hook['headers']['x-webhook-event'] == 'goods_receipt.created'

    update_hook = events['goods_receipt.updated']
    assert update_hook['body']['data']['status'] == 'complete'
    assert update_hook['body']['data']['line_items'][0]['quantity_received'] == 10


def test_ui_create_and_edit_fire_webhooks(client, cleanup_grs, webhook_receiver):
    gr_number = _unique_gr_number()
    cleanup_grs.append(gr_number)
    form = {
        'gr_number': gr_number, 'po_number': 'TEST-PO-UI', 'vendor_id': 'TEST-VEND-001',
        'vendor_name': 'Test Vendor Ltd', 'received_date': '2024-11-05', 'received_by': 'Test Receiver',
        'status': 'partial',
        'line_item_1_item_code': 'WIDGET-001', 'line_item_1_description': 'Test Widget',
        'line_item_1_quantity_ordered': '10', 'line_item_1_quantity_received': '4',
        'line_item_1_unit_price': '20.00', 'line_item_1_condition': 'good',
    }
    assert client.post('/gr/new', data=form).status_code == 302
    assert client.post(f'/gr/{gr_number}/edit', data={**form, 'status': 'complete'}).status_code == 302

    received = webhook_receiver.wait_for(2)
    assert sorted(r['body']['event'] for r in received) == ['goods_receipt.created', 'goods_receipt.updated']
    updated = next(r for r in received if r['body']['event'] == 'goods_receipt.updated')
    assert updated['body']['data']['gr_number'] == gr_number
    assert updated['body']['data']['status'] == 'complete'


def test_webhook_signature_is_hmac_of_body(client, cleanup_grs, webhook_receiver):
    gr_number = _unique_gr_number()
    cleanup_grs.append(gr_number)
    client.post('/api/grs', headers=AUTH_HEADERS, json=_gr_payload(gr_number))

    [hook] = webhook_receiver.wait_for(1)
    expected = hmac.new(b'test-secret', hook['raw'], hashlib.sha256).hexdigest()
    assert hook['headers']['x-webhook-signature'] == f'sha256={expected}'


def test_failed_requests_do_not_fire_webhooks(client, webhook_receiver):
    assert client.post('/api/grs', headers=AUTH_HEADERS, json={'gr_number': 'x'}).status_code == 400
    assert client.put('/api/grs/DOES-NOT-EXIST', headers=AUTH_HEADERS, json={'status': 'complete'}).status_code == 404
    assert webhook_receiver.wait_for(1, timeout=1) == []


def test_webhook_is_noop_without_url(client, cleanup_grs, monkeypatch):
    import app as app_module
    monkeypatch.setattr(app_module, 'WEBHOOK_URL', '')
    gr_number = _unique_gr_number()
    cleanup_grs.append(gr_number)
    assert client.post('/api/grs', headers=AUTH_HEADERS, json=_gr_payload(gr_number)).status_code == 201
