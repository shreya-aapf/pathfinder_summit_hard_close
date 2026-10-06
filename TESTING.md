# Testing — pathfinder_summit_hard_close

This project has two layers of testing: manual (browser + curl) and automated (pytest, hitting the real shared Supabase project — there's no mock/local DB mode).

All five apps' tables and seed data are live in the `pathfinder-invoice-matching` Supabase project (`supabase/schema.sql` has already been applied there). Automated tests read/write real rows in that project, using `TEST-`-prefixed identifiers that get cleaned up automatically — see [Test data isolation](#test-data-isolation-strategy) below.

## Prerequisites (once per app)

Each app needs its own `.env` (or `env.example`, for ClearLedger/MeridianGL specifically — see that app's README) filled in with the real project credentials:

```
SUPABASE_URL=https://jmbwyttobedzszswarhd.supabase.co
SUPABASE_KEY=<the anon key from the Supabase dashboard — Project Settings → API>
FLASK_SECRET_KEY=<anything>
PORT=<the app's port>
```

Get `SUPABASE_KEY` from the Supabase dashboard yourself rather than copying it from anywhere else — it's a live credential and shouldn't be pasted into chat logs, docs, or committed files. Use the **anon** key everywhere; RLS isn't enabled on any table, so the anon key already has full read/write access — there's no need for the service role key for local dev or testing.

## Manual testing

### UI, by hand in a browser

For each app: `pip install -r requirements.txt`, then `python app.py`, then open `http://localhost:<port>`.

| App | Port | What to click through |
|---|---|---|
| ClearLedger | 5001 | Queue → filter by status tabs → open an invoice → approve/contact/escalate → confirm it moves tabs and the action shows in history → Settings → change threshold → confirm it persists on reload |
| ProcureOS | 5002 | List → search/filter → New PO (add 2+ line items, confirm total auto-computes) → view detail → edit → delete |
| ReceiptHub | 5003 | List → New GR (mix `good`/`damaged`/`rejected` line items) → view detail → confirm condition badges are readable at a glance → edit → delete |
| MeridianGL | 5004 | Balance Sheet → filter by subsidiary A/B/C → confirm the Sub A AP row is visually flagged as a variance → Intercompany → confirm IC-2024-0091 reads as a timing difference, not an error → Accruals → confirm the Sub B row reads as blocked, not just flagged |
| AuditTrail | 5005 | Close Status board → filter by status → confirm escalated items are visually the most urgent → Vendor Flags → open the Acme Supplies flag → confirm registered vs. submitted bank details are easy to compare → Flux → Audit Log |

### API, by hand with curl

`API_REFERENCE.md` has a full curl example for every endpoint across all five apps, including the exact auth headers and demo API keys. Run through those directly against a running app to sanity-check request/response shapes before or instead of writing code against them.

## Automated tests

Each app has its own `tests/` folder (pytest) that exercises both its UI routes (via Flask's test client, checking status codes and key page content) and its full API surface (create/read/update/delete lifecycles, auth enforcement, validation errors, 404s) — all against the real Supabase project via the app's own `.env`.

### Running tests for one app

```bash
cd clearledger        # or procureos / receipthub / meridiangl / audittrail
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest tests/ -v
```

Repeat per app — there's no shared test runner across apps, matching the "no shared library" structure of the rest of the project.

### What's covered

| App | Tests | Notes |
|---|---|---|
| ClearLedger | 12 | Full invoice lifecycle (create → duplicate rejection → fetch → approve → history), threshold round-trip, validation/404 cases |
| ProcureOS | 11 | Auth enforcement, full PO lifecycle via API (create/get/list/update/delete with computed totals), UI create/view/delete |
| ReceiptHub | 12 | Auth enforcement (401 missing / 403 invalid — differs from ProcureOS), full GR lifecycle including `by-po` lookup and `condition` field, UI create/view/delete |
| MeridianGL | 12 | Read-only — asserts against the known seed data (Sub A AP variance, IC-2024-0091 timing difference, Sub B blocked accrual, Sub A flagged accrual), auth enforcement |
| AuditTrail | 19 | Vendor flag / flux / audit-trail / close-status reads against seed data, audit-trail POST (the automation's primary write path), close-status PATCH round-trip, validation/404 cases |

Total: 66 tests, all passing against the live project as of this writing.

## Test data isolation strategy

- **ClearLedger, ProcureOS, ReceiptHub:** tests create records with a `TEST-`-prefixed invoice/PO/GR number, then delete them (and their line items/actions) in a pytest fixture teardown that always runs, pass or fail.
- **MeridianGL:** read-only app, no writes — tests only assert against the existing seeded rows, nothing to clean up.
- **AuditTrail:**
  - `audit_trail` is an append-only log by design (there's no DELETE endpoint, intentionally — a real audit trail shouldn't be erasable). Tests that POST to it tag their `related_reference` with a `TEST-` prefix so they're easy to spot and ignore, but the rows are **not** deleted afterward. This is expected, not a leak.
  - `close_status` tests that PATCH a row snapshot its original `status`/`owner`/`note`/`updated_at` first and restore it in teardown, so the shared board ends up unchanged.

If you run the suites repeatedly, you'll see `audit_trail` grow — that's the one intentional exception to "tests leave no trace."

## Known gaps

- No CI wiring (no GitHub Actions) — this isn't a git repo, so there's nowhere to hook that up yet.
- No browser-level (Playwright/Selenium) UI tests — the "UI tests" here render templates via Flask's test client and check status codes + key text, they don't click buttons in a real browser or check CSS/visual layout. Do that part manually per the table above.
- Tests run serially, single-process, against one shared project — don't run two people's test suites at the same time against the same demo data; a `PATCH /api/close-status/<id>` round-trip from one run could race with another.
