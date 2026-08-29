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
grant_policy_available=false
if [ -r /database/admin/apply-app-grants.sql ]; then
  grant_policy_available=true
else
  # A controller from the immediately preceding immutable release may invoke
  # this newer migration entrypoint before it knows about the new mount. The
  # migration has self-contained grants, and the exact-release controller
  # reconciles the canonical policy on the subsequent same-SHA pass.
  echo "Canonical application grant policy is not mounted; using migration-local grants." >&2
fi
AXORA_CLEANUP_ROLE_PASSWORD="$(cat /run/secrets/axora_cleanup_worker_password)"
export AXORA_CLEANUP_ROLE_PASSWORD
integration_worker_role_available=false
if [ -r /run/secrets/axora_integration_worker_password ]; then
  AXORA_INTEGRATION_WORKER_ROLE_PASSWORD="$(cat /run/secrets/axora_integration_worker_password)"
  export AXORA_INTEGRATION_WORKER_ROLE_PASSWORD
  integration_worker_role_available=true
fi

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

PSQL

if [ "$integration_worker_role_available" = true ]; then
  cat >> "$migration_plan" <<'PSQL'
\getenv integration_worker_password AXORA_INTEGRATION_WORKER_ROLE_PASSWORD
SELECT format(
  'CREATE ROLE axora_integration_worker LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
  :'integration_worker_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_integration_worker') \gexec
SELECT format('ALTER ROLE axora_integration_worker PASSWORD %L', :'integration_worker_password') \gexec
PSQL
else
  echo "Integration-worker database secret is not mounted; applying migrations with the worker disabled." >&2
fi

cat >> "$migration_plan" <<'PSQL'

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
DO $integration_worker_grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_integration_worker')
    AND to_regprocedure(
      'public.axora_project_integration_events(integer,timestamp with time zone)'
    ) IS NOT NULL
  THEN
    EXECUTE format(
      'GRANT CONNECT ON DATABASE %I TO axora_integration_worker',current_database()
    );
    GRANT USAGE ON SCHEMA public TO axora_integration_worker;
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM axora_integration_worker;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM axora_integration_worker;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM axora_integration_worker;
    GRANT EXECUTE ON FUNCTION
      public.axora_project_integration_events(integer,timestamptz),
      public.axora_claim_integration_webhook_deliveries(text,integer,integer,timestamptz),
      public.axora_claimed_webhook_delivery_is_authorized(text,uuid,uuid,timestamptz),
      public.axora_complete_integration_webhook_delivery(text,uuid,uuid,text,integer,text,integer,integer,integer,timestamptz),
      public.axora_cleanup_integration_runtime(timestamptz)
    TO axora_integration_worker;
  END IF;
END
$integration_worker_grants$;
PSQL

if [ "$grant_policy_available" = true ]; then
  cat >> "$migration_plan" <<'PSQL'
-- Reconcile direct application and worker capabilities after every migration
-- run. This is required because PostgreSQL grants new functions to PUBLIC by
-- default, while migration 129 closes that implicit privilege surface.
\ir /database/admin/apply-app-grants.sql
PSQL
fi

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
if [ "$integration_worker_role_available" = true ]; then
  unset AXORA_INTEGRATION_WORKER_ROLE_PASSWORD
fi
