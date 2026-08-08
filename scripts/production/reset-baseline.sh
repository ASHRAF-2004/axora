#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
load_config
require_reset_database_allowed "$AXORA_DATABASE_NAME"

mode=plan
case "${1:-}" in
  ""|--plan) mode=plan ;;
  --apply) mode=apply ;;
  *) die "Usage: $0 [--plan|--apply]" ;;
esac

if [[ "$mode" == "apply" ]]; then
  reset_authorization_is_exact \
    || die "--apply requires the exact one-shot AXORA_BASELINE_RESET_AUTHORIZATION value."
  unset AXORA_BASELINE_RESET_AUTHORIZATION
  [[ -t 0 && -t 1 && -r /dev/tty && -w /dev/tty ]] \
    || die "--apply requires a real interactive terminal; piped confirmation is forbidden."
fi

for command in awk basename cmp cp cut date docker find flock grep install mktemp mv realpath rm sha256sum sort stat tail tee tr wc xargs; do
  require_command "$command"
done
valid_database_name "$AXORA_DATABASE_NAME" || die "Unsafe database name."
[[ "$AXORA_MIN_TABLE_COUNT" =~ ^[0-9]+$ && "$AXORA_MIN_TABLE_COUNT" -ge 1 ]] \
  || die "AXORA_MIN_TABLE_COUNT must be a positive whole number."
valid_image_reference "$AXORA_POSTGRES_IMAGE" \
  || die "Configured PostgreSQL image reference is unsafe."
[[ "$AXORA_POSTGRES_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]] \
  || die "Reset migrations require a digest-pinned PostgreSQL image."
assert_safe_root_file "$AXORA_RUNTIME_ENV_FILE"
runtime_database="$(runtime_env_value "$AXORA_RUNTIME_ENV_FILE" AXORA_HYBRID_DB_NAME)"
[[ "$runtime_database" == "$AXORA_DATABASE_NAME" ]] \
  || die "Runtime and deployment-controller database names differ."

install -d -o root -g root -m 0700 \
  "$AXORA_STATE_ROOT" "$AXORA_RESET_BACKUPS_ROOT" \
  "$AXORA_RESET_QUARANTINE_ROOT" "$AXORA_RESET_AUDIT_ROOT"
exec 9>"$AXORA_DEPLOY_LOCK"
flock --exclusive --nonblock 9 \
  || die "Another deployment, backup, rollback, reset, or verification is running."
export AXORA_DEPLOY_LOCK_HELD=true

current_sha="$(read_state_file "$AXORA_CURRENT_SHA_FILE")"
valid_sha "$current_sha" || die "Current release state contains an invalid commit SHA."
release="$(current_sealed_release)"
current_image="$(read_state_file "$AXORA_CURRENT_IMAGE_FILE")"
current_image_id="$(read_state_file "$AXORA_CURRENT_IMAGE_ID_FILE")"
valid_image_reference "$current_image" || die "Current release image state is invalid."
valid_image_id "$current_image_id" || die "Current release image digest state is invalid."
[[ "$release" == "$(release_path_for_sha "$current_sha")" ]] \
  || die "Reset must migrate only from the current sealed release."
[[ -f "$release/database/init/01-run-migration.sh" \
  && -f "$release/database/admin/apply-app-grants.sql" \
  && -d "$release/database/migrations" ]] \
  || die "Current sealed release lacks required migration assets."

db_container="$(find_service_container db)" \
  || die "Expected exactly one running Axora PostgreSQL container."
db_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$db_container")"
[[ "$db_health" == "healthy" ]] || die "PostgreSQL is not healthy."
running_app="$(find_service_container app)" \
  || die "Expected exactly one running Axora application container."
[[ "$(docker inspect --format '{{.Image}}' "$running_app")" == "$current_image_id" ]] \
  || die "Running application image differs from the sealed release digest."

work_dir="$(mktemp -d "$AXORA_STATE_ROOT/.reset-plan-XXXXXX")"
candidate_database=""
archived_database=""
failed_database=""
audit_dir=""
quarantine_dir=""
uploads_quarantined=false
candidate_created=false
source_renamed=false
source_connections_disabled=false
baseline_named=false
services_frozen=false
reset_committed=false
cleanup_running=false
mutation_started=false
declare -a stopped_service_ids=()
declare -a stopped_services=()

append_audit() {
  local event="$1"
  local detail="${2:-}"

  [[ -n "$audit_dir" && -d "$audit_dir" ]] || return 0
  [[ "$event" =~ ^[a-z][a-z0-9_]{1,79}$ ]] || event=invalid_event
  detail="${detail//$'\n'/ }"
  detail="${detail//$'\r'/ }"
  printf '%s\t%s\t%s\n' "$(date -u --iso-8601=seconds)" "$event" "$detail" \
    >> "$audit_dir/events.log"
  chmod 0600 "$audit_dir/events.log"
}

database_exists() {
  local database="$1"
  local result

  valid_database_name "$database" || return 1
  result="$(docker exec -i "$db_container" psql \
    --username postgres \
    --dbname postgres \
    --tuples-only \
    --no-align \
    --set=ON_ERROR_STOP=1 \
    --set="database=$database" \
    <<'SQL'
SELECT count(*) FROM pg_database WHERE datname=:'database';
SQL
  )"
  result="$(printf '%s' "$result" | tr -d '[:space:]')"
  [[ "$result" == "1" ]]
}

terminate_database_connections() {
  local database="$1"

  valid_database_name "$database" || die "Unsafe database connection target."
  docker exec -i "$db_container" psql \
    --username postgres \
    --dbname postgres \
    --set=ON_ERROR_STOP=1 \
    --set="database=$database" \
    >/dev/null <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname=:'database' AND pid<>pg_backend_pid();
SQL
}

set_database_connections() {
  local database="$1"
  local allowed="$2"

  valid_database_name "$database" || die "Unsafe database connection target."
  [[ "$allowed" == "true" || "$allowed" == "false" ]] \
    || die "Unsafe database connection setting."
  docker exec -i "$db_container" psql \
    --username postgres \
    --dbname postgres \
    --set=ON_ERROR_STOP=1 \
    --set="database=$database" \
    --set="allowed=$allowed" \
    >/dev/null <<'SQL'
SELECT format('ALTER DATABASE %I WITH ALLOW_CONNECTIONS %s', :'database', :'allowed')
\gexec
SQL
}

rename_database() {
  local source="$1"
  local destination="$2"

  valid_database_name "$source" || die "Unsafe source database name."
  valid_database_name "$destination" || die "Unsafe destination database name."
  docker exec -i "$db_container" psql \
    --username postgres \
    --dbname postgres \
    --set=ON_ERROR_STOP=1 \
    --set="source_database=$source" \
    --set="destination_database=$destination" \
    >/dev/null <<'SQL'
SELECT format('ALTER DATABASE %I RENAME TO %I', :'source_database', :'destination_database')
\gexec
SQL
}

capture_table_counts() {
  local database="$1"
  local output="$2"

  valid_database_name "$database" || die "Unsafe table-count database."
  docker exec -i "$db_container" psql \
    --username postgres \
    --dbname "$database" \
    --tuples-only \
    --no-align \
    --field-separator $'\t' \
    --set=ON_ERROR_STOP=1 \
    > "$output" <<'SQL'
SELECT format(
  'SELECT %L::text, count(*)::bigint FROM %I.%I',
  table_name,
  table_schema,
  table_name
)
FROM information_schema.tables
WHERE table_schema='public' AND table_type='BASE TABLE'
ORDER BY table_name
\gexec
SQL
  LC_ALL=C sort -o "$output" "$output"
}

summarize_table_counts() {
  local input="$1"
  local count=0
  local total=0
  local table rows

  while IFS=$'\t' read -r table rows; do
    [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ && "$rows" =~ ^[0-9]+$ ]] \
      || die "Database table-count output is invalid."
    count=$(( count + 1 ))
    total=$(( total + rows ))
  done < "$input"
  (( count >= AXORA_MIN_TABLE_COUNT )) || die "Database has too few public tables."
  printf '%s\t%s' "$count" "$total"
}

assert_migration_only_baseline() {
  local input="$1"
  local table rows

  while IFS=$'\t' read -r table rows; do
    [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ && "$rows" =~ ^[0-9]+$ ]] \
      || die "Candidate table-count output is invalid."
    case "$table" in
      schema_migrations|roles|lookup_types|lookup_values|request_status_transitions)
        ;;
      *)
        (( rows == 0 )) \
          || die "Migration-only candidate contains rows in non-baseline table $table."
        ;;
    esac
  done < "$input"
}

capture_upload_state() {
  local destination_prefix="$1"

  [[ -d "$AXORA_UPLOADS_DIR" && ! -L "$AXORA_UPLOADS_DIR" ]] \
    || die "Persistent upload directory is missing or unsafe."
  if find "$AXORA_UPLOADS_DIR" -mindepth 1 ! -type d ! -type f -print -quit | grep -q .; then
    die "Persistent uploads contain a symlink or special file."
  fi
  (
    cd "$AXORA_UPLOADS_DIR"
    find . -type f -printf '%P\t%s\0' | LC_ALL=C sort -z
  ) > "${destination_prefix}-files.list"
  (
    cd "$AXORA_UPLOADS_DIR"
    find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum --zero
  ) > "${destination_prefix}.sha256"
  (
    cd "$AXORA_UPLOADS_DIR"
    find . -type d -printf '%P\0' | LC_ALL=C sort -z
  ) > "${destination_prefix}-directories.list"
}

capture_database_migrations() {
  local database="$1"
  local output="$2"

  docker exec "$db_container" psql \
    --username postgres \
    --dbname "$database" \
    --tuples-only \
    --no-align \
    --field-separator $'\t' \
    --set=ON_ERROR_STOP=1 \
    --command "SELECT filename, sha256 FROM schema_migrations ORDER BY filename;" \
    > "$output"
}

assert_source_database_quiescent() {
  local session_count

  session_count="$(docker exec "$db_container" psql \
    --username postgres \
    --dbname "$AXORA_DATABASE_NAME" \
    --tuples-only \
    --no-align \
    --set=ON_ERROR_STOP=1 \
    --command "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();" \
    | tr -d '[:space:]')"
  [[ "$session_count" == "0" ]] \
    || die "Production database still has a non-controller session after the writer freeze."
}

capture_release_migrations() {
  local output="$1"
  local migration

  : > "$output"
  for migration in "$release"/database/migrations/[0-9][0-9][0-9]_*.sql; do
    [[ -f "$migration" && ! -L "$migration" ]] || continue
    printf '%s\t%s\n' "$(basename -- "$migration")" \
      "$(sha256sum "$migration" | awk '{print $1}')" >> "$output"
  done
  LC_ALL=C sort -o "$output" "$output"
  [[ -s "$output" ]] || die "Current sealed release contains no migrations."
}

service_was_stopped() {
  local wanted="$1"
  local service
  for service in "${stopped_services[@]}"; do
    [[ "$service" == "$wanted" ]] && return 0
  done
  return 1
}

freeze_writers() {
  local service container
  local -a ordered_services=(cloudflared caddy email-sender document-worker budget-worker app tailscale-db)

  stopped_service_ids=()
  stopped_services=()
  for service in "${ordered_services[@]}"; do
    if container="$(find_service_container "$service")"; then
      stopped_services+=("$service")
      stopped_service_ids+=("$container")
    fi
  done
  service_was_stopped app || die "The production app stopped unexpectedly before maintenance freeze."
  # Set this immediately before the first mutating command. Collection and
  # validation failures above must not trigger a rollback that stops otherwise
  # healthy services; a partial docker stop below must trigger one.
  mutation_started=true
  if (( "${#stopped_service_ids[@]}" > 0 )); then
    docker stop --time 45 "${stopped_service_ids[@]}" >/dev/null
  fi
  services_frozen=true
  append_audit writers_frozen "services=${stopped_services[*]}"
}

restart_original_services() {
  local -a first_wave=()
  local -a second_wave=()
  local service

  export AXORA_IMAGE="$current_image"
  for service in app budget-worker document-worker email-sender tailscale-db; do
    service_was_stopped "$service" && first_wave+=("$service")
  done
  for service in caddy cloudflared; do
    service_was_stopped "$service" && second_wave+=("$service")
  done
  if (( "${#first_wave[@]}" > 0 )); then
    if ! compose_release "$release" up -d --no-deps --no-build --wait \
      --wait-timeout "$AXORA_DEPLOY_TIMEOUT_SECONDS" "${first_wave[@]}"; then
      return 1
    fi
  fi
  if (( "${#second_wave[@]}" > 0 )); then
    if ! compose_release "$release" up -d --no-deps --no-build --wait \
      --wait-timeout "$AXORA_DEPLOY_TIMEOUT_SECONDS" "${second_wave[@]}"; then
      return 1
    fi
  fi
  services_frozen=false
}

preserve_new_uploads_and_restore_old() {
  local failed_uploads

  "$uploads_quarantined" || return 0
  failed_uploads="$quarantine_dir/failed-baseline-uploads"
  if [[ -e "$AXORA_UPLOADS_DIR" ]]; then
    [[ -d "$AXORA_UPLOADS_DIR" && ! -L "$AXORA_UPLOADS_DIR" ]] || return 1
    [[ ! -e "$failed_uploads" ]] || return 1
    mv -- "$AXORA_UPLOADS_DIR" "$failed_uploads" || return 1
  fi
  [[ -d "$quarantine_dir/uploads" && ! -L "$quarantine_dir/uploads" ]] || return 1
  mv -- "$quarantine_dir/uploads" "$AXORA_UPLOADS_DIR" || return 1
  uploads_quarantined=false
}

rollback_uncommitted_reset() {
  local rollback_failed=false

  "$cleanup_running" && return 0
  cleanup_running=true
  warn "Reset did not complete; attempting the preserved database/upload rollback."
  append_audit rollback_started "automatic=true"

  # Stop any application-path containers started against the candidate before
  # changing database names back. PostgreSQL itself remains running.
  local service container
  local -a active_ids=()
  for service in cloudflared caddy email-sender document-worker budget-worker app tailscale-db; do
    if container="$(find_service_container "$service")"; then active_ids+=("$container"); fi
  done
  if (( "${#active_ids[@]}" > 0 )); then
    docker stop --time 45 "${active_ids[@]}" >/dev/null 2>&1 || rollback_failed=true
  fi

  if "$baseline_named"; then
    if database_exists "$AXORA_DATABASE_NAME"; then
      failed_database="axora_failed_baseline_$(date -u +%Y%m%dT%H%M%SZ)_$$"
      failed_database="${failed_database:0:60}"
      set_database_connections "$AXORA_DATABASE_NAME" false || rollback_failed=true
      terminate_database_connections "$AXORA_DATABASE_NAME" || rollback_failed=true
      if rename_database "$AXORA_DATABASE_NAME" "$failed_database"; then
        baseline_named=false
      else
        rollback_failed=true
      fi
    else
      rollback_failed=true
    fi
  fi
  if "$source_renamed"; then
    if ! "$baseline_named" && database_exists "$archived_database"; then
      terminate_database_connections "$archived_database" || rollback_failed=true
      if rename_database "$archived_database" "$AXORA_DATABASE_NAME"; then
        source_renamed=false
      else
        rollback_failed=true
      fi
    else
      rollback_failed=true
    fi
  fi
  if "$source_connections_disabled"; then
    if ! "$source_renamed" && ! "$baseline_named" \
      && database_exists "$AXORA_DATABASE_NAME"; then
      if set_database_connections "$AXORA_DATABASE_NAME" true; then
        source_connections_disabled=false
      else
        rollback_failed=true
      fi
    else
      rollback_failed=true
    fi
  fi
  if "$candidate_created" && [[ -n "$candidate_database" ]] \
    && database_exists "$candidate_database"; then
    terminate_database_connections "$candidate_database" || rollback_failed=true
    if docker exec "$db_container" dropdb --username postgres --if-exists "$candidate_database" \
      >/dev/null 2>&1; then
      candidate_created=false
    else
      rollback_failed=true
    fi
  fi
  preserve_new_uploads_and_restore_old || rollback_failed=true
  if ! "$baseline_named" && ! "$source_renamed" \
    && ! "$source_connections_disabled" && ! "$uploads_quarantined"; then
    restart_original_services || rollback_failed=true
  else
    rollback_failed=true
  fi
  if "$rollback_failed"; then
    append_audit rollback_incomplete "manual_recovery_required=true"
    warn "Automatic rollback was incomplete; keep services isolated and use the audit record."
  else
    append_audit rollback_completed "source_restored=true"
  fi
}

on_exit() {
  local status=$?
  trap - EXIT
  if (( status != 0 )) && [[ "$mode" == "apply" ]] \
    && "$mutation_started" && ! "$reset_committed"; then
    rollback_uncommitted_reset || true
  fi
  if [[ -n "${work_dir:-}" && -d "$work_dir" \
    && "$work_dir" == "$AXORA_STATE_ROOT"/.reset-plan-* ]]; then
    rm -rf -- "$work_dir"
  fi
  exit "$status"
}
trap on_exit EXIT

capture_release_migrations "$work_dir/release-migrations.tsv"
capture_database_migrations "$AXORA_DATABASE_NAME" "$work_dir/source-migrations.tsv"
cmp --silent "$work_dir/release-migrations.tsv" "$work_dir/source-migrations.tsv" \
  || die "Production migrations do not exactly match the current sealed release."
capture_table_counts "$AXORA_DATABASE_NAME" "$work_dir/source-counts.tsv"
IFS=$'\t' read -r source_table_count source_row_count \
  <<< "$(summarize_table_counts "$work_dir/source-counts.tsv")"
capture_upload_state "$work_dir/source-uploads"
upload_file_count="$(find "$AXORA_UPLOADS_DIR" -type f | wc -l | tr -d '[:space:]')"
upload_byte_count="$(find "$AXORA_UPLOADS_DIR" -type f -printf '%s\n' \
  | awk '{ total += $1 } END { print total + 0 }')"
[[ "$upload_file_count" =~ ^[0-9]+$ && "$upload_byte_count" =~ ^[0-9]+$ ]] \
  || die "Unable to summarize persistent uploads."

log "Baseline reset plan: database=$AXORA_DATABASE_NAME commit=$current_sha tables=$source_table_count rows=$source_row_count uploads=$upload_file_count files/$upload_byte_count bytes."
if [[ "$mode" == "plan" ]]; then
  log "Plan only: no service, database, upload, backup, or Docker volume was changed."
  exit 0
fi

confirmation="$(reset_confirmation_phrase \
  "$AXORA_DATABASE_NAME" "$source_row_count" "$source_table_count" "$current_sha")"
{
  printf '\nThis replaces the active database with a migration-only baseline.\n'
  printf 'No company, branch, user, owner, product, supplier, request, or demo row will be seeded.\n'
  printf 'The source database and upload tree will be quarantined, not deleted.\n\n'
  printf 'Type this exact phrase:\n%s\n> ' "$confirmation"
} > /dev/tty
IFS= read -r typed_confirmation < /dev/tty
[[ "$typed_confirmation" == "$confirmation" ]] \
  || die "Typed reset confirmation did not match; nothing was changed."
unset typed_confirmation confirmation

initiator_uid="${SUDO_UID:-0}"
initiator_user="${SUDO_USER:-root}"
[[ "$initiator_uid" =~ ^[0-9]+$ ]] || initiator_uid=0
[[ "$initiator_user" =~ ^[A-Za-z_][A-Za-z0-9_.-]{0,63}$ ]] || initiator_user=unknown
reset_id="reset-$(date -u +%Y%m%dT%H%M%SZ)-${current_sha:0:12}"
audit_dir="$AXORA_RESET_AUDIT_ROOT/$reset_id"
quarantine_dir="$AXORA_RESET_QUARANTINE_ROOT/$reset_id"
[[ ! -e "$audit_dir" && ! -e "$quarantine_dir" ]] \
  || die "Reset audit/quarantine destination already exists."
install -d -o root -g root -m 0700 "$audit_dir" "$quarantine_dir"
cp -- "$work_dir/source-counts.tsv" "$audit_dir/source-counts.tsv"
cp -- "$work_dir/source-migrations.tsv" "$audit_dir/source-migrations.tsv"
cp -- "$work_dir/source-uploads-files.list" "$audit_dir/uploads-files.list"
cp -- "$work_dir/source-uploads.sha256" "$audit_dir/uploads.sha256"
cp -- "$work_dir/source-uploads-directories.list" "$audit_dir/uploads-directories.list"
chmod 0600 "$audit_dir"/*
cat > "$audit_dir/manifest.txt" <<EOF
format=axora-baseline-reset-audit-v1
reset_id=$reset_id
requested_utc=$(date -u --iso-8601=seconds)
initiator_uid=$initiator_uid
initiator_user=$initiator_user
database=$AXORA_DATABASE_NAME
commit=$current_sha
source_table_count=$source_table_count
source_row_count=$source_row_count
source_upload_file_count=$upload_file_count
source_upload_byte_count=$upload_byte_count
authorization_flag=exact
typed_confirmation=matched
seed_users=no
seed_demo=no
docker_volumes_touched=no
EOF
chmod 0600 "$audit_dir/manifest.txt"
append_audit reset_authorized "initiator=$initiator_user uid=$initiator_uid"

freeze_writers
capture_table_counts "$AXORA_DATABASE_NAME" "$work_dir/frozen-counts.tsv"
capture_database_migrations "$AXORA_DATABASE_NAME" "$work_dir/frozen-migrations.tsv"
capture_upload_state "$work_dir/frozen-uploads"
cmp --silent "$work_dir/source-counts.tsv" "$work_dir/frozen-counts.tsv" \
  || die "Database counts changed after confirmation; aborting for a new plan."
cmp --silent "$work_dir/source-migrations.tsv" "$work_dir/frozen-migrations.tsv" \
  || die "Database migrations changed after confirmation; aborting."
cmp --silent "$work_dir/source-uploads-files.list" "$work_dir/frozen-uploads-files.list" \
  || die "Upload paths or sizes changed after confirmation; aborting for a new plan."
cmp --silent "$work_dir/source-uploads.sha256" "$work_dir/frozen-uploads.sha256" \
  || die "Upload content changed after confirmation; aborting for a new plan."
cmp --silent "$work_dir/source-uploads-directories.list" "$work_dir/frozen-uploads-directories.list" \
  || die "Upload directories changed after confirmation; aborting for a new plan."
assert_source_database_quiescent

log "Creating and independently restoring the final encrypted recovery point."
backup_output="$work_dir/encrypted-backup-output.log"
AXORA_DEPLOY_LOCK_HELD=true \
  "$SCRIPT_DIR/encrypted-reset-backup.sh" --purpose baseline-reset | tee "$backup_output"
encrypted_backup="$(tail -n 1 "$backup_output")"
[[ -f "$encrypted_backup" && ! -L "$encrypted_backup" ]] \
  || die "Final encrypted reset recovery point is missing."
[[ "$encrypted_backup" == "$AXORA_RESET_BACKUPS_ROOT"/axora-reset-*.tar.gpg ]] \
  || die "Final encrypted reset recovery point is outside the approved root."
verified_backup="${encrypted_backup%.tar.gpg}.verified"
assert_private_root_file "$verified_backup" 1 1048576
grep -Fqx 'purpose=baseline-reset' "${encrypted_backup%.tar.gpg}.manifest" \
  || die "Final encrypted recovery point does not have the baseline-reset purpose."
grep -Fqx "database=$AXORA_DATABASE_NAME" "${encrypted_backup%.tar.gpg}.manifest" \
  || die "Final encrypted recovery point belongs to a different database."
grep -Fqx "commit=$current_sha" "${encrypted_backup%.tar.gpg}.manifest" \
  || die "Final encrypted recovery point belongs to a different release."
cp -- "${encrypted_backup%.tar.gpg}.manifest" "$audit_dir/encrypted-backup.manifest"
cp -- "$verified_backup" "$audit_dir/encrypted-backup.verified"
chmod 0600 "$audit_dir/encrypted-backup.manifest" "$audit_dir/encrypted-backup.verified"
append_audit encrypted_backup_verified "artifact=$(basename -- "$encrypted_backup")"

# The final backup is the last source-reading operation before candidate work.
# Re-prove that no database/upload drift occurred while it was created and
# independently restored.
assert_source_database_quiescent
capture_table_counts "$AXORA_DATABASE_NAME" "$work_dir/post-backup-counts.tsv"
capture_database_migrations "$AXORA_DATABASE_NAME" "$work_dir/post-backup-migrations.tsv"
capture_upload_state "$work_dir/post-backup-uploads"
cmp --silent "$work_dir/frozen-counts.tsv" "$work_dir/post-backup-counts.tsv" \
  || die "Database counts changed while the final encrypted backup was created."
cmp --silent "$work_dir/frozen-migrations.tsv" "$work_dir/post-backup-migrations.tsv" \
  || die "Database migrations changed while the final encrypted backup was created."
cmp --silent "$work_dir/frozen-uploads-files.list" "$work_dir/post-backup-uploads-files.list" \
  || die "Upload paths or sizes changed while the final encrypted backup was created."
cmp --silent "$work_dir/frozen-uploads.sha256" "$work_dir/post-backup-uploads.sha256" \
  || die "Upload content changed while the final encrypted backup was created."
cmp --silent "$work_dir/frozen-uploads-directories.list" "$work_dir/post-backup-uploads-directories.list" \
  || die "Upload directories changed while the final encrypted backup was created."
append_audit source_reverified_after_backup "sessions=0 drift=false"

# The candidate name is internal and never replaces the configured production
# name until every migration-only baseline check passes.
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
candidate_database="axora_baseline_${stamp}_$$"
candidate_database="${candidate_database:0:60}"
archived_database="axora_pre_reset_${stamp}_$$"
archived_database="${archived_database:0:60}"
valid_database_name "$candidate_database" || die "Unsafe candidate database name."
valid_database_name "$archived_database" || die "Unsafe archive database name."
database_exists "$candidate_database" && die "Candidate database already exists."
database_exists "$archived_database" && die "Archive database already exists."

docker exec "$db_container" createdb \
  --username postgres \
  --template template0 \
  --encoding UTF8 \
  "$candidate_database"
candidate_created=true
append_audit candidate_created "database=$candidate_database"

log "Applying migrations only from sealed release $current_sha."
docker run \
  --rm \
  --label "axora.reset.migration=$reset_id" \
  --network "$AXORA_BACKEND_NETWORK" \
  --group-add 1000 \
  --cpus 2 \
  --memory 1g \
  --pids-limit 128 \
  --env POSTGRES_USER=postgres \
  --env "POSTGRES_DB=$candidate_database" \
  --env PGHOST=db \
  --mount "type=bind,source=$AXORA_SECRETS_DIR/postgres_admin_password,target=/run/secrets/postgres_admin_password,readonly" \
  --mount "type=bind,source=$release/database/init,target=/database/init,readonly" \
  --mount "type=bind,source=$release/database/migrations,target=/migrations,readonly" \
  --entrypoint /bin/sh \
  "$AXORA_POSTGRES_IMAGE" \
  /database/init/01-run-migration.sh

docker run \
  --rm \
  --label "axora.reset.grants=$reset_id" \
  --network "$AXORA_BACKEND_NETWORK" \
  --group-add 1000 \
  --cpus 1 \
  --memory 512m \
  --pids-limit 64 \
  --env "PGDATABASE=$candidate_database" \
  --env PGHOST=db \
  --env PGUSER=postgres \
  --mount "type=bind,source=$AXORA_SECRETS_DIR/postgres_admin_password,target=/run/secrets/postgres_admin_password,readonly" \
  --mount "type=bind,source=$release/database/admin,target=/database/admin,readonly" \
  --entrypoint /bin/sh \
  "$AXORA_POSTGRES_IMAGE" \
  -c 'export PGPASSWORD="$(cat /run/secrets/postgres_admin_password)"; exec psql --set=ON_ERROR_STOP=1 --file=/database/admin/apply-app-grants.sql'

capture_database_migrations "$candidate_database" "$work_dir/candidate-migrations.tsv"
cmp --silent "$work_dir/release-migrations.tsv" "$work_dir/candidate-migrations.tsv" \
  || die "Migration-only candidate does not match the sealed release."
capture_table_counts "$candidate_database" "$work_dir/candidate-counts.tsv"
IFS=$'\t' read -r candidate_table_count candidate_row_count \
  <<< "$(summarize_table_counts "$work_dir/candidate-counts.tsv")"
assert_migration_only_baseline "$work_dir/candidate-counts.tsv"
append_audit candidate_verified \
  "tables=$candidate_table_count baseline_rows=$candidate_row_count business_rows=0"

[[ "$(stat -c '%d' "$AXORA_UPLOADS_DIR")" == "$(stat -c '%d' "$quarantine_dir")" ]] \
  || die "Upload quarantine must be on the same filesystem for a recoverable rename."
upload_group="$(stat -c '%g' "$AXORA_UPLOADS_DIR")"
[[ "$upload_group" =~ ^[0-9]+$ ]] || die "Unable to preserve upload group ownership."
mv -- "$AXORA_UPLOADS_DIR" "$quarantine_dir/uploads"
uploads_quarantined=true
install -d -o root -g "$upload_group" -m 0770 "$AXORA_UPLOADS_DIR"
append_audit uploads_quarantined "path=$quarantine_dir/uploads"

set_database_connections "$AXORA_DATABASE_NAME" false
source_connections_disabled=true
terminate_database_connections "$AXORA_DATABASE_NAME"
rename_database "$AXORA_DATABASE_NAME" "$archived_database"
source_renamed=true
rename_database "$candidate_database" "$AXORA_DATABASE_NAME"
candidate_created=false
baseline_named=true
append_audit database_swapped "source=$archived_database active=$AXORA_DATABASE_NAME"

restart_original_services
"$SCRIPT_DIR/health-check.sh" --local
if bool_is_true "$AXORA_REQUIRE_EXTERNAL"; then
  "$SCRIPT_DIR/health-check.sh" --external
fi

reset_committed=true
append_audit reset_completed \
  "active=$AXORA_DATABASE_NAME preserved_source=$archived_database encrypted_backup=$(basename -- "$encrypted_backup")"
atomic_write "$AXORA_LAST_RESET_FILE" "$audit_dir"
log "Migration-only baseline is active; no user or demo account was seeded."
log "Preserved source database: $archived_database"
log "Recoverable upload quarantine: $quarantine_dir/uploads"
log "Verified encrypted recovery point: $encrypted_backup"
log "Reset audit record: $audit_dir"
