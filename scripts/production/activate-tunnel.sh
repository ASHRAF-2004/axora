#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
load_config
bool_is_true "$AXORA_ENABLE_TUNNEL" \
  || die "Set AXORA_ENABLE_TUNNEL=true in the root-owned deploy configuration first."
bool_is_true "$AXORA_REQUIRE_EXTERNAL" \
  || die "Set AXORA_REQUIRE_EXTERNAL=true before activating the production Tunnel."
"$SCRIPT_DIR/preflight.sh"

current_image="$(read_state_file "$AXORA_CURRENT_IMAGE_FILE")"
current_release="$(read_state_file "$AXORA_CURRENT_RELEASE_FILE")"
valid_image_reference "$current_image" || die "No valid locally deployed image is recorded."
[[ -d "$current_release" && ! -L "$current_release" ]] || die "No valid local release is recorded."

exec 9>"$AXORA_DEPLOY_LOCK"
flock --exclusive --nonblock 9 || die "Another deployment, rollback, or backup is running."

export AXORA_IMAGE="$current_image"
"$SCRIPT_DIR/health-check.sh" --local
log "Starting only the production Cloudflare Tunnel connector."
compose_release "$current_release" up -d --no-deps --no-build --wait \
  --wait-timeout "$AXORA_DEPLOY_TIMEOUT_SECONDS" cloudflared
"$SCRIPT_DIR/health-check.sh" --external
log "Tunnel, apex HTTPS, redirect, security headers, and database readiness are verified."
log "Automatic polling may now be enabled with: systemctl enable --now axora-deploy.timer axora-health.timer axora-backup.timer"
