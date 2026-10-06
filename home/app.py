import os

from dotenv import load_dotenv
from flask import Flask, flash, make_response, redirect, render_template, request
from supabase import Client, create_client

from auth_gate import COOKIE_NAME, MAX_AGE, current_user, install_auth_gate, issue_token, safe_next

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'change-me-in-production')
app.config['SESSION_COOKIE_NAME'] = 'home_session'
install_auth_gate(app, exempt=('/login', '/register', '/logout'))

supabase: Client = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

APPS = [
    {'name': 'ClearLedger', 'path': '/clearledger/', 'blurb': 'Invoice review portal for flagged 3-way match results.'},
    {'name': 'ProcureOS', 'path': '/procureos/', 'blurb': 'Purchase orders, justification answers and supporting documents.'},
    {'name': 'ReceiptHub', 'path': '/receipthub/', 'blurb': 'Goods received records against purchase orders.'},
    {'name': 'AuditTrail', 'path': '/audittrail/', 'blurb': 'Forensic close dashboard: vendor flags, flux analysis and close status.'},
    {'name': 'MeridianGL', 'path': '/meridiangl/', 'blurb': 'GL balance sheet, intercompany log and accruals by subsidiary.'},
]

REGISTER_ERRORS = {
    'invalid_username': 'Usernames are 3-32 characters: letters, numbers, dot, dash or underscore.',
    'invalid_password': 'Passwords must be at least 8 characters and no more than 72 bytes.',
    'username_taken': 'That username is already taken.',
}


@app.route('/')
def index():
    return render_template('index.html', apps=APPS, user=current_user())


@app.route('/login', methods=['GET', 'POST'])
def login():
    next_url = safe_next(request.values.get('next'))
    if request.method == 'GET':
        if current_user():
            return redirect(next_url)
        return render_template('login.html', next_url=next_url)

    username = request.form.get('username', '').strip()
    password = request.form.get('password', '')
    try:
        result = supabase.rpc('verify_app_user', {'p_username': username, 'p_password': password}).execute().data
        token = issue_token(username) if result == 'ok' else None
    except Exception as e:
        app.logger.warning('Login failed unexpectedly: %s', e)
        flash('Sign-in is unavailable right now. Please try again shortly.', 'error')
        return render_template('login.html', next_url=next_url, username=username), 503

    if result == 'locked':
        flash('Too many failed attempts. Try again in 5 minutes.', 'error')
        return render_template('login.html', next_url=next_url, username=username), 429
    if result != 'ok':
        flash('Incorrect username or password.', 'error')
        return render_template('login.html', next_url=next_url, username=username), 401

    resp = make_response(redirect(next_url))
    resp.set_cookie(COOKIE_NAME, token, max_age=MAX_AGE, httponly=True, samesite='Lax',
                    secure=bool(os.environ.get('VERCEL')), path='/')
    return resp


@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'GET':
        return render_template('register.html')

    username = request.form.get('username', '').strip()
    password = request.form.get('password', '')
    if password != request.form.get('confirm_password', ''):
        flash('The two passwords do not match.', 'error')
        return render_template('register.html', username=username), 400
    try:
        result = supabase.rpc('register_app_user', {'p_username': username, 'p_password': password}).execute().data
    except Exception as e:
        app.logger.warning('Registration failed unexpectedly: %s', e)
        flash('Registration is unavailable right now. Please try again shortly.', 'error')
        return render_template('register.html', username=username), 503

    if result != 'ok':
        flash(REGISTER_ERRORS.get(result, 'Could not create the account.'), 'error')
        return render_template('register.html', username=username), 400
    flash('Account created. Sign in below.', 'success')
    return redirect('/login')


@app.route('/logout', methods=['POST'])
def logout():
    resp = make_response(redirect('/login'))
    resp.delete_cookie(COOKIE_NAME, path='/')
    return resp


if __name__ == '__main__':
    app.run(debug=False, port=5000)
