-- Invoices carry their own currency (ISO 4217 code). Existing rows default to USD.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
