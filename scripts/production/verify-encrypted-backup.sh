#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
load_config

for command in awk cmp date docker find flock gpg grep install mktemp realpath rm sha256sum sort stat tar tr wc xargs; do
  require_command "$command"
done
require_reset_database_allowed "$AXORA_DATABASE_NAME"
require_reset_backup_passphrase
[[ "$AXORA_MIN_TABLE_COUNT" =~ ^[0-9]+$ && "$AXORA_MIN_TABLE_COUNT" -ge 1 ]] \
  || die "AXORA_MIN_TABLE_COUNT must be a positive whole number."

[[ "${1:-}" == "--artifact" && -n "${2:-}" && -z "${3:-}" ]] \
  || die "Usage: $0 --artifact <encrypted-reset-backup.tar.gpg>"

install -d -o root -g root -m 0700 \
  "$AXORA_STATE_ROOT" "$AXORA_RESET_BACKUPS_ROOT" "$AXORA_RESET_AUDIT_ROOT"
if ! bool_is_true "${AXORA_DEPLOY_LOCK_HELD:-false}"; then
  exec 9>"$AXORA_DEPLOY_LOCK"
  flock --exclusive --timeout 600 9 \
    || die "A deployment, backup, reset, or verification is still running after ten minutes."
fi

manifest_value() {
  local manifest="$1"
  local key="$2"
  local -a values

  [[ "$key" =~ ^[a-z][a-z0-9_]*$ ]] || die "Unsafe backup manifest key."
  mapfile -t values < <(
    awk -v key="$key" 'index($0, key "=") == 1 { print substr($0, length(key) + 2) }' \
      "$manifest"
  )
  (( "${#values[@]}" == 1 )) || die "Backup manifest must contain exactly one $key."
  [[ "${values[0]}" != *$'\r'* ]] || die "Backup manifest contains an invalid $key."
  printf '%s' "${values[0]}"
}

archive_member_is_safe() {
  local member="$1"
  local component
  local -a components

  [[ -n "$member" && "$member" != /* && "$member" != *$'\r'* ]] || return 1
  member="${member#./}"
  [[ -z "$member" || "$member" == "." ]] && return 0
  IFS='/' read -r -a components <<< "$member"
  for component in "${components[@]}"; do
    [[ -n "$component" && "$component" != "." && "$component" != ".." ]] || return 1
  done
}

artifact_input="$2"
[[ -f "$artifact_input" && ! -L "$artifact_input" ]] \
  || die "Encrypted reset backup is missing or unsafe."
artifact="$(realpath -- "$artifact_input")"
reset_root="$(realpath -- "$AXORA_RESET_BACKUPS_ROOT")"
[[ "$artifact" == "$reset_root"/axora-reset-*.tar.gpg ]] \
  || die "Encrypted reset backup must be an artifact in $AXORA_RESET_BACKUPS_ROOT."
assert_private_root_file "$artifact" 1 1099511627776

outer_manifest="${artifact%.tar.gpg}.manifest"
assert_private_root_file "$outer_manifest" 1 1048576
[[ "$(manifest_value "$outer_manifest" format)" == "axora-encrypted-reset-backup-v1" ]] \
  || die "Encrypted reset backup manifest format is unsupported."
manifest_created_utc="$(manifest_value "$outer_manifest" created_utc)"
[[ "$manifest_created_utc" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\+00:00$ ]] \
  || die "Encrypted reset backup has an invalid creation timestamp."
manifest_database="$(manifest_value "$outer_manifest" database)"
require_reset_database_allowed "$manifest_database"
[[ "$manifest_database" == "$AXORA_DATABASE_NAME" ]] \
  || die "Encrypted reset backup belongs to a different configured database."
manifest_commit="$(manifest_value "$outer_manifest" commit)"
valid_sha "$manifest_commit" || die "Encrypted reset backup has an invalid release commit."
manifest_purpose="$(manifest_value "$outer_manifest" purpose)"
[[ "$manifest_purpose" == "manual-guarded-backup" || "$manifest_purpose" == "baseline-reset" ]] \
  || die "Encrypted reset backup has an invalid purpose."
manifest_source_backup="$(manifest_value "$outer_manifest" source_backup)"
[[ "$manifest_source_backup" =~ ^axora-[0-9]{8}T[0-9]{6}Z$ ]] \
  || die "Encrypted reset backup has an invalid source backup identity."
manifest_initiator_uid="$(manifest_value "$outer_manifest" initiator_uid)"
manifest_initiator_user="$(manifest_value "$outer_manifest" initiator_user)"
[[ "$manifest_initiator_uid" =~ ^[0-9]+$ \
  && "$manifest_initiator_user" =~ ^[A-Za-z_][A-Za-z0-9_.-]{0,63}$ ]] \
  || die "Encrypted reset backup has an invalid initiator identity."
expected_source_manifest_sha="$(manifest_value "$outer_manifest" source_manifest_sha256)"
[[ "$expected_source_manifest_sha" =~ ^[0-9a-f]{64}$ ]] \
  || die "Encrypted reset backup has an invalid source-manifest checksum."
[[ "$(manifest_value "$outer_manifest" credentials_included)" == "no" ]] \
  || die "Encrypted reset backup must not contain credentials."
expected_ciphertext_sha="$(manifest_value "$outer_manifest" ciphertext_sha256)"
[[ "$expected_ciphertext_sha" =~ ^[0-9a-f]{64}$ ]] \
  || die "Encrypted reset backup has an invalid ciphertext checksum."
actual_ciphertext_sha="$(sha256sum "$artifact" | awk '{print $1}')"
[[ "$actual_ciphertext_sha" == "$expected_ciphertext_sha" ]] \
  || die "Encrypted reset backup ciphertext checksum does not match."

work_dir="$(mktemp -d "$AXORA_RESET_BACKUPS_ROOT/.verify-XXXXXX")"
test_database="axora_reset_verify_$(date -u +%Y%m%dT%H%M%SZ)_$$"
test_database="${test_database:0:60}"
valid_database_name "$test_database" || die "Unable to construct a safe verification database name."
restore_created=false

cleanup() {
  if "$restore_created" && [[ -n "${db_container:-}" ]]; then
    docker exec "$db_container" dropdb --username postgres --if-exists "$test_database" \
      >/dev/null 2>&1 || true
  fi
  if [[ -n "${work_dir:-}" && -d "$work_dir" \
    && "$work_dir" == "$AXORA_RESET_BACKUPS_ROOT"/.verify-* ]]; then
    rm -rf -- "$work_dir"
  fi
}
trap cleanup EXIT

install -d -m 0700 "$work_dir/gnupg" "$work_dir/extracted"
if ! GNUPGHOME="$work_dir/gnupg" gpg \
  --batch \
  --quiet \
  --no-tty \
  --status-fd 3 \
  --pinentry-mode loopback \
  --passphrase-file "$AXORA_RESET_BACKUP_PASSPHRASE_FILE" \
  --output "$work_dir/package.tar" \
  --decrypt "$artifact" \
  3>"$work_dir/gpg-status.log" \
  2>"$work_dir/gpg-error.log"; then
  die "Encrypted reset backup could not be decrypted with the configured root-only passphrase."
fi
grep -Eq '^\[GNUPG:\] DECRYPTION_INFO [0-9]+ 9( [0-9]+)?$' \
  "$work_dir/gpg-status.log" \
  || die "Encrypted reset backup was not produced with AES256."
grep -Fqx '[GNUPG:] GOODMDC' "$work_dir/gpg-status.log" \
  || die "Encrypted reset backup did not pass its GPG integrity check."

tar --list --file "$work_dir/package.tar" > "$work_dir/package-members.list"
if tar --list --verbose --quoting-style=escape --file "$work_dir/package.tar" \
  | awk 'substr($1, 1, 1) != "-" && substr($1, 1, 1) != "d" { bad=1 } END { exit bad ? 0 : 1 }'; then
  die "Encrypted reset package contains a link or special archive member."
fi
package_root=""
while IFS= read -r member; do
  archive_member_is_safe "$member" || die "Encrypted reset package contains an unsafe path."
  normalized="${member#./}"
  [[ -n "$normalized" && "$normalized" != "." ]] || continue
  member_root="${normalized%%/*}"
  if [[ -z "$package_root" ]]; then
    package_root="$member_root"
  elif [[ "$member_root" != "$package_root" ]]; then
    die "Encrypted reset package must contain exactly one backup directory."
  fi
done < "$work_dir/package-members.list"
[[ "$package_root" =~ ^axora-[0-9]{8}T[0-9]{6}Z$ ]] \
  || die "Encrypted reset package has an invalid backup directory name."
[[ "$package_root" == "$manifest_source_backup" ]] \
  || die "Encrypted reset package source identity differs from its manifest."

tar \
  --extract \
  --no-same-owner \
  --no-same-permissions \
  --file "$work_dir/package.tar" \
  --directory "$work_dir/extracted"
backup_dir="$work_dir/extracted/$package_root"
[[ -d "$backup_dir" && ! -L "$backup_dir" ]] \
  || die "Encrypted reset package did not restore the expected backup directory."
if find "$backup_dir" -mindepth 1 ! -type f -print -quit | grep -q .; then
  die "Encrypted reset package contains a nested directory, symlink, or special file."
fi

cat > "$work_dir/expected-files.list" <<'EOF'
checksums.sha256
database.dump
manifest.txt
migrations.tsv
uploads-directories.list
uploads-files.list
uploads.sha256
uploads.tar.gz
EOF
find "$backup_dir" -mindepth 1 -maxdepth 1 -type f -printf '%f\n' \
  | LC_ALL=C sort > "$work_dir/actual-files.list"
cmp --silent "$work_dir/expected-files.list" "$work_dir/actual-files.list" \
  || die "Encrypted reset package contains an unexpected backup file set."
(cd "$backup_dir" && sha256sum --check checksums.sha256 >/dev/null) \
  || die "Decrypted reset backup checksum verification failed."

inner_manifest="$backup_dir/manifest.txt"
[[ "$(sha256sum "$inner_manifest" | awk '{print $1}')" == "$expected_source_manifest_sha" ]] \
  || die "Decrypted source manifest checksum differs from the encrypted metadata."
[[ "$(manifest_value "$inner_manifest" format)" == "axora-production-backup-v1" ]] \
  || die "Decrypted reset backup format is unsupported."
[[ "$(manifest_value "$inner_manifest" database)" == "$manifest_database" ]] \
  || die "Encrypted and decrypted backup database identities differ."
[[ "$(manifest_value "$inner_manifest" commit)" == "$manifest_commit" ]] \
  || die "Encrypted and decrypted backup release commits differ."
[[ "$(manifest_value "$inner_manifest" database_archive)" == "postgresql-custom" ]] \
  || die "Decrypted reset backup does not contain the expected PostgreSQL archive format."
[[ "$(manifest_value "$inner_manifest" migration_manifest)" == "migrations.tsv" ]] \
  || die "Decrypted reset backup names an unexpected migration manifest."
[[ "$(manifest_value "$inner_manifest" persistent_files)" == "uploads.tar.gz" ]] \
  || die "Decrypted reset backup names an unexpected upload archive."
[[ "$(manifest_value "$inner_manifest" persistent_file_manifest)" \
  == "uploads-files.list,uploads.sha256,uploads-directories.list" ]] \
  || die "Decrypted reset backup names an unexpected upload manifest set."
[[ "$(manifest_value "$inner_manifest" credentials_included)" == "no" ]] \
  || die "Decrypted reset backup must not contain credentials."
source_tables="$(manifest_value "$inner_manifest" source_table_count)"
migration_count="$(manifest_value "$inner_manifest" migration_count)"
[[ "$source_tables" =~ ^[0-9]+$ && "$migration_count" =~ ^[0-9]+$ ]] \
  || die "Decrypted reset backup contains invalid verification counts."
(( source_tables >= AXORA_MIN_TABLE_COUNT )) \
  || die "Decrypted reset backup has too few source tables."
[[ "$(wc -l < "$backup_dir/migrations.tsv" | tr -d '[:space:]')" == "$migration_count" ]] \
  || die "Decrypted reset backup migration count does not match its manifest."

tar --list --gzip --file "$backup_dir/uploads.tar.gz" > "$work_dir/uploads-members.list"
if tar --list --verbose --quoting-style=escape --gzip --file "$backup_dir/uploads.tar.gz" \
  | awk 'substr($1, 1, 1) != "-" && substr($1, 1, 1) != "d" { bad=1 } END { exit bad ? 0 : 1 }'; then
  die "Decrypted upload archive contains a link or special archive member."
fi
while IFS= read -r member; do
  archive_member_is_safe "$member" || die "Decrypted upload archive contains an unsafe path."
done < "$work_dir/uploads-members.list"
install -d -m 0700 "$work_dir/uploads-restored"
tar \
  --extract \
  --gzip \
  --no-same-owner \
  --no-same-permissions \
  --file "$backup_dir/uploads.tar.gz" \
  --directory "$work_dir/uploads-restored"
if find "$work_dir/uploads-restored" -mindepth 1 ! -type d ! -type f -print -quit | grep -q .; then
  die "Decrypted upload archive contains a symlink or special file."
fi
(
  cd "$work_dir/uploads-restored"
  find . -type f -printf '%P\t%s\0' | LC_ALL=C sort -z
) > "$work_dir/restored-uploads-files.list"
(
  cd "$work_dir/uploads-restored"
  find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum --zero
) > "$work_dir/restored-uploads.sha256"
(
  cd "$work_dir/uploads-restored"
  find . -type d -printf '%P\0' | LC_ALL=C sort -z
) > "$work_dir/restored-uploads-directories.list"
cmp --silent "$backup_dir/uploads-files.list" "$work_dir/restored-uploads-files.list" \
  || die "Decrypted upload archive differs in paths or sizes."
cmp --silent "$backup_dir/uploads.sha256" "$work_dir/restored-uploads.sha256" \
  || die "Decrypted upload archive differs in file content."
cmp --silent "$backup_dir/uploads-directories.list" "$work_dir/restored-uploads-directories.list" \
  || die "Decrypted upload archive differs in directory layout."

db_container="$(find_service_container db)" \
  || die "Expected exactly one running Axora PostgreSQL container."
db_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$db_container")"
[[ "$db_health" == "healthy" ]] \
  || die "PostgreSQL is not healthy; refusing recovery verification."
docker exec -i "$db_container" pg_restore --list \
  < "$backup_dir/database.dump" >/dev/null

log "Restoring the decrypted reset recovery point into a disposable database."
docker exec "$db_container" createdb --username postgres "$test_database"
restore_created=true
docker exec -i "$db_container" pg_restore \
  --username postgres \
  --dbname "$test_database" \
  --no-owner \
  --no-privileges \
  < "$backup_dir/database.dump"

restored_tables="$(docker exec "$db_container" psql \
  --username postgres \
  --dbname "$test_database" \
  --tuples-only \
  --no-align \
  --set=ON_ERROR_STOP=1 \
  --command "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" \
  | tr -d '[:space:]')"
[[ "$restored_tables" == "$source_tables" ]] \
  || die "Disposable restore table count differs from the encrypted source."
docker exec "$db_container" psql \
  --username postgres \
  --dbname "$test_database" \
  --tuples-only \
  --no-align \
  --field-separator $'\t' \
  --set=ON_ERROR_STOP=1 \
  --command "SELECT filename, sha256 FROM schema_migrations ORDER BY filename;" \
  > "$work_dir/restored-migrations.tsv"
cmp --silent "$backup_dir/migrations.tsv" "$work_dir/restored-migrations.tsv" \
  || die "Disposable restore migration manifest differs from the encrypted source."

docker exec "$db_container" dropdb --username postgres "$test_database"
restore_created=false

verifier_uid="${SUDO_UID:-0}"
verifier_user="${SUDO_USER:-root}"
[[ "$verifier_uid" =~ ^[0-9]+$ ]] || verifier_uid=0
[[ "$verifier_user" =~ ^[A-Za-z_][A-Za-z0-9_.-]{0,63}$ ]] || verifier_user=unknown
verified_file="${artifact%.tar.gpg}.verified"
if [[ -e "$verified_file" || -L "$verified_file" ]]; then
  assert_private_root_file "$verified_file" 1 1048576
fi
verified_content="$(printf '%s\n' \
  'format=axora-encrypted-reset-verification-v1' \
  "verified_utc=$(date -u --iso-8601=seconds)" \
  "database=$manifest_database" \
  "commit=$manifest_commit" \
  "purpose=$manifest_purpose" \
  "ciphertext_sha256=$actual_ciphertext_sha" \
  "source_table_count=$source_tables" \
  "migration_count=$migration_count" \
  "verifier_uid=$verifier_uid" \
  "verifier_user=$verifier_user")"
atomic_write "$verified_file" "$verified_content"
log "Encrypted reset recovery point passed checksum, upload, and disposable database restore verification."
printf '%s\n' "$artifact"
