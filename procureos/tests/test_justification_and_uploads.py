import io
import urllib.request
import uuid

from conftest import AUTH_HEADERS, supabase

PDF_BYTES = b'%PDF-1.4\n% test quote\n'

JUSTIFICATION = {
    'purchase_what': 'Annual licence for a log analytics tool',
    'purchase_why': 'Incident reviews currently take two days',
    'no_purchase_impact': 'On-call keeps grepping raw logs',
    'criticality': 'keep_the_lights_on',
    'alternative_tool': 'Existing APM covers about 70% of this',
    'roi_benefit': 'Saves roughly 20 engineer hours a month',
    'okr_alignment': 'Reduce MTTR by 30%',
}


def _unique_po_number():
    return f'TEST-PO-{uuid.uuid4().hex[:10]}'


def _pdf(name='quote.pdf', content=PDF_BYTES):
    return (io.BytesIO(content), name)


def _ui_form(po_number, **overrides):
    data = {
        'po_number': po_number,
        'vendor_id': 'TEST-VEND-001',
        'vendor_name': 'Test Vendor Ltd',
        'issue_date': '2024-10-01',
        'delivery_date': '2024-11-01',
        'status': 'open',
        'line_item_1_item_code': 'LIC-001',
        'line_item_1_description': 'Licence',
        'line_item_1_quantity': '2',
        'line_item_1_unit_price': '50.00',
        **JUSTIFICATION,
    }
    data.update(overrides)
    return data


def _api_payload(po_number, **overrides):
    payload = {
        'po_number': po_number,
        'vendor_id': 'TEST-VEND-001',
        'vendor_name': 'Test Vendor Ltd',
        'line_items': [{'item_code': 'LIC-001', 'description': 'Licence', 'quantity': 2, 'unit_price': 50.0}],
    }
    payload.update(overrides)
    return payload


# ---------------------------------------------------------------------------
# Justification questions
# ---------------------------------------------------------------------------

def test_new_po_form_shows_all_justification_questions(client):
    html = client.get('/po/new').data.decode()
    for question in (
        'What are you purchasing?',
        'Why do we need to purchase this?',
        "What will happen if we don't make this purchase?",
        'keep-the-lights-on or nice to have',
        'another tool/service that does 70-80%',
        'What is the ROI or benefit of the services?',
        'What other OKRs of your team is the purchase tied to?',
    ):
        assert question in html


def test_ui_create_requires_every_justification_answer(client, cleanup_pos):
    for field in list(JUSTIFICATION):
        po_number = _unique_po_number()
        cleanup_pos.append(po_number)
        resp = client.post('/po/new', data=_ui_form(po_number, **{field: ''}), follow_redirects=True)
        assert b'purchase justification questions' in resp.data, field
        assert client.get(f'/po/{po_number}').status_code == 404, field


def test_ui_create_rejects_invalid_criticality(client, cleanup_pos):
    po_number = _unique_po_number()
    cleanup_pos.append(po_number)
    resp = client.post('/po/new', data=_ui_form(po_number, criticality='whenever'), follow_redirects=True)
    assert b'purchase justification questions' in resp.data
    assert client.get(f'/po/{po_number}').status_code == 404


def test_ui_create_with_justification_and_document(client, cleanup_pos):
    po_number = _unique_po_number()
    cleanup_pos.append(po_number)

    resp = client.post('/po/new', data=_ui_form(po_number, document=_pdf()),
                       content_type='multipart/form-data', follow_redirects=True)
    assert resp.status_code == 200
    html = resp.data.decode()
    assert 'Annual licence for a log analytics tool' in html
    assert 'Keep the lights on' in html
    assert 'Reduce MTTR by 30%' in html
    assert 'quote.pdf' in html

    row = supabase.table('purchase_orders').select('*').eq('po_number', po_number).single().execute().data
    assert row['criticality'] == 'keep_the_lights_on'
    assert row['document_path'].startswith(f'purchase-orders/{po_number}/')

    view = client.get(f'/po/{po_number}/document')
    assert view.status_code == 302
    assert urllib.request.urlopen(view.headers['Location'], timeout=10).read() == PDF_BYTES


def test_ui_create_without_document_is_allowed(client, cleanup_pos):
    po_number = _unique_po_number()
    cleanup_pos.append(po_number)
    resp = client.post('/po/new', data=_ui_form(po_number), follow_redirects=True)
    assert resp.status_code == 200
    assert client.get(f'/po/{po_number}/document', follow_redirects=True).status_code == 200


def test_ui_edit_updates_answers_and_replaces_document(client, cleanup_pos):
    po_number = _unique_po_number()
    cleanup_pos.append(po_number)
    client.post('/po/new', data=_ui_form(po_number, document=_pdf('first.pdf')), content_type='multipart/form-data')

    edit = client.post(f'/po/{po_number}/edit',
                       data=_ui_form(po_number, roi_benefit='Revised ROI', document=_pdf('second.pdf')),
                       content_type='multipart/form-data', follow_redirects=True)
    assert edit.status_code == 200
    assert b'Revised ROI' in edit.data
    assert b'second.pdf' in edit.data
    listing = supabase.storage.from_('documents').list(f'purchase-orders/{po_number}')
    assert len(listing) == 1


def test_edit_form_does_not_force_answers_on_legacy_pos(client):
    # Seeded POs predate the questions; their edit form must still be usable.
    html = client.get('/po/PO-2024-0099/edit').data.decode()
    assert 'name="purchase_what"' in html
    assert 'required' not in html.split('id="purchase_what"')[1].split('>')[0]


def test_api_create_and_update_with_justification(client, cleanup_pos):
    po_number = _unique_po_number()
    cleanup_pos.append(po_number)

    created = client.post('/api/pos', headers=AUTH_HEADERS, json=_api_payload(po_number, **JUSTIFICATION))
    assert created.status_code == 201
    assert created.get_json()['justification'] == JUSTIFICATION

    updated = client.put(f'/api/pos/{po_number}', headers=AUTH_HEADERS,
                         json=_api_payload(po_number, roi_benefit='Updated via API'))
    assert updated.status_code == 200
    j = updated.get_json()['justification']
    assert j['roi_benefit'] == 'Updated via API'
    assert j['purchase_what'] == JUSTIFICATION['purchase_what']


def test_api_create_without_justification_still_works(client, cleanup_pos):
    po_number = _unique_po_number()
    cleanup_pos.append(po_number)
    resp = client.post('/api/pos', headers=AUTH_HEADERS, json=_api_payload(po_number))
    assert resp.status_code == 201
    assert resp.get_json()['justification']['criticality'] is None


def test_api_rejects_invalid_criticality(client, cleanup_pos):
    po_number = _unique_po_number()
    cleanup_pos.append(po_number)
    resp = client.post('/api/pos', headers=AUTH_HEADERS, json=_api_payload(po_number, criticality='whenever'))
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Document API
# ---------------------------------------------------------------------------

def test_api_document_upload_and_get(client, cleanup_pos):
    po_number = _unique_po_number()
    cleanup_pos.append(po_number)
    client.post('/api/pos', headers=AUTH_HEADERS, json=_api_payload(po_number))

    assert client.get(f'/api/pos/{po_number}/document', headers=AUTH_HEADERS).status_code == 404

    up = client.post(f'/api/pos/{po_number}/document', headers=AUTH_HEADERS,
                     data={'file': _pdf()}, content_type='multipart/form-data')
    assert up.status_code == 201

    got = client.get(f'/api/pos/{po_number}/document', headers=AUTH_HEADERS)
    assert got.status_code == 200
    assert got.get_json()['document_name'] == 'quote.pdf'
    assert urllib.request.urlopen(got.get_json()['url'], timeout=10).read() == PDF_BYTES
    assert client.get(f'/api/po/{po_number}', headers=AUTH_HEADERS).get_json()['document_name'] == 'quote.pdf'


def test_api_document_endpoints_require_key(client):
    assert client.post('/api/pos/PO-2024-0099/document', data={'file': _pdf()},
                       content_type='multipart/form-data').status_code == 401
    assert client.get('/api/pos/PO-2024-0099/document').status_code == 401
    assert client.get('/api/pos/PO-2024-0099/document/download').status_code == 401


def test_api_document_download(client, cleanup_pos):
    po_number = _unique_po_number()
    cleanup_pos.append(po_number)
    client.post('/api/pos', headers=AUTH_HEADERS, json=_api_payload(po_number))

    assert client.get(f'/api/pos/{po_number}/document/download', headers=AUTH_HEADERS).status_code == 404

    client.post(f'/api/pos/{po_number}/document', headers=AUTH_HEADERS,
                data={'file': _pdf()}, content_type='multipart/form-data')

    resp = client.get(f'/api/pos/{po_number}/document/download', headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.data == PDF_BYTES
    assert 'attachment' in resp.headers.get('Content-Disposition', '')
    assert 'quote.pdf' in resp.headers.get('Content-Disposition', '')


def test_api_document_upload_validation(client, cleanup_pos):
    po_number = _unique_po_number()
    cleanup_pos.append(po_number)
    client.post('/api/pos', headers=AUTH_HEADERS, json=_api_payload(po_number))
    url = f'/api/pos/{po_number}/document'

    assert client.post(url, headers=AUTH_HEADERS, data={}, content_type='multipart/form-data').status_code == 400
    assert client.post(url, headers=AUTH_HEADERS, data={'file': _pdf('run.exe')},
                       content_type='multipart/form-data').status_code == 400
    assert client.post(url, headers=AUTH_HEADERS, data={'file': _pdf('empty.pdf', b'')},
                       content_type='multipart/form-data').status_code == 400
    assert client.post('/api/pos/NOPE-0000/document', headers=AUTH_HEADERS, data={'file': _pdf()},
                       content_type='multipart/form-data').status_code == 404
