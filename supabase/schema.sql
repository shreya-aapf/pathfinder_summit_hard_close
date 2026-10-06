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

-- Seed: four invoices spanning every status/mismatch type, tying back to
-- the PO/GR seed data below via shared po_number/gr_number, and to
-- AuditTrail's existing vendor_flags/close_status seed via INV-2024-001.
DO $$
DECLARE
    inv1 UUID;
    inv2 UUID;
    inv3 UUID;
    inv4 UUID;
BEGIN
    INSERT INTO invoices (invoice_number, vendor_id, vendor_name, invoice_date, po_number, gr_number, total_amount, match_status, variance_amount, variance_pct, status)
    VALUES ('INV-2024-001', 'VEND-001', 'Acme Supplies Ltd', '2024-11-15', 'PO-2024-0099', 'GR-2024-0044', 1250.00, 'mismatch', 50.00, 4.17, 'escalated')
    ON CONFLICT (invoice_number) DO NOTHING
    RETURNING id INTO inv1;
    IF inv1 IS NULL THEN
        SELECT id INTO inv1 FROM invoices WHERE invoice_number = 'INV-2024-001';
    END IF;

    INSERT INTO invoices (invoice_number, vendor_id, vendor_name, invoice_date, po_number, gr_number, total_amount, match_status, variance_amount, variance_pct, status)
    VALUES ('INV-2024-002', 'VEND-002', 'Beta Manufacturing', '2024-11-08', 'PO-2024-0100', 'GR-2024-0045', 1700.00, 'mismatch', 425.00, 25.0, 'pending')
    ON CONFLICT (invoice_number) DO NOTHING
    RETURNING id INTO inv2;
    IF inv2 IS NULL THEN
        SELECT id INTO inv2 FROM invoices WHERE invoice_number = 'INV-2024-002';
    END IF;

    INSERT INTO invoices (invoice_number, vendor_id, vendor_name, invoice_date, po_number, gr_number, total_amount, match_status, variance_amount, variance_pct, status)
    VALUES ('INV-2024-003', 'VEND-003', 'Gamma Traders', '2024-11-20', 'PO-2024-0101', NULL, 1600.00, 'partial_match', 0, 0, 'pending')
    ON CONFLICT (invoice_number) DO NOTHING
    RETURNING id INTO inv3;
    IF inv3 IS NULL THEN
        SELECT id INTO inv3 FROM invoices WHERE invoice_number = 'INV-2024-003';
    END IF;

    INSERT INTO invoices (invoice_number, vendor_id, vendor_name, invoice_date, po_number, gr_number, total_amount, match_status, variance_amount, variance_pct, status)
    VALUES ('INV-2024-004', 'VEND-004', 'Delta Logistics', '2024-09-22', 'PO-2024-0103', 'GR-2024-0046', 890.00, 'partial_match', 0, 0, 'approved')
    ON CONFLICT (invoice_number) DO NOTHING
    RETURNING id INTO inv4;
    IF inv4 IS NULL THEN
        SELECT id INTO inv4 FROM invoices WHERE invoice_number = 'INV-2024-004';
    END IF;

    INSERT INTO invoice_line_items (invoice_id, line_number, description, invoice_qty, invoice_unit_price, po_qty, po_unit_price, gr_qty, mismatch_type, variance_amount)
    VALUES
        (inv1, 1, 'Office Chairs', 10, 125.00, 10, 120.00, 10, 'price_variance', 50.00),
        (inv2, 1, 'Steel Brackets', 200, 8.50, 200, 8.50, 150, 'qty_mismatch', 425.00),
        (inv3, 1, 'Copy Paper Cases', 50, 32.00, 50, 32.00, NULL, 'missing_gr', 0),
        (inv4, 1, 'Freight Services', 1, 890.00, 1, 890.00, 1, 'ok', 0)
    ON CONFLICT (invoice_id, line_number) DO NOTHING;

    -- invoice_actions has no unique constraint, so guard manually to stay idempotent
    INSERT INTO invoice_actions (invoice_id, action_type, note, actioned_at)
    SELECT inv1, 'escalate',
           'Vendor bank details on this invoice do not match the ERP-registered record — escalated per AuditTrail fraud flag. Do not release payment pending verification.',
           '2024-11-16T09:30:00Z'
    WHERE NOT EXISTS (SELECT 1 FROM invoice_actions WHERE invoice_id = inv1 AND action_type = 'escalate');

    INSERT INTO invoice_actions (invoice_id, action_type, note, actioned_at)
    SELECT inv4, 'approve', 'Fully matched against PO and GR — approved.', '2024-09-23T14:00:00Z'
    WHERE NOT EXISTS (SELECT 1 FROM invoice_actions WHERE invoice_id = inv4 AND action_type = 'approve');
END $$;


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
    currency        TEXT NOT NULL DEFAULT 'USD',
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

-- Seed: four POs across every status, feeding the GR and invoice seed data
-- above/below via shared po_number. PO-2024-0101 intentionally has no GR
-- yet, so it demonstrates the "missing_gr" scenario end-to-end.
DO $$
DECLARE
    po1 UUID;
    po2 UUID;
    po3 UUID;
    po4 UUID;
BEGIN
    INSERT INTO purchase_orders (po_number, vendor_id, vendor_name, issue_date, delivery_date, status, total_amount)
    VALUES ('PO-2024-0099', 'VEND-001', 'Acme Supplies Ltd', '2024-10-01', '2024-11-01', 'closed', 1200.00)
    ON CONFLICT (po_number) DO NOTHING
    RETURNING id INTO po1;
    IF po1 IS NULL THEN
        SELECT id INTO po1 FROM purchase_orders WHERE po_number = 'PO-2024-0099';
    END IF;

    INSERT INTO purchase_orders (po_number, vendor_id, vendor_name, issue_date, delivery_date, status, total_amount)
    VALUES ('PO-2024-0100', 'VEND-002', 'Beta Manufacturing', '2024-10-05', '2024-11-05', 'open', 1700.00)
    ON CONFLICT (po_number) DO NOTHING
    RETURNING id INTO po2;
    IF po2 IS NULL THEN
        SELECT id INTO po2 FROM purchase_orders WHERE po_number = 'PO-2024-0100';
    END IF;

    INSERT INTO purchase_orders (po_number, vendor_id, vendor_name, issue_date, delivery_date, status, total_amount)
    VALUES ('PO-2024-0101', 'VEND-003', 'Gamma Traders', '2024-11-10', '2024-12-01', 'open', 1600.00)
    ON CONFLICT (po_number) DO NOTHING
    RETURNING id INTO po3;
    IF po3 IS NULL THEN
        SELECT id INTO po3 FROM purchase_orders WHERE po_number = 'PO-2024-0101';
    END IF;

    INSERT INTO purchase_orders (po_number, vendor_id, vendor_name, issue_date, delivery_date, status, total_amount)
    VALUES ('PO-2024-0103', 'VEND-004', 'Delta Logistics', '2024-09-01', '2024-09-20', 'closed', 890.00)
    ON CONFLICT (po_number) DO NOTHING
    RETURNING id INTO po4;
    IF po4 IS NULL THEN
        SELECT id INTO po4 FROM purchase_orders WHERE po_number = 'PO-2024-0103';
    END IF;

    INSERT INTO po_line_items (po_id, line_number, item_code, description, quantity, unit_price, amount)
    VALUES
        (po1, 1, 'CHAIR-001', 'Office Chairs', 10, 120.00, 1200.00),
        (po2, 1, 'STEEL-100', 'Steel Brackets', 200, 8.50, 1700.00),
        (po3, 1, 'PAPER-500', 'Copy Paper Cases', 50, 32.00, 1600.00),
        (po4, 1, 'FREIGHT-01', 'Freight Services', 1, 890.00, 890.00)
    ON CONFLICT (po_id, line_number) DO NOTHING;
END $$;


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

-- Seed: three GRs against the POs above. PO-2024-0100's GR is deliberately
-- partial (150 of 200 received) to demonstrate the "qty_mismatch" scenario;
-- PO-2024-0101 has no GR at all (see invoices seed's missing_gr row).
DO $$
DECLARE
    gr1 UUID;
    gr2 UUID;
    gr3 UUID;
BEGIN
    INSERT INTO goods_received (gr_number, po_number, vendor_id, vendor_name, received_date, received_by, status)
    VALUES ('GR-2024-0044', 'PO-2024-0099', 'VEND-001', 'Acme Supplies Ltd', '2024-10-28', 'J. Santos', 'complete')
    ON CONFLICT (gr_number) DO NOTHING
    RETURNING id INTO gr1;
    IF gr1 IS NULL THEN
        SELECT id INTO gr1 FROM goods_received WHERE gr_number = 'GR-2024-0044';
    END IF;

    INSERT INTO goods_received (gr_number, po_number, vendor_id, vendor_name, received_date, received_by, status)
    VALUES ('GR-2024-0045', 'PO-2024-0100', 'VEND-002', 'Beta Manufacturing', '2024-11-06', 'K. Alvarez', 'partial')
    ON CONFLICT (gr_number) DO NOTHING
    RETURNING id INTO gr2;
    IF gr2 IS NULL THEN
        SELECT id INTO gr2 FROM goods_received WHERE gr_number = 'GR-2024-0045';
    END IF;

    INSERT INTO goods_received (gr_number, po_number, vendor_id, vendor_name, received_date, received_by, status)
    VALUES ('GR-2024-0046', 'PO-2024-0103', 'VEND-004', 'Delta Logistics', '2024-09-19', 'T. Brooks', 'complete')
    ON CONFLICT (gr_number) DO NOTHING
    RETURNING id INTO gr3;
    IF gr3 IS NULL THEN
        SELECT id INTO gr3 FROM goods_received WHERE gr_number = 'GR-2024-0046';
    END IF;

    INSERT INTO gr_line_items (gr_id, line_number, item_code, description, quantity_ordered, quantity_received, unit_price, condition)
    VALUES
        (gr1, 1, 'CHAIR-001', 'Office Chairs', 10, 10, 120.00, 'good'),
        (gr2, 1, 'STEEL-100', 'Steel Brackets', 200, 150, 8.50, 'good'),
        (gr3, 1, 'FREIGHT-01', 'Freight Services', 1, 1, 890.00, 'good')
    ON CONFLICT (gr_id, line_number) DO NOTHING;
END $$;


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


-- =============================================================
-- DevCon demo: multi-currency POs + GRs that mismatch the three
-- test invoices (Lumen Hall EUR, Saffron & Sage INR, Brightwave USD).
-- PO amounts are pre-tax, matching the existing seed convention.
-- =============================================================

ALTER TABLE purchase_orders
    ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

DO $$
DECLARE
    po_lumen UUID;
    po_saff  UUID;
    po_bw    UUID;
    gr_lumen UUID;
    gr_saff  UUID;
    gr_bw    UUID;
BEGIN
    -- ---------- Lumen Hall (EUR) ----------
    INSERT INTO purchase_orders (po_number, vendor_id, vendor_name, issue_date, delivery_date, status, total_amount, currency)
    VALUES ('PO-DEVCON-0910', 'VEND-005', 'Lumen Hall', '2026-08-05', '2026-09-17', 'partially_received', 10320.00, 'EUR')
    ON CONFLICT (po_number) DO NOTHING
    RETURNING id INTO po_lumen;
    IF po_lumen IS NULL THEN
        SELECT id INTO po_lumen FROM purchase_orders WHERE po_number = 'PO-DEVCON-0910';
    END IF;

    INSERT INTO po_line_items (po_id, line_number, item_code, description, quantity, unit_price, amount)
    VALUES
        (po_lumen, 1, 'VENUE-HALL',   'Main hall hire (capacity 250)',          2, 3000.00, 6000.00),
        (po_lumen, 2, 'VENUE-BRK-B',  'Breakout room B (workshop, 40 seats)',   2,  650.00, 1300.00),
        (po_lumen, 3, 'DECOR-STAGE',  'Stage decor and branded backdrop',       1, 1150.00, 1150.00),
        (po_lumen, 4, 'FURN-SEAT',    'Seating: 200 chairs, 20 high tables',    1,  780.00,  780.00),
        (po_lumen, 5, 'SEC-STAFF',    'Event security (4 staff, 10 hrs)',       4,  210.00,  840.00),
        (po_lumen, 6, 'CLEAN-01',     'Cleaning and waste handling',            1,  250.00,  250.00)
    ON CONFLICT (po_id, line_number) DO NOTHING;

    -- ---------- Saffron & Sage Catering (INR) ----------
    INSERT INTO purchase_orders (po_number, vendor_id, vendor_name, issue_date, delivery_date, status, total_amount, currency)
    VALUES ('PO-DEVCON-0911', 'VEND-006', 'Saffron & Sage Catering Co.', '2026-08-20', '2026-09-19', 'partially_received', 231500.00, 'INR')
    ON CONFLICT (po_number) DO NOTHING
    RETURNING id INTO po_saff;
    IF po_saff IS NULL THEN
        SELECT id INTO po_saff FROM purchase_orders WHERE po_number = 'PO-DEVCON-0911';
    END IF;

    INSERT INTO po_line_items (po_id, line_number, item_code, description, quantity, unit_price, amount)
    VALUES
        (po_saff, 1, 'CATER-LUNCH', 'Working lunch buffet (veg), per head',       180,   650.00, 117000.00),
        (po_saff, 2, 'CATER-AM',    'Morning tea/coffee and snacks, per head',    180,   220.00,  39600.00),
        (po_saff, 3, 'CATER-PM',    'Evening high tea, per head',                 180,   260.00,  46800.00),
        (po_saff, 4, 'CATER-LIVE',  'Live dosa and chaat counter',                  1, 18500.00,  18500.00),
        (po_saff, 5, 'CATER-STAFF', 'Service staff (8 persons, 9 hrs)',             8,  1200.00,   9600.00)
    ON CONFLICT (po_id, line_number) DO NOTHING;

    -- ---------- Brightwave AV Rentals (USD) ----------
    INSERT INTO purchase_orders (po_number, vendor_id, vendor_name, issue_date, delivery_date, status, total_amount, currency)
    VALUES ('PO-DEVCON-0912', 'VEND-007', 'Brightwave AV Rentals', '2026-08-10', '2026-09-07', 'partially_received', 5850.00, 'USD')
    ON CONFLICT (po_number) DO NOTHING
    RETURNING id INTO po_bw;
    IF po_bw IS NULL THEN
        SELECT id INTO po_bw FROM purchase_orders WHERE po_number = 'PO-DEVCON-0912';
    END IF;

    INSERT INTO po_line_items (po_id, line_number, item_code, description, quantity, unit_price, amount)
    VALUES
        (po_bw, 1, 'AV-SPEAKER', 'Line array speaker system (2-day rental)', 1, 1850.00, 1850.00),
        (po_bw, 2, 'AV-MIC',     'Wireless lavalier mic kit',                6,   75.00,  450.00),
        (po_bw, 3, 'AV-LED',     '4K LED wall panel, 12ft x 8ft',            1, 2400.00, 2400.00),
        (po_bw, 4, 'AV-TECH',    'On-site technician (10 hrs)',              2,  400.00,  800.00),
        (po_bw, 5, 'AV-DELIVER', 'Delivery, setup and teardown',             1,  350.00,  350.00)
    ON CONFLICT (po_id, line_number) DO NOTHING;

    -- ---------- Goods received ----------
    -- Lumen: 3 of 4 security staff turned up.
    INSERT INTO goods_received (gr_number, po_number, vendor_id, vendor_name, received_date, received_by, status)
    VALUES ('GR-DEVCON-0910', 'PO-DEVCON-0910', 'VEND-005', 'Lumen Hall', '2026-09-18', 'E. Vogel', 'partial')
    ON CONFLICT (gr_number) DO NOTHING
    RETURNING id INTO gr_lumen;
    IF gr_lumen IS NULL THEN
        SELECT id INTO gr_lumen FROM goods_received WHERE gr_number = 'GR-DEVCON-0910';
    END IF;

    INSERT INTO gr_line_items (gr_id, line_number, item_code, description, quantity_ordered, quantity_received, unit_price, condition)
    VALUES
        (gr_lumen, 1, 'VENUE-HALL',  'Main hall hire (capacity 250)',        2, 2, 3000.00, 'good'),
        (gr_lumen, 2, 'VENUE-BRK-B', 'Breakout room B (workshop, 40 seats)', 2, 2,  650.00, 'good'),
        (gr_lumen, 3, 'DECOR-STAGE', 'Stage decor and branded backdrop',     1, 1, 1150.00, 'good'),
        (gr_lumen, 4, 'FURN-SEAT',   'Seating: 200 chairs, 20 high tables',  1, 1,  780.00, 'good'),
        (gr_lumen, 5, 'SEC-STAFF',   'Event security (4 staff, 10 hrs)',     4, 3,  210.00, 'good'),
        (gr_lumen, 6, 'CLEAN-01',    'Cleaning and waste handling',          1, 1,  250.00, 'good')
    ON CONFLICT (gr_id, line_number) DO NOTHING;

    -- Saffron & Sage: actual headcount served was below the 180 ordered.
    INSERT INTO goods_received (gr_number, po_number, vendor_id, vendor_name, received_date, received_by, status)
    VALUES ('GR-DEVCON-0911', 'PO-DEVCON-0911', 'VEND-006', 'Saffron & Sage Catering Co.', '2026-09-19', 'R. Iyer', 'partial')
    ON CONFLICT (gr_number) DO NOTHING
    RETURNING id INTO gr_saff;
    IF gr_saff IS NULL THEN
        SELECT id INTO gr_saff FROM goods_received WHERE gr_number = 'GR-DEVCON-0911';
    END IF;

    INSERT INTO gr_line_items (gr_id, line_number, item_code, description, quantity_ordered, quantity_received, unit_price, condition)
    VALUES
        (gr_saff, 1, 'CATER-LUNCH', 'Working lunch buffet (veg), per head',       180, 165,   650.00, 'good'),
        (gr_saff, 2, 'CATER-AM',    'Morning tea/coffee and snacks, per head',    180, 172,   220.00, 'good'),
        (gr_saff, 3, 'CATER-PM',    'Evening high tea, per head',                 180, 158,   260.00, 'good'),
        (gr_saff, 4, 'CATER-LIVE',  'Live dosa and chaat counter',                  1,   1, 18500.00, 'good'),
        (gr_saff, 5, 'CATER-STAFF', 'Service staff (8 persons, 9 hrs)',             8,   8,  1200.00, 'good')
    ON CONFLICT (gr_id, line_number) DO NOTHING;

    -- Brightwave: only 4 of 6 mic kits delivered.
    INSERT INTO goods_received (gr_number, po_number, vendor_id, vendor_name, received_date, received_by, status)
    VALUES ('GR-DEVCON-0912', 'PO-DEVCON-0912', 'VEND-007', 'Brightwave AV Rentals', '2026-09-07', 'M. Torres', 'partial')
    ON CONFLICT (gr_number) DO NOTHING
    RETURNING id INTO gr_bw;
    IF gr_bw IS NULL THEN
        SELECT id INTO gr_bw FROM goods_received WHERE gr_number = 'GR-DEVCON-0912';
    END IF;

    INSERT INTO gr_line_items (gr_id, line_number, item_code, description, quantity_ordered, quantity_received, unit_price, condition)
    VALUES
        (gr_bw, 1, 'AV-SPEAKER', 'Line array speaker system (2-day rental)', 1, 1, 1850.00, 'good'),
        (gr_bw, 2, 'AV-MIC',     'Wireless lavalier mic kit',                6, 4,   75.00, 'good'),
        (gr_bw, 3, 'AV-LED',     '4K LED wall panel, 12ft x 8ft',            1, 1, 2400.00, 'good'),
        (gr_bw, 4, 'AV-TECH',    'On-site technician (10 hrs)',              2, 2,  400.00, 'good'),
        (gr_bw, 5, 'AV-DELIVER', 'Delivery, setup and teardown',             1, 1,  350.00, 'good')
    ON CONFLICT (gr_id, line_number) DO NOTHING;
END $$;


-- =============================================================================
-- Document uploads (Supabase Storage) + PO justification questions
-- =============================================================================

-- Private bucket shared by ClearLedger (invoices/...) and ProcureOS (purchase-orders/...)
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- The apps use the anon key (RLS is not enabled on the app tables), so the
-- bucket needs explicit anon read/write policies on storage.objects.
DROP POLICY IF EXISTS "documents anon read" ON storage.objects;
CREATE POLICY "documents anon read" ON storage.objects
    FOR SELECT TO anon USING (bucket_id = 'documents');

DROP POLICY IF EXISTS "documents anon insert" ON storage.objects;
CREATE POLICY "documents anon insert" ON storage.objects
    FOR INSERT TO anon WITH CHECK (bucket_id = 'documents');

DROP POLICY IF EXISTS "documents anon delete" ON storage.objects;
CREATE POLICY "documents anon delete" ON storage.objects
    FOR DELETE TO anon USING (bucket_id = 'documents');

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS document_path TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS document_name TEXT;

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS document_path TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS document_name TEXT;

-- PO justification questions
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS purchase_what      TEXT;  -- What are you purchasing?
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS purchase_why       TEXT;  -- Why do we need to purchase this?
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS no_purchase_impact TEXT;  -- What happens if we don't?
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS criticality        TEXT;  -- keep_the_lights_on | nice_to_have
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS alternative_tool   TEXT;  -- Existing tool covering 70-80%?
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS roi_benefit        TEXT;  -- ROI or benefit
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS okr_alignment      TEXT;  -- Other team OKRs it ties to

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_criticality_check') THEN
        ALTER TABLE purchase_orders
            ADD CONSTRAINT purchase_orders_criticality_check
            CHECK (criticality IS NULL OR criticality IN ('keep_the_lights_on', 'nice_to_have'));
    END IF;
END $$;


-- Username/password login for the Pathfinder Summit portal.
-- Passwords are bcrypt-hashed inside Postgres. The table has RLS enabled with no policies
-- and no grants, so the anon key cannot read or write it; the app can only call the two
-- SECURITY DEFINER functions below, which never return a hash.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS app_users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    failed_attempts INT NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_key ON app_users (lower(username));

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_users FROM anon, authenticated;

CREATE OR REPLACE FUNCTION register_app_user(p_username TEXT, p_password TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF p_username IS NULL OR p_username !~ '^[A-Za-z0-9_.-]{3,32}$' THEN
        RETURN 'invalid_username';
    END IF;
    IF p_password IS NULL OR length(p_password) < 8 OR octet_length(p_password) > 72 THEN
        RETURN 'invalid_password';
    END IF;
    BEGIN
        INSERT INTO app_users (username, password_hash)
        VALUES (p_username, crypt(p_password, gen_salt('bf', 10)));
    EXCEPTION WHEN unique_violation THEN
        RETURN 'username_taken';
    END;
    RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION verify_app_user(p_username TEXT, p_password TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    u app_users%ROWTYPE;
BEGIN
    SELECT * INTO u FROM app_users WHERE lower(username) = lower(coalesce(p_username, ''));
    IF NOT FOUND THEN
        PERFORM crypt(coalesce(p_password, ''), gen_salt('bf', 10));
        RETURN 'invalid';
    END IF;
    IF u.locked_until IS NOT NULL AND u.locked_until > NOW() THEN
        RETURN 'locked';
    END IF;
    IF u.password_hash = crypt(coalesce(p_password, ''), u.password_hash) THEN
        UPDATE app_users SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = u.id;
        RETURN 'ok';
    END IF;
    IF u.failed_attempts + 1 >= 5 THEN
        UPDATE app_users SET failed_attempts = 0, locked_until = NOW() + INTERVAL '5 minutes' WHERE id = u.id;
    ELSE
        UPDATE app_users SET failed_attempts = u.failed_attempts + 1 WHERE id = u.id;
    END IF;
    RETURN 'invalid';
END;
$$;

REVOKE ALL ON FUNCTION register_app_user(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION verify_app_user(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_app_user(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION verify_app_user(TEXT, TEXT) TO anon;


-- ClearLedger gets its own API key table (it previously shared MeridianGL's gl_api_keys).
CREATE TABLE IF NOT EXISTS cl_api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash    TEXT NOT NULL,
    label       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Demo API key: "demo-key-clearledger"
INSERT INTO cl_api_keys (key_hash, label)
SELECT '2093db633edc2c04712a486f20ba4fe45e0af387b6bc0ecb1fd216b06df4094f', 'Demo key — participants'
WHERE NOT EXISTS (SELECT 1 FROM cl_api_keys WHERE key_hash = '2093db633edc2c04712a486f20ba4fe45e0af387b6bc0ecb1fd216b06df4094f');
