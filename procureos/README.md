# ProcureOS

A procurement portal (Purchase Order management system) that exposes a REST API for automation workflows, particularly 3-way invoice matching. Built with Flask + Supabase.

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your Supabase project URL and anon key, and a secure `FLASK_SECRET_KEY`.

### 3. Run the database schema

Apply the schema in the parent directory:

```bash
# From a Supabase SQL editor or psql:
# Run ../supabase/schema.sql
```

The schema creates three tables:
- `purchase_orders` — PO headers
- `po_line_items` — line items linked to each PO
- `po_api_keys` — hashed API keys for authentication

Seed the demo API key by inserting into `po_api_keys`:
```sql
INSERT INTO po_api_keys (key_hash, label)
VALUES ('e2ea498f352094908ededbb13b347a72657a0ba3348b5f11bf504e0343ac2d86', 'Demo key');
```

### 4. Start the server

```bash
python app.py
```

Runs on **port 5002** by default. Override with `PORT=XXXX` in `.env`.

---

## API Authentication

All `/api/*` routes require the `X-API-Key` header.

```
X-API-Key: demo-key-procureos
```

Missing or invalid keys return `401 {"error": "Unauthorized"}`.

---

## Primary Automation Endpoint

```
GET /api/po/{po_number}
```

Returns full PO header + all line items. Used by the automation workflow to look up PO data during 3-way invoice matching.

**Example request:**
```bash
curl http://localhost:5002/api/po/PO-2024-0099 \
  -H "X-API-Key: demo-key-procureos"
```

**Example response:**
```json
{
  "po_number": "PO-2024-0099",
  "vendor_id": "VEND-001",
  "vendor_name": "Acme Supplies Ltd",
  "issue_date": "2024-10-01",
  "delivery_date": "2024-11-01",
  "status": "open",
  "total_amount": 12000.00,
  "line_items": [
    {
      "line_number": 1,
      "item_code": "CHAIR-001",
      "description": "Office Chairs",
      "quantity": 10,
      "unit_price": 120.00,
      "amount": 1200.00
    }
  ]
}
```

---

## Other API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/pos` | List POs (supports `vendor_id`, `status`, `page`, `limit`) |
| POST | `/api/pos` | Create PO via API |
| PUT | `/api/pos/{po_number}` | Full replace of PO header + lines |
| DELETE | `/api/pos/{po_number}` | Delete PO (returns 204) |

---

## UI

The web UI at `http://localhost:5002` provides:
- PO list with search and status filtering
- Create / edit / delete POs with dynamic line items
- Detail view per PO

No authentication is required to use the UI (intended for internal/demo use).
