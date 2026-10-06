# ReceiptHub

Warehouse goods receiving system. Stores GR records against POs and exposes a REST API for 3-way invoice matching automation.

## Setup

**1. Install dependencies**
```bash
pip install -r requirements.txt
```

**2. Configure environment**
```bash
cp .env.example .env
# Edit .env — fill in SUPABASE_URL, SUPABASE_KEY, FLASK_SECRET_KEY
```

**3. Run the Supabase schema**

Apply `../supabase/schema.sql` to your Supabase project (SQL editor or CLI).

Tables required: `goods_received`, `gr_line_items`, `gr_api_keys`.

**4. Start the server**
```bash
python app.py
```

Runs on port **5003** by default (override with `PORT` env var).

---

## API Authentication

All `/api/*` routes require an `X-API-Key` header.

Demo key for the summit:
```
X-API-Key: demo-key-receipthub
```

---

## Primary Automation Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/gr/{gr_number}` | Fetch a single GR by GR number |
| `GET` | `/api/gr/by-po/{po_number}` | Fetch **all** GRs for a PO (partial deliveries included) |
| `GET` | `/api/grs` | List GRs with optional filters: `vendor_id`, `po_number`, `status`, `page`, `limit` |
| `POST` | `/api/grs` | Create a GR via API |
| `PUT` | `/api/grs/{gr_number}` | Full replace |
| `DELETE` | `/api/grs/{gr_number}` | Delete (returns 204) |

### Example — fetch all GRs for a PO

```bash
curl -H "X-API-Key: demo-key-receipthub" \
  http://localhost:5003/api/gr/by-po/PO-2024-0099
```

Response:
```json
[
  {
    "gr_number": "GR-2024-0044",
    "po_number": "PO-2024-0099",
    "vendor_id": "VEND-001",
    "vendor_name": "Acme Supplies Ltd",
    "received_date": "2024-10-28",
    "received_by": "J. Santos",
    "status": "complete",
    "line_items": [
      {
        "line_number": 1,
        "item_code": "CHAIR-001",
        "description": "Office Chairs",
        "quantity_ordered": 10,
        "quantity_received": 10,
        "unit_price": 120.00,
        "condition": "good"
      }
    ]
  }
]
```
