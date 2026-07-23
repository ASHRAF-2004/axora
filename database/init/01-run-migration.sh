#!/bin/sh
set -eu

if [ -r /run/secrets/postgres_admin_password ]; then
  PGPASSWORD="$(cat /run/secrets/postgres_admin_password)"
  export PGPASSWORD
fi

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

for migration in /migrations/[0-9][0-9][0-9]_*.sql; do
  [ -f "$migration" ] || continue
  filename="$(basename "$migration")"
  checksum="$(sha256sum "$migration" | awk '{print $1}')"
  recorded="$(psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --command "SELECT sha256 FROM schema_migrations WHERE filename='${filename}'")"
  if [ -n "$recorded" ]; then
    [ "$recorded" = "$checksum" ] || { echo "Migration checksum changed after application: $filename" >&2; exit 1; }
    echo "Migration already applied: $filename"
    continue
  fi
  echo "Applying migration: $filename"
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 --file="$migration"
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
    --command "INSERT INTO schema_migrations(filename,sha256) VALUES ('$filename','$checksum')"
done
