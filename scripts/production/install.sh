#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_DIR="$(cd -- "$SOURCE_DIR/../.." && pwd)"
LIBEXEC_DIR="/usr/local/libexec/axora-production"
CONFIG_DIR="/etc/axora-production"
STATE_DIR="/var/lib/axora-production"
CONTROLLER_HOME="$STATE_DIR/controller-home"
LOG_DIR="/var/log/axora-production"
BUILD_HOME="/var/cache/axora-production"
SYSTEMD_DIR="/etc/systemd/system"
BUILD_USER="axora-build"
SECRETS_DIR="/etc/axora-production/secrets"
UPLOADS_DIR="/var/lib/axora-production/uploads"
MIGRATION_BACKUP_DIR="/var/lib/axora-production/one-time-migration-backups"
LEGACY_SECRETS_DIR="/srv/axora/secrets"
LEGACY_UPLOADS_DIR="/srv/axora/data/uploads"
RUNTIME_GID=1000

fail() {
  printf '[axora-production] ERROR: %s\n' "$*" >&2
  exit 1
}

[[ "$(id -u)" -eq 0 ]] || fail "Run this installer as root."
[[ "${1:-}" == "" || "${1:-}" == "--enable" ]] || fail "Usage: $0 [--enable]"
command -v install >/dev/null 2>&1 || fail "install is required."
command -v ssh-keygen >/dev/null 2>&1 || fail "ssh-keygen is required."
command -v systemctl >/dev/null 2>&1 || fail "systemd is required."
command -v jq >/dev/null 2>&1 || fail "jq is required for the one-time active session-secret migration."
for required_command in cmp cp find getent sha256sum sort stat useradd xargs; do
  command -v "$required_command" >/dev/null 2>&1 || fail "$required_command is required."
done
[[ -d /srv/axora && ! -L /srv/axora ]] || fail "/srv/axora must be an existing regular directory."
getent group "$RUNTIME_GID" >/dev/null || fail "Required runtime GID $RUNTIME_GID does not exist."
for protected_path in "$CONFIG_DIR" "$STATE_DIR" "$CONTROLLER_HOME" "$LOG_DIR" "$BUILD_HOME" "$SECRETS_DIR" "$UPLOADS_DIR"; do
  [[ ! -L "$protected_path" ]] || fail "Refusing symlinked production path: $protected_path"
done

for source_file in deploy.sh rollback.sh backup.sh health-check.sh preflight.sh activate-tunnel.sh harden-host.sh lib.sh; do
  [[ -f "$SOURCE_DIR/$source_file" ]] || fail "Missing source script: $source_file"
done
for unit_file in \
  axora-deploy.service axora-deploy.timer \
  axora-health.service axora-health.timer \
  axora-backup.service axora-backup.timer; do
  [[ -f "$REPOSITORY_DIR/deploy/systemd/$unit_file" ]] || fail "Missing systemd unit: $unit_file"
done

if ! id "$BUILD_USER" >/dev/null 2>&1; then
  useradd \
    --system \
    --home-dir "$BUILD_HOME" \
    --create-home \
    --shell /usr/sbin/nologin \
    --user-group \
    "$BUILD_USER"
fi

install -d -o root -g root -m 0750 "$LIBEXEC_DIR" "$STATE_DIR" "$STATE_DIR/releases" "$STATE_DIR/backups" "$LOG_DIR"
install -d -o root -g root -m 0700 "$CONFIG_DIR"
install -d -o root -g root -m 0700 \
  "$CONTROLLER_HOME" "$CONTROLLER_HOME/docker" "$CONTROLLER_HOME/buildx"
install -d -o root -g "$RUNTIME_GID" -m 0710 "$SECRETS_DIR"
install -d -o root -g "$RUNTIME_GID" -m 0770 "$UPLOADS_DIR"
install -d -o root -g root -m 0700 "$MIGRATION_BACKUP_DIR"
install -d -o "$BUILD_USER" -g "$BUILD_USER" -m 0700 "$BUILD_HOME"
install -d -m 0750 /srv/axora /srv/axora/data /srv/axora/data/uploads
chmod go-w /srv/axora /srv/axora/data /srv/axora/data/uploads
# Harden the checkout without changing the permissions needed by the existing
# production secret/upload paths during the controlled migration window.
find /srv/axora -xdev \
  \( -path "$LEGACY_SECRETS_DIR" -o -path "$LEGACY_UPLOADS_DIR" \) -prune -o \
  \( -type f -o -type d \) -perm /022 -exec chmod go-w {} +
find /srv/axora -maxdepth 1 -type f -name '.env*' -exec chmod 0600 {} +
if [[ -d "$LEGACY_SECRETS_DIR" ]]; then
  find "$LEGACY_SECRETS_DIR" -maxdepth 1 -type f -exec chmod go-w {} +
fi

copy_secret_if_absent() {
  local source_path="$1"
  local destination_path="$2"

  if [[ -e "$destination_path" || -L "$destination_path" ]]; then
    [[ -f "$destination_path" && ! -L "$destination_path" ]] \
      || fail "Existing stable secret is not a regular file: $destination_path"
    [[ -s "$destination_path" ]] || fail "Existing stable secret is empty: $destination_path"
    return
  fi
  [[ -f "$source_path" && ! -L "$source_path" && -s "$source_path" ]] \
    || fail "Secret source is missing or empty: $source_path"
  install -o root -g "$RUNTIME_GID" -m 0640 "$source_path" "$destination_path"
}

copy_secret_if_absent "$LEGACY_SECRETS_DIR/postgres_admin_password" "$SECRETS_DIR/postgres_admin_password"
copy_secret_if_absent "$LEGACY_SECRETS_DIR/axora_app_password" "$SECRETS_DIR/axora_app_password"
copy_secret_if_absent "$LEGACY_SECRETS_DIR/tailscale_db_auth_key" "$SECRETS_DIR/tailscale_db_auth_key"

render_environment_record="$LEGACY_SECRETS_DIR/render_env_before_hybrid.json"
[[ -f "$render_environment_record" && ! -L "$render_environment_record" ]] \
  || fail "Protected Render environment record is missing or is a symlink."
stable_session_secret="$SECRETS_DIR/session_secret"
[[ ! -L "$stable_session_secret" ]] || fail "Stable session secret must not be a symlink."
session_temporary="$(mktemp "$CONFIG_DIR/.session-secret.XXXXXX")"
trap 'rm -f -- "$session_temporary"' EXIT
session_record_count="$(
  jq '[.[] | select(.key == "SESSION_SECRET" and (.value | type == "string") and (.value | length >= 32))] | length' \
    "$render_environment_record" 2>/dev/null
)" || fail "Unable to read the protected Render environment record."
[[ "$session_record_count" == "1" ]] \
  || fail "Expected exactly one valid SESSION_SECRET in $render_environment_record."
jq -erj '.[] | select(.key == "SESSION_SECRET") | .value' \
  "$render_environment_record" > "$session_temporary"
session_size="$(stat -c '%s' "$session_temporary")"
(( session_size >= 32 && session_size <= 4096 )) || fail "Recorded Render session secret has an invalid size."

if [[ ! -f "$stable_session_secret" ]]; then
  if [[ -f "$LEGACY_SECRETS_DIR/session_secret" ]]; then
    local_session_backup="$MIGRATION_BACKUP_DIR/session_secret.local-before-production"
    if [[ ! -f "$local_session_backup" ]]; then
      install \
        -o root \
        -g root \
        -m 0600 \
        "$LEGACY_SECRETS_DIR/session_secret" \
        "$local_session_backup"
    elif ! cmp --silent "$LEGACY_SECRETS_DIR/session_secret" "$local_session_backup"; then
      fail "Existing one-time local session-secret backup differs; refusing to overwrite it."
    fi
  fi
  install -o root -g "$RUNTIME_GID" -m 0640 "$session_temporary" "$stable_session_secret"
elif ! cmp --silent "$stable_session_secret" "$session_temporary"; then
  fail "Stable session_secret differs from the verified active Render secret; it was not overwritten."
fi
rm -f -- "$session_temporary"
trap - EXIT

uploads_marker="$STATE_DIR/uploads-migrated-from-srv-axora"
if [[ -d "$LEGACY_UPLOADS_DIR" && ! -f "$uploads_marker" ]]; then
  if ! find "$UPLOADS_DIR" -mindepth 1 -print -quit | grep -q .; then
    if find "$LEGACY_UPLOADS_DIR" -mindepth 1 ! -type d ! -type f -print -quit | grep -q .; then
      fail "Legacy uploads contain a symlink or special file; refusing an unsafe automatic copy."
    fi
    cp -a -- "$LEGACY_UPLOADS_DIR/." "$UPLOADS_DIR/"
    if find "$UPLOADS_DIR" -mindepth 1 ! -type d ! -type f -print -quit | grep -q .; then
      fail "Stable upload copy contains a symlink or special file."
    fi
    source_upload_manifest="$MIGRATION_BACKUP_DIR/uploads-source.sha256"
    stable_upload_manifest="$MIGRATION_BACKUP_DIR/uploads-stable.sha256"
    source_file_inventory="$MIGRATION_BACKUP_DIR/uploads-source-files.list"
    stable_file_inventory="$MIGRATION_BACKUP_DIR/uploads-stable-files.list"
    source_directory_manifest="$MIGRATION_BACKUP_DIR/uploads-source-directories.list"
    stable_directory_manifest="$MIGRATION_BACKUP_DIR/uploads-stable-directories.list"
    (
      cd "$LEGACY_UPLOADS_DIR"
      find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum --zero
    ) > "$source_upload_manifest"
    (
      cd "$UPLOADS_DIR"
      find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum --zero
    ) > "$stable_upload_manifest"
    (
      cd "$LEGACY_UPLOADS_DIR"
      find . -type f -printf '%P\t%s\0' | LC_ALL=C sort -z
    ) > "$source_file_inventory"
    (
      cd "$UPLOADS_DIR"
      find . -type f -printf '%P\t%s\0' | LC_ALL=C sort -z
    ) > "$stable_file_inventory"
    (
      cd "$LEGACY_UPLOADS_DIR"
      find . -type d -printf '%P\0' | LC_ALL=C sort -z
    ) > "$source_directory_manifest"
    (
      cd "$UPLOADS_DIR"
      find . -type d -printf '%P\0' | LC_ALL=C sort -z
    ) > "$stable_directory_manifest"
    cmp --silent "$source_upload_manifest" "$stable_upload_manifest" \
      || fail "Stable upload copy failed file-size/content verification."
    cmp --silent "$source_file_inventory" "$stable_file_inventory" \
      || fail "Stable upload copy failed path/size verification."
    cmp --silent "$source_directory_manifest" "$stable_directory_manifest" \
      || fail "Stable upload copy failed directory verification."
    {
      printf 'verified_utc=%s\n' "$(date -u --iso-8601=seconds)"
      sha256sum "$source_upload_manifest" "$source_file_inventory" "$source_directory_manifest"
    } > "$uploads_marker"
    chown root:root "$source_upload_manifest" "$stable_upload_manifest" \
      "$source_file_inventory" "$stable_file_inventory" \
      "$source_directory_manifest" "$stable_directory_manifest" "$uploads_marker"
    chmod 0600 "$source_upload_manifest" "$stable_upload_manifest" \
      "$source_file_inventory" "$stable_file_inventory" \
      "$source_directory_manifest" "$stable_directory_manifest" "$uploads_marker"
  elif find "$LEGACY_UPLOADS_DIR" -mindepth 1 -print -quit | grep -q .; then
    fail "Stable uploads already contain data; refusing to merge legacy uploads automatically."
  fi
fi
chown -R root:"$RUNTIME_GID" "$UPLOADS_DIR"
find "$UPLOADS_DIR" -type d -exec chmod 0770 {} +
find "$UPLOADS_DIR" -type f -exec chmod 0660 {} +

for source_file in deploy.sh rollback.sh backup.sh health-check.sh preflight.sh activate-tunnel.sh harden-host.sh lib.sh; do
  install -o root -g root -m 0750 "$SOURCE_DIR/$source_file" "$LIBEXEC_DIR/$source_file"
done

if [[ ! -f "$CONFIG_DIR/deploy.env" ]]; then
  install -o root -g root -m 0600 "$REPOSITORY_DIR/deploy/systemd/deploy.env.example" "$CONFIG_DIR/deploy.env"
fi
[[ ! -L "$CONFIG_DIR/deploy.env" && ! -L "$CONFIG_DIR/runtime.env" ]] \
  || fail "Production configuration files must not be symlinks."
if [[ ! -f "$CONFIG_DIR/runtime.env" ]]; then
  install -o root -g root -m 0600 "$REPOSITORY_DIR/deploy/systemd/runtime.env.example" "$CONFIG_DIR/runtime.env"
fi
chown root:root "$CONFIG_DIR/deploy.env" "$CONFIG_DIR/runtime.env"
chmod 0600 "$CONFIG_DIR/deploy.env" "$CONFIG_DIR/runtime.env"

if [[ ! -f "$CONFIG_DIR/github_deploy_key" ]]; then
  ssh-keygen \
    -q \
    -t ed25519 \
    -N '' \
    -C 'axora-production-read-only-deploy' \
    -f "$CONFIG_DIR/github_deploy_key"
fi
[[ ! -L "$CONFIG_DIR/github_deploy_key" && ! -L "$CONFIG_DIR/github_deploy_key.pub" ]] \
  || fail "GitHub deploy key files must not be symlinks."
chown root:root "$CONFIG_DIR/github_deploy_key" "$CONFIG_DIR/github_deploy_key.pub"
chmod 0600 "$CONFIG_DIR/github_deploy_key"
chmod 0644 "$CONFIG_DIR/github_deploy_key.pub"

# Pinned GitHub Ed25519 host key from GitHub's official SSH-key-fingerprint
# documentation. Do not replace this with an unverified ssh-keyscan result.
if [[ ! -f "$CONFIG_DIR/github_known_hosts" ]]; then
  printf '%s\n' \
    'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' \
    > "$CONFIG_DIR/github_known_hosts"
fi
[[ ! -L "$CONFIG_DIR/github_known_hosts" ]] || fail "GitHub known-hosts file must not be a symlink."
chown root:root "$CONFIG_DIR/github_known_hosts"
chmod 0644 "$CONFIG_DIR/github_known_hosts"

for unit_file in \
  axora-deploy.service axora-deploy.timer \
  axora-health.service axora-health.timer \
  axora-backup.service axora-backup.timer; do
  install -o root -g root -m 0644 "$REPOSITORY_DIR/deploy/systemd/$unit_file" "$SYSTEMD_DIR/$unit_file"
done
systemctl daemon-reload

printf '\nInstalled root-owned Axora production orchestration.\n'
printf 'The installed service never executes scripts from the mutable repository checkout.\n\n'
printf 'Required one-time steps before enabling automatic deployment:\n'
printf '  1. Add the following key as a READ-ONLY deploy key for ASHRAF-2004/axora:\n'
printf '     sudo cat %s/github_deploy_key.pub\n' "$CONFIG_DIR"
printf '  2. Protect the main branch and require the GitHub-hosted verification workflow.\n'
printf '  3. Review %s/deploy.env and %s/runtime.env.\n' "$CONFIG_DIR" "$CONFIG_DIR"
printf '  4. Create a DEDICATED Axora production Tunnel, then install only its token at:\n'
printf '     %s/cloudflare_tunnel_token (root:GID %s, mode 0640).\n' "$SECRETS_DIR" "$RUNTIME_GID"
printf '     Never reuse the existing /etc/cloudflared/token; it belongs to bekal-production.\n'
printf '  5. Run: sudo %s/preflight.sh\n' "$LIBEXEC_DIR"

if [[ "${1:-}" == "--enable" ]]; then
  "$LIBEXEC_DIR/preflight.sh" --for-automation
  "$LIBEXEC_DIR/health-check.sh" --external
  systemctl enable --now axora-deploy.timer axora-health.timer axora-backup.timer
  printf 'Automatic deployment, health, and backup timers are enabled.\n'
else
  printf 'After preflight succeeds, enable timers with:\n'
  printf '  sudo systemctl enable --now axora-deploy.timer axora-health.timer axora-backup.timer\n'
fi
