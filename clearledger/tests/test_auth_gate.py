import pytest

from auth_gate import COOKIE_NAME, issue_token


@pytest.fixture(autouse=True)
def gate_on(monkeypatch):
    monkeypatch.setenv('AUTH_SECRET', 'test-auth-secret')
    monkeypatch.setenv('LOGIN_URL', '/login')
    monkeypatch.delenv('VERCEL', raising=False)


def test_ui_pages_redirect_to_login_with_return_path(client):
    resp = client.get('/settings?tab=1')
    assert resp.status_code == 302
    assert resp.headers['Location'] == '/login?next=%2Fsettings%3Ftab%3D1'


def test_prefixed_request_keeps_prefix_in_return_path(client):
    resp = client.get('/clearledger/settings/api-keys')
    assert resp.headers['Location'] == '/login?next=%2Fclearledger%2Fsettings%2Fapi-keys'


def test_key_free_ui_routes_are_gated_too(client):
    assert client.put('/ui/settings/threshold', json={'threshold_pct': 5}).status_code == 302


def test_api_keeps_key_auth_not_login(client):
    assert client.get('/api/invoices').status_code == 401


def test_static_files_stay_public(client):
    assert client.get('/static/style.css').status_code == 200


def test_valid_cookie_gets_through(client):
    client.set_cookie(COOKIE_NAME, issue_token('someone'))
    assert client.get('/settings').status_code == 200


def test_cookie_signed_with_another_secret_is_rejected(client, monkeypatch):
    monkeypatch.setenv('AUTH_SECRET', 'a-different-secret')
    forged = issue_token('someone')
    monkeypatch.setenv('AUTH_SECRET', 'test-auth-secret')
    client.set_cookie(COOKIE_NAME, forged)
    assert client.get('/settings').status_code == 302
