#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly AXORA_DEFAULT_CONFIG_FILE="/etc/axora-production/deploy.env"
readonly AXORA_CONFIG_FILE="${AXORA_CONFIG_FILE:-$AXORA_DEFAULT_CONFIG_FILE}"
readonly AXORA_BASELINE_RESET_REQUIRED_AUTHORIZATION="I_ACKNOWLEDGE_AXORA_BASELINE_RESET"

log() {
  printf '%s [axora-production] %s\n' "$(date --iso-8601=seconds)" "$*"
}

warn() {
  printf '%s [axora-production] WARNING: %s\n' "$(date --iso-8601=seconds)" "$*" >&2
}

die() {
  printf '%s [axora-production] ERROR: %s\n' "$(date --iso-8601=seconds)" "$*" >&2
  exit 1
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "Run this command as root."
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

assert_safe_root_file() {
  local path="$1"
  local mode owner

  [[ -f "$path" && ! -L "$path" ]] || die "Required regular file is missing: $path"
  owner="$(stat -c '%u' "$path")"
  mode="$(stat -c '%a' "$path")"
  [[ "$owner" == "0" ]] || die "$path must be owned by root."
  (( (8#$mode & 8#022) == 0 )) || die "$path must not be writable by group or other users."
}

assert_private_root_file() {
  local path="$1"
  local minimum_size="${2:-1}"
  local maximum_size="${3:-1048576}"
  local mode owner size

  assert_safe_root_file "$path"
  owner="$(stat -c '%u' "$path")"
  mode="$(stat -c '%a' "$path")"
  size="$(stat -c '%s' "$path")"
  [[ "$owner" == "0" ]] || die "$path must be owned by root."
  (( (8#$mode & 8#077) == 0 )) || die "$path must not be accessible by group or other users."
  [[ "$size" =~ ^[0-9]+$ ]] || die "Unable to determine the size of $path."
  (( size >= minimum_size && size <= maximum_size )) \
    || die "$path has an invalid size."
}

load_config() {
  assert_safe_root_file "$AXORA_CONFIG_FILE"
  # The file is deliberately root-owned and non-writable by other users. It is
  # shell syntax so deployment paths can be configured without editing scripts.
  # shellcheck disable=SC1090
  source "$AXORA_CONFIG_FILE"

  : "${AXORA_REPOSITORY_SSH:=git@github.com:ASHRAF-2004/axora.git}"
  : "${AXORA_MAIN_REF:=refs/heads/main}"
  : "${AXORA_RUNTIME_ROOT:=/srv/axora}"
  : "${AXORA_RUNTIME_ENV_FILE:=/etc/axora-production/runtime.env}"
  : "${AXORA_SECRETS_DIR:=/etc/axora-production/secrets}"
  : "${AXORA_UPLOADS_DIR:=/var/lib/axora-production/uploads}"
  : "${AXORA_STATE_ROOT:=/var/lib/axora-production}"
  : "${AXORA_LOG_ROOT:=/var/log/axora-production}"
  : "${AXORA_BUILD_HOME:=/var/cache/axora-production}"
  : "${AXORA_BUILD_USER:=axora-build}"
  : "${AXORA_DEPLOY_KEY:=/etc/axora-production/github_deploy_key}"
  : "${AXORA_KNOWN_HOSTS:=/etc/axora-production/github_known_hosts}"
  : "${AXORA_COMPOSE_PROJECT:=axora}"
  : "${AXORA_COMPOSE_FILES:=compose.yaml:compose.hybrid.yaml:compose.production.yaml}"
  : "${AXORA_IMAGE_REPOSITORY:=ghcr.io/ashraf-2004/axora}"
  : "${AXORA_REGISTRY_HOST:=ghcr.io}"
  : "${AXORA_REGISTRY_USERNAME:=ASHRAF-2004}"
  : "${AXORA_REGISTRY_TOKEN_FILE:=$AXORA_SECRETS_DIR/ghcr_read_token}"
  : "${AXORA_DATABASE_NAME:=axora_hybrid}"
  : "${AXORA_POSTGRES_IMAGE:=postgres:18.4-alpine3.24@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15}"
  : "${AXORA_BACKEND_NETWORK:=axora_backend}"
  : "${AXORA_PUBLIC_URL:=https://axora.management}"
  : "${AXORA_ORIGIN_BIND:=127.0.0.1}"
  : "${AXORA_ORIGIN_PORT:=8080}"
  : "${AXORA_REQUIRE_EXTERNAL:=true}"
  : "${AXORA_ENABLE_TUNNEL:=true}"
  : "${AXORA_MAIN_PROTECTION_CONFIRMED:=false}"
  : "${AXORA_MIN_FREE_GB:=15}"
  : "${AXORA_MIN_TABLE_COUNT:=15}"
  : "${AXORA_DEPLOY_TIMEOUT_SECONDS:=180}"
  : "${AXORA_REQUIRED_SECRETS:=postgres_admin_password axora_app_password axora_cleanup_worker_password axora_integration_worker_password session_secret tailscale_db_auth_key}"
  : "${AXORA_BACKUP_RETENTION_DAYS:=30}"
  : "${AXORA_RELEASE_RETENTION_COUNT:=5}"
  : "${AXORA_LOG_RETENTION_DAYS:=30}"
  : "${AXORA_OFFSITE_BACKUP_TARGET:=}"
  : "${AXORA_OFFSITE_BACKUP_HOOK:=}"
  : "${AXORA_RESET_DATABASE_ALLOWLIST:=axora_hybrid}"
  : "${AXORA_RESET_BACKUP_PASSPHRASE_FILE:=$AXORA_SECRETS_DIR/reset_backup_passphrase}"
  : "${AXORA_MANAGEMENT_CIDR:=}"
  : "${AXORA_SSH_PORT:=22}"
  : "${AXORA_RETENTION_MODE:=}"

  export AXORA_REPOSITORY_SSH AXORA_MAIN_REF AXORA_RUNTIME_ROOT
  export AXORA_RUNTIME_ENV_FILE AXORA_SECRETS_DIR AXORA_UPLOADS_DIR
  export AXORA_STATE_ROOT AXORA_LOG_ROOT
  export AXORA_BUILD_HOME AXORA_BUILD_USER AXORA_DEPLOY_KEY AXORA_KNOWN_HOSTS
  export AXORA_COMPOSE_PROJECT AXORA_COMPOSE_FILES AXORA_IMAGE_REPOSITORY
  export AXORA_REGISTRY_HOST AXORA_REGISTRY_USERNAME AXORA_REGISTRY_TOKEN_FILE
  export AXORA_DATABASE_NAME AXORA_POSTGRES_IMAGE AXORA_BACKEND_NETWORK
  export AXORA_PUBLIC_URL AXORA_ORIGIN_BIND AXORA_ORIGIN_PORT
  export AXORA_REQUIRE_EXTERNAL AXORA_ENABLE_TUNNEL AXORA_MAIN_PROTECTION_CONFIRMED
  export AXORA_MIN_FREE_GB AXORA_MIN_TABLE_COUNT
  export AXORA_DEPLOY_TIMEOUT_SECONDS AXORA_REQUIRED_SECRETS
  export AXORA_BACKUP_RETENTION_DAYS AXORA_RELEASE_RETENTION_COUNT
  export AXORA_LOG_RETENTION_DAYS AXORA_OFFSITE_BACKUP_TARGET
  export AXORA_OFFSITE_BACKUP_HOOK AXORA_MANAGEMENT_CIDR AXORA_SSH_PORT
  export AXORA_RETENTION_MODE
  export AXORA_RESET_DATABASE_ALLOWLIST AXORA_RESET_BACKUP_PASSPHRASE_FILE

  # These globals are consumed by the installed sibling scripts after sourcing
  # this library, which static per-file analysis cannot observe.
  # shellcheck disable=SC2034
  readonly AXORA_RELEASES_ROOT="$AXORA_STATE_ROOT/releases"
  # shellcheck disable=SC2034
  readonly AXORA_BACKUPS_ROOT="$AXORA_STATE_ROOT/backups"
  # shellcheck disable=SC2034
  readonly AXORA_REPOSITORY_DIR="$AXORA_STATE_ROOT/repository.git"
  # shellcheck disable=SC2034
  readonly AXORA_DEPLOY_LOCK="$AXORA_STATE_ROOT/deploy.lock"
  # shellcheck disable=SC2034
  readonly AXORA_CURRENT_SHA_FILE="$AXORA_STATE_ROOT/current.sha"
  # shellcheck disable=SC2034
  readonly AXORA_CURRENT_IMAGE_FILE="$AXORA_STATE_ROOT/current.image"
  # shellcheck disable=SC2034
  readonly AXORA_CURRENT_IMAGE_ID_FILE="$AXORA_STATE_ROOT/current.image-id"
  # shellcheck disable=SC2034
  readonly AXORA_CURRENT_RELEASE_FILE="$AXORA_STATE_ROOT/current.release"
  # shellcheck disable=SC2034
  readonly AXORA_PREVIOUS_SHA_FILE="$AXORA_STATE_ROOT/previous.sha"
  # shellcheck disable=SC2034
  readonly AXORA_PREVIOUS_IMAGE_FILE="$AXORA_STATE_ROOT/previous.image"
  # shellcheck disable=SC2034
  readonly AXORA_PREVIOUS_IMAGE_ID_FILE="$AXORA_STATE_ROOT/previous.image-id"
  # shellcheck disable=SC2034
  readonly AXORA_PREVIOUS_RELEASE_FILE="$AXORA_STATE_ROOT/previous.release"
  # shellcheck disable=SC2034
  readonly AXORA_LAST_BACKUP_FILE="$AXORA_STATE_ROOT/last-backup.path"
  # shellcheck disable=SC2034
  readonly AXORA_RESET_BACKUPS_ROOT="$AXORA_STATE_ROOT/reset-backups"
  # shellcheck disable=SC2034
  readonly AXORA_RESET_QUARANTINE_ROOT="$AXORA_STATE_ROOT/reset-quarantine"
  # shellcheck disable=SC2034
  readonly AXORA_RESET_AUDIT_ROOT="$AXORA_STATE_ROOT/reset-audit"
  # shellcheck disable=SC2034
  readonly AXORA_LAST_RESET_BACKUP_FILE="$AXORA_STATE_ROOT/last-reset-backup.path"
  # shellcheck disable=SC2034
  readonly AXORA_LAST_RESET_FILE="$AXORA_STATE_ROOT/last-reset.path"
}

valid_sha() {
  [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]]
}

materialize_git_tree() {
  local repository_dir="$1"
  local sha="$2"
  local destination="$3"
  local control_dir="$destination/.axora-deployment-control"
  local index_file="$control_dir/index"
  local expected_tree
  local indexed_tree
  local invalid_entry
  local attributes_path
  local -a isolated_git

  [[ -d "$repository_dir" && ! -L "$repository_dir" ]] \
    || die "Git repository is missing or unsafe: $repository_dir"
  valid_sha "$sha" || die "Invalid release SHA: $sha"
  [[ -d "$destination" && ! -L "$destination" ]] \
    || die "Release staging directory is missing or unsafe: $destination"
  if find "$destination" -mindepth 1 -print -quit | grep -q .; then
    die "Release staging directory must be empty: $destination"
  fi

  invalid_entry="$(
    git --git-dir="$repository_dir" ls-tree -r "$sha^{tree}" \
      | LC_ALL=C awk \
        '$1 != "100644" && $1 != "100755" && !found { print; found = 1 }'
  )"
  [[ -z "$invalid_entry" ]] \
    || die "Release tree contains an unsupported symlink, submodule, or special mode: $invalid_entry"
  attributes_path="$(
    git --git-dir="$repository_dir" ls-tree -r --name-only "$sha^{tree}" \
      | LC_ALL=C awk -F/ '$NF == ".gitattributes" && !found { print; found = 1 }'
  )"
  [[ -z "$attributes_path" ]] \
    || die "Release tree uses unsupported checkout attributes: $attributes_path"
  if git --git-dir="$repository_dir" cat-file -e \
    "$sha:.axora-deployment-control" 2>/dev/null; then
    die "Release tree uses the reserved .axora-deployment-control path."
  fi

  mkdir -m 0700 "$control_dir"
  isolated_git=(
    env
    GIT_CONFIG_NOSYSTEM=1
    GIT_CONFIG_GLOBAL=/dev/null
    GIT_INDEX_FILE="$index_file"
    GIT_WORK_TREE="$destination"
    git
    --git-dir="$repository_dir"
    -c core.autocrlf=false
    -c core.sparseCheckout=false
  )
  "${isolated_git[@]}" read-tree --no-sparse-checkout "$sha^{tree}"
  expected_tree="$("${isolated_git[@]}" rev-parse "$sha^{tree}")"
  indexed_tree="$("${isolated_git[@]}" write-tree)"
  [[ "$indexed_tree" == "$expected_tree" ]] \
    || die "Isolated release index does not match the trusted commit tree."
  "${isolated_git[@]}" checkout-index \
    --all \
    --ignore-skip-worktree-bits
  rm -- "$index_file"
  rmdir -- "$control_dir"
}

valid_database_name() {
  [[ "${1:-}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]
}

database_in_allowlist() {
  local database="$1"
  local allowlist="$2"
  local candidate
  local matched=false
  local -a candidates

  valid_database_name "$database" || return 1
  [[ -n "$allowlist" && "$allowlist" != *$'\n'* && "$allowlist" != *$'\r'* ]] \
    || return 1
  read -r -a candidates <<< "$allowlist"
  (( "${#candidates[@]}" > 0 )) || return 1
  for candidate in "${candidates[@]}"; do
    valid_database_name "$candidate" || return 1
    case "${candidate,,}" in
      postgres|template0|template1) return 1 ;;
    esac
    [[ "$candidate" == "$database" ]] && matched=true
  done
  [[ "$matched" == true ]]
}

require_reset_database_allowed() {
  local database="$1"

  database_in_allowlist "$database" "$AXORA_RESET_DATABASE_ALLOWLIST" \
    || die "Database $database is not in the validated reset allowlist."
}

require_reset_backup_passphrase() {
  local passphrase passphrase_path passphrase_size secrets_root
  local LC_ALL=C

  assert_private_root_file "$AXORA_RESET_BACKUP_PASSPHRASE_FILE" 32 4096
  passphrase_path="$(realpath -- "$AXORA_RESET_BACKUP_PASSPHRASE_FILE")"
  secrets_root="$(realpath -- "$AXORA_SECRETS_DIR")"
  [[ "$passphrase_path" == "$secrets_root"/* ]] \
    || die "Reset-backup passphrase must remain in the root-owned production secrets directory outside Git."
  # read -d '' consumes the complete file up to EOF. Comparing the byte count
  # catches NUL bytes, while the anchored expression rejects newlines and all
  # other whitespace without ever printing the key material.
  IFS= read -r -d '' passphrase < "$passphrase_path" || true
  passphrase_size="$(stat -c '%s' "$passphrase_path")"
  [[ "${#passphrase}" -eq "$passphrase_size" \
    && "$passphrase" =~ ^[A-Za-z0-9_-]{43,4096}$ ]] \
    || die "Reset-backup passphrase must be one generated base64url line without whitespace."
  unset passphrase
}

reset_authorization_is_exact() {
  [[ "${AXORA_BASELINE_RESET_AUTHORIZATION:-}" == "$AXORA_BASELINE_RESET_REQUIRED_AUTHORIZATION" ]]
}

reset_confirmation_phrase() {
  local database="$1"
  local row_count="$2"
  local table_count="$3"
  local sha="$4"

  valid_database_name "$database" || die "Unsafe database in reset confirmation."
  [[ "$row_count" =~ ^[0-9]+$ && "$table_count" =~ ^[0-9]+$ ]] \
    || die "Unsafe counts in reset confirmation."
  valid_sha "$sha" || die "Unsafe release SHA in reset confirmation."
  printf 'RESET %s TO MIGRATION-ONLY BASELINE OMIT %s ROWS ACROSS %s TABLES AT %s' \
    "$database" "$row_count" "$table_count" "$sha"
}

valid_runtime_key() {
  [[ "${1:-}" =~ ^[A-Z][A-Z0-9_]*$ ]]
}

runtime_env_value() {
  local runtime_file="$1"
  local key="$2"
  local -a values

  valid_runtime_key "$key" || die "Unsafe production runtime configuration key."
  [[ -f "$runtime_file" && ! -L "$runtime_file" ]] \
    || die "Production runtime environment file is missing or unsafe: $runtime_file"
  mapfile -t values < <(
    awk -v key="$key" 'index($0, key "=") == 1 { print substr($0, length(key) + 2) }' \
      "$runtime_file"
  )
  (( "${#values[@]}" == 1 )) \
    || die "$runtime_file must contain exactly one $key setting."
  [[ "${values[0]}" != *$'\r'* ]] \
    || die "$runtime_file contains a carriage return in $key."
  printf '%s' "${values[0]}"
}

valid_image_reference() {
  [[ -n "${1:-}" && "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._/:@-]*$ ]]
}

valid_image_id() {
  [[ "${1:-}" =~ ^sha256:[0-9a-f]{64}$ ]]
}

valid_image_digest() {
  valid_image_id "${1:-}"
}

read_state_file() {
  local path="$1"
  if [[ -f "$path" && ! -L "$path" ]]; then
    tr -d '\r\n' < "$path"
  fi
}

atomic_write() {
  local path="$1"
  local value="$2"
  local temporary

  temporary="$(mktemp "${path}.tmp.XXXXXX")"
  printf '%s\n' "$value" > "$temporary"
  chmod 600 "$temporary"
  mv -f -- "$temporary" "$path"
}

release_path_for_sha() {
  local sha="$1"
  valid_sha "$sha" || die "Invalid release SHA: $sha"
  printf '%s/%s' "$AXORA_RELEASES_ROOT" "$sha"
}

current_sealed_release() {
  local sha release expected marker

  sha="$(read_state_file "$AXORA_CURRENT_SHA_FILE")"
  valid_sha "$sha" || die "Current release state contains an invalid commit SHA."
  release="$(read_state_file "$AXORA_CURRENT_RELEASE_FILE")"
  expected="$(release_path_for_sha "$sha")"
  [[ "$release" == "$expected" ]] \
    || die "Current release state does not point to the sealed commit directory."
  [[ -d "$release" && ! -L "$release" ]] \
    || die "Current sealed release directory is missing or unsafe."
  [[ "$(stat -c '%u' "$release")" == "0" ]] \
    || die "Current sealed release must be root-owned."
  if find "$release" -xdev -mindepth 1 ! \( -type f -o -type d \) -print -quit \
    | grep -q .; then
    die "Current sealed release contains a symlink or special file."
  fi
  if find "$release" -xdev -mindepth 1 ! -user root -print -quit | grep -q .; then
    die "Every current sealed release entry must be root-owned."
  fi
  if find "$release" -xdev \( -type f -o -type d \) -perm /022 -print -quit | grep -q .; then
    die "Current sealed release is writable by group or other users."
  fi
  marker="$release/.axora-commit"
  assert_safe_root_file "$marker"
  [[ "$(tr -d '\r\n' < "$marker")" == "$sha" ]] \
    || die "Current sealed release commit marker does not match state."
  printf '%s' "$release"
}

compose_release() {
  local release="$1"
  shift
  local -a command
  local -a files
  local compose_file

  [[ -d "$release" && ! -L "$release" ]] || die "Release directory is missing: $release"
  [[ -f "$AXORA_RUNTIME_ENV_FILE" ]] || die "Runtime environment file is missing: $AXORA_RUNTIME_ENV_FILE"
  : "${AXORA_IMAGE:?AXORA_IMAGE must be set to an immutable image reference}"

  command=(
    docker compose
    --project-name "$AXORA_COMPOSE_PROJECT"
    --project-directory "$release"
    --env-file "$AXORA_RUNTIME_ENV_FILE"
  )
  IFS=':' read -r -a files <<< "$AXORA_COMPOSE_FILES"
  for compose_file in "${files[@]}"; do
    [[ "$compose_file" =~ ^[A-Za-z0-9._/-]+$ ]] || die "Unsafe Compose filename: $compose_file"
    [[ -f "$release/$compose_file" ]] || die "Compose file is missing from release: $compose_file"
    command+=(-f "$release/$compose_file")
  done

  env AXORA_IMAGE="$AXORA_IMAGE" "${command[@]}" "$@"
}

release_has_email_sender() {
  local release="$1"
  local compose_file
  local -a files

  [[ -d "$release" && ! -L "$release" ]] || die "Release directory is missing: $release"
  IFS=':' read -r -a files <<< "$AXORA_COMPOSE_FILES"
  for compose_file in "${files[@]}"; do
    [[ "$compose_file" =~ ^[A-Za-z0-9._/-]+$ ]] || die "Unsafe Compose filename: $compose_file"
    [[ -f "$release/$compose_file" && ! -L "$release/$compose_file" ]] \
      || die "Compose file is missing or unsafe: $compose_file"
    if grep -Eq '^  email-sender:[[:space:]]*(#.*)?$' "$release/$compose_file"; then
      return 0
    fi
  done
  return 1
}

release_has_budget_worker() {
  local release="$1"
  local compose_file
  local -a files

  [[ -d "$release" && ! -L "$release" ]] || die "Release directory is missing: $release"
  IFS=':' read -r -a files <<< "$AXORA_COMPOSE_FILES"
  for compose_file in "${files[@]}"; do
    [[ "$compose_file" =~ ^[A-Za-z0-9._/-]+$ ]] || die "Unsafe Compose filename: $compose_file"
    [[ -f "$release/$compose_file" && ! -L "$release/$compose_file" ]] \
      || die "Compose file is missing or unsafe: $compose_file"
    if grep -Eq '^  budget-worker:[[:space:]]*(#.*)?$' "$release/$compose_file"; then
      return 0
    fi
  done
  return 1
}

release_has_document_worker() {
  local release="$1"
  local compose_file
  local -a files

  [[ -d "$release" && ! -L "$release" ]] || die "Release directory is missing: $release"
  IFS=':' read -r -a files <<< "$AXORA_COMPOSE_FILES"
  for compose_file in "${files[@]}"; do
    [[ "$compose_file" =~ ^[A-Za-z0-9._/-]+$ ]] || die "Unsafe Compose filename: $compose_file"
    [[ -f "$release/$compose_file" && ! -L "$release/$compose_file" ]] \
      || die "Compose file is missing or unsafe: $compose_file"
    if grep -Eq '^  document-worker:[[:space:]]*(#.*)?$' "$release/$compose_file"; then
      return 0
    fi
  done
  return 1
}

release_has_company_deletion_cleanup_worker() {
  local release="$1"
  local compose_file
  local -a files

  [[ -d "$release" && ! -L "$release" ]] || die "Release directory is missing: $release"
  IFS=':' read -r -a files <<< "$AXORA_COMPOSE_FILES"
  for compose_file in "${files[@]}"; do
    [[ "$compose_file" =~ ^[A-Za-z0-9._/-]+$ ]] || die "Unsafe Compose filename: $compose_file"
    [[ -f "$release/$compose_file" && ! -L "$release/$compose_file" ]] \
      || die "Compose file is missing or unsafe: $compose_file"
    if grep -Eq '^  company-deletion-cleanup-worker:[[:space:]]*(#.*)?$' "$release/$compose_file"; then
      return 0
    fi
  done
  return 1
}

release_has_integration_worker() {
  local release="$1"
  local compose_file
  local -a files

  [[ -d "$release" && ! -L "$release" ]] || die "Release directory is missing: $release"
  IFS=':' read -r -a files <<< "$AXORA_COMPOSE_FILES"
  for compose_file in "${files[@]}"; do
    [[ "$compose_file" =~ ^[A-Za-z0-9._/-]+$ ]] || die "Unsafe Compose filename: $compose_file"
    [[ -f "$release/$compose_file" && ! -L "$release/$compose_file" ]] \
      || die "Compose file is missing or unsafe: $compose_file"
    if grep -Eq '^  integration-worker:[[:space:]]*(#.*)?$' "$release/$compose_file"; then
      return 0
    fi
  done
  return 1
}

find_service_container() {
  local service="$1"
  local -a matches

  mapfile -t matches < <(
    docker ps \
      --filter "label=com.docker.compose.project=$AXORA_COMPOSE_PROJECT" \
      --filter "label=com.docker.compose.service=$service" \
      --format '{{.ID}}'
  )
  [[ "${#matches[@]}" -eq 1 ]] || return 1
  printf '%s' "${matches[0]}"
}

# Remove only the explicitly named, ephemeral Compose service container. This
# is used when rolling back to a release that predates the service; it never
# touches volumes or any persistent database/storage service.
remove_ephemeral_email_sender() {
  local -a matches

  mapfile -t matches < <(
    docker ps --all \
      --filter "label=com.docker.compose.project=$AXORA_COMPOSE_PROJECT" \
      --filter "label=com.docker.compose.service=email-sender" \
      --format '{{.ID}}'
  )
  (( "${#matches[@]}" <= 1 )) \
    || die "Expected at most one Axora email-sender container."
  if (( "${#matches[@]}" == 1 )); then
    log "Removing the obsolete ephemeral email-sender container; no volumes are removed."
    docker rm --force "${matches[0]}" >/dev/null
  fi
}

# A Compose invocation cannot remove a service that its release does not
# define. Call this after the chosen release has passed its gates so a failed
# rollback retains the previously working application-path topology.
remove_email_sender_if_release_lacks_it() {
  local release="$1"

  if ! release_has_email_sender "$release"; then
    remove_ephemeral_email_sender
  fi
}

remove_ephemeral_budget_worker() {
  local -a matches

  mapfile -t matches < <(
    docker ps --all \
      --filter "label=com.docker.compose.project=$AXORA_COMPOSE_PROJECT" \
      --filter "label=com.docker.compose.service=budget-worker" \
      --format '{{.ID}}'
  )
  (( "${#matches[@]}" <= 1 )) \
    || die "Expected at most one Axora budget-worker container."
  if (( "${#matches[@]}" == 1 )); then
    log "Removing the obsolete ephemeral budget-worker container; no volumes are removed."
    docker rm --force "${matches[0]}" >/dev/null
  fi
}

remove_budget_worker_if_release_lacks_it() {
  local release="$1"

  if ! release_has_budget_worker "$release"; then
    remove_ephemeral_budget_worker
  fi
}

remove_ephemeral_document_worker() {
  local -a matches

  mapfile -t matches < <(
    docker ps --all \
      --filter "label=com.docker.compose.project=$AXORA_COMPOSE_PROJECT" \
      --filter "label=com.docker.compose.service=document-worker" \
      --format '{{.ID}}'
  )
  (( "${#matches[@]}" <= 1 )) \
    || die "Expected at most one Axora document-worker container."
  if (( "${#matches[@]}" == 1 )); then
    log "Removing the obsolete ephemeral document-worker container; no volumes are removed."
    docker rm --force "${matches[0]}" >/dev/null
  fi
}

remove_document_worker_if_release_lacks_it() {
  local release="$1"

  if ! release_has_document_worker "$release"; then
    remove_ephemeral_document_worker
  fi
}

remove_ephemeral_company_deletion_cleanup_worker() {
  local -a matches

  mapfile -t matches < <(
    docker ps --all \
      --filter "label=com.docker.compose.project=$AXORA_COMPOSE_PROJECT" \
      --filter "label=com.docker.compose.service=company-deletion-cleanup-worker" \
      --format '{{.ID}}'
  )
  (( "${#matches[@]}" <= 1 )) \
    || die "Expected at most one Axora company-deletion-cleanup-worker container."
  if (( "${#matches[@]}" == 1 )); then
    log "Removing the obsolete ephemeral company-deletion-cleanup-worker container; no volumes are removed."
    docker rm --force "${matches[0]}" >/dev/null
  fi
}

remove_company_deletion_cleanup_worker_if_release_lacks_it() {
  local release="$1"
  if ! release_has_company_deletion_cleanup_worker "$release"; then
    remove_ephemeral_company_deletion_cleanup_worker
  fi
}

remove_ephemeral_integration_worker() {
  local -a matches

  mapfile -t matches < <(
    docker ps --all \
      --filter "label=com.docker.compose.project=$AXORA_COMPOSE_PROJECT" \
      --filter "label=com.docker.compose.service=integration-worker" \
      --format '{{.ID}}'
  )
  (( "${#matches[@]}" <= 1 )) \
    || die "Expected at most one Axora integration-worker container."
  if (( "${#matches[@]}" == 1 )); then
    log "Removing the obsolete ephemeral integration worker; no volumes are removed."
    docker rm --force "${matches[0]}" >/dev/null
  fi
}

remove_integration_worker_if_release_lacks_it() {
  local release="$1"
  if ! release_has_integration_worker "$release"; then
    remove_ephemeral_integration_worker
  fi
}

github_ssh_command() {
  printf 'ssh -i %q -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=%q' \
    "$AXORA_DEPLOY_KEY" "$AXORA_KNOWN_HOSTS"
}

remote_main_sha() {
  local output sha ref

  output="$(
    GIT_SSH_COMMAND="$(github_ssh_command)" \
      git ls-remote --exit-code "$AXORA_REPOSITORY_SSH" "$AXORA_MAIN_REF"
  )" || die "Unable to read the trusted main ref from GitHub."
  [[ "$(printf '%s\n' "$output" | wc -l)" -eq 1 ]] || die "GitHub returned an unexpected main-ref response."
  read -r sha ref <<< "$output"
  valid_sha "$sha" || die "GitHub returned an invalid commit SHA."
  [[ "$ref" == "$AXORA_MAIN_REF" ]] || die "GitHub returned the wrong ref: $ref"
  printf '%s' "$sha"
}

bool_is_true() {
  case "${1,,}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}
