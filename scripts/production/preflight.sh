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
  awk bash curl cut df docker env find flock git grep id jq mkdir node npm realpath rm \
  rmdir runuser sed sha256sum sort stat tar tr wc; do
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

email_delivery_enabled="$(runtime_env_value "$AXORA_RUNTIME_ENV_FILE" AXORA_EMAIL_DELIVERY_ENABLED)"
email_events_enabled="$(runtime_env_value "$AXORA_RUNTIME_ENV_FILE" AXORA_EMAIL_EVENTS_ENABLED)"
zeptomail_webhook_bootstrap_enabled="$(runtime_env_value "$AXORA_RUNTIME_ENV_FILE" ZEPTOMAIL_WEBHOOK_BOOTSTRAP_ENABLED)"
cloudflare_account_id="$(runtime_env_value "$AXORA_RUNTIME_ENV_FILE" CLOUDFLARE_ACCOUNT_ID)"
cloudflare_zone_id="$(runtime_env_value "$AXORA_RUNTIME_ENV_FILE" CLOUDFLARE_ZONE_ID)"
email_from_address="$(runtime_env_value "$AXORA_RUNTIME_ENV_FILE" AXORA_EMAIL_FROM_ADDRESS)"
email_from_name="$(runtime_env_value "$AXORA_RUNTIME_ENV_FILE" AXORA_EMAIL_FROM_NAME)"
email_reply_to="$(runtime_env_value "$AXORA_RUNTIME_ENV_FILE" AXORA_EMAIL_REPLY_TO)"
email_provider="$(runtime_env_value "$AXORA_RUNTIME_ENV_FILE" AXORA_EMAIL_PROVIDER)"
account_setup_ttl="$(runtime_env_value "$AXORA_RUNTIME_ENV_FILE" ACCOUNT_SETUP_TTL_HOURS)"
turnstile_site_key="$(runtime_env_value "$AXORA_RUNTIME_ENV_FILE" TURNSTILE_SITE_KEY)"
turnstile_hostnames="$(runtime_env_value "$AXORA_RUNTIME_ENV_FILE" TURNSTILE_HOSTNAMES)"
turnstile_expected_hostname="$(runtime_env_value "$AXORA_RUNTIME_ENV_FILE" AXORA_TURNSTILE_EXPECTED_HOSTNAME)"

[[ "$email_delivery_enabled" == "true" || "$email_delivery_enabled" == "false" ]] \
  || die "AXORA_EMAIL_DELIVERY_ENABLED must be exactly true or false."
[[ "$email_events_enabled" == "true" || "$email_events_enabled" == "false" ]] \
  || die "AXORA_EMAIL_EVENTS_ENABLED must be exactly true or false."
[[ "$zeptomail_webhook_bootstrap_enabled" == "true" || "$zeptomail_webhook_bootstrap_enabled" == "false" ]] \
  || die "ZEPTOMAIL_WEBHOOK_BOOTSTRAP_ENABLED must be exactly true or false."
if [[ "$email_delivery_enabled" == "true" && "$email_events_enabled" != "true" ]]; then
  die "Email delivery requires the Email Sending event consumer and suppression endpoint."
fi
if [[ "$email_events_enabled" == "true" && "$email_delivery_enabled" != "true" \
  && "$email_provider" != "zeptomail" ]]; then
  die "Email provider events cannot be enabled while email delivery is disabled."
fi
if [[ "$zeptomail_webhook_bootstrap_enabled" == "true" ]]; then
  [[ "$email_provider" == "zeptomail" ]] \
    || die "Webhook bootstrap is available only for ZeptoMail."
  [[ "$email_delivery_enabled" == "false" && "$email_events_enabled" == "false" ]] \
    || die "ZeptoMail webhook bootstrap requires delivery and provider events to remain disabled."
fi
if [[ -n "$cloudflare_account_id" && ! "$cloudflare_account_id" =~ ^[A-Fa-f0-9]{32}$ ]]; then
  die "CLOUDFLARE_ACCOUNT_ID must be empty or a 32-character Cloudflare identifier."
fi
if [[ -n "$cloudflare_zone_id" && ! "$cloudflare_zone_id" =~ ^[A-Fa-f0-9]{32}$ ]]; then
  die "CLOUDFLARE_ZONE_ID must be empty or a 32-character Cloudflare identifier."
fi
[[ "$email_from_address" =~ ^[^[:space:]@]+@([A-Za-z0-9-]+\.)*axora\.management$ ]] \
  || die "AXORA_EMAIL_FROM_ADDRESS must use axora.management or one of its subdomains."
[[ -n "$email_from_name" && "${#email_from_name}" -le 100 && ! "$email_from_name" =~ [[:cntrl:]] ]] \
  || die "AXORA_EMAIL_FROM_NAME must be a non-empty, single-line value of at most 100 characters."
[[ "$email_reply_to" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] \
  || die "AXORA_EMAIL_REPLY_TO must be a valid email address."
[[ "$email_provider" == "cloudflare-email-service" || "$email_provider" == "zeptomail" ]] \
  || die "AXORA_EMAIL_PROVIDER must be cloudflare-email-service or zeptomail."
if [[ "$email_provider" == "zeptomail" ]]; then
  "$SCRIPT_DIR/check-email-service.mjs" \
    --runtime-file "$AXORA_RUNTIME_ENV_FILE" \
    --configuration-only
fi
if [[ ! "$account_setup_ttl" =~ ^[0-9]+$ ]] \
  || (( account_setup_ttl < 1 || account_setup_ttl > 168 )); then
  die "ACCOUNT_SETUP_TTL_HOURS must be a whole number from 1 to 168."
fi

[[ "$turnstile_expected_hostname" == "axora.management" ]] \
  || die "AXORA_TURNSTILE_EXPECTED_HOSTNAME must be exactly axora.management."
[[ ",$turnstile_hostnames," == *,axora.management,* ]] \
  || die "TURNSTILE_HOSTNAMES must include axora.management."
if [[ -n "$turnstile_site_key" && ! "$turnstile_site_key" =~ ^[A-Za-z0-9_-]{10,200}$ ]]; then
  die "TURNSTILE_SITE_KEY is malformed."
fi

turnstile_secret_path="$AXORA_SECRETS_DIR/turnstile_secret"
[[ -f "$turnstile_secret_path" && ! -L "$turnstile_secret_path" ]] \
  || die "Turnstile secret placeholder is missing or unsafe."
turnstile_secret_mode="$(stat -c '%a' "$turnstile_secret_path")"
[[ "$(stat -c '%u:%g' "$turnstile_secret_path")" == "0:1000" ]] \
  || die "Turnstile secret must be owned by root:GID-1000."
(( (8#$turnstile_secret_mode & 8#027) == 0 )) \
  || die "Turnstile secret permissions are too broad."
if [[ -n "$turnstile_site_key" ]]; then
  [[ -s "$turnstile_secret_path" ]] \
    || die "Contact verification is configured but the dedicated Turnstile secret is empty."
  node -e '
    const fs=require("node:fs");
    const value=fs.readFileSync(process.argv[1],"utf8").trim();
    if(value.length<10 || value.length>2048 || /[\s\x00-\x1f\x7f]/.test(value)) process.exit(1);
  ' "$turnstile_secret_path" \
    || die "The dedicated Turnstile secret is malformed."
fi

email_token_path="$AXORA_SECRETS_DIR/cloudflare_email_api_token"
[[ -f "$email_token_path" && ! -L "$email_token_path" ]] \
  || die "Cloudflare email token placeholder is missing or unsafe."
email_token_mode="$(stat -c '%a' "$email_token_path")"
[[ "$(stat -c '%u:%g' "$email_token_path")" == "0:1000" ]] \
  || die "Cloudflare email token must be owned by root:GID-1000."
(( (8#$email_token_mode & 8#027) == 0 )) \
  || die "Cloudflare email token permissions are too broad."

for zeptomail_token_name in zeptomail_send_token zeptomail_send_token_next; do
  zeptomail_token_path="$AXORA_SECRETS_DIR/$zeptomail_token_name"
  [[ -f "$zeptomail_token_path" && ! -L "$zeptomail_token_path" ]] \
    || die "ZeptoMail token placeholder is missing or unsafe: $zeptomail_token_name"
  zeptomail_token_mode="$(stat -c '%a' "$zeptomail_token_path")"
  [[ "$(stat -c '%u:%g' "$zeptomail_token_path")" == "0:1000" ]] \
    || die "ZeptoMail token must be owned by root:GID-1000: $zeptomail_token_name"
  (( (8#$zeptomail_token_mode & 8#027) == 0 )) \
    || die "ZeptoMail token permissions are too broad: $zeptomail_token_name"
done

if [[ "$email_delivery_enabled" == "true" ]]; then
  if [[ "$email_provider" == "cloudflare-email-service" ]]; then
    [[ -n "$cloudflare_account_id" ]] \
      || die "Cloudflare email delivery requires CLOUDFLARE_ACCOUNT_ID."
    [[ -n "$cloudflare_zone_id" ]] \
      || die "Cloudflare email delivery requires CLOUDFLARE_ZONE_ID."
    [[ -s "$email_token_path" ]] \
      || die "Cloudflare email delivery is enabled but its API token is empty."
    selected_email_token_path="$email_token_path"
  else
    zeptomail_token_slot="$(runtime_env_value "$AXORA_RUNTIME_ENV_FILE" AXORA_ZEPTOMAIL_TOKEN_SLOT)"
    [[ "$zeptomail_token_slot" == "primary" || "$zeptomail_token_slot" == "next" ]] \
      || die "AXORA_ZEPTOMAIL_TOKEN_SLOT must be primary or next."
    selected_email_token_path="$AXORA_SECRETS_DIR/zeptomail_send_token"
    [[ "$zeptomail_token_slot" == "primary" ]] \
      || selected_email_token_path="$AXORA_SECRETS_DIR/zeptomail_send_token_next"
    [[ -s "$selected_email_token_path" ]] \
      || die "ZeptoMail delivery is enabled but the active Send Mail Token is empty."
  fi
  if [[ "$check_mode" != "local" ]]; then
    "$SCRIPT_DIR/check-email-service.mjs" \
      --runtime-file "$AXORA_RUNTIME_ENV_FILE" \
      --token-file "$selected_email_token_path"
  fi
fi

email_service_key_path="$AXORA_SECRETS_DIR/axora_email_service_auth_key"
[[ -f "$email_service_key_path" && ! -L "$email_service_key_path" ]] \
  || die "The private account email service key is missing or unsafe."
email_service_key_mode="$(stat -c '%a' "$email_service_key_path")"
[[ "$(stat -c '%u:%g' "$email_service_key_path")" == "0:1000" ]] \
  || die "The private account email service key must be owned by root:GID-1000."
(( (8#$email_service_key_mode & 8#027) == 0 )) \
  || die "The private account email service key permissions are too broad."
node -e '
  const fs=require("node:fs");
  const value=fs.readFileSync(process.argv[1],"utf8").trim();
  if(value.length<32 || value.length>4096 || /[\s\x00-\x1f\x7f]/.test(value)) process.exit(1);
' "$email_service_key_path" \
  || die "The private account email service key is malformed."

email_events_key_path="$AXORA_SECRETS_DIR/axora_email_events_webhook_secret"
[[ -f "$email_events_key_path" && ! -L "$email_events_key_path" ]] \
  || die "The Email Sending event webhook secret placeholder is missing or unsafe."
email_events_key_mode="$(stat -c '%a' "$email_events_key_path")"
[[ "$(stat -c '%u:%g' "$email_events_key_path")" == "0:1000" ]] \
  || die "The Email Sending event webhook secret must be owned by root:GID-1000."
(( (8#$email_events_key_mode & 8#027) == 0 )) \
  || die "The Email Sending event webhook secret permissions are too broad."
if [[ "$email_events_enabled" == "true" ]]; then
  [[ -s "$email_events_key_path" ]] \
    || die "Email provider events are enabled but their webhook secret is empty."
  node -e '
    const fs=require("node:fs");
    const value=fs.readFileSync(process.argv[1],"utf8").trim();
    if(!/^[A-Za-z0-9_-]{43,4096}$/.test(value)) process.exit(1);
  ' "$email_events_key_path" \
    || die "The Email Sending event webhook secret is malformed."
fi

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
