# pathfinder_summit_hard_close

Five independent Flask + Supabase mockup apps for the invoice-matching / financial-close challenge (Easy/Medium/Hard tiers). No shared library, no tests, not a git repo.

## Structure

- **`clearledger/`** (port 5001) — Invoice Review Portal, no API auth
- **`procureos/`** (port 5002) — Purchase Order system, X-API-Key auth on `/api/*`
- **`receipthub/`** (port 5003) — Goods Received system, X-API-Key auth on `/api/*`
- **`meridiangl/`** (port 5004) — GL Balance Sheet Viewer (Medium tier), X-API-Key auth on `/api/*`
- **`audittrail/`** (port 5005) — Fraud Flag + Close Status Dashboard (Hard tier), no API auth
- **`supabase/schema.sql`** — single combined DDL for all five apps' tables + demo API-key seeds
- **`API_REFERENCE.md`** — combined API docs + expected automation call sequence

## ClearLedger (Invoice Review Portal)

**Routes:**
- `/` — queue view, filterable by status (pending/approved/escalated/contacted)
- `/invoices/<id>` — detail view + action history
- `/settings` — threshold editor

**API:**
- `POST/GET /api/invoices` — submit or list flagged invoices
- `GET /api/invoices/<id>`
- `PATCH /api/invoices/<id>/action` — approve/contact_vendor/escalate
- `GET/PUT /api/settings/threshold`

**Tables:** `invoices`, `invoice_line_items`, `invoice_actions`, `settings`

**Note:** Only stores/displays match results computed elsewhere. No matching logic here. `MISMATCH_LABELS` maps codes (`price_variance`, `qty_mismatch`, `missing_gr`, `ok`) to display labels.

## ProcureOS (Purchase Order System)

**Routes:**
- `/` — list + search/status filter
- `/po/new`, `/po/<po_number>`, edit/delete (form-based, no auth)

**API:**
- `GET/POST /api/pos` — list or create POs
- `GET/PUT/DELETE /api/pos/<po_number>`
- `GET /api/po/<po_number>` — primary automation endpoint

**Server logic:** Computes `amount = quantity × unit_price` and `total_amount` server-side. `require_api_key` decorator SHA-256-hashes incoming key, checks hardcoded `DEMO_KEY_HASH` fallback or `po_api_keys` table.

**Tables:** `purchase_orders`, `po_line_items`, `po_api_keys`

## ReceiptHub (Goods Received System)

Structurally similar to ProcureOS, with a unique `condition` field (good/damaged/rejected) on line items.

**Routes:**
- `/` — list
- `/gr/new`, `/gr/<gr_number>`, edit/delete (form-based)

**API:**
- `GET /api/gr/by-po/<po_number>` — primary automation endpoint; returns array (a PO can have multiple partial GRs)
- `GET /api/gr/<gr_number>`
- `GET/POST /api/grs`, `PUT/DELETE /api/grs/<gr_number>`

**Route ordering:** `by-po/<po_number>` must be registered before `<gr_number>` to avoid Flask routing ambiguity.

**Tables:** `goods_received`, `gr_line_items`, `gr_api_keys`

## MeridianGL (GL Balance Sheet Viewer — Medium tier)

Read-only viewer over a 3-subsidiary (A/B/C) month-end close: GL vs. sub-ledger balances, intercompany transaction log, and accruals schedule. No matching/automation logic here — it's a data source the automation reads from, like ProcureOS/ReceiptHub.

**Routes:**
- `/` — balance sheet, filterable by subsidiary, GL-vs-sub-ledger variances highlighted
- `/intercompany` — cross-subsidiary transaction log, distinguishes timing differences (informational) from real errors
- `/accruals` — estimated vs. actual accruals, tolerance breaches and AP-blocked accruals visually distinct

**API (all require `X-API-Key: demo-key-meridiangl`):**
- `GET /api/gl/accounts` — filter by `subsidiary`
- `GET /api/gl/balances` — filter by `subsidiary`, `period`
- `GET /api/gl/intercompany` — filter by `subsidiary`, `flag_type`
- `GET /api/gl/accruals` — filter by `subsidiary`, `status`

Read-only by design — no POST/PUT/DELETE.

**Tables:** `gl_accounts`, `gl_balances`, `intercompany_log`, `accruals`, `gl_api_keys`

## AuditTrail (Fraud Flag + Close Status Dashboard — Hard tier)

Forensic dashboard: a vendor flagged for mismatched bank details, a flux analysis template (actuals vs. prior quarter vs. budget), a running log of every automated agent decision, and a close-status board. No auth, same pattern as ClearLedger — the automation posts here directly.

**Routes:**
- `/` — close status board, filterable by status (cleared/exception_documented/escalated)
- `/vendor-flags`, `/vendor-flags/<id>` — flagged vendors, registered vs. submitted bank details side by side
- `/flux` — flux analysis, unexplained variances flagged
- `/audit-log` — chronological agent action/decision log

**API:**
- `GET /api/vendor-flags`, `GET /api/vendor-flags/<id>`
- `GET /api/flux-analysis`
- `GET/POST /api/audit-trail` — automation logs every check via `POST`
- `GET /api/close-status`, `PATCH /api/close-status/<id>` — update status/owner/note

**Tables:** `vendor_flags`, `flux_analysis`, `audit_trail`, `close_status`

## Missing Piece

None of the five apps performs the actual matching/variance/fraud-detection logic — that's expected to live in an external automation (not present in this folder). For the Easy tier it:
1. Reads ClearLedger's threshold (`GET /api/settings/threshold`)
2. Pulls PO data from ProcureOS (`GET /api/po/<po_number>`)
3. Pulls GR data from ReceiptHub (`GET /api/gr/by-po/<po_number>`)
4. Computes variances (price, quantity, missing GRs)
5. Posts results into ClearLedger (`POST /api/invoices`)

For Medium, it additionally reads GL/intercompany/accrual data from MeridianGL to reconcile the close. For Hard, it additionally checks vendor bank details and flux variances, logging every decision to AuditTrail via `POST /api/audit-trail` and updating `PATCH /api/close-status/<id>` as items resolve.

## Dependencies

All five apps depend on:
- `flask>=3.0.0`
- `supabase>=2.9.0`
- `python-dotenv>=1.0.0`

Frontend: vanilla JS/CSS, no build step, no ORM.

## Notable Issues

- **Env file naming inconsistency:** `clearledger/` and `meridiangl/` use `env.example` (no leading dot); `procureos/` and `receipthub/` use `.env.example`. `audittrail/` uses `.env.example`. Each app's README matches its own filename, but the convention isn't consistent project-wide — consider consolidating.
- **Duplicated logic:** `require_api_key` and line-item/filter parsing logic are copy-pasted across the X-API-Key apps (ProcureOS, ReceiptHub, MeridianGL) with small divergences (ProcureOS returns 401 for both missing/invalid key; ReceiptHub returns 401 missing / 403 invalid; MeridianGL returns 401 for both, matching ProcureOS).
- **Hardcoded demo API keys:** `DEMO_KEY_HASH` is hardcoded in ProcureOS, ReceiptHub, and MeridianGL source, alongside DB-backed keys — acceptable for a demo, flag if reused beyond the summit.
- **Hardcoded default FLASK_SECRET_KEY:** Fallback strings (`'change-me-in-production'` / `'dev-secret-key'`) are committed in source — fine for a mockup, worth hardening if deployed.
- **Committed .env files:** Real `.env` files (not just examples) exist in the original three app folders — check for committed secrets before pushing to a shared repo.
- **No automated tests** anywhere.
- **Minor UX inconsistency:** ClearLedger and AuditTrail use flash+redirect for missing records; ProcureOS/ReceiptHub use `abort(404)`.
- **Design language deliberately varies by app** (Ramp-inspired throughout, but each with its own palette): ClearLedger (navy/gold, authoritative), ProcureOS/ReceiptHub (muted, table-dense), MeridianGL (charcoal/teal, dense accounting-tool feel), AuditTrail (deep red/ink, forensic feel with monospace evidence blocks). This is intentional, not an inconsistency to fix.

## Testing

See [TESTING.md](TESTING.md) for manual (browser/curl) and automated (pytest, real Supabase project) test instructions. Each app has a `tests/` folder — run `pytest tests/` inside that app's directory after installing `requirements-dev.txt`.

## Running the Apps

Each app has its own setup instructions in its local `README.md`. In brief:
1. Install dependencies: `pip install -r requirements.txt` (same in each)
2. Configure `.env` with Supabase credentials and `FLASK_SECRET_KEY` (copy from `env.example` or `.env.example` depending on the app — see that app's README)
3. Set up database: run `supabase/schema.sql` once against your Supabase project (creates all tables + seed data for all five apps)
4. Run each app: `python app.py` (defaults to ports 5001–5005; override via `PORT` env var)
