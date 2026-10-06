import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app as flask_app, supabase  # noqa: E402


@pytest.fixture
def client():
    flask_app.config['TESTING'] = True
    return flask_app.test_client()


@pytest.fixture
def restore_close_status():
    """Snapshots a close_status row before a test mutates it via PATCH, and
    restores its original status/owner/note afterward — this table is a
    seeded shared board, not test-owned data, so we round-trip rather than
    delete."""
    snapshots = {}

    def _snapshot(item_id):
        result = supabase.table('close_status').select('*').eq('id', item_id).single().execute()
        snapshots[item_id] = result.data

    yield _snapshot

    for item_id, original in snapshots.items():
        if original:
            supabase.table('close_status').update({
                'status': original['status'],
                'owner': original['owner'],
                'note': original['note'],
                'updated_at': original['updated_at'],
            }).eq('id', item_id).execute()
