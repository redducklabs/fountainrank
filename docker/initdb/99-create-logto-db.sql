-- Runs once on first volume initialization (docker-entrypoint-initdb.d), as the
-- POSTGRES_USER superuser. Creates a dedicated database + role for self-hosted
-- Logto, separate from the FountainRank application database. This mirrors the
-- production topology: a separate database within the same Postgres cluster.
-- Logto needs no PostGIS / extensions in its own database.
--
-- Local-dev-only throwaway credentials. NOT a secret. Do not reuse anywhere real.
--
-- CREATEROLE is required: Logto's first-boot `db seed` creates Postgres roles for
-- tenant/row-level-security isolation and fails with "Only roles with the CREATEROLE
-- attribute may create roles" otherwise. The managed-Postgres user in prod has this.
CREATE ROLE logto WITH LOGIN CREATEROLE PASSWORD 'logto_dev';
CREATE DATABASE logto OWNER logto;
