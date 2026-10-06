import os
import shutil
import subprocess
import sys
import uuid

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app as flask_app, supabase  # noqa: E402

PASSWORD = 'correct-horse-battery'


@pytest.fixture(autouse=True)
def auth_env(monkeypatch):
    monkeypatch.setenv('AUTH_SECRET', 'test-auth-secret')
    monkeypatch.setenv('LOGIN_URL', '/login')
    monkeypatch.delenv('VERCEL', raising=False)


@pytest.fixture
def client():
    flask_app.config['TESTING'] = True
    return flask_app.test_client()


@pytest.fixture
def new_username():
    return f'test_{uuid.uuid4().hex[:10]}'


@pytest.fixture
def registered_user(new_username):
    result = supabase.rpc('register_app_user', {'p_username': new_username, 'p_password': PASSWORD}).execute().data
    assert result == 'ok'
    return new_username


@pytest.fixture(scope='session', autouse=True)
def purge_test_users():
    """app_users is closed to the anon key, so test accounts are removed with the Supabase CLI."""
    yield
    cli = shutil.which('supabase')
    if cli:
        repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        subprocess.run(
            [cli, 'db', 'query', '--linked', "delete from app_users where username like 'test\\_%'"],
            capture_output=True, timeout=60, cwd=repo_root,
        )
