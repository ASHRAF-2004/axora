#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
load_config
for command in cmp cp docker find flock realpath sha256sum sort tar xargs; do
  require_command "$command"
done
valid_database_name "$AXORA_DATABASE_NAME" || die "Unsafe database name: $AXORA_DATABASE_NAME"
[[ "$AXORA_BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] \
  || die "AXORA_BACKUP_RETENTION_DAYS must be a whole number."

commit_sha=""
case "${1:-}" in
  "")
    commit_sha="$(read_state_file "$AXORA_CURRENT_SHA_FILE")"
    ;;
  --commit)
    commit_sha="${2:-}"
    valid_sha "$commit_sha" || die "Usage: $0 [--commit <40-character-sha>]"
    [[ -z "${3:-}" ]] || die "Usage: $0 [--commit <40-character-sha>]"
    ;;
  *)
    die "Usage: $0 [--commit <40-character-sha>]"
    ;;
esac
if [[ -n "$commit_sha" ]] && ! valid_sha "$commit_sha"; then
  die "Current release state contains an invalid commit SHA."
fi

install -d -m 0700 "$AXORA_STATE_ROOT" "$AXORA_BACKUPS_ROOT"
if ! bool_is_true "${AXORA_DEPLOY_LOCK_HELD:-false}"; then
  exec 9>"$AXORA_DEPLOY_LOCK"
  flock --exclusive --timeout 600 9 || die "A deployment or backup is still running after ten minutes."
fi

db_container="$(find_service_container db)" || die "Expected exactly one running Axora PostgreSQL container."
db_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$db_container")"
[[ "$db_health" == "healthy" ]] || die "PostgreSQL is not healthy; refusing to create a questionable backup."

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
partial_dir="$(mktemp -d "$AXORA_BACKUPS_ROOT/.partial-${stamp}-XXXXXX")"
backup_dir="$AXORA_BACKUPS_ROOT/axora-${stamp}"
test_database="axora_verify_${stamp//[^0-9A-Za-z]/_}_$$"
test_database="${test_database:0:60}"
restore_created=false

cleanup() {
  if "$restore_created"; then
    docker exec "$db_container" dropdb --username postgres --if-exists "$test_database" >/dev/null 2>&1 || true
  fi
  if [[ -n "${partial_dir:-}" && -d "$partial_dir" ]]; then
    rm -rf -- "$partial_dir"
  fi
}
trap cleanup EXIT

log "Creating a transaction-consistent PostgreSQL custom-format backup."
docker exec "$db_container" pg_dump \
  --username postgres \
  --dbname "$AXORA_DATABASE_NAME" \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-privileges > "$partial_dir/database.dump"

docker exec -i "$db_container" pg_restore --list < "$partial_dir/database.dump" >/dev/null

log "Archiving persistent legacy uploads."
if find "$AXORA_UPLOADS_DIR" -mindepth 1 ! -type d ! -type f -print -quit | grep -q .; then
  die "Persistent uploads contain a symlink or special file; refusing an unsafe backup."
fi
(
  cd "$AXORA_UPLOADS_DIR"
  find . -type f -printf '%P\t%s\0' | LC_ALL=C sort -z
) > "$partial_dir/uploads-files.list"
(
  cd "$AXORA_UPLOADS_DIR"
  find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum --zero
) > "$partial_dir/uploads.sha256"
(
  cd "$AXORA_UPLOADS_DIR"
  find . -type d -printf '%P\0' | LC_ALL=C sort -z
) > "$partial_dir/uploads-directories.list"
tar \
  --create \
  --gzip \
  --numeric-owner \
  --file "$partial_dir/uploads.tar.gz" \
  --directory "$AXORA_UPLOADS_DIR" \
  .
tar --list --gzip --file "$partial_dir/uploads.tar.gz" >/dev/null
upload_restore_dir="$partial_dir/upload-restore-test"
mkdir -m 0700 "$upload_restore_dir"
tar \
  --extract \
  --gzip \
  --no-same-owner \
  --no-same-permissions \
  --file "$partial_dir/uploads.tar.gz" \
  --directory "$upload_restore_dir"
(
  cd "$upload_restore_dir"
  find . -type f -printf '%P\t%s\0' | LC_ALL=C sort -z
) > "$partial_dir/restored-uploads-files.list"
(
  cd "$upload_restore_dir"
  find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum --zero
) > "$partial_dir/restored-uploads.sha256"
(
  cd "$upload_restore_dir"
  find . -type d -printf '%P\0' | LC_ALL=C sort -z
) > "$partial_dir/restored-uploads-directories.list"
cmp --silent "$partial_dir/uploads-files.list" "$partial_dir/restored-uploads-files.list" \
  || die "Restored uploads archive differs in paths or sizes."
cmp --silent "$partial_dir/uploads.sha256" "$partial_dir/restored-uploads.sha256" \
  || die "Restored uploads archive differs in file content."
cmp --silent "$partial_dir/uploads-directories.list" "$partial_dir/restored-uploads-directories.list" \
  || die "Restored uploads archive differs in directory layout."
rm -rf -- "$upload_restore_dir"
rm -f -- \
  "$partial_dir/restored-uploads-files.list" \
  "$partial_dir/restored-uploads.sha256" \
  "$partial_dir/restored-uploads-directories.list"

source_tables="$(docker exec "$db_container" psql --username postgres --dbname "$AXORA_DATABASE_NAME" --tuples-only --no-align --set=ON_ERROR_STOP=1 --command \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" | tr -d '[:space:]')"
[[ "$source_tables" =~ ^[0-9]+$ ]] || die "Unable to count source tables."
(( source_tables >= AXORA_MIN_TABLE_COUNT )) || die "Source database has too few tables ($source_tables)."
docker exec "$db_container" psql \
  --username postgres \
  --dbname "$AXORA_DATABASE_NAME" \
  --tuples-only \
  --no-align \
  --field-separator $'\t' \
  --set=ON_ERROR_STOP=1 \
  --command "SELECT filename, sha256 FROM schema_migrations ORDER BY filename;" \
  > "$partial_dir/migrations.tsv"
migration_count="$(wc -l < "$partial_dir/migrations.tsv" | tr -d '[:space:]')"
[[ "$migration_count" =~ ^[0-9]+$ ]] || die "Unable to record applied migrations."

{
  printf 'format=axora-production-backup-v1\n'
  printf 'created_utc=%s\n' "$(date -u --iso-8601=seconds)"
  printf 'host=%s\n' "$(hostname)"
  printf 'database=%s\n' "$AXORA_DATABASE_NAME"
  printf 'source_table_count=%s\n' "$source_tables"
  printf 'migration_count=%s\n' "$migration_count"
  printf 'migration_manifest=migrations.tsv\n'
  printf 'commit=%s\n' "${commit_sha:-unknown}"
  printf 'database_archive=postgresql-custom\n'
  printf 'persistent_files=uploads.tar.gz\n'
  printf 'persistent_file_manifest=uploads-files.list,uploads.sha256,uploads-directories.list\n'
  printf 'credentials_included=no\n'
} > "$partial_dir/manifest.txt"

(cd "$partial_dir" && sha256sum \
  database.dump \
  uploads.tar.gz \
  uploads-files.list \
  uploads.sha256 \
  uploads-directories.list \
  migrations.tsv \
  manifest.txt \
  > checksums.sha256)
(cd "$partial_dir" && sha256sum --check checksums.sha256 >/dev/null)

log "Restoring the new archive into an isolated verification database."
docker exec "$db_container" createdb --username postgres "$test_database"
restore_created=true
docker exec "$db_container" psql \
  --username postgres \
  --dbname "$test_database" \
  --set=ON_ERROR_STOP=1 \
  --command "CREATE OR REPLACE FUNCTION public.workflow_metadata_is_safe(p_metadata jsonb)
  RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS \$\$
    SELECT true
  \$\$;
  SELECT 1 FROM information_schema.tables
    WHERE table_name='schema_migrations' LIMIT 1;"
docker exec -i "$db_container" pg_restore \
  --username postgres \
  --dbname "$test_database" \
  --no-owner \
  --no-privileges < "$partial_dir/database.dump"

restored_tables="$(docker exec "$db_container" psql --username postgres --dbname "$test_database" --tuples-only --no-align --set=ON_ERROR_STOP=1 --command \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" | tr -d '[:space:]')"
[[ "$restored_tables" == "$source_tables" ]] \
  || die "Restore verification table count differs (source=$source_tables, restored=$restored_tables)."
docker exec "$db_container" psql \
  --username postgres \
  --dbname "$test_database" \
  --tuples-only \
  --no-align \
  --field-separator $'\t' \
  --set=ON_ERROR_STOP=1 \
  --command "SELECT filename, sha256 FROM schema_migrations ORDER BY filename;" \
  > "$partial_dir/restored-migrations.tsv"
cmp --silent "$partial_dir/migrations.tsv" "$partial_dir/restored-migrations.tsv" \
  || die "Restored migration manifest differs from the source database."
rm -f -- "$partial_dir/restored-migrations.tsv"

docker exec "$db_container" dropdb --username postgres "$test_database"
restore_created=false

chmod 0600 "$partial_dir"/*
mv -- "$partial_dir" "$backup_dir"
partial_dir=""
atomic_write "$AXORA_LAST_BACKUP_FILE" "$backup_dir"
log "Verified backup completed: $backup_dir"

if [[ -n "$AXORA_OFFSITE_BACKUP_TARGET" ]]; then
  require_command mountpoint
  [[ -d "$AXORA_OFFSITE_BACKUP_TARGET" && ! -L "$AXORA_OFFSITE_BACKUP_TARGET" ]] \
    || die "Configured offsite backup target is missing: $AXORA_OFFSITE_BACKUP_TARGET"
  mountpoint --quiet "$AXORA_OFFSITE_BACKUP_TARGET" \
    || die "Configured offsite backup target is not a mounted filesystem."
  offsite_partial="$AXORA_OFFSITE_BACKUP_TARGET/.axora-${stamp}.partial"
  offsite_final="$AXORA_OFFSITE_BACKUP_TARGET/axora-${stamp}"
  [[ ! -e "$offsite_partial" && ! -e "$offsite_final" ]] \
    || die "Offsite backup destination already exists for this timestamp."
  cp -a -- "$backup_dir" "$offsite_partial"
  (cd "$offsite_partial" && sha256sum --check checksums.sha256 >/dev/null)
  mv -- "$offsite_partial" "$offsite_final"
  log "Verified offsite backup copy completed: $offsite_final"
fi

if [[ -n "$AXORA_OFFSITE_BACKUP_HOOK" ]]; then
  assert_safe_root_file "$AXORA_OFFSITE_BACKUP_HOOK"
  [[ -x "$AXORA_OFFSITE_BACKUP_HOOK" ]] || die "Configured offsite backup hook is not executable."
  AXORA_BACKUP_PATH="$backup_dir" \
    AXORA_BACKUP_COMMIT="${commit_sha:-unknown}" \
    "$AXORA_OFFSITE_BACKUP_HOOK" "$backup_dir"
  log "Configured offsite backup hook completed."
fi

if (( AXORA_BACKUP_RETENTION_DAYS > 0 )); then
  mapfile -d '' old_backups < <(
    find "$AXORA_BACKUPS_ROOT" \
      -mindepth 1 \
      -maxdepth 1 \
      -type d \
      -name 'axora-*' \
      -mtime "+$AXORA_BACKUP_RETENTION_DAYS" \
      -print0
  )
  backup_count="$(find "$AXORA_BACKUPS_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'axora-*' | wc -l | tr -d '[:space:]')"
  for old_backup in "${old_backups[@]}"; do
    (( backup_count > 3 )) || break
    resolved_old="$(realpath "$old_backup")"
    [[ "$resolved_old" == "$AXORA_BACKUPS_ROOT"/axora-* ]] || die "Unsafe backup retention target: $resolved_old"
    (cd "$resolved_old" && sha256sum --check checksums.sha256 >/dev/null) \
      || die "Refusing to prune an unverifiable old backup: $resolved_old"
    rm -rf -- "$resolved_old"
    backup_count=$(( backup_count - 1 ))
    log "Pruned verified local backup beyond retention: $resolved_old"
  done
fi

printf '%s\n' "$backup_dir"
