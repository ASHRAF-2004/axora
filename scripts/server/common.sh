#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

info() { printf '\n[Axora] %s\n' "$*"; }
fail() { printf '\n[Axora] ERROR: %s\n' "$*" >&2; exit 1; }

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

require_server_config() {
  [[ -f .env ]] || fail "Missing .env. Run: cp .env.server.example .env"
  # shellcheck disable=SC1091
  source .env
  [[ -n "${LAN_IP:-}" && "$LAN_IP" != "192.168.1.50" ]] || fail "Set the real reserved LAN_IP in .env."
  [[ -n "${AXORA_HOST:-}" ]] || fail "Set AXORA_HOST in .env (for example axora.internal)."
}

require_secrets() {
  local secret
  for secret in postgres_admin_password axora_app_password session_secret; do
    [[ -s "secrets/$secret" ]] || fail "Missing secrets/$secret. Run: bash scripts/server/prepare-secrets.sh"
  done
}

compose() {
  docker compose "$@"
}

resolve_backup_file() {
  local requested="$1"
  [[ -f "$requested" ]] || fail "Backup file not found: $requested"
  local resolved backup_root
  resolved="$(realpath "$requested")"
  backup_root="$(realpath backups)"
  [[ "$resolved" == "$backup_root"/* ]] || fail "For safety, the backup must be inside $backup_root"
  printf '%s' "$resolved"
}
