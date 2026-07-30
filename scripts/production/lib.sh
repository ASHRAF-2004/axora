#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly AXORA_DEFAULT_CONFIG_FILE="/etc/axora-production/deploy.env"
readonly AXORA_CONFIG_FILE="${AXORA_CONFIG_FILE:-$AXORA_DEFAULT_CONFIG_FILE}"

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
  : "${AXORA_IMAGE_REPOSITORY:=axora-app}"
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
  : "${AXORA_REQUIRED_SECRETS:=postgres_admin_password axora_app_password session_secret tailscale_db_auth_key}"
  : "${AXORA_BACKUP_RETENTION_DAYS:=30}"
  : "${AXORA_RELEASE_RETENTION_COUNT:=5}"
  : "${AXORA_LOG_RETENTION_DAYS:=30}"
  : "${AXORA_OFFSITE_BACKUP_TARGET:=}"
  : "${AXORA_OFFSITE_BACKUP_HOOK:=}"
  : "${AXORA_MANAGEMENT_CIDR:=}"
  : "${AXORA_SSH_PORT:=22}"

  export AXORA_REPOSITORY_SSH AXORA_MAIN_REF AXORA_RUNTIME_ROOT
  export AXORA_RUNTIME_ENV_FILE AXORA_SECRETS_DIR AXORA_UPLOADS_DIR
  export AXORA_STATE_ROOT AXORA_LOG_ROOT
  export AXORA_BUILD_HOME AXORA_BUILD_USER AXORA_DEPLOY_KEY AXORA_KNOWN_HOSTS
  export AXORA_COMPOSE_PROJECT AXORA_COMPOSE_FILES AXORA_IMAGE_REPOSITORY
  export AXORA_DATABASE_NAME AXORA_POSTGRES_IMAGE AXORA_BACKEND_NETWORK
  export AXORA_PUBLIC_URL AXORA_ORIGIN_BIND AXORA_ORIGIN_PORT
  export AXORA_REQUIRE_EXTERNAL AXORA_ENABLE_TUNNEL AXORA_MAIN_PROTECTION_CONFIRMED
  export AXORA_MIN_FREE_GB AXORA_MIN_TABLE_COUNT
  export AXORA_DEPLOY_TIMEOUT_SECONDS AXORA_REQUIRED_SECRETS
  export AXORA_BACKUP_RETENTION_DAYS AXORA_RELEASE_RETENTION_COUNT
  export AXORA_LOG_RETENTION_DAYS AXORA_OFFSITE_BACKUP_TARGET
  export AXORA_OFFSITE_BACKUP_HOOK AXORA_MANAGEMENT_CIDR AXORA_SSH_PORT

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
}

valid_sha() {
  [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]]
}

valid_database_name() {
  [[ "${1:-}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]
}

valid_image_reference() {
  [[ -n "${1:-}" && "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._/:@-]*$ ]]
}

valid_image_id() {
  [[ "${1:-}" =~ ^sha256:[0-9a-f]{64}$ ]]
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
