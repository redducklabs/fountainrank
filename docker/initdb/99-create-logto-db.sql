-- Runs once on first volume initialization (docker-entrypoint-initdb.d), as the
-- POSTGRES_USER superuser. Creates a dedicated database + role for self-hosted
-- Logto, separate from the FountainRank application database. This mirrors the
-- production topology: a separate database within the same Postgres cluster.
-- Logto needs no PostGIS / extensions in its own database.
--
-- Local-dev-only throwaway credentials. NOT a secret. Do not reuse anywhere real.
CREATE ROLE logto WITH LOGIN PASSWORD 'logto_dev';
CREATE DATABASE logto OWNER logto;
