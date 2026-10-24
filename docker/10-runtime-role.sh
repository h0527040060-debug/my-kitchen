#!/bin/sh
# Runs once on a new volume as the bootstrap administrator. The application
# uses a separate login; its password is quoted by psql, never interpolated SQL.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=kitchen_password="$KITCHEN_DATABASE_PASSWORD" <<'SQL'
CREATE ROLE kitchen LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'kitchen_password';
ALTER DATABASE kitchen OWNER TO kitchen;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
