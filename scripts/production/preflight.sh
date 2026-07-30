#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
load_config

check_mode=full
case "${1:-}" in
  "") ;;
  --local-only) check_mode=local ;;
  --for-automation) check_mode=automation ;;
  *) die "Usage: $0 [--local-only|--for-automation]" ;;
esac

for command in \
  awk bash curl docker env find flock git grep jq mkdir node npm realpath rm \
  rmdir runuser sha256sum sort stat tar tr wc; do
  require_command "$command"
done

valid_database_name "$AXORA_DATABASE_NAME" || die "Unsafe database name: $AXORA_DATABASE_NAME"
[[ "$AXORA_MAIN_REF" == "refs/heads/main" ]] || die "Only refs/heads/main may trigger production deployments."
[[ "$AXORA_PUBLIC_URL" == "https://axora.management" ]] \
  || die "AXORA_PUBLIC_URL must be exactly https://axora.management"
[[ "$AXORA_ORIGIN_BIND" == "127.0.0.1" || "$AXORA_ORIGIN_BIND" == "::1" ]] \
  || die "AXORA_ORIGIN_BIND must be loopback (127.0.0.1 or ::1)."
if [[ ! "$AXORA_ORIGIN_PORT" =~ ^[0-9]+$ ]] \
  || (( AXORA_ORIGIN_PORT < 1024 || AXORA_ORIGIN_PORT > 65535 )); then
  die "AXORA_ORIGIN_PORT must be an unprivileged TCP port."
fi
[[ "$AXORA_MIN_FREE_GB" =~ ^[0-9]+$ ]] || die "AXORA_MIN_FREE_GB must be a whole number."
[[ "$AXORA_MIN_TABLE_COUNT" =~ ^[0-9]+$ ]] || die "AXORA_MIN_TABLE_COUNT must be a whole number."
[[ "$AXORA_BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] || die "AXORA_BACKUP_RETENTION_DAYS must be a whole number."
if [[ ! "$AXORA_RELEASE_RETENTION_COUNT" =~ ^[0-9]+$ ]] \
  || (( AXORA_RELEASE_RETENTION_COUNT < 2 )); then
  die "AXORA_RELEASE_RETENTION_COUNT must be at least 2."
fi
[[ "$AXORA_LOG_RETENTION_DAYS" =~ ^[0-9]+$ ]] || die "AXORA_LOG_RETENTION_DAYS must be a whole number."
if [[ ! "$AXORA_DEPLOY_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] \
  || (( AXORA_DEPLOY_TIMEOUT_SECONDS < 30 )); then
  die "AXORA_DEPLOY_TIMEOUT_SECONDS must be at least 30."
fi

[[ -d "$AXORA_RUNTIME_ROOT" && ! -L "$AXORA_RUNTIME_ROOT" ]] \
  || die "Runtime root is missing or is a symlink: $AXORA_RUNTIME_ROOT"
[[ -d "$AXORA_SECRETS_DIR" && ! -L "$AXORA_SECRETS_DIR" ]] \
  || die "Stable production secrets directory is missing or is a symlink."
[[ -d "$AXORA_UPLOADS_DIR" && ! -L "$AXORA_UPLOADS_DIR" ]] \
  || die "Stable persistent uploads directory is missing or is a symlink."
[[ -d "$AXORA_STATE_ROOT" && ! -L "$AXORA_STATE_ROOT" ]] \
  || die "Deployment state root is missing or is a symlink."
[[ -d "$AXORA_RELEASES_ROOT" && ! -L "$AXORA_RELEASES_ROOT" ]] \
  || die "Release root is missing or is a symlink."
[[ -d "$AXORA_BUILD_HOME" && ! -L "$AXORA_BUILD_HOME" ]] \
  || die "Build staging root is missing or is a symlink."
id "$AXORA_BUILD_USER" >/dev/null 2>&1 || die "Unprivileged build user is missing: $AXORA_BUILD_USER"
build_primary_gid="$(id -g "$AXORA_BUILD_USER")"
build_group_count="$(id -G "$AXORA_BUILD_USER" | tr ' ' '\n' | LC_ALL=C sort -u | wc -l)"
[[ "$build_group_count" -eq 1 ]] \
  || die "$AXORA_BUILD_USER must not belong to supplementary groups."
[[ "$(id -G "$AXORA_BUILD_USER")" == "$build_primary_gid" ]] \
  || die "$AXORA_BUILD_USER has an unexpected primary group."
[[ "$(stat -c '%U:%G' "$AXORA_BUILD_HOME")" == "$AXORA_BUILD_USER:$AXORA_BUILD_USER" ]] \
  || die "$AXORA_BUILD_HOME must be owned by the unprivileged build user."
controller_home="$AXORA_STATE_ROOT/controller-home"
for controller_path in "$controller_home" "$controller_home/docker" "$controller_home/buildx"; do
  [[ -d "$controller_path" && ! -L "$controller_path" ]] \
    || die "Controller directory is missing or unsafe: $controller_path"
  [[ "$(stat -c '%u:%g' "$controller_path")" == "0:0" ]] \
    || die "Controller directory must be owned by root:root: $controller_path"
  [[ "$(stat -c '%a' "$controller_path")" == "700" ]] \
    || die "Controller directory must have mode 0700: $controller_path"
done
[[ "$(stat -c '%u:%g' "$AXORA_SECRETS_DIR")" == "0:1000" ]] \
  || die "$AXORA_SECRETS_DIR must be owned by root:GID-1000."
[[ "$(stat -c '%u:%g' "$AXORA_UPLOADS_DIR")" == "0:1000" ]] \
  || die "$AXORA_UPLOADS_DIR must be owned by root:GID-1000."

assert_safe_root_file "$AXORA_RUNTIME_ENV_FILE"
grep -Eq '^AXORA_HOST=axora\.management$' "$AXORA_RUNTIME_ENV_FILE" \
  || die "$AXORA_RUNTIME_ENV_FILE must set AXORA_HOST=axora.management"
grep -Eq '^LAN_IP=127\.0\.0\.1$' "$AXORA_RUNTIME_ENV_FILE" \
  || die "$AXORA_RUNTIME_ENV_FILE must use loopback LAN_IP for safe base-Compose interpolation."
grep -Eq '^AXORA_ORIGIN_BIND=(127\.0\.0\.1|::1)$' "$AXORA_RUNTIME_ENV_FILE" \
  || die "$AXORA_RUNTIME_ENV_FILE must use a loopback AXORA_ORIGIN_BIND."
grep -Eq '^AXORA_HYBRID_DB_NAME=axora_hybrid$' "$AXORA_RUNTIME_ENV_FILE" \
  || die "$AXORA_RUNTIME_ENV_FILE must set AXORA_HYBRID_DB_NAME=axora_hybrid"
grep -Fqx "AXORA_SECRETS_DIR=$AXORA_SECRETS_DIR" "$AXORA_RUNTIME_ENV_FILE" \
  || die "$AXORA_RUNTIME_ENV_FILE must set the canonical AXORA_SECRETS_DIR."
grep -Fqx "AXORA_UPLOADS_DIR=$AXORA_UPLOADS_DIR" "$AXORA_RUNTIME_ENV_FILE" \
  || die "$AXORA_RUNTIME_ENV_FILE must set the canonical AXORA_UPLOADS_DIR."

for secret in $AXORA_REQUIRED_SECRETS; do
  [[ "$secret" =~ ^[A-Za-z0-9_-]+$ ]] || die "Unsafe secret filename in AXORA_REQUIRED_SECRETS."
  secret_path="$AXORA_SECRETS_DIR/$secret"
  [[ -f "$secret_path" && ! -L "$secret_path" && -s "$secret_path" ]] \
    || die "Required production secret is missing or empty: $secret_path"
  secret_mode="$(stat -c '%a' "$secret_path")"
  [[ "$(stat -c '%u:%g' "$secret_path")" == "0:1000" ]] \
    || die "Stable secret must be owned by root:GID-1000: $secret_path"
  (( (8#$secret_mode & 8#007) == 0 )) || die "Secret is accessible by other users: $secret_path"
  (( (8#$secret_mode & 8#022) == 0 )) || die "Secret is writable by group or other users: $secret_path"
done
if bool_is_true "$AXORA_ENABLE_TUNNEL"; then
  secret_path="$AXORA_SECRETS_DIR/cloudflare_tunnel_token"
  [[ -f "$secret_path" && ! -L "$secret_path" && -s "$secret_path" ]] \
    || die "Tunnel is enabled but its token is missing: $secret_path"
  secret_mode="$(stat -c '%a' "$secret_path")"
  [[ "$(stat -c '%u:%g' "$secret_path")" == "0:1000" ]] \
    || die "Cloudflare tunnel token must be owned by root:GID-1000."
  (( (8#$secret_mode & 8#027) == 0 )) || die "Cloudflare tunnel token permissions are too broad."
fi

runtime_mode="$(stat -c '%a' "$AXORA_RUNTIME_ROOT")"
(( (8#$runtime_mode & 8#022) == 0 )) || die "$AXORA_RUNTIME_ROOT must not be group/world-writable."
uploads_mode="$(stat -c '%a' "$AXORA_UPLOADS_DIR")"
(( (8#$uploads_mode & 8#007) == 0 )) || die "$AXORA_UPLOADS_DIR must not be accessible by other users."

docker info >/dev/null 2>&1 || die "Docker is unavailable."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is unavailable."

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
[[ "$node_major" == "24" ]] || die "Node.js 24 is required; found $(node --version)."
npm_major="$(npm --version | cut -d. -f1)"
[[ "$npm_major" =~ ^[0-9]+$ ]] || die "Unable to identify npm version."

available_kb="$(df -Pk "$AXORA_STATE_ROOT" | awk 'NR==2 {print $4}')"
required_kb=$(( AXORA_MIN_FREE_GB * 1024 * 1024 ))
(( available_kb >= required_kb )) \
  || die "Less than ${AXORA_MIN_FREE_GB} GiB is free on the deployment filesystem."
[[ "$(stat -c '%d' "$AXORA_BUILD_HOME")" == "$(stat -c '%d' "$AXORA_RELEASES_ROOT")" ]] \
  || die "Build staging and release storage must share a filesystem for atomic promotion."

if [[ "$check_mode" != "local" ]]; then
  assert_safe_root_file "$AXORA_DEPLOY_KEY"
  assert_safe_root_file "$AXORA_KNOWN_HOSTS"
  key_mode="$(stat -c '%a' "$AXORA_DEPLOY_KEY")"
  (( (8#$key_mode & 8#077) == 0 )) || die "GitHub deploy key must have mode 0600 or stricter."
  remote_sha="$(remote_main_sha)"
  log "Trusted GitHub main is reachable at commit $remote_sha."
fi

if [[ "$check_mode" == "automation" ]]; then
  bool_is_true "$AXORA_MAIN_PROTECTION_CONFIRMED" \
    || die "Automatic deployment cannot be enabled until protected main is independently verified."
  bool_is_true "$AXORA_REQUIRE_EXTERNAL" \
    || die "Automatic deployment cannot be enabled while AXORA_REQUIRE_EXTERNAL=false."
  bool_is_true "$AXORA_ENABLE_TUNNEL" \
    || die "Automatic deployment cannot be enabled while AXORA_ENABLE_TUNNEL=false."
fi

if db_container="$(find_service_container db)"; then
  published_ports="$(docker inspect --format '{{json .NetworkSettings.Ports}}' "$db_container")"
  if grep -Eq '"HostIp"|"HostPort"' <<< "$published_ports"; then
    die "PostgreSQL has a published host port; production database must remain private."
  fi
  db_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$db_container")"
  [[ "$db_health" == "healthy" ]] || die "PostgreSQL container is not healthy (status: $db_health)."
fi

log "Production preflight passed."
