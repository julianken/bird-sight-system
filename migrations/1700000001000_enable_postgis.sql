-- Up Migration
CREATE EXTENSION IF NOT EXISTS postgis;

-- Down Migration
-- We do NOT drop PostGIS in down — too risky if other DBs share the cluster.
