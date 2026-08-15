#!/bin/sh
set -eu

if [ -r /run/secrets/postgres_admin_password ]; then
  PGPASSWORD="$(cat /run/secrets/postgres_admin_password)"
  export PGPASSWORD
fi
if [ ! -r /run/secrets/axora_cleanup_worker_password ]; then
  echo "Cleanup-worker database secret is unavailable." >&2
  exit 1
fi
AXORA_CLEANUP_ROLE_PASSWORD="$(cat /run/secrets/axora_cleanup_worker_password)"
export AXORA_CLEANUP_ROLE_PASSWORD

migration_plan="$(mktemp)"
cleanup() {
  rm -f -- "$migration_plan"
}
trap cleanup EXIT HUP INT TERM

cat > "$migration_plan" <<'PSQL'
\set ON_ERROR_STOP on
\getenv cleanup_worker_password AXORA_CLEANUP_ROLE_PASSWORD

SELECT format(
  'CREATE ROLE axora_cleanup_worker LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
  :'cleanup_worker_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_cleanup_worker') \gexec
SELECT format('ALTER ROLE axora_cleanup_worker PASSWORD %L', :'cleanup_worker_password') \gexec

SELECT pg_try_advisory_lock(
  hashtextextended(current_database() || ':axora:schema_migrations', 0)
) AS migration_lock_acquired
\gset
\if :migration_lock_acquired
  \echo Acquired the Axora schema migration lock.
\else
  \warn Another Axora schema migration is already running; refusing to overlap.
  SELECT 1 / 0;
\endif

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
PSQL

for migration in /migrations/[0-9][0-9][0-9]_*.sql; do
  [ -f "$migration" ] || continue
  filename="$(basename "$migration")"
  case "$filename" in
    *[!A-Za-z0-9._-]*)
      echo "Unsafe migration filename: $filename" >&2
      exit 1
      ;;
  esac
  checksum="$(sha256sum "$migration" | awk '{print $1}')"

  {
    printf "\\set migration_filename '%s'\n" "$filename"
    printf "\\set migration_checksum '%s'\n" "$checksum"
    cat <<'PSQL'
SELECT EXISTS (
  SELECT 1
  FROM schema_migrations
  WHERE filename = :'migration_filename'
) AS migration_recorded,
COALESCE((
  SELECT sha256 = :'migration_checksum'
  FROM schema_migrations
  WHERE filename = :'migration_filename'
), false) AS migration_checksum_matches
\gset
\if :migration_recorded
  \if :migration_checksum_matches
    \echo Migration already applied: :migration_filename
  \else
    \warn Migration checksum changed after application: :migration_filename
    SELECT 1 / 0;
  \endif
\else
  \echo Applying migration: :migration_filename
PSQL
    printf '\\ir %s\n' "$migration"
    cat <<'PSQL'
  INSERT INTO schema_migrations(filename, sha256)
  VALUES (:'migration_filename', :'migration_checksum');
\endif
PSQL
  } >> "$migration_plan"
done

cat >> "$migration_plan" <<'PSQL'
SELECT pg_advisory_unlock(
  hashtextextended(current_database() || ':axora:schema_migrations', 0)
) AS migration_lock_released
\gset
\if :migration_lock_released
  \echo Released the Axora schema migration lock.
\else
  \warn The Axora schema migration lock was not held by this session.
  SELECT 1 / 0;
\endif
PSQL

psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --file="$migration_plan"
unset AXORA_CLEANUP_ROLE_PASSWORD
