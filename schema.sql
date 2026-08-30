-- Video Selling v3.1 - Supabase PostgreSQL schema
-- Run the whole file in Supabase SQL Editor.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS packages (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price > 0),
  original_price INTEGER CHECK (original_price IS NULL OR original_price > 0),
  description TEXT NOT NULL DEFAULT '',
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  badge TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS groups_catalog (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  link TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  content_count TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS offers (
  id BIGSERIAL PRIMARY KEY,
  package_id BIGINT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  original_price INTEGER NOT NULL CHECK (original_price > 0),
  sale_price INTEGER NOT NULL CHECK (sale_price > 0 AND sale_price <= original_price),
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  package_id BIGINT REFERENCES packages(id) ON DELETE SET NULL,
  package_name TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  original_amount INTEGER,
  offer_id BIGINT REFERENCES offers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_contact TEXT NOT NULL,
  utr TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_packages_active_order
  ON packages(active, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_groups_active_order
  ON groups_catalog(active, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_offers_package_active_dates
  ON offers(package_id, active, start_at, end_at);

CREATE INDEX IF NOT EXISTS idx_orders_created_at
  ON orders(created_at DESC);

-- Seed each package only if that package name does not already exist.
INSERT INTO packages (name, price, description, features, badge, sort_order)
SELECT 'Prime Access', 99, '1,000+ Videos',
       '["1,000+ Videos","Digital access","Telegram support"]'::jsonb, '', 0
WHERE NOT EXISTS (SELECT 1 FROM packages WHERE name = 'Prime Access');

INSERT INTO packages (name, price, description, features, badge, sort_order)
SELECT 'Exclusive Access', 149, '2,000+ Videos',
       '["2,000+ Videos","Digital access","Telegram support"]'::jsonb, '', 1
WHERE NOT EXISTS (SELECT 1 FROM packages WHERE name = 'Exclusive Access');

INSERT INTO packages (name, price, description, features, badge, sort_order)
SELECT 'VIP Access', 199, 'Any 2 Groups',
       '["Any 2 Groups","Digital access","Telegram support"]'::jsonb, '', 2
WHERE NOT EXISTS (SELECT 1 FROM packages WHERE name = 'VIP Access');

INSERT INTO packages (name, price, description, features, badge, sort_order)
SELECT 'VIP Elite', 249, 'Any 3 Groups',
       '["Any 3 Groups","Digital access","Telegram support"]'::jsonb, 'Popular', 3
WHERE NOT EXISTS (SELECT 1 FROM packages WHERE name = 'VIP Elite');

INSERT INTO packages (name, price, description, features, badge, sort_order)
SELECT 'VVIP Access', 299, '2,000+ Videos',
       '["2,000+ Videos","Digital access","Telegram support"]'::jsonb, '', 4
WHERE NOT EXISTS (SELECT 1 FROM packages WHERE name = 'VVIP Access');

INSERT INTO packages (name, price, description, features, badge, sort_order)
SELECT 'VVIP Black', 399, 'Any 4 Groups',
       '["Any 4 Groups","Digital access","Telegram support"]'::jsonb, '', 5
WHERE NOT EXISTS (SELECT 1 FROM packages WHERE name = 'VVIP Black');

INSERT INTO packages (name, price, description, features, badge, sort_order)
SELECT 'Ultra Elite', 499, '1,000+ Videos + Any 5 Groups',
       '["1,000+ Videos","Any 5 Groups","Digital access","Telegram support"]'::jsonb, '', 6
WHERE NOT EXISTS (SELECT 1 FROM packages WHERE name = 'Ultra Elite');

INSERT INTO settings (key, value)
VALUES ('store_name', 'Video Selling')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value)
VALUES ('telegram_1', 'ZzzNnnVvvv')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value)
VALUES ('telegram_2', 'Ramerusaan')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value)
VALUES ('email', '')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value)
VALUES ('phone', '')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value)
VALUES ('support_hours', 'Support hours: as listed on the store.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value)
VALUES ('announcement', 'Secure checkout • Dynamic UPI QR • Fast support')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value)
VALUES ('terms_summary', 'Please review the package, price, description, and policies before purchase.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value)
VALUES ('refund_summary', 'Digital purchases are generally final after successful delivery, subject to applicable law.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value)
VALUES ('delivery_summary', 'Digital access instructions are provided through the configured support/delivery channel after order review.')
ON CONFLICT (key) DO NOTHING;
