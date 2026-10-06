# ClearLedger — Invoice Review Portal

A Flask web app for accountants to review flagged invoices from a 3-way matching automation workflow.

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
PORT=5001
```

### 3. Run Supabase schema

Apply the database schema using the SQL file in the parent directory:

```bash
# Via Supabase CLI
supabase db push --file ../supabase/schema.sql

# Or paste the contents of ../supabase/schema.sql into the Supabase SQL editor
```

The schema creates four tables: `invoices`, `invoice_line_items`, `invoice_actions`, and `settings`.
It also seeds an initial `threshold_pct` row in `settings` (default: 2.5%).

### 4. Start the server

```bash
python app.py
```

The app runs on [http://localhost:5001](http://localhost:5001).

---

## API Authentication

No authentication is required on ClearLedger endpoints. The automation workflow posts directly to `/api/invoices` from within the same private network. For production deployments behind a public endpoint, add a shared secret header check in `app.py`.

## Demo API Key

Not applicable — ClearLedger has no API key system. All endpoints are open.

---

## API Quick Reference

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/invoices` | Automation posts extracted invoice data |
| `GET` | `/api/invoices` | List invoices (supports `status`, `vendor_id`, `page`, `limit`) |
| `GET` | `/api/invoices/<id>` | Full invoice with line items and action history |
| `PATCH` | `/api/invoices/<id>/action` | Take action: `approve`, `contact_vendor`, or `escalate` |
| `GET` | `/api/settings/threshold` | Read current matching threshold % |
| `PUT` | `/api/settings/threshold` | Update matching threshold % |

### Example: Post an invoice

```bash
curl -X POST http://localhost:5001/api/invoices \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_number": "INV-2024-001",
    "vendor_id": "VEND-001",
    "vendor_name": "Acme Supplies Ltd",
    "invoice_date": "2024-11-15",
    "po_number": "PO-2024-0099",
    "gr_number": "GR-2024-0044",
    "total_amount": 12450.00,
    "match_status": "mismatch",
    "variance_amount": 150.00,
    "variance_pct": 1.2,
    "line_items": [
      {
        "line_number": 1,
        "description": "Office Chairs",
        "invoice_qty": 10,
        "invoice_unit_price": 125.00,
        "po_qty": 10,
        "po_unit_price": 120.00,
        "gr_qty": 10,
        "mismatch_type": "price_variance",
        "variance_amount": 50.00
      }
    ]
  }'
```

### Example: Take action on an invoice

```bash
curl -X PATCH http://localhost:5001/api/invoices/<invoice-uuid>/action \
  -H "Content-Type: application/json" \
  -d '{"action": "escalate", "note": "Vendor overcharged by 4.2% — forwarding to finance."}'
```
