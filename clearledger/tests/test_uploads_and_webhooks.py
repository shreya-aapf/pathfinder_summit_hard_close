import hashlib
import hmac
import io
import urllib.request
import uuid

from conftest import AUTH_HEADERS, supabase

PDF_BYTES = b'%PDF-1.4\n% test invoice\n'


def _unique_invoice_number():
    return f'TEST-{uuid.uuid4().hex[:10]}'


def _pdf(name='invoice.pdf', content=PDF_BYTES):
    return (io.BytesIO(content), name)


def _upload_form(invoice_number, **overrides):
    data = {
        'invoice_number': invoice_number,
        'vendor_id': 'TEST-VEND-001',
        'vendor_name': 'Test Vendor Ltd',
        'invoice_date': '2024-11-15',
        'po_number': 'TEST-PO-0001',
        'gr_number': '',
        'total_amount': '1250.00',
        'document': _pdf(),
    }
    data.update(overrides)
    return data


def _create_invoice_via_api(client, invoice_number):
    resp = client.post('/api/invoices', json={
        'invoice_number': invoice_number, 'vendor_id': 'TEST-VEND-001', 'vendor_name': 'Test Vendor Ltd',
        'invoice_date': '2024-11-15', 'po_number': 'TEST-PO-0001', 'total_amount': 100.0,
        'match_status': 'mismatch',
    }, headers=AUTH_HEADERS)
    assert resp.status_code == 201
    return resp.get_json()['id']


# ---------------------------------------------------------------------------
# Document upload (Supabase Storage)
# ---------------------------------------------------------------------------

def test_upload_invoice_page_loads(client):
    resp = client.get('/invoices/new')
    assert resp.status_code == 200
    assert b'Upload Invoice' in resp.data


def test_ui_upload_invoice_stores_record_and_document(client, cleanup_invoices):
    number = _unique_invoice_number()
    cleanup_invoices.append(number)

    resp = client.post('/invoices/new', data=_upload_form(number),
                       content_type='multipart/form-data', follow_redirects=True)
    assert resp.status_code == 200
    assert number.encode() in resp.data
    assert b'invoice.pdf' in resp.data
    assert b'Awaiting Match' in resp.data

    row = supabase.table('invoices').select('*').eq('invoice_number', number).single().execute().data
    assert row['status'] == 'pending'
    assert row['document_name'] == 'invoice.pdf'
    assert row['document_path'].startswith(f'invoices/{number}/')

    view = client.get(f"/invoices/{row['id']}/document")
    assert view.status_code == 302
    assert urllib.request.urlopen(view.headers['Location'], timeout=10).read() == PDF_BYTES


def test_ui_upload_invoice_requires_file(client, cleanup_invoices):
    number = _unique_invoice_number()
    cleanup_invoices.append(number)
    resp = client.post('/invoices/new', data=_upload_form(number, document=(io.BytesIO(b''), '')),
                       content_type='multipart/form-data')
    assert resp.status_code == 400
    assert b'choose an invoice file' in resp.data
    assert not supabase.table('invoices').select('id').eq('invoice_number', number).execute().data


def test_ui_upload_invoice_rejects_unsupported_type_and_leaves_no_record(client, cleanup_invoices):
    number = _unique_invoice_number()
    cleanup_invoices.append(number)
    resp = client.post('/invoices/new', data=_upload_form(number, document=_pdf('malware.exe')),
                       content_type='multipart/form-data')
    assert resp.status_code == 400
    assert b'Unsupported file type' in resp.data
    assert not supabase.table('invoices').select('id').eq('invoice_number', number).execute().data


def test_ui_upload_invoice_rejects_duplicate_number(client, cleanup_invoices):
    number = _unique_invoice_number()
    cleanup_invoices.append(number)
    _create_invoice_via_api(client, number)
    resp = client.post('/invoices/new', data=_upload_form(number), content_type='multipart/form-data')
    assert resp.status_code == 400
    assert b'already exists' in resp.data


def test_api_document_upload_get_and_replace(client, cleanup_invoices):
    number = _unique_invoice_number()
    cleanup_invoices.append(number)
    invoice_id = _create_invoice_via_api(client, number)

    assert client.get(f'/api/invoices/{invoice_id}/document', headers=AUTH_HEADERS).status_code == 404

    up = client.post(f'/api/invoices/{invoice_id}/document', headers=AUTH_HEADERS,
                     data={'file': _pdf('first.pdf')}, content_type='multipart/form-data')
    assert up.status_code == 201
    first_path = up.get_json()['document_path']

    got = client.get(f'/api/invoices/{invoice_id}/document', headers=AUTH_HEADERS)
    assert got.status_code == 200
    assert got.get_json()['document_name'] == 'first.pdf'
    assert urllib.request.urlopen(got.get_json()['url'], timeout=10).read() == PDF_BYTES

    again = client.post(f'/api/invoices/{invoice_id}/document', headers=AUTH_HEADERS,
                        data={'file': _pdf('second.pdf', b'%PDF-1.4\n% replacement\n')},
                        content_type='multipart/form-data')
    assert again.status_code == 201
    assert again.get_json()['document_path'] != first_path
    listing = supabase.storage.from_('documents').list(f'invoices/{number}')
    assert [f['name'] for f in listing] == [again.get_json()['document_path'].rsplit('/', 1)[-1]]


def test_api_document_upload_validation(client, cleanup_invoices):
    number = _unique_invoice_number()
    cleanup_invoices.append(number)
    invoice_id = _create_invoice_via_api(client, number)

    no_file = client.post(f'/api/invoices/{invoice_id}/document', headers=AUTH_HEADERS,
                          data={}, content_type='multipart/form-data')
    assert no_file.status_code == 400
    bad_type = client.post(f'/api/invoices/{invoice_id}/document', headers=AUTH_HEADERS,
                           data={'file': _pdf('notes.txt')}, content_type='multipart/form-data')
    assert bad_type.status_code == 400
    empty = client.post(f'/api/invoices/{invoice_id}/document', headers=AUTH_HEADERS,
                        data={'file': _pdf('empty.pdf', b'')}, content_type='multipart/form-data')
    assert empty.status_code == 400
    missing = client.post(f'/api/invoices/{uuid.uuid4()}/document', headers=AUTH_HEADERS,
                          data={'file': _pdf()}, content_type='multipart/form-data')
    assert missing.status_code == 404


# ---------------------------------------------------------------------------
# Outbound webhook
# ---------------------------------------------------------------------------

def test_webhook_fires_on_create_action_and_document_upload(client, cleanup_invoices, webhook_receiver):
    number = _unique_invoice_number()
    cleanup_invoices.append(number)
    invoice_id = _create_invoice_via_api(client, number)

    action = client.patch(f'/api/invoices/{invoice_id}/action',
                          json={'action': 'escalate', 'note': 'looks off'}, headers=AUTH_HEADERS)
    assert action.status_code == 200
    upload = client.post(f'/api/invoices/{invoice_id}/document', headers=AUTH_HEADERS,
                         data={'file': _pdf()}, content_type='multipart/form-data')
    assert upload.status_code == 201

    received = webhook_receiver.wait_for(3)
    assert len(received) == 3
    by_event = {}
    for r in received:
        by_event.setdefault(r['body']['event'], []).append(r)
    assert len(by_event['invoice.created']) == 1
    assert len(by_event['invoice.updated']) == 2

    created = by_event['invoice.created'][0]
    assert created['body']['source'] == 'clearledger'
    assert created['body']['data']['invoice_number'] == number
    assert created['body']['data']['document_url'] is None  # no document at create time
    assert created['headers']['x-webhook-event'] == 'invoice.created'

    action_payload = next(r for r in by_event['invoice.updated'] if r['body']['data'].get('action'))
    assert action_payload['body']['data']['status'] == 'escalated'
    assert action_payload['body']['data']['note'] == 'looks off'

    upload_payload = next(r for r in by_event['invoice.updated'] if not r['body']['data'].get('action'))
    assert upload_payload['body']['data']['document_url'].startswith('https://')


def test_webhook_signature_is_hmac_of_body(client, cleanup_invoices, webhook_receiver):
    number = _unique_invoice_number()
    cleanup_invoices.append(number)
    _create_invoice_via_api(client, number)

    [hook] = webhook_receiver.wait_for(1)
    signature = hook['headers']['x-webhook-signature']
    assert signature.startswith('sha256=')
    assert hook['raw'] is not None
    expected = hmac.new(b'test-secret', hook['raw'], hashlib.sha256).hexdigest()
    assert signature == f'sha256={expected}'


def test_webhook_is_noop_without_url(client, cleanup_invoices, monkeypatch):
    import app as app_module
    monkeypatch.setattr(app_module, 'WEBHOOK_URL', '')
    number = _unique_invoice_number()
    cleanup_invoices.append(number)
    _create_invoice_via_api(client, number)


def test_api_document_download(client, cleanup_invoices):
    number = _unique_invoice_number()
    cleanup_invoices.append(number)
    invoice_id = _create_invoice_via_api(client, number)

    assert client.get(f'/api/invoices/{invoice_id}/document/download',
                      headers=AUTH_HEADERS).status_code == 404

    client.post(f'/api/invoices/{invoice_id}/document', headers=AUTH_HEADERS,
                data={'file': _pdf()}, content_type='multipart/form-data')

    resp = client.get(f'/api/invoices/{invoice_id}/document/download', headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.data == PDF_BYTES
    assert 'attachment' in resp.headers.get('Content-Disposition', '')
    assert 'invoice.pdf' in resp.headers.get('Content-Disposition', '')
