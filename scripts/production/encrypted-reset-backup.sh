#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
load_config

for command in awk basename date docker find flock gpg grep install mktemp realpath rm sha256sum stat tail tar tee tr; do
  require_command "$command"
done
require_reset_database_allowed "$AXORA_DATABASE_NAME"
require_reset_backup_passphrase
[[ "$AXORA_MIN_TABLE_COUNT" =~ ^[0-9]+$ && "$AXORA_MIN_TABLE_COUNT" -ge 1 ]] \
  || die "AXORA_MIN_TABLE_COUNT must be a positive whole number."

purpose="manual-guarded-backup"
case "${1:-}" in
  "") ;;
  --purpose)
    purpose="${2:-}"
    [[ "$purpose" == "manual-guarded-backup" || "$purpose" == "baseline-reset" ]] \
      || die "Purpose must be manual-guarded-backup or baseline-reset."
    [[ -z "${3:-}" ]] || die "Usage: $0 [--purpose manual-guarded-backup|baseline-reset]"
    ;;
  *) die "Usage: $0 [--purpose manual-guarded-backup|baseline-reset]" ;;
esac

install -d -o root -g root -m 0700 \
  "$AXORA_STATE_ROOT" "$AXORA_BACKUPS_ROOT" "$AXORA_RESET_BACKUPS_ROOT" "$AXORA_RESET_AUDIT_ROOT"
if ! bool_is_true "${AXORA_DEPLOY_LOCK_HELD:-false}"; then
  exec 9>"$AXORA_DEPLOY_LOCK"
  flock --exclusive --timeout 600 9 \
    || die "A deployment, backup, reset, or verification is still running after ten minutes."
  export AXORA_DEPLOY_LOCK_HELD=true
fi

current_sha="$(read_state_file "$AXORA_CURRENT_SHA_FILE")"
valid_sha "$current_sha" || die "Current release state contains an invalid commit SHA."
sealed_release="$(current_sealed_release)"
[[ "$sealed_release" == "$(release_path_for_sha "$current_sha")" ]] \
  || die "Encrypted reset backup must use the current sealed release."

db_container="$(find_service_container db)" \
  || die "Expected exactly one running Axora PostgreSQL container."
db_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$db_container")"
[[ "$db_health" == "healthy" ]] \
  || die "PostgreSQL is not healthy; refusing an encrypted reset backup."

initiator_uid="${SUDO_UID:-0}"
initiator_user="${SUDO_USER:-root}"
[[ "$initiator_uid" =~ ^[0-9]+$ ]] || initiator_uid=0
[[ "$initiator_user" =~ ^[A-Za-z_][A-Za-z0-9_.-]{0,63}$ ]] || initiator_user=unknown

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
artifact="$AXORA_RESET_BACKUPS_ROOT/axora-reset-${stamp}-${current_sha:0:12}.tar.gpg"
outer_manifest="${artifact%.tar.gpg}.manifest"
verified_file="${artifact%.tar.gpg}.verified"
[[ ! -e "$artifact" && ! -e "$outer_manifest" && ! -e "$verified_file" ]] \
  || die "Encrypted reset backup destination already exists for this timestamp."
partial_artifact="$(mktemp "$AXORA_RESET_BACKUPS_ROOT/.encrypted-${stamp}.XXXXXX")"
partial_manifest="$(mktemp "$AXORA_RESET_BACKUPS_ROOT/.manifest-${stamp}.XXXXXX")"
backup_output="$(mktemp "$AXORA_RESET_BACKUPS_ROOT/.backup-output-${stamp}.XXXXXX")"
gpg_home="$(mktemp -d "$AXORA_RESET_BACKUPS_ROOT/.gnupg-${stamp}.XXXXXX")"
chmod 0700 "$gpg_home"
# GPG refuses to replace an existing output file. The randomized path remains
# inside the root-only directory, but the placeholder itself must not exist.
rm -f -- "$partial_artifact"

cleanup() {
  rm -f -- "${partial_artifact:-}" "${partial_manifest:-}" "${backup_output:-}"
  if [[ -n "${gpg_home:-}" && -d "$gpg_home" \
    && "$gpg_home" == "$AXORA_RESET_BACKUPS_ROOT"/.gnupg-* ]]; then
    rm -rf -- "$gpg_home"
  fi
}
trap cleanup EXIT

log "Creating the final verified database and upload backup used by the encrypted recovery point."
AXORA_OFFSITE_BACKUP_TARGET= \
AXORA_OFFSITE_BACKUP_HOOK= \
AXORA_DEPLOY_LOCK_HELD=true \
  "$SCRIPT_DIR/backup.sh" --commit "$current_sha" | tee "$backup_output"
backup_dir="$(tail -n 1 "$backup_output")"
[[ -d "$backup_dir" && ! -L "$backup_dir" ]] \
  || die "The standard backup did not return a safe backup directory."
resolved_backup="$(realpath -- "$backup_dir")"
resolved_backups_root="$(realpath -- "$AXORA_BACKUPS_ROOT")"
[[ "$resolved_backup" == "$resolved_backups_root"/axora-[0-9]* ]] \
  || die "The standard backup returned a path outside the production backup root."
backup_name="$(basename -- "$resolved_backup")"
[[ "$backup_name" =~ ^axora-[0-9]{8}T[0-9]{6}Z$ ]] \
  || die "The standard backup returned an invalid backup directory name."
assert_private_root_file "$resolved_backup/manifest.txt" 1 1048576
assert_private_root_file "$resolved_backup/checksums.sha256" 1 1048576
(cd "$resolved_backup" && sha256sum --check checksums.sha256 >/dev/null) \
  || die "The standard backup failed its checksum verification before encryption."

log "Encrypting the verified recovery point with GPG AES256."
if ! tar \
  --create \
  --format=posix \
  --directory "$resolved_backups_root" \
  "$backup_name" \
  | GNUPGHOME="$gpg_home" gpg \
      --batch \
      --quiet \
      --no-tty \
      --pinentry-mode loopback \
      --passphrase-file "$AXORA_RESET_BACKUP_PASSPHRASE_FILE" \
      --symmetric \
      --cipher-algo AES256 \
      --force-mdc \
      --compress-algo none \
      --output "$partial_artifact"; then
  die "GPG encryption of the reset recovery point failed."
fi
chmod 0600 "$partial_artifact"
ciphertext_sha="$(sha256sum "$partial_artifact" | awk '{print $1}')"
source_manifest_sha="$(sha256sum "$resolved_backup/manifest.txt" | awk '{print $1}')"
{
  printf 'format=axora-encrypted-reset-backup-v1\n'
  printf 'created_utc=%s\n' "$(date -u --iso-8601=seconds)"
  printf 'database=%s\n' "$AXORA_DATABASE_NAME"
  printf 'commit=%s\n' "$current_sha"
  printf 'purpose=%s\n' "$purpose"
  printf 'initiator_uid=%s\n' "$initiator_uid"
  printf 'initiator_user=%s\n' "$initiator_user"
  printf 'source_backup=%s\n' "$backup_name"
  printf 'source_manifest_sha256=%s\n' "$source_manifest_sha"
  printf 'ciphertext_sha256=%s\n' "$ciphertext_sha"
  printf 'credentials_included=no\n'
} > "$partial_manifest"
chmod 0600 "$partial_manifest"

mv -- "$partial_artifact" "$artifact"
partial_artifact=""
mv -- "$partial_manifest" "$outer_manifest"
partial_manifest=""

log "Decrypting and restoring the encrypted recovery point for independent verification."
AXORA_DEPLOY_LOCK_HELD=true \
  "$SCRIPT_DIR/verify-encrypted-backup.sh" --artifact "$artifact" >/dev/null
assert_private_root_file "$verified_file" 1 1048576
atomic_write "$AXORA_LAST_RESET_BACKUP_FILE" "$artifact"

log "Encrypted reset recovery point completed and verified: $artifact"
printf '%s\n' "$artifact"
