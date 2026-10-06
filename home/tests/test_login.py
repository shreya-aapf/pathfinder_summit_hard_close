from conftest import PASSWORD, supabase


def _register(client, username, password=PASSWORD, confirm=None):
    return client.post('/register', data={
        'username': username, 'password': password,
        'confirm_password': password if confirm is None else confirm,
    })


def _login(client, username, password=PASSWORD, **extra):
    return client.post('/login', data={'username': username, 'password': password, **extra})


def test_home_redirects_to_login_when_signed_out(client):
    resp = client.get('/')
    assert resp.status_code == 302
    assert resp.headers['Location'] == '/login?next=%2F'


def test_login_and_register_pages_are_public(client):
    assert client.get('/login').status_code == 200
    assert client.get('/register').status_code == 200


def test_register_then_login_reaches_home(client, new_username):
    resp = _register(client, new_username)
    assert resp.status_code == 302 and resp.headers['Location'] == '/login'

    resp = _login(client, new_username)
    assert resp.status_code == 302
    assert 'pathfinder_auth=' in resp.headers['Set-Cookie']
    assert 'HttpOnly' in resp.headers['Set-Cookie']

    home = client.get('/')
    assert home.status_code == 200
    assert new_username.encode() in home.data
    assert b'/clearledger/' in home.data


def test_register_rejects_duplicate_username_case_insensitively(client, registered_user):
    resp = _register(client, registered_user.upper())
    assert resp.status_code == 400
    assert b'already taken' in resp.data


def test_register_validates_input(client, new_username):
    assert b'Usernames are' in _register(client, 'a b').data
    assert b'Passwords must be' in _register(client, new_username, password='short').data
    mismatch = _register(client, new_username, confirm='something-else-entirely')
    assert mismatch.status_code == 400 and b'do not match' in mismatch.data


def test_wrong_password_is_rejected_without_cookie(client, registered_user):
    resp = _login(client, registered_user, password='not-the-password')
    assert resp.status_code == 401
    assert b'Incorrect username or password' in resp.data
    assert 'pathfinder_auth' not in resp.headers.get('Set-Cookie', '')


def test_unknown_user_gets_the_same_error(client, new_username):
    resp = _login(client, new_username)
    assert resp.status_code == 401
    assert b'Incorrect username or password' in resp.data


def test_five_failures_lock_the_account_even_for_the_right_password(client, registered_user):
    for _ in range(5):
        assert _login(client, registered_user, password='wrong-wrong').status_code == 401
    locked = _login(client, registered_user)
    assert locked.status_code == 429
    assert b'Too many failed attempts' in locked.data


def test_next_param_is_honoured_only_for_local_paths(client, registered_user):
    ok = _login(client, registered_user, next='/clearledger/settings')
    assert ok.headers['Location'] == '/clearledger/settings'
    evil = _login(client, registered_user, next='//evil.example/phish')
    assert evil.headers['Location'] == '/'


def test_tampered_cookie_is_rejected(client):
    client.set_cookie('pathfinder_auth', 'not-a-real-token')
    assert client.get('/').status_code == 302


def test_logout_clears_the_cookie(client, registered_user):
    _login(client, registered_user)
    resp = client.post('/logout')
    assert resp.status_code == 302
    assert 'pathfinder_auth=;' in resp.headers['Set-Cookie']
    assert client.get('/').status_code == 302


def test_gate_fails_closed_on_vercel_without_secret(client, monkeypatch):
    monkeypatch.delenv('AUTH_SECRET')
    monkeypatch.setenv('VERCEL', '1')
    assert client.get('/').status_code == 503


def test_anon_key_cannot_read_password_hashes(registered_user):
    try:
        rows = supabase.table('app_users').select('*').execute().data
    except Exception:
        return
    assert rows == []
