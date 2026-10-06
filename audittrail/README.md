# AuditTrail — Forensic Close Dashboard

A Flask web app for the hard-tier financial close scenario: a flagged vendor with mismatched bank
details, flux analysis of actuals vs. prior quarter vs. budget, a running audit trail of every
automated agent decision, and a close-status board tracking every open item to resolution.

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your Supabase credentials:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-anon-key
FLASK_SECRET_KEY=a-random-secret-string
PORT=5005
```

### 3. Run Supabase schema

Apply the database schema using the SQL file in the parent directory:

```bash
# Via Supabase CLI
supabase db push --file ../supabase/schema.sql

# Or paste the contents of ../supabase/schema.sql into the Supabase SQL editor
```

The schema creates the `vendor_flags`, `flux_analysis`, `audit_trail`, and `close_status` tables
used by this app, and seeds a flagged vendor (Acme Supplies Ltd, linked to invoice
`INV-2024-001`), three flux analysis rows, and six close status items.

### 4. Start the server

```bash
python app.py
```

The app runs on [http://localhost:5005](http://localhost:5005).

---

## API Authentication

No authentication is required on AuditTrail endpoints. The close automation posts directly to
`/api/audit-trail` (and reads the other endpoints) from within the same private network, the same
way ClearLedger's automation posts invoices. For production deployments behind a public endpoint,
add a shared secret header check in `app.py`.

## Demo API Key

Not applicable — AuditTrail has no API key system. All endpoints are open.

---

## API Quick Reference

| Method  | Path                       | Description |
|---------|-----------------------------|--------------|
| `GET`   | `/api/vendor-flags`         | List vendor flags (supports `status`) |
| `GET`   | `/api/vendor-flags/<id>`    | Single vendor flag |
| `GET`   | `/api/flux-analysis`        | List flux analysis rows (supports `category`, `status`) |
| `GET`   | `/api/audit-trail`          | List audit trail entries, newest first (supports `related_reference`) |
| `POST`  | `/api/audit-trail`          | Automation posts an agent check/decision |
| `GET`   | `/api/close-status`         | List close status items (supports `status`, `category`) |
| `PATCH` | `/api/close-status/<id>`    | Update `status`, `owner`, and/or `note` on a close item |

### Example: Post an audit trail entry

```bash
curl -X POST http://localhost:5005/api/audit-trail \
  -H "Content-Type: application/json" \
  -d '{
    "agent_name": "close-automation",
    "action_checked": "Vendor bank details vs. registered record",
    "decision": "escalate",
    "evidence": "Submitted account ****9902 does not match registered account ****4471 on file since 2021-03-10.",
    "escalation_reason": "Bank detail mismatch — possible fraud risk, payment held pending verification.",
    "related_reference": "INV-2024-001"
  }'
```

### Example: Update a close status item

```bash
curl -X PATCH http://localhost:5005/api/close-status/<item-uuid> \
  -H "Content-Type: application/json" \
  -d '{"status": "cleared", "owner": "AP Team", "note": "Vendor confirmed new bank details via callback verification."}'
```
