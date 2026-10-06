-- =============================================================
-- Pathfinder Summit — 3-Way Invoice Matching
-- Combined Supabase Schema (all three systems, public schema)
-- Run this in the Supabase SQL editor for your project.
-- =============================================================


-- =============================================================
-- CLEARLEDGER — Invoice Review Portal
-- =============================================================

CREATE TABLE IF NOT EXISTS invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number  TEXT UNIQUE NOT NULL,
    vendor_id       TEXT NOT NULL,
    vendor_name     TEXT NOT NULL,
    invoice_date    DATE,
    po_number       TEXT NOT NULL,
    gr_number       TEXT,
    total_amount    NUMERIC(12, 2),
    match_status    TEXT CHECK (match_status IN ('mismatch', 'partial_match')),
    variance_amount NUMERIC(12, 2),
    variance_pct    NUMERIC(8, 4),
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'escalated', 'contacted')),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id          UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    line_number         INT NOT NULL,
    description         TEXT,
    invoice_qty         NUMERIC(10, 2),
    invoice_unit_price  NUMERIC(12, 2),
    po_qty              NUMERIC(10, 2),
    po_unit_price       NUMERIC(12, 2),
    gr_qty              NUMERIC(10, 2),
    mismatch_type       TEXT DEFAULT 'ok',
    variance_amount     NUMERIC(12, 2),
    UNIQUE(invoice_id, line_number)
);

CREATE TABLE IF NOT EXISTS invoice_actions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id  UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL CHECK (action_type IN ('approve', 'contact_vendor', 'escalate')),
    note        TEXT,
    actioned_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key         TEXT UNIQUE NOT NULL,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Default matching threshold: 2.5%
INSERT INTO settings (key, value)
VALUES ('threshold_pct', '2.5')
ON CONFLICT (key) DO NOTHING;


-- =============================================================
-- PROCUREOS — Procurement Portal (PO System)
-- =============================================================

CREATE TABLE IF NOT EXISTS purchase_orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number       TEXT UNIQUE NOT NULL,
    vendor_id       TEXT NOT NULL,
    vendor_name     TEXT NOT NULL,
    issue_date      DATE,
    delivery_date   DATE,
    status          TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'partially_received', 'closed', 'cancelled')),
    total_amount    NUMERIC(12, 2),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS po_line_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id       UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    line_number INT NOT NULL,
    item_code   TEXT,
    description TEXT,
    quantity    NUMERIC(10, 2) NOT NULL,
    unit_price  NUMERIC(12, 2) NOT NULL,
    amount      NUMERIC(12, 2),
    UNIQUE(po_id, line_number)
);

CREATE TABLE IF NOT EXISTS po_api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash    TEXT NOT NULL,
    label       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Demo API key: "demo-key-procureos"
-- SHA-256 hash of "demo-key-procureos"
INSERT INTO po_api_keys (key_hash, label)
VALUES ('e2ea498f352094908ededbb13b347a72657a0ba3348b5f11bf504e0343ac2d86', 'Demo key — participants')
ON CONFLICT DO NOTHING;


-- =============================================================
-- RECEIPTHUB — Warehouse / GR System
-- =============================================================

CREATE TABLE IF NOT EXISTS goods_received (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gr_number     TEXT UNIQUE NOT NULL,
    po_number     TEXT NOT NULL,
    vendor_id     TEXT NOT NULL,
    vendor_name   TEXT NOT NULL,
    received_date DATE NOT NULL,
    received_by   TEXT,
    status        TEXT NOT NULL DEFAULT 'complete'
                      CHECK (status IN ('partial', 'complete', 'rejected')),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gr_line_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gr_id             UUID NOT NULL REFERENCES goods_received(id) ON DELETE CASCADE,
    line_number       INT NOT NULL,
    item_code         TEXT,
    description       TEXT,
    quantity_ordered  NUMERIC(10, 2),
    quantity_received NUMERIC(10, 2) NOT NULL,
    unit_price        NUMERIC(12, 2),
    condition         TEXT NOT NULL DEFAULT 'good'
                          CHECK (condition IN ('good', 'damaged', 'rejected')),
    UNIQUE(gr_id, line_number)
);

CREATE TABLE IF NOT EXISTS gr_api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash    TEXT NOT NULL,
    label       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Demo API key: "demo-key-receipthub"
-- SHA-256 hash of "demo-key-receipthub"
INSERT INTO gr_api_keys (key_hash, label)
VALUES ('f455355415937c4bb9db319ccef142b3d9b707a754ad93f30983c77538e84cf2', 'Demo key — participants')
ON CONFLICT DO NOTHING;


-- =============================================================
-- MERIDIANGL — GL Balance Sheet Viewer (Medium tier)
-- =============================================================

CREATE TABLE IF NOT EXISTS gl_accounts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subsidiary    TEXT NOT NULL CHECK (subsidiary IN ('A', 'B', 'C')),
    account_code  TEXT NOT NULL,
    account_name  TEXT NOT NULL,
    account_type  TEXT NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(subsidiary, account_code)
);

CREATE TABLE IF NOT EXISTS gl_balances (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          UUID NOT NULL REFERENCES gl_accounts(id) ON DELETE CASCADE,
    period              TEXT NOT NULL,
    gl_balance          NUMERIC(14, 2) NOT NULL,
    subledger_balance   NUMERIC(14, 2),
    variance_amount     NUMERIC(14, 2),
    source_doc_ref      TEXT,
    status              TEXT NOT NULL DEFAULT 'matched' CHECK (status IN ('matched', 'variance')),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(account_id, period)
);

CREATE TABLE IF NOT EXISTS intercompany_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_ref     TEXT UNIQUE NOT NULL,
    subsidiary_from     TEXT NOT NULL CHECK (subsidiary_from IN ('A', 'B', 'C')),
    subsidiary_to       TEXT NOT NULL CHECK (subsidiary_to IN ('A', 'B', 'C')),
    amount              NUMERIC(14, 2) NOT NULL,
    description         TEXT,
    posted_date_from    DATE NOT NULL,
    posted_date_to      DATE,
    flag_type           TEXT NOT NULL DEFAULT 'matched' CHECK (flag_type IN ('matched', 'timing_difference', 'error')),
    note                TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accruals (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subsidiary          TEXT NOT NULL CHECK (subsidiary IN ('A', 'B', 'C')),
    period              TEXT NOT NULL,
    description         TEXT NOT NULL,
    estimated_amount    NUMERIC(14, 2) NOT NULL,
    actual_amount       NUMERIC(14, 2),
    variance_pct        NUMERIC(8, 4),
    tolerance_pct       NUMERIC(6, 2) NOT NULL DEFAULT 10.0,
    blocked_by_open_ap  BOOLEAN NOT NULL DEFAULT FALSE,
    ap_reference        TEXT,
    status              TEXT NOT NULL DEFAULT 'within_tolerance' CHECK (status IN ('within_tolerance', 'flagged', 'blocked')),
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gl_api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash    TEXT NOT NULL,
    label       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Demo API key: "demo-key-meridiangl"
-- SHA-256 hash of "demo-key-meridiangl"
INSERT INTO gl_api_keys (key_hash, label)
VALUES ('13a70133e81abd62377bc38332fc4507ff5f8ef9d56e309611f59b6546af0fb4', 'Demo key — participants')
ON CONFLICT DO NOTHING;

-- Seed: three subsidiaries, one GL/sub-ledger variance, one intercompany
-- timing difference (A posted 28th, B posted 2nd of following month),
-- one accrual 12% over estimate (flagged, within the 10% tolerance policy
-- means "over tolerance -> flagged", not a hard failure).

DO $$
DECLARE
    acct_a_cash UUID;
    acct_a_ap   UUID;
    acct_b_cash UUID;
    acct_c_rev  UUID;
BEGIN
    INSERT INTO gl_accounts (subsidiary, account_code, account_name, account_type)
    VALUES ('A', '1000', 'Cash and Cash Equivalents', 'asset')
    ON CONFLICT (subsidiary, account_code) DO NOTHING
    RETURNING id INTO acct_a_cash;

    IF acct_a_cash IS NULL THEN
        SELECT id INTO acct_a_cash FROM gl_accounts WHERE subsidiary = 'A' AND account_code = '1000';
    END IF;

    INSERT INTO gl_accounts (subsidiary, account_code, account_name, account_type)
    VALUES ('A', '2000', 'Accounts Payable', 'liability')
    ON CONFLICT (subsidiary, account_code) DO NOTHING
    RETURNING id INTO acct_a_ap;

    IF acct_a_ap IS NULL THEN
        SELECT id INTO acct_a_ap FROM gl_accounts WHERE subsidiary = 'A' AND account_code = '2000';
    END IF;

    INSERT INTO gl_accounts (subsidiary, account_code, account_name, account_type)
    VALUES ('B', '1000', 'Cash and Cash Equivalents', 'asset')
    ON CONFLICT (subsidiary, account_code) DO NOTHING
    RETURNING id INTO acct_b_cash;

    IF acct_b_cash IS NULL THEN
        SELECT id INTO acct_b_cash FROM gl_accounts WHERE subsidiary = 'B' AND account_code = '1000';
    END IF;

    INSERT INTO gl_accounts (subsidiary, account_code, account_name, account_type)
    VALUES ('C', '4000', 'Product Revenue', 'revenue')
    ON CONFLICT (subsidiary, account_code) DO NOTHING
    RETURNING id INTO acct_c_rev;

    IF acct_c_rev IS NULL THEN
        SELECT id INTO acct_c_rev FROM gl_accounts WHERE subsidiary = 'C' AND account_code = '4000';
    END IF;

    INSERT INTO gl_balances (account_id, period, gl_balance, subledger_balance, variance_amount, source_doc_ref, status)
    VALUES
        (acct_a_cash, '2024-11', 482300.00, 482300.00, 0, NULL, 'matched'),
        (acct_a_ap,   '2024-11', 118450.00, 115980.00, 2470.00, 'AP-SUBLEDGER-A-1124', 'variance'),
        (acct_b_cash, '2024-11', 216900.00, 216900.00, 0, NULL, 'matched'),
        (acct_c_rev,  '2024-11', 934200.00, 934200.00, 0, NULL, 'matched')
    ON CONFLICT (account_id, period) DO NOTHING;

    INSERT INTO intercompany_log (transaction_ref, subsidiary_from, subsidiary_to, amount, description, posted_date_from, posted_date_to, flag_type, note)
    VALUES
        ('IC-2024-0091', 'A', 'B', 54000.00, 'Management fee allocation Q4', '2024-11-28', '2024-12-02', 'timing_difference',
         'Subsidiary A posted on the 28th of November; Subsidiary B posted the corresponding entry on the 2nd of December. Same amount, same reference — timing difference across month-end, not a booking error.'),
        ('IC-2024-0092', 'B', 'C', 12800.00, 'Shared services recharge', '2024-11-15', '2024-11-15', 'matched', NULL)
    ON CONFLICT (transaction_ref) DO NOTHING;

    INSERT INTO accruals (subsidiary, period, description, estimated_amount, actual_amount, variance_pct, tolerance_pct, blocked_by_open_ap, ap_reference, status)
    VALUES
        ('A', '2024-11', 'Utilities accrual — corporate HQ', 8500.00, 9520.00, 12.0, 10.0, FALSE, NULL, 'flagged'),
        ('B', '2024-11', 'Freight accrual — Q4 shipments', 15000.00, 14200.00, -5.33, 10.0, TRUE, 'AP-2024-2201', 'blocked'),
        ('C', '2024-11', 'Marketing accrual — campaign spend', 22000.00, 21850.00, -0.68, 10.0, FALSE, NULL, 'within_tolerance')
    ON CONFLICT DO NOTHING;
END $$;


-- =============================================================
-- AUDITTRAIL — Fraud Flag + Close Status Dashboard (Hard tier)
-- =============================================================

CREATE TABLE IF NOT EXISTS vendor_flags (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id                 TEXT NOT NULL,
    vendor_name               TEXT NOT NULL,
    invoice_number            TEXT,
    flag_type                 TEXT NOT NULL DEFAULT 'bank_mismatch' CHECK (flag_type IN ('bank_mismatch', 'duplicate_vendor', 'other')),
    registered_bank_details   TEXT NOT NULL,
    submitted_bank_details    TEXT NOT NULL,
    severity                  TEXT NOT NULL DEFAULT 'high' CHECK (severity IN ('low', 'medium', 'high')),
    status                    TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cleared', 'escalated')),
    created_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flux_analysis (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category                TEXT NOT NULL CHECK (category IN ('revenue', 'opex', 'cash')),
    subsidiary              TEXT,
    period                  TEXT NOT NULL,
    actual                  NUMERIC(14, 2) NOT NULL,
    prior_quarter           NUMERIC(14, 2),
    budget                  NUMERIC(14, 2),
    variance_vs_prior_pct   NUMERIC(8, 4),
    variance_vs_budget_pct  NUMERIC(8, 4),
    explanation             TEXT,
    linked_reference        TEXT,
    status                  TEXT NOT NULL DEFAULT 'unexplained' CHECK (status IN ('explained', 'unexplained')),
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_trail (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name          TEXT NOT NULL DEFAULT 'close-automation',
    action_checked      TEXT NOT NULL,
    decision            TEXT NOT NULL,
    evidence            TEXT,
    escalation_reason   TEXT,
    related_reference   TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS close_status (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_name           TEXT NOT NULL,
    category            TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'escalated' CHECK (status IN ('cleared', 'exception_documented', 'escalated')),
    owner               TEXT,
    note                TEXT,
    related_reference   TEXT,
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Seed: one vendor with mismatched bank details, flux analysis with three
-- unexplained variances (one linked to the held invoice INV-2024-001), and
-- a close status board reflecting the open items above.

INSERT INTO vendor_flags (vendor_id, vendor_name, invoice_number, flag_type, registered_bank_details, submitted_bank_details, severity, status)
VALUES
    ('VEND-001', 'Acme Supplies Ltd', 'INV-2024-001', 'bank_mismatch',
     'Bank: First National — Acct ****4471 (on file since 2021-03-10)',
     'Bank: Coastal Trust — Acct ****9902 (submitted with this invoice)',
     'high', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO flux_analysis (category, subsidiary, period, actual, prior_quarter, budget, variance_vs_prior_pct, variance_vs_budget_pct, explanation, linked_reference, status)
VALUES
    ('revenue', 'C', '2024-Q4', 934200.00, 812600.00, 900000.00, 14.97, 3.80, NULL, NULL, 'unexplained'),
    ('opex', 'A', '2024-Q4', 118450.00, 96200.00, 105000.00, 23.13, 12.81, NULL, 'INV-2024-001', 'unexplained'),
    ('cash', 'B', '2024-Q4', 216900.00, 268400.00, 250000.00, -19.19, -13.24, NULL, NULL, 'unexplained')
ON CONFLICT DO NOTHING;

INSERT INTO close_status (item_name, category, status, owner, note, related_reference)
VALUES
    ('Acme Supplies bank detail mismatch', 'Vendor Flag', 'escalated', 'AP Team', 'Awaiting vendor callback verification before payment release.', 'INV-2024-001'),
    ('Sub A AP sub-ledger variance', 'GL Variance', 'exception_documented', 'Controller — Sub A', 'Timing difference from two late-posted credit memos; documented, no restatement needed.', 'AP-SUBLEDGER-A-1124'),
    ('Sub A/B intercompany timing difference', 'Intercompany', 'cleared', 'Corporate Accounting', 'Confirmed as month-end cutoff timing; both entries verified against shared reference IC-2024-0091.', 'IC-2024-0091'),
    ('Sub A utilities accrual over estimate', 'Accrual', 'exception_documented', 'Controller — Sub A', '12% over estimate, within documented seasonal variance for HQ utilities; outside 10% tolerance so flagged for review.', NULL),
    ('Sub B freight accrual blocked by open AP', 'Accrual', 'escalated', 'AP Team', 'Cannot true up actuals until AP-2024-2201 closes.', 'AP-2024-2201'),
    ('Q4 revenue flux — Sub C', 'Flux', 'escalated', 'FP&A', 'Revenue up 14.97% vs prior quarter with no explanation on file yet.', NULL)
ON CONFLICT DO NOTHING;
