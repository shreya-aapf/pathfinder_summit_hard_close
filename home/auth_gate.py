import os
from urllib.parse import quote

from flask import request, redirect
from itsdangerous import BadSignature, URLSafeTimedSerializer

COOKIE_NAME = 'pathfinder_auth'
MAX_AGE = 12 * 3600
EXEMPT_PREFIXES = ('/api/', '/static/')


def _secret():
    return os.environ.get('AUTH_SECRET', '')


def _serializer():
    return URLSafeTimedSerializer(_secret(), salt='pathfinder-auth')


def issue_token(username):
    if not _secret():
        raise RuntimeError('AUTH_SECRET is not configured')
    return _serializer().dumps({'u': username})


def current_user():
    token = request.cookies.get(COOKIE_NAME)
    if not token or not _secret():
        return None
    try:
        return _serializer().loads(token, max_age=MAX_AGE).get('u')
    except BadSignature:
        return None


def safe_next(value, default='/'):
    if value and value.startswith('/') and not value.startswith('//') and '\\' not in value:
        return value
    return default


def install_auth_gate(app, exempt=()):
    """Require a signed login cookie for every UI route. /api/* keeps its own X-API-Key
    auth. The gate is on when AUTH_SECRET is set or when running on Vercel (fails closed
    there if the secret is missing); it is off for plain local development."""

    @app.before_request
    def _require_login():
        on_vercel = bool(os.environ.get('VERCEL'))
        if not (_secret() or on_vercel):
            return None
        if request.path.startswith(EXEMPT_PREFIXES) or request.path in exempt:
            return None
        if not _secret():
            return 'Login is not configured: set the AUTH_SECRET environment variable.', 503
        if current_user():
            return None
        login_url = os.environ.get('LOGIN_URL') or ('/login' if on_vercel else 'http://localhost:5000/login')
        target = request.script_root + request.full_path.rstrip('?')
        return redirect(f'{login_url}?next={quote(target, safe="")}')
