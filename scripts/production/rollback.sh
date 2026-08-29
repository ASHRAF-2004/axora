#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
load_config
for command in docker flock grep; do
  require_command "$command"
done

target="${1:-previous}"
[[ -z "${2:-}" ]] || die "Usage: $0 [previous|40-character-sha]"

install -d -m 0700 "$AXORA_STATE_ROOT"
install -d -m 0750 "$AXORA_LOG_ROOT"
exec 9>"$AXORA_DEPLOY_LOCK"
flock --exclusive --nonblock 9 || die "Another Axora deployment, rollback, or backup is already running."

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
log_file="$AXORA_LOG_ROOT/rollback-${stamp}.log"
touch "$log_file"
chmod 0600 "$log_file"
exec > >(tee -a "$log_file") 2>&1

current_sha="$(read_state_file "$AXORA_CURRENT_SHA_FILE")"
current_image="$(read_state_file "$AXORA_CURRENT_IMAGE_FILE")"
current_image_id="$(read_state_file "$AXORA_CURRENT_IMAGE_ID_FILE")"
current_release="$(read_state_file "$AXORA_CURRENT_RELEASE_FILE")"
valid_image_reference "$current_image" || die "Current image state is missing or invalid."
valid_image_id "$current_image_id" || die "Current image ID state is missing or invalid."
[[ -d "$current_release" ]] || die "Current release state is missing or invalid."

if [[ "$target" == "previous" ]]; then
  target_sha="$(read_state_file "$AXORA_PREVIOUS_SHA_FILE")"
  target_image="$(read_state_file "$AXORA_PREVIOUS_IMAGE_FILE")"
  target_image_id="$(read_state_file "$AXORA_PREVIOUS_IMAGE_ID_FILE")"
  target_release="$(read_state_file "$AXORA_PREVIOUS_RELEASE_FILE")"
else
  valid_sha "$target" || die "Usage: $0 [previous|40-character-sha]"
  target_sha="$target"
  target_image="${AXORA_IMAGE_REPOSITORY}:${target_sha}"
  target_image_id="$(docker image inspect --format '{{.Id}}' "$target_image" 2>/dev/null || true)"
  target_release="$(release_path_for_sha "$target_sha")"
fi

[[ "$target_sha" == "legacy" ]] || valid_sha "$target_sha" || die "Rollback target SHA is invalid."
valid_image_reference "$target_image" || die "Rollback target image is invalid."
valid_image_id "$target_image_id" || die "Rollback target image ID is invalid."
[[ -d "$target_release" && ! -L "$target_release" ]] || die "Rollback release is missing: $target_release"
docker image inspect "$target_image" >/dev/null 2>&1 || die "Rollback image is not available locally: $target_image"
[[ "$(docker image inspect --format '{{.Id}}' "$target_image")" == "$target_image_id" ]] \
  || die "Rollback image tag no longer resolves to its recorded content digest."
if valid_sha "$target_sha"; then
  [[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$target_image")" == "$target_sha" ]] \
    || die "Rollback image revision label does not match the requested commit."
fi

log "Performing app-only rollback to ${target_sha}; database migrations are intentionally not reversed."
export AXORA_IMAGE="$target_image"
services=(app)
if release_has_budget_worker "$target_release"; then
  services+=(budget-worker)
else
  remove_ephemeral_budget_worker
fi
if release_has_document_worker "$target_release"; then
  services+=(document-worker)
else
  remove_ephemeral_document_worker
fi
if release_has_company_deletion_cleanup_worker "$target_release"; then
  services+=(company-deletion-cleanup-worker)
else
  remove_ephemeral_company_deletion_cleanup_worker
fi
if release_has_integration_worker "$target_release"; then
  services+=(integration-worker)
else
  remove_ephemeral_integration_worker
fi
if release_has_email_sender "$target_release"; then
  services+=(email-sender)
fi
services+=(caddy)
if bool_is_true "$AXORA_ENABLE_TUNNEL"; then
  services+=(cloudflared)
fi
if ! compose_release "$target_release" up -d --no-deps --no-build --wait \
  --wait-timeout "$AXORA_DEPLOY_TIMEOUT_SECONDS" "${services[@]}" \
  || ! "$SCRIPT_DIR/health-check.sh" --local \
  || { bool_is_true "$AXORA_REQUIRE_EXTERNAL" && ! "$SCRIPT_DIR/health-check.sh" --external; }; then
  warn "Rollback target failed; restoring the application version that was running before this command."
  export AXORA_IMAGE="$current_image"
  restore_services=(app)
  if release_has_budget_worker "$current_release"; then
    restore_services+=(budget-worker)
  fi
  if release_has_document_worker "$current_release"; then
    restore_services+=(document-worker)
  fi
  if release_has_company_deletion_cleanup_worker "$current_release"; then
    restore_services+=(company-deletion-cleanup-worker)
  fi
  if release_has_integration_worker "$current_release"; then
    restore_services+=(integration-worker)
  fi
  if release_has_email_sender "$current_release"; then
    restore_services+=(email-sender)
  fi
  restore_services+=(caddy)
  if bool_is_true "$AXORA_ENABLE_TUNNEL"; then
    restore_services+=(cloudflared)
  fi
  if compose_release "$current_release" up -d --no-deps --no-build --wait \
    --wait-timeout "$AXORA_DEPLOY_TIMEOUT_SECONDS" "${restore_services[@]}"; then
    remove_email_sender_if_release_lacks_it "$current_release"
    remove_budget_worker_if_release_lacks_it "$current_release"
    remove_document_worker_if_release_lacks_it "$current_release"
    remove_company_deletion_cleanup_worker_if_release_lacks_it "$current_release"
    remove_integration_worker_if_release_lacks_it "$current_release"
  fi
  "$SCRIPT_DIR/health-check.sh" --local || true
  die "Rollback did not pass its health gates; the original app image was requested again."
fi

remove_email_sender_if_release_lacks_it "$target_release"
remove_budget_worker_if_release_lacks_it "$target_release"
remove_document_worker_if_release_lacks_it "$target_release"
remove_company_deletion_cleanup_worker_if_release_lacks_it "$target_release"
remove_integration_worker_if_release_lacks_it "$target_release"

atomic_write "$AXORA_PREVIOUS_SHA_FILE" "${current_sha:-legacy}"
atomic_write "$AXORA_PREVIOUS_IMAGE_FILE" "$current_image"
atomic_write "$AXORA_PREVIOUS_IMAGE_ID_FILE" "$current_image_id"
atomic_write "$AXORA_PREVIOUS_RELEASE_FILE" "$current_release"
atomic_write "$AXORA_CURRENT_SHA_FILE" "$target_sha"
atomic_write "$AXORA_CURRENT_IMAGE_FILE" "$target_image"
atomic_write "$AXORA_CURRENT_IMAGE_ID_FILE" "$target_image_id"
atomic_write "$AXORA_CURRENT_RELEASE_FILE" "$target_release"
log "App-only rollback succeeded. Database restore was not performed."
warn "A database restore is disaster recovery, not normal rollback; follow the production runbook and require an outage window."
