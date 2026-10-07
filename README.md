# Hard Close — Pathfinder Summit 2026

Five small apps for the invoice-matching and financial-close challenge (Easy, Medium and Hard tiers), built as a static website that calls Supabase Edge Functions. The data lives in one Supabase project.

| App | What it is | Tier |
|---|---|---|
| **ClearLedger** | Invoice review portal for flagged 3-way match results | Easy |
| **ProcureOS** | Purchase orders, justification answers, supporting documents | Easy |
| **ReceiptsLog** | Goods received records against purchase orders | Easy |
| **MeridianGL** | GL balance sheet, intercompany log, accruals | Medium |
| **AuditTrail** | Vendor fraud flags, flux analysis, audit log, close-status board | Hard |

## How it fits together

- `web/` is the website: plain HTML, CSS and JavaScript, no build step. Every page calls the functions below from the browser.
- `supabase/functions/` has one Edge Function per app (`clearledger`, `procureos`, `receiptslog`, `meridiangl`, `audittrail`) plus `auth` for sign-in. Shared code is in `_shared/`.
- `supabase/schema.sql` and `supabase/migrations/` define the database tables and demo data.
- `tests/` has API tests that run against the deployed functions.
- The original Flask versions of each app (`clearledger/`, `procureos/`, `receipthub/`, `meridiangl/`, `audittrail/`, `home/`) are kept for reference. They are not part of the deployment.

## REST API

Each app is reachable at `https://jmbwyttobedzszswarhd.supabase.co/functions/v1/<app>`. Automation calls send an `X-API-Key` header.

| App | Base path | Demo key |
|---|---|---|
| ClearLedger | `/clearledger` | `demo-key-clearledger` |
| ProcureOS | `/procureos` | `demo-key-procureos` |
| ReceiptsLog | `/receiptslog` | `demo-key-receipthub` |
| MeridianGL | `/meridiangl` | `demo-key-meridiangl` |
| AuditTrail | `/audittrail` | none needed |

Example: `GET /procureos/api/po/PO-2024-0099` with the ProcureOS key returns that purchase order.

Every endpoint, payload and error is documented in [API_REFERENCE.md](API_REFERENCE.md). ClearLedger, ProcureOS and ReceiptsLog also have an **API Keys** page where you can generate your own keys.

## Run the website locally

```bash
cd web
python -m http.server 3000
```

Open http://localhost:3000/register.html, create an account (a username and a password, no email), then sign in. The pages talk to the live Supabase project, so anything you create is real data. The function address is set in `web/assets/js/config.js`.

## Deploy

**Website.** It is a static site and needs no environment variables. `vercel.json` and `netlify.toml` both publish the `web/` folder.

**Functions.** With the [Supabase CLI](https://supabase.com/docs/guides/cli) linked to the project:

```bash
supabase functions deploy <name> --no-verify-jwt --use-api
```

The functions check sign-in tokens and API keys themselves, which is why JWT verification is off. They use the project's built-in service credentials, so no extra secrets are required.

**Webhooks (optional).** ClearLedger and ReceiptsLog send a signed POST when an invoice or receipt is created or updated. They stay off until you set:

```bash
supabase secrets set WEBHOOK_URL=https://your-receiver WEBHOOK_SECRET=your-secret
```

The payload and the `X-Webhook-Signature` header are described in [API_REFERENCE.md](API_REFERENCE.md).

## Sign-in

One login covers the whole website. Passwords are bcrypt-hashed inside Postgres and are never readable through the API. Five wrong attempts lock an account for five minutes. Sessions last 12 hours. There is no password reset, because no email is collected.

## Tests

Needs Node 22 or later. The tests call the deployed functions and clean up the data they create.

```bash
node --test tests/*.test.mjs        # all API tests
node tests/check-syntax.mjs web     # syntax-check every page script
```

Cleanup of test accounts uses the Supabase CLI, so run the tests from a checkout linked to the project. [TESTING.md](TESTING.md) covers the legacy Flask tests.

## Known limitations

- The original tables have no row-level security, so the project's anon key can read and write them directly. Keep that key private. Locking the tables down is a planned follow-up and will stop the legacy Flask apps from working.
- AuditTrail's API has no authentication, matching the original app.
- Registration is open to anyone who can reach the site.
- The demo keys are shared and public by design; revoke or replace them for anything beyond the event.
