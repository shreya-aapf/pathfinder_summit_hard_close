# MeridianGL — GL Balance Sheet Viewer

A Flask web app for accountants to review the GL balance sheet, intercompany transaction log, and accruals schedule for a 3-subsidiary (A / B / C) month-end close. Built with Flask + Supabase.

This is a read/display app only — no matching or automation logic lives here. It exposes the underlying close data via a read-only JSON API for other systems to consume.

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp env.example .env
```

Edit `.env` and fill in your Supabase credentials:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-anon-key
FLASK_SECRET_KEY=a-random-secret-string
PORT=5004
```

### 3. Run the database schema

Apply the schema in the parent directory:

```bash
# Via Supabase CLI
supabase db push --file ../supabase/schema.sql

# Or paste the contents of ../supabase/schema.sql into the Supabase SQL editor
```

The schema creates five tables used by this app:
- `gl_accounts` — chart of accounts per subsidiary
- `gl_balances` — GL vs. sub-ledger balances per account/period
- `intercompany_log` — cross-subsidiary transactions and reconciliation flags
- `accruals` — estimated vs. actual accruals per subsidiary/period
- `gl_api_keys` — hashed API keys for authentication

It also seeds a demo API key row in `gl_api_keys`.

### 4. Start the server

```bash
python app.py
```

The app runs on [http://localhost:5004](http://localhost:5004).

---

## API Authentication

All `/api/*` routes require the `X-API-Key` header.

```
X-API-Key: demo-key-meridiangl
```

Missing or invalid keys return `401 {"error": "Unauthorized"}`.

UI routes (`/`, `/intercompany`, `/accruals`) require no authentication, matching the other apps' UI pattern.

---

## API Quick Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/gl/accounts` | List GL accounts (supports `subsidiary`) |
| `GET` | `/api/gl/balances` | List GL balances joined with account info (supports `subsidiary`, `period`) |
| `GET` | `/api/gl/intercompany` | List intercompany log entries (supports `subsidiary`, `flag_type`) |
| `GET` | `/api/gl/accruals` | List accruals (supports `subsidiary`, `status`) |

This app is read-only by design — there are no POST/PUT/DELETE endpoints.

### Example: List accounts for Subsidiary A

```bash
curl "http://localhost:5004/api/gl/accounts?subsidiary=A" \
  -H "X-API-Key: demo-key-meridiangl"
```

### Example: List balances for a period

```bash
curl "http://localhost:5004/api/gl/balances?subsidiary=A&period=2024-11" \
  -H "X-API-Key: demo-key-meridiangl"
```

### Example: List intercompany entries involving Subsidiary B

```bash
curl "http://localhost:5004/api/gl/intercompany?subsidiary=B" \
  -H "X-API-Key: demo-key-meridiangl"
```

### Example: List flagged accruals

```bash
curl "http://localhost:5004/api/gl/accruals?status=flagged" \
  -H "X-API-Key: demo-key-meridiangl"
```

---

## UI

The web UI at `http://localhost:5004` provides:
- **Balance Sheet** (`/`) — GL accounts joined with their latest-period balance, filterable by subsidiary, with GL-vs-sub-ledger variances highlighted
- **Intercompany** (`/intercompany`) — cross-subsidiary transaction log, filterable by subsidiary and flag type, distinguishing timing differences (informational) from errors
- **Accruals** (`/accruals`) — estimated vs. actual accruals per subsidiary, with tolerance breaches and AP-blocked accruals visually distinct

No authentication is required to use the UI (intended for internal/demo use).

## Note on generated content

This app's code, styling, and copy were scaffolded with AI assistance. Review before relying on it for anything customer-facing or official.
