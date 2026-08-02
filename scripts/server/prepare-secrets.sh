#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

command -v openssl >/dev/null 2>&1 || { echo "OpenSSL is required." >&2; exit 1; }
install -m 700 -d secrets backups
mkdir -p data/uploads
if [[ "$(id -u)" -eq 0 ]]; then
  chown -R 1001:1001 data/uploads
  chmod 750 data/uploads
else
  sudo chown -R 1001:1001 data/uploads
  sudo chmod 750 data/uploads
fi

# The host secrets directory remains mode 700. Compose file-backed secrets
# need a readable file mode because PostgreSQL drops supplementary groups
# before running its initialization scripts.

create_secret() {
  local name="$1" bytes="$2"
  if [[ -s "secrets/$name" ]]; then
    printf '[Axora] Keeping existing secrets/%s\n' "$name"
    return
  fi
  umask 077
  openssl rand -hex "$bytes" > "secrets/$name"
  chmod 644 "secrets/$name"
  printf '[Axora] Created secrets/%s\n' "$name"
}

create_secret postgres_admin_password 32
create_secret axora_app_password 32
create_secret session_secret 48

printf '\nCore service secrets are ready. No user password was generated.\n'
printf 'Next: copy .env.server.example to .env and set the real LAN IP.\n'
printf 'Bootstrap the first owner only through the one-time invitation command documented in scripts/bootstrap/README.md.\n'
