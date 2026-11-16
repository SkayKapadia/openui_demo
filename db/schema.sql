-- Schema for World Bank indicator data. Safe to run more than once.
-- Used by the Docker init script and by `npm run db:schema` for hosted
-- Postgres (e.g. Neon), so the same schema works anywhere.

CREATE TABLE IF NOT EXISTS countries (
  code        TEXT PRIMARY KEY,          -- ISO3, e.g. IND
  name        TEXT NOT NULL,
  region      TEXT,
  income      TEXT
);

CREATE TABLE IF NOT EXISTS indicators (
  code        TEXT PRIMARY KEY,          -- e.g. NY.GDP.PCAP.CD
  name        TEXT NOT NULL,
  topic       TEXT NOT NULL,             -- our grouping: Economy, People, ...
  unit        TEXT,
  description TEXT,
  source      TEXT NOT NULL DEFAULT 'World Bank WDI'
);

CREATE TABLE IF NOT EXISTS observations (
  country_code   TEXT    NOT NULL REFERENCES countries(code),
  indicator_code TEXT    NOT NULL REFERENCES indicators(code),
  year           INTEGER NOT NULL,
  value          DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (country_code, indicator_code, year)
);

CREATE INDEX IF NOT EXISTS observations_indicator_year
  ON observations (indicator_code, year);

CREATE TABLE IF NOT EXISTS load_runs (
  id          SERIAL PRIMARY KEY,
  source      TEXT        NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  rows_upserted INTEGER,
  notes       TEXT
);

-- Saved dashboards: the OpenUI Lang program the model wrote once.
-- Data is never stored here. Each dashboard loads fresh data when it opens.
CREATE TABLE IF NOT EXISTS dashboards (
  id         TEXT PRIMARY KEY,
  title      TEXT        NOT NULL,
  prompt     TEXT        NOT NULL,           -- what the user asked for
  source     TEXT        NOT NULL,           -- OpenUI Lang with Query() calls
  model      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Daily request counts for the public demo's usage limit.
-- `client` is a salted hash of the caller's IP address, never the address itself.
CREATE TABLE IF NOT EXISTS chat_usage (
  day    DATE    NOT NULL,
  client TEXT    NOT NULL,
  count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, client)
);
