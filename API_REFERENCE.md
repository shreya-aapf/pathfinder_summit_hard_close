# API Reference — Pathfinder Summit Systems

Five standalone systems. The automation workflow interacts with all of them depending on the challenge tier (Easy: ClearLedger/ProcureOS/ReceiptsLog; Medium: + MeridianGL; Hard: + AuditTrail).

| System | Base URL | Auth |
|---|---|---|
| ClearLedger (Invoice Review) | `https://jmbwyttobedzszswarhd.supabase.co/functions/v1/clearledger` | `X-API-Key` header on `/api/*` |
| ProcureOS (PO System) | `https://jmbwyttobedzszswarhd.supabase.co/functions/v1/procureos` | `X-API-Key` header |
| ReceiptsLog (GR System) | `https://jmbwyttobedzszswarhd.supabase.co/functions/v1/receiptslog` | `X-API-Key` header |
| MeridianGL (GL Balance Sheet Viewer) | `https://jmbwyttobedzszswarhd.supabase.co/functions/v1/meridiangl` | `X-API-Key` header |
| AuditTrail (Fraud Flag + Close Status) | `https://jmbwyttobedzszswarhd.supabase.co/functions/v1/audittrail` | None |

Every system is a Supabase Edge Function. Endpoint paths in this document are relative to its base URL, for example `GET /api/po/PO-2024-0099` on ProcureOS is `GET https://jmbwyttobedzszswarhd.supabase.co/functions/v1/procureos/api/po/PO-2024-0099`. A logged-in web session's `Authorization: Bearer <token>` is accepted wherever an `X-API-Key` is.

**Demo API keys**
- ProcureOS: `demo-key-procureos`
- ReceiptsLog: `demo-key-receipthub`
- MeridianGL: `demo-key-meridiangl`
- ClearLedger: `demo-key-clearledger`

**Web UI.** The pages are a static site (the `web/` folder) that calls these functions from the browser. Sign in at `/login.html` (create an account at `/register.html`); one login covers every app, and the pages send it as a bearer token. API keys for ClearLedger, ProcureOS and ReceiptsLog are managed on each app's API Keys page. Webhooks are configured with Supabase secrets: `supabase secrets set WEBHOOK_URL=... WEBHOOK_SECRET=...`.

---

## ClearLedger — Invoice Review Portal

The automation posts invoice data and mismatch results here. The accountant reviews and acts via the UI.

### POST /api/invoices
Submit an extracted invoice with mismatch analysis. The automation calls this after comparing an invoice against PO and GR data.

**No authentication required.**

**Request body**
```json
{
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
}
```

**Required fields:** `invoice_number`, `vendor_id`, `vendor_name`, `invoice_date`, `po_number`, `total_amount`, `match_status`

**`match_status` values:** `mismatch` | `partial_match`

**`mismatch_type` values (per line):** `price_variance` | `qty_mismatch` | `missing_gr` | `ok`

**Responses**

| Code | Meaning |
|---|---|
| 201 | Created. Body: `{"id": "<uuid>", "invoice_number": "INV-2024-001"}` |
| 400 | Missing required fields. Body: `{"error": "Missing required fields: ..."}` |
| 409 | Duplicate. Invoice number already exists. |
| 500 | Server / database error. |

**curl example**
```bash
curl -X POST https://jmbwyttobedzszswarhd.supabase.co/functions/v1/clearledger/api/invoices \
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
    "line_items": [{
      "line_number": 1,
      "description": "Office Chairs",
      "invoice_qty": 10,
      "invoice_unit_price": 125.00,
      "po_qty": 10,
      "po_unit_price": 120.00,
      "gr_qty": 10,
      "mismatch_type": "price_variance",
      "variance_amount": 50.00
    }]
  }'
```

---

### GET /api/invoices
List invoices with optional filters.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `status` | string | Filter by status: `pending` \| `approved` \| `escalated` \| `contacted` |
| `vendor_id` | string | Filter by vendor ID |
| `page` | int | Page number (default: 1) |
| `limit` | int | Results per page (default: 50, max: 200) |

**Response** — array of invoice objects.

```bash
curl "https://jmbwyttobedzszswarhd.supabase.co/functions/v1/clearledger/api/invoices?status=pending"
curl "https://jmbwyttobedzszswarhd.supabase.co/functions/v1/clearledger/api/invoices?status=approved&page=1&limit=20"
```

---

### GET /api/invoices/{id}
Get a single invoice by UUID, including all line items and action history.

**Response**
```json
{
  "id": "uuid",
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
  "status": "pending",
  "created_at": "2024-11-16T10:00:00Z",
  "updated_at": "2024-11-16T10:00:00Z",
  "line_items": [...],
  "actions": [...]
}
```

| Code | Meaning |
|---|---|
| 200 | Invoice found |
| 404 | Invoice not found |

```bash
curl https://jmbwyttobedzszswarhd.supabase.co/functions/v1/clearledger/api/invoices/550e8400-e29b-41d4-a716-446655440000
```

---

### PATCH /api/invoices/{id}/action
Record an accountant's decision on a flagged invoice. Updates invoice status and logs the action.

**Request body**
```json
{
  "action": "approve",
  "note": "Variance within acceptable range. Approved."
}
```

**`action` values:** `approve` | `contact_vendor` | `escalate`

| Action | Sets status to |
|---|---|
| `approve` | `approved` |
| `contact_vendor` | `contacted` |
| `escalate` | `escalated` |

**Response** — updated invoice object.

| Code | Meaning |
|---|---|
| 200 | Action recorded. Returns updated invoice. |
| 400 | Invalid action value. |
| 404 | Invoice not found. |

```bash
curl -X PATCH https://jmbwyttobedzszswarhd.supabase.co/functions/v1/clearledger/api/invoices/550e8400-e29b-41d4-a716-446655440000/action \
  -H "Content-Type: application/json" \
  -d '{"action": "approve", "note": "Variance within acceptable range."}'
```

---

### GET /api/settings/threshold
Get the current matching threshold percentage. The automation should read this before deciding what to flag.

**Response**
```json
{
  "threshold_pct": 2.5,
  "updated_at": "2024-11-16T10:00:00Z"
}
```

```bash
curl https://jmbwyttobedzszswarhd.supabase.co/functions/v1/clearledger/api/settings/threshold
```

---

### PUT /api/settings/threshold
Update the matching threshold.

**Request body**
```json
{
  "threshold_pct": 3.0
}
```

`threshold_pct` must be a number between 0 and 100.

**Response** — `{"threshold_pct": 3.0, "updated_at": "..."}`

```bash
curl -X PUT https://jmbwyttobedzszswarhd.supabase.co/functions/v1/clearledger/api/settings/threshold \
  -H "Content-Type: application/json" \
  -d '{"threshold_pct": 3.0}'
```

---

### POST /api/invoices/{id}/document

Attaches (or replaces) the invoice file. Sent as `multipart/form-data` with a `file` field. Allowed types: pdf, png, jpg, jpeg, tif, tiff. Maximum 4 MB. Files are stored in the private Supabase Storage bucket `documents` under `invoices/{invoice_number}/`. Replacing a document deletes the previous file. Fires an `invoice.updated` webhook.

```bash
curl -X POST https://jmbwyttobedzszswarhd.supabase.co/functions/v1/clearledger/api/invoices/{id}/document -F "file=@invoice.pdf"
```

Response `201`: `{ "id": "...", "document_name": "invoice.pdf", "document_path": "invoices/INV-2024-010/ab12cd34_invoice.pdf" }`

Errors: `400` missing/empty file or unsupported type, `404` invoice not found.

### GET /api/invoices/{id}/document

Returns a signed download URL valid for one hour: `{ "document_name": "invoice.pdf", "url": "https://...", "expires_in": 3600 }`. `404` if no document is attached.

The UI equivalents are `/invoices/new` (create an invoice together with its file) and the "Invoice Document" section on each invoice detail page.

---

## ProcureOS — Purchase Order System

Holds PO data. The automation queries this to retrieve PO details for matching.

**Authentication:** All `/api/*` routes require `X-API-Key: demo-key-procureos` header.

---

### GET /api/po/{po_number}
**Primary automation endpoint.** Retrieve a Purchase Order by PO number, including all line items.

**Response**
```json
{
  "po_number": "PO-2024-0099",
  "vendor_id": "VEND-001",
  "vendor_name": "Acme Supplies Ltd",
  "issue_date": "2024-10-01",
  "delivery_date": "2024-11-01",
  "status": "open",
  "currency": "USD",
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

| Code | Meaning |
|---|---|
| 200 | PO found |
| 401 | Missing API key |
| 404 | PO not found |

```bash
curl https://jmbwyttobedzszswarhd.supabase.co/functions/v1/procureos/api/po/PO-2024-0099 \
  -H "X-API-Key: demo-key-procureos"
```

---

### GET /api/pos
List Purchase Orders with optional filters.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `vendor_id` | string | Filter by vendor ID |
| `status` | string | Filter by status: `open` \| `partially_received` \| `closed` \| `cancelled` |
| `page` | int | Page number (default: 1) |
| `limit` | int | Results per page (default: 50, max: 200) |

**Response**
```json
{
  "page": 1,
  "limit": 50,
  "count": 8,
  "purchase_orders": [...]
}
```

```bash
curl "https://jmbwyttobedzszswarhd.supabase.co/functions/v1/procureos/api/pos?status=open" \
  -H "X-API-Key: demo-key-procureos"
```

---

### POST /api/pos
Create a Purchase Order via API.

**Request body**
```json
{
  "po_number": "PO-2024-0100",
  "vendor_id": "VEND-001",
  "vendor_name": "Acme Supplies Ltd",
  "issue_date": "2024-10-01",
  "delivery_date": "2024-11-01",
  "status": "open",
  "currency": "USD",
  "line_items": [
    {
      "line_number": 1,
      "item_code": "DESK-001",
      "description": "Standing Desks",
      "quantity": 5,
      "unit_price": 450.00
    }
  ]
}
```

`currency` is an ISO code (default `USD`); all PO amounts are in that currency and exclude tax. `amount` per line is computed server-side (`quantity × unit_price`). `total_amount` on the PO is the sum of all line amounts.

| Code | Meaning |
|---|---|
| 201 | Created |
| 400 | Missing po_number |
| 409 | Duplicate PO number |

```bash
curl -X POST https://jmbwyttobedzszswarhd.supabase.co/functions/v1/procureos/api/pos \
  -H "X-API-Key: demo-key-procureos" \
  -H "Content-Type: application/json" \
  -d '{"po_number":"PO-2024-0100","vendor_id":"VEND-001","vendor_name":"Acme Supplies","status":"open","line_items":[{"item_code":"DESK-001","description":"Standing Desks","quantity":5,"unit_price":450.00}]}'
```

---

### PUT /api/pos/{po_number}
Full replace of a PO. Replaces all line items.

**Request body** — same shape as POST. `line_items` replaces existing lines entirely.

| Code | Meaning |
|---|---|
| 200 | Updated |
| 404 | PO not found |

---

### DELETE /api/pos/{po_number}
Delete a PO and all its line items.

| Code | Meaning |
|---|---|
| 204 | Deleted |
| 404 | Not found |

```bash
curl -X DELETE https://jmbwyttobedzszswarhd.supabase.co/functions/v1/procureos/api/pos/PO-2024-0100 \
  -H "X-API-Key: demo-key-procureos"
```

---

### Purchase justification fields

`POST /api/pos` and `PUT /api/pos/{po_number}` accept these optional fields, and every PO response returns them under `justification`:

| Field | Question |
|-------|----------|
| `purchase_what` | What are you purchasing? |
| `purchase_why` | Why do we need to purchase this? |
| `no_purchase_impact` | What will happen if we don't make this purchase? |
| `criticality` | `keep_the_lights_on` or `nice_to_have` (any other value returns `400`) |
| `alternative_tool` | Do we have another tool/service that does 70-80% of this? |
| `roi_benefit` | What is the ROI or benefit of the services? |
| `okr_alignment` | What other OKRs of your team is the purchase tied to? |

The web form at `/po/new` requires all seven answers. The API leaves them optional so existing automations keep working.

### POST /api/pos/{po_number}/document

Requires `X-API-Key`. Attaches (or replaces) a supporting file such as a quote or contract. `multipart/form-data` with a `file` field. Allowed types: pdf, png, jpg, jpeg, tif, tiff, doc, docx, xls, xlsx. Maximum 4 MB. Stored under `purchase-orders/{po_number}/` in the `documents` bucket. Response `201`: `{ "po_number": "...", "document_name": "...", "document_path": "..." }`.

### GET /api/pos/{po_number}/document

Requires `X-API-Key`. Returns `{ "document_name": "...", "url": "<signed URL>", "expires_in": 3600 }`, or `404` if nothing is attached. The PO response from `GET /api/po/{po_number}` also includes `document_name`.

---

## ReceiptsLog — Goods Received System

Holds GR (goods received) records. The automation queries this to retrieve delivery data for matching. A single PO may have multiple GR records (split/partial deliveries).

**Authentication:** All `/api/*` routes require `X-API-Key: demo-key-receipthub` header.

---

### GET /api/gr/by-po/{po_number}
**Primary automation endpoint.** Get all GR records for a PO. Returns an array — a PO may have multiple receipts (partial deliveries). Returns an empty array if no GR exists for the PO.

**Response**
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

| Code | Meaning |
|---|---|
| 200 | Array of GR records (may be empty) |
| 401 | Missing API key |
| 403 | Invalid API key |

```bash
curl https://jmbwyttobedzszswarhd.supabase.co/functions/v1/receiptslog/api/gr/by-po/PO-2024-0099 \
  -H "X-API-Key: demo-key-receipthub"
```

---

### GET /api/gr/{gr_number}
Get a single GR record by GR number.

**Response** — single GR object (same shape as one element of the `by-po` array).

| Code | Meaning |
|---|---|
| 200 | GR found |
| 404 | Not found |

```bash
curl https://jmbwyttobedzszswarhd.supabase.co/functions/v1/receiptslog/api/gr/GR-2024-0044 \
  -H "X-API-Key: demo-key-receipthub"
```

---

### GET /api/grs
List GR records with optional filters.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `po_number` | string | Filter by PO number |
| `vendor_id` | string | Filter by vendor ID |
| `status` | string | Filter by status: `partial` \| `complete` \| `rejected` |
| `page` | int | Page number (default: 1) |
| `limit` | int | Results per page (default: 50, max: 200) |

**Response**
```json
{
  "data": [...],
  "page": 1,
  "limit": 50
}
```

```bash
curl "https://jmbwyttobedzszswarhd.supabase.co/functions/v1/receiptslog/api/grs?po_number=PO-2024-0099" \
  -H "X-API-Key: demo-key-receipthub"
```

---

### POST /api/grs
Create a GR record via API.

**Required fields:** `gr_number`, `po_number`, `vendor_id`, `vendor_name`, `received_date`, `received_by`, `status`

**`status` values:** `partial` | `complete` | `rejected`

**`condition` values (per line):** `good` | `damaged` | `rejected`

**Request body**
```json
{
  "gr_number": "GR-2024-0045",
  "po_number": "PO-2024-0099",
  "vendor_id": "VEND-001",
  "vendor_name": "Acme Supplies Ltd",
  "received_date": "2024-11-05",
  "received_by": "M. Torres",
  "status": "partial",
  "line_items": [
    {
      "line_number": 1,
      "item_code": "CHAIR-001",
      "description": "Office Chairs",
      "quantity_ordered": 10,
      "quantity_received": 6,
      "unit_price": 120.00,
      "condition": "good"
    }
  ]
}
```

| Code | Meaning |
|---|---|
| 201 | Created |
| 400 | Missing required fields |

---

### PUT /api/grs/{gr_number}
Full replace of a GR record. If `line_items` is included, replaces all lines.

| Code | Meaning |
|---|---|
| 200 | Updated |
| 404 | Not found |

---

### DELETE /api/grs/{gr_number}
Delete a GR record and all its line items.

| Code | Meaning |
|---|---|
| 204 | Deleted |
| 404 | Not found |

---

## MeridianGL — GL Balance Sheet Viewer (Medium tier)

Read-only viewer over GL close data for three subsidiaries (`A`, `B`, `C`). No matching/automation logic lives here — the automation reads from it the same way it reads from ProcureOS and ReceiptsLog.

**Authentication:** All `/api/*` routes require `X-API-Key: demo-key-meridiangl` header.

---

### GET /api/gl/accounts
List GL accounts (chart of accounts per subsidiary).

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `subsidiary` | string | Filter by `A` \| `B` \| `C` |

```bash
curl "https://jmbwyttobedzszswarhd.supabase.co/functions/v1/meridiangl/api/gl/accounts?subsidiary=A" \
  -H "X-API-Key: demo-key-meridiangl"
```

---

### GET /api/gl/balances
List GL-vs-sub-ledger balances, joined with account info (`subsidiary`, `account_code`, `account_name`, `account_type`).

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `subsidiary` | string | Filter by `A` \| `B` \| `C` |
| `period` | string | Filter by period, e.g. `2024-11` |

**Response** — array of balance objects, each including `gl_balance`, `subledger_balance`, `variance_amount`, `source_doc_ref`, and `status` (`matched` \| `variance`).

```bash
curl "https://jmbwyttobedzszswarhd.supabase.co/functions/v1/meridiangl/api/gl/balances?subsidiary=A&period=2024-11" \
  -H "X-API-Key: demo-key-meridiangl"
```

---

### GET /api/gl/intercompany
List intercompany transaction log entries. Matches on either `subsidiary_from` or `subsidiary_to` when `subsidiary` is given.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `subsidiary` | string | Filter by `A` \| `B` \| `C` (matches either side of the transaction) |
| `flag_type` | string | Filter by `matched` \| `timing_difference` \| `error` |

```bash
curl "https://jmbwyttobedzszswarhd.supabase.co/functions/v1/meridiangl/api/gl/intercompany?subsidiary=B" \
  -H "X-API-Key: demo-key-meridiangl"
```

---

### GET /api/gl/accruals
List accruals (estimated vs. actual per subsidiary/period).

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `subsidiary` | string | Filter by `A` \| `B` \| `C` |
| `status` | string | Filter by `within_tolerance` \| `flagged` \| `blocked` |

**Response fields of note:** `variance_pct`, `tolerance_pct`, `blocked_by_open_ap` (bool), `ap_reference`.

```bash
curl "https://jmbwyttobedzszswarhd.supabase.co/functions/v1/meridiangl/api/gl/accruals?status=flagged" \
  -H "X-API-Key: demo-key-meridiangl"
```

This app is read-only by design — no POST/PUT/DELETE endpoints exist.

---

## AuditTrail — Fraud Flag + Close Status Dashboard (Hard tier)

Forensic dashboard for a flagged vendor (bank-detail mismatch), a flux analysis template, a running log of every automated agent decision, and a close-status board. Like ClearLedger, the automation posts here directly — **no authentication required.**

---

### GET /api/vendor-flags
List flagged vendors.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `status` | string | Filter by `open` \| `cleared` \| `escalated` |

```bash
curl "https://jmbwyttobedzszswarhd.supabase.co/functions/v1/audittrail/api/vendor-flags?status=open"
```

---

### GET /api/vendor-flags/{id}
Get a single vendor flag, including `registered_bank_details` vs. `submitted_bank_details`.

| Code | Meaning |
|---|---|
| 200 | Flag found |
| 404 | Not found |

```bash
curl https://jmbwyttobedzszswarhd.supabase.co/functions/v1/audittrail/api/vendor-flags/<uuid>
```

---

### GET /api/flux-analysis
List flux analysis rows (actual vs. prior quarter vs. budget).

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `category` | string | Filter by `revenue` \| `opex` \| `cash` |
| `status` | string | Filter by `explained` \| `unexplained` |

```bash
curl "https://jmbwyttobedzszswarhd.supabase.co/functions/v1/audittrail/api/flux-analysis?status=unexplained"
```

---

### GET /api/audit-trail
List audit trail entries, most recent first. `related_reference` ties an entry back to an invoice, PO, GR, or vendor flag.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `related_reference` | string | Filter by the linked reference (e.g. an invoice number) |

```bash
curl "https://jmbwyttobedzszswarhd.supabase.co/functions/v1/audittrail/api/audit-trail?related_reference=INV-2024-001"
```

---

### POST /api/audit-trail
**Primary automation endpoint.** The automation posts here every time an agent checks something and makes a decision.

**Request body**
```json
{
  "agent_name": "close-automation",
  "action_checked": "Vendor bank details vs. ERP registration",
  "decision": "Escalated — bank details do not match registered record",
  "evidence": "Registered: First National ****4471. Submitted: Coastal Trust ****9902.",
  "escalation_reason": "Possible payment fraud — do not release payment.",
  "related_reference": "INV-2024-001"
}
```

**Required fields:** `action_checked`, `decision`. `agent_name` defaults to `close-automation`.

| Code | Meaning |
|---|---|
| 201 | Created |
| 400 | Missing required fields |

```bash
curl -X POST https://jmbwyttobedzszswarhd.supabase.co/functions/v1/audittrail/api/audit-trail \
  -H "Content-Type: application/json" \
  -d '{"action_checked":"Vendor bank details vs. ERP registration","decision":"Escalated — mismatch found","related_reference":"INV-2024-001"}'
```

---

### GET /api/close-status
List close status items (the open-items board).

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `status` | string | Filter by `cleared` \| `exception_documented` \| `escalated` |
| `category` | string | Filter by category, e.g. `GL Variance`, `Vendor Flag`, `Accrual`, `Intercompany`, `Flux` |

```bash
curl "https://jmbwyttobedzszswarhd.supabase.co/functions/v1/audittrail/api/close-status?status=escalated"
```

---

### PATCH /api/close-status/{id}
Update a close item's `status`, `owner`, and/or `note` (any subset).

**Request body**
```json
{
  "status": "cleared",
  "note": "Vendor confirmed bank change via callback verification."
}
```

| Code | Meaning |
|---|---|
| 200 | Updated. Returns the updated item. |
| 400 | Body empty or `status` not a valid value |
| 404 | Item not found |

```bash
curl -X PATCH https://jmbwyttobedzszswarhd.supabase.co/functions/v1/audittrail/api/close-status/<uuid> \
  -H "Content-Type: application/json" \
  -d '{"status": "cleared"}'
```

---

## Webhooks — Invoice and Goods Receipt Changes

ClearLedger and ReceiptsLog send an HTTP `POST` to `WEBHOOK_URL` each time an invoice or goods receipt is created or updated. Set the variables in the app's environment before starting it. If `WEBHOOK_URL` is empty, nothing is sent.

| Variable | Purpose |
|----------|---------|
| `WEBHOOK_URL` | Receiver endpoint, for example an Automation Anywhere webhook trigger URL |
| `WEBHOOK_SECRET` | Optional. When set, each request carries `X-Webhook-Signature: sha256=<hex HMAC-SHA256 of the raw body>` |

| Source | Event | Sent when |
|--------|-------|-----------|
| ClearLedger | `invoice.created` | `POST /api/invoices` or the `/invoices/new` upload form |
| ClearLedger | `invoice.updated` | `PATCH /api/invoices/{id}/action` (approve, contact vendor, escalate) or a document upload or replacement |
| ReceiptsLog | `goods_receipt.created` | `POST /api/grs` or the `/gr/new` form |
| ReceiptsLog | `goods_receipt.updated` | `PUT /api/grs/{gr_number}` or the GR edit form |

Headers: `Content-Type: application/json`, `X-Webhook-Event: <event>`, and the signature header when a secret is configured.

```json
{
  "event": "goods_receipt.updated",
  "source": "receiptslog",
  "occurred_at": "2026-10-01T09:30:00+00:00",
  "data": { "gr_number": "GR-2024-0045", "po_number": "PO-2024-0100", "status": "complete", "line_items": [ ... ] }
}
```

For `invoice.*` events, `data` is the full invoice row. Action events add `action` and `note` to it. For `goods_receipt.*` events, `data` has the same shape as `GET /api/gr/{gr_number}`.

Delivery is a single attempt with a 3 second timeout, sent inline before the API response returns (serverless hosts can freeze background threads). A failure is logged and never affects the API response, so there are no retries. Deletes do not send an event.

---

## Automation Workflow — Typical Call Sequence

The sequence the automation follows when processing an invoice (Easy tier):

```
1. GET /api/settings/threshold                     → read tolerance %
   ClearLedger: https://jmbwyttobedzszswarhd.supabase.co/functions/v1/clearledger/api/settings/threshold

2. GET /api/po/{po_number}                         → fetch PO data
   ProcureOS:   https://jmbwyttobedzszswarhd.supabase.co/functions/v1/procureos/api/po/{po_number}
   Header:      X-API-Key: demo-key-procureos

3. GET /api/gr/by-po/{po_number}                   → fetch all GR data for that PO
   ReceiptsLog:  https://jmbwyttobedzszswarhd.supabase.co/functions/v1/receiptslog/api/gr/by-po/{po_number}
   Header:      X-API-Key: demo-key-receipthub

4. [automation applies matching logic + computes variances]

5. POST /api/invoices                              → post result to review queue
   ClearLedger: https://jmbwyttobedzszswarhd.supabase.co/functions/v1/clearledger/api/invoices
   Body:        invoice data + line-level mismatch details
```

For the Medium tier, the automation additionally reads GL/intercompany/accrual data from MeridianGL (`GET /api/gl/*`) to reconcile the close. For the Hard tier, it additionally checks vendor bank details and flux variances, then logs every check via `POST /api/audit-trail` and updates `PATCH /api/close-status/{id}` on AuditTrail as items get resolved.

---

## Data Shared Across Systems

These fields are the linking keys that tie records across all three systems. Seed data must use them consistently.

| Field | Type | Description |
|---|---|---|
| `vendor_id` | string | Identifies a vendor. Must match across PO, GR, and invoice records. e.g. `VEND-001` |
| `po_number` | string | The primary link between all three systems. e.g. `PO-2024-0099` |
| `line_number` | int | Used to align invoice lines with PO lines and GR lines for per-line comparison. |

There is no cross-system vendor master — `vendor_id` is a plain string field. Seed data must keep vendor IDs consistent.
