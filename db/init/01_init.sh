#!/bin/sh
# Runs once, on the first start of the Docker volume.
# Creates the schema and a read-only role the dashboard app connects with.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -f /opt/opendata/schema.sql

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v reader_pw="$READER_PASSWORD" -v store_pw="$STORE_PASSWORD" -v db="$POSTGRES_DB" <<'SQL'
CREATE ROLE dashboard_reader LOGIN PASSWORD :'reader_pw';
GRANT CONNECT ON DATABASE :"db" TO dashboard_reader;
GRANT USAGE ON SCHEMA public TO dashboard_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dashboard_reader;
ALTER ROLE dashboard_reader SET default_transaction_read_only = on;
ALTER ROLE dashboard_reader SET statement_timeout = '5s';

-- The app saves dashboards with this role. It can touch only that one table,
-- so the data tools (dashboard_reader) can never write, and storage can never
-- read or change the data tables.
CREATE ROLE dashboard_store LOGIN PASSWORD :'store_pw';
GRANT CONNECT ON DATABASE :"db" TO dashboard_store;
GRANT USAGE ON SCHEMA public TO dashboard_store;
GRANT SELECT, INSERT, UPDATE, DELETE ON dashboards TO dashboard_store;
ALTER ROLE dashboard_store SET statement_timeout = '5s';
SQL
