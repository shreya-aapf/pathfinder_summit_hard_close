import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app as flask_app, supabase  # noqa: E402

DEMO_API_KEY = 'demo-key-procureos'
AUTH_HEADERS = {'X-API-Key': DEMO_API_KEY}


@pytest.fixture
def client():
    flask_app.config['TESTING'] = True
    return flask_app.test_client()


@pytest.fixture
def cleanup_pos():
    """Deletes any PO (and its line items) whose po_number was registered
    here, once the test finishes — regardless of pass/fail."""
    created_numbers = []
    yield created_numbers
    for number in created_numbers:
        result = supabase.table('purchase_orders').select('id, document_path').eq('po_number', number).execute()
        for row in result.data or []:
            if row.get('document_path'):
                supabase.storage.from_('documents').remove([row['document_path']])
            supabase.table('po_line_items').delete().eq('po_id', row['id']).execute()
            supabase.table('purchase_orders').delete().eq('id', row['id']).execute()
