import http.server
import json
import os
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as app_module  # noqa: E402
from app import app as flask_app, supabase  # noqa: E402

DEMO_API_KEY = 'demo-key-receipthub'
AUTH_HEADERS = {'X-API-Key': DEMO_API_KEY}


@pytest.fixture
def client():
    flask_app.config['TESTING'] = True
    return flask_app.test_client()


@pytest.fixture
def cleanup_grs():
    """Deletes any GR (and its line items) whose gr_number was registered
    here, once the test finishes — regardless of pass/fail."""
    created_numbers = []
    yield created_numbers
    for number in created_numbers:
        result = supabase.table('goods_received').select('id').eq('gr_number', number).execute()
        for row in result.data or []:
            supabase.table('gr_line_items').delete().eq('gr_id', row['id']).execute()
            supabase.table('goods_received').delete().eq('id', row['id']).execute()


class WebhookReceiver:
    """Local HTTP server standing in for the webhook consumer."""

    def __init__(self):
        self.requests = []
        self._cond = threading.Condition()

    def record(self, headers, body):
        with self._cond:
            self.requests.append({'headers': headers, 'body': json.loads(body), 'raw': body})
            self._cond.notify_all()

    def wait_for(self, count, timeout=5):
        with self._cond:
            self._cond.wait_for(lambda: len(self.requests) >= count, timeout)
            return list(self.requests)


@pytest.fixture
def webhook_receiver(monkeypatch):
    receiver = WebhookReceiver()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(length)
            receiver.record({k.lower(): v for k, v in self.headers.items()}, raw)
            self.send_response(200)
            self.end_headers()

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(app_module, 'WEBHOOK_URL', f'http://127.0.0.1:{server.server_port}/hook')
    monkeypatch.setattr(app_module, 'WEBHOOK_SECRET', 'test-secret')
    yield receiver
    server.shutdown()
