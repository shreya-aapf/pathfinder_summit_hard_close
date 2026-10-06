import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app as flask_app  # noqa: E402

DEMO_API_KEY = 'demo-key-meridiangl'
AUTH_HEADERS = {'X-API-Key': DEMO_API_KEY}


@pytest.fixture
def client():
    flask_app.config['TESTING'] = True
    return flask_app.test_client()
