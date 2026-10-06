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
