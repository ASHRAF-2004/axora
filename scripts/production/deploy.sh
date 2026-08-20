#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
load_config

deployment_mode=manual
requested_sha=""
requested_digest=""
case "${1:-}" in
  --automatic)
    deployment_mode=automatic
    requested_sha="${2:-}"
    requested_digest="${3:-}"
    [[ -z "${4:-}" ]] || die "Usage: $0 --automatic 40-character-main-commit-sha sha256:image-digest"
    ;;
  --local-bootstrap)
    deployment_mode=bootstrap
    requested_sha="${2:-}"
    requested_digest="${3:-}"
    [[ -z "${4:-}" ]] || die "Usage: $0 --local-bootstrap 40-character-main-commit-sha sha256:image-digest"
    ;;
  "")
    ;;
  *)
    requested_sha="$1"
    requested_digest="${2:-}"
    [[ -z "${3:-}" ]] || die "Usage: $0 40-character-main-commit-sha sha256:image-digest"
    ;;
esac
if [[ -n "$requested_sha" ]] && ! valid_sha "$requested_sha"; then
  die "Invalid deployment commit SHA."
fi
if ! valid_image_digest "$requested_digest"; then
  die "Deployment requires a valid sha256 image digest."
fi
if [[ "$deployment_mode" == "automatic" ]] && ! bool_is_true "$AXORA_REQUIRE_EXTERNAL"; then
  die "Automatic deployment is disabled while AXORA_REQUIRE_EXTERNAL=false."
fi
if [[ "$deployment_mode" == "bootstrap" ]]; then
  ! bool_is_true "$AXORA_REQUIRE_EXTERNAL" \
    || die "Local bootstrap requires AXORA_REQUIRE_EXTERNAL=false."
  ! bool_is_true "$AXORA_ENABLE_TUNNEL" \
    || die "Local bootstrap requires AXORA_ENABLE_TUNNEL=false."
fi

install -d -m 0700 "$AXORA_STATE_ROOT" "$AXORA_RELEASES_ROOT" "$AXORA_BACKUPS_ROOT"
install -d -m 0750 "$AXORA_LOG_ROOT"
controller_home="$AXORA_STATE_ROOT/controller-home"
install -d -o root -g root -m 0700 \
  "$controller_home" "$controller_home/docker" "$controller_home/buildx"
export HOME="$controller_home"
export DOCKER_CONFIG="$controller_home/docker"
export BUILDX_CONFIG="$controller_home/buildx"
exec 9>"$AXORA_DEPLOY_LOCK"
flock --exclusive --nonblock 9 || die "Another Axora deployment, rollback, or backup is already running."
export AXORA_DEPLOY_LOCK_HELD=true

log_file="$AXORA_LOG_ROOT/deploy-$(date -u +%Y%m%d).log"
touch "$log_file"
chmod 0600 "$log_file"
exec > >(tee -a "$log_file") 2>&1

temporary_release=""
swapped=false
old_image=""
old_image_id=""
old_release=""

ensure_budget_worker_for_release() {
  local release="$1"
  local expected_image="$2"
  local expected_image_id="$3"
  local container
  local health

  if ! release_has_budget_worker "$release"; then
    remove_budget_worker_if_release_lacks_it "$release"
    return
  fi

  if ! container="$(find_service_container budget-worker)"; then
    [[ "$(docker image inspect --format '{{.Id}}' "$expected_image")" == "$expected_image_id" ]] \
      || die "Recorded application image no longer resolves to its recorded content digest."
    log "Production budget-worker is missing; reconciling only that ephemeral service from the recorded image."
    export AXORA_IMAGE="$expected_image"
    compose_release "$release" up -d --no-deps --no-build --wait \
      --wait-timeout "$AXORA_DEPLOY_TIMEOUT_SECONDS" budget-worker
    container="$(find_service_container budget-worker)" \
      || die "Expected one running production budget-worker container after reconciliation."
  fi

  [[ "$(docker inspect --format '{{.Image}}' "$container")" == "$expected_image_id" ]] \
    || die "Running budget-worker image differs from the recorded content digest."
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")"
  [[ "$health" == "healthy" ]] \
    || die "Production budget-worker is not healthy (status: $health)."
}

ensure_document_worker_for_release() {
  local release="$1"
  local expected_image="$2"
  local expected_image_id="$3"
  local container
  local health

  if ! release_has_document_worker "$release"; then
    remove_document_worker_if_release_lacks_it "$release"
    return
  fi

  if ! container="$(find_service_container document-worker)"; then
    [[ "$(docker image inspect --format '{{.Id}}' "$expected_image")" == "$expected_image_id" ]] \
      || die "Recorded application image no longer resolves to its recorded content digest."
    log "Production document-worker is missing; reconciling only that ephemeral service from the recorded image."
    export AXORA_IMAGE="$expected_image"
    compose_release "$release" up -d --no-deps --no-build --wait \
      --wait-timeout "$AXORA_DEPLOY_TIMEOUT_SECONDS" document-worker
    container="$(find_service_container document-worker)" \
      || die "Expected one running production document-worker container after reconciliation."
  fi

  [[ "$(docker inspect --format '{{.Image}}' "$container")" == "$expected_image_id" ]] \
    || die "Running document-worker image differs from the recorded content digest."
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")"
  [[ "$health" == "healthy" ]] \
    || die "Production document-worker is not healthy (status: $health)."
}

ensure_company_deletion_cleanup_worker_for_release() {
  local release="$1" expected_image="$2" expected_image_id="$3"
  local container health
  if ! release_has_company_deletion_cleanup_worker "$release"; then
    remove_company_deletion_cleanup_worker_if_release_lacks_it "$release"
    return
  fi
  if ! container="$(find_service_container company-deletion-cleanup-worker)"; then
    [[ "$(docker image inspect --format '{{.Id}}' "$expected_image")" == "$expected_image_id" ]] \
      || die "Recorded application image no longer resolves to its recorded content digest."
    log "Production company deletion cleanup worker is missing; reconciling only that ephemeral service."
    export AXORA_IMAGE="$expected_image"
    compose_release "$release" up -d --no-deps --no-build --wait \
      --wait-timeout "$AXORA_DEPLOY_TIMEOUT_SECONDS" company-deletion-cleanup-worker
    container="$(find_service_container company-deletion-cleanup-worker)" \
      || die "Expected one running company deletion cleanup worker after reconciliation."
  fi
  [[ "$(docker inspect --format '{{.Image}}' "$container")" == "$expected_image_id" ]] \
    || die "Running company deletion cleanup worker image differs from the recorded content digest."
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")"
  [[ "$health" == "healthy" ]] \
    || die "Production company deletion cleanup worker is not healthy (status: $health)."
}

automatic_revert() {
  if ! "$swapped" || ! valid_image_reference "$old_image" || [[ ! -d "$old_release" ]]; then
    return
  fi

  warn "A post-swap gate failed; restoring the previously running application image."
  export AXORA_IMAGE="$old_image"
  local -a services=(app)
  if release_has_budget_worker "$old_release"; then
    services+=(budget-worker)
  else
    remove_ephemeral_budget_worker
  fi
  if release_has_document_worker "$old_release"; then
    services+=(document-worker)
  else
    remove_ephemeral_document_worker
  fi
  if release_has_company_deletion_cleanup_worker "$old_release"; then
    services+=(company-deletion-cleanup-worker)
  else
    remove_ephemeral_company_deletion_cleanup_worker
  fi
  if release_has_email_sender "$old_release"; then
    services+=(email-sender)
  fi
  services+=(caddy)
  if bool_is_true "$AXORA_ENABLE_TUNNEL"; then
    services+=(cloudflared)
  fi
  if compose_release "$old_release" up -d --no-deps --no-build --wait \
    --wait-timeout "$AXORA_DEPLOY_TIMEOUT_SECONDS" "${services[@]}"; then
    if "$SCRIPT_DIR/health-check.sh" --local; then
      remove_email_sender_if_release_lacks_it "$old_release"
      remove_budget_worker_if_release_lacks_it "$old_release"
      remove_document_worker_if_release_lacks_it "$old_release"
      remove_company_deletion_cleanup_worker_if_release_lacks_it "$old_release"
    else
      warn "The automatic app-only rollback also failed its local health gate."
    fi
  else
    warn "The automatic app-only rollback could not restart the prior application."
  fi
}

on_exit() {
  status=$?
  if [[ -n "$temporary_release" && -d "$temporary_release" ]]; then
    rm -rf -- "$temporary_release"
  fi
  if (( status != 0 )); then
    automatic_revert
    warn "Deployment failed. Production database was never restored automatically; inspect $log_file."
  fi
  exit "$status"
}
trap on_exit EXIT

if [[ "$deployment_mode" == "bootstrap" ]]; then
  "$SCRIPT_DIR/preflight.sh" --local-only
elif [[ "$deployment_mode" == "automatic" ]]; then
  "$SCRIPT_DIR/preflight.sh" --for-automation
else
  "$SCRIPT_DIR/preflight.sh"
fi

target_sha="$(remote_main_sha)"
if [[ -n "$requested_sha" && "$requested_sha" != "$target_sha" ]]; then
  die "Requested commit is not the current trusted main commit."
fi
current_sha="$(read_state_file "$AXORA_CURRENT_SHA_FILE")"
requested_image="$AXORA_IMAGE_REPOSITORY@$requested_digest"
if [[ "$current_sha" == "$target_sha" ]]; then
  release="$(release_path_for_sha "$target_sha")"
  [[ -d "$release" && ! -L "$release" ]] || die "Current release directory is missing or unsafe."
  recorded_image="$(read_state_file "$AXORA_CURRENT_IMAGE_FILE")"
  recorded_image_id="$(read_state_file "$AXORA_CURRENT_IMAGE_ID_FILE")"
  valid_image_reference "$recorded_image" || die "Current image state is invalid."
  [[ "$recorded_image" == "$requested_image" ]] \
    || die "Current commit is recorded with a different immutable image digest."
  valid_image_id "$recorded_image_id" || die "Current image digest state is invalid."
  current_app_container="$(find_service_container app)" || die "Expected one running production app container."
  [[ "$(docker inspect --format '{{.Image}}' "$current_app_container")" == "$recorded_image_id" ]] \
    || die "Running application image differs from the recorded content digest."
  ensure_budget_worker_for_release "$release" "$recorded_image" "$recorded_image_id"
  ensure_document_worker_for_release "$release" "$recorded_image" "$recorded_image_id"
  ensure_company_deletion_cleanup_worker_for_release "$release" "$recorded_image" "$recorded_image_id"
  log "Commit $target_sha is already deployed; running health gates only."
  "$SCRIPT_DIR/health-check.sh" --local
  if bool_is_true "$AXORA_REQUIRE_EXTERNAL"; then
    "$SCRIPT_DIR/health-check.sh" --external
  fi
  exit 0
fi

log "Fetching exact trusted main commit $target_sha."
if [[ ! -d "$AXORA_REPOSITORY_DIR" ]]; then
  git init --bare --initial-branch=main "$AXORA_REPOSITORY_DIR" >/dev/null
fi
[[ -f "$AXORA_REPOSITORY_DIR/HEAD" ]] || die "Deployment repository is not a valid bare Git repository."
git --git-dir="$AXORA_REPOSITORY_DIR" config remote.origin.url "$AXORA_REPOSITORY_SSH"
GIT_SSH_COMMAND="$(github_ssh_command)" \
  git --git-dir="$AXORA_REPOSITORY_DIR" fetch \
    --force \
    --no-tags \
    --prune \
    origin \
    "+$AXORA_MAIN_REF:refs/remotes/origin/main"

fetched_sha="$(git --git-dir="$AXORA_REPOSITORY_DIR" rev-parse --verify 'refs/remotes/origin/main^{commit}')"
[[ "$fetched_sha" == "$target_sha" ]] || die "Fetched commit does not match GitHub main."
git --git-dir="$AXORA_REPOSITORY_DIR" cat-file -e "$target_sha^{commit}"
git --git-dir="$AXORA_REPOSITORY_DIR" fsck --strict --full --no-dangling >/dev/null

release="$(release_path_for_sha "$target_sha")"
if [[ ! -d "$release" ]]; then
  temporary_release="$(mktemp -d "$AXORA_BUILD_HOME/.release-${target_sha}.XXXXXX")"
  materialize_git_tree "$AXORA_REPOSITORY_DIR" "$target_sha" "$temporary_release"

  for required_file in .dockerignore package.json package-lock.json Dockerfile compose.yaml compose.hybrid.yaml compose.production.yaml; do
    [[ -f "$temporary_release/$required_file" ]] || die "Release is missing required file: $required_file"
  done

  required_ignores=(.git .env '.env.*' secrets backups data/uploads output)
  for ignore_rule in "${required_ignores[@]}"; do
    grep -Fqx "$ignore_rule" "$temporary_release/.dockerignore" \
      || die ".dockerignore is missing mandatory rule: $ignore_rule"
  done
  log "Sealing the exact CI-approved Git tree as the production build context."
  printf '%s\n' "$target_sha" > "$temporary_release/.axora-commit"
  chmod -R go-w "$temporary_release"
  mv -- "$temporary_release" "$release"
  temporary_release=""
else
  [[ "$(tr -d '\r\n' < "$release/.axora-commit")" == "$target_sha" ]] \
    || die "Existing release directory has the wrong commit marker."
  [[ "$(stat -c '%u' "$release")" == "0" ]] || die "Existing release is not root-owned."
fi

export AXORA_IMAGE="$requested_image"
assert_safe_root_file "$AXORA_REGISTRY_TOKEN_FILE"
log "Authenticating to the private image registry and pulling $AXORA_IMAGE."
docker login "$AXORA_REGISTRY_HOST" \
  --username "$AXORA_REGISTRY_USERNAME" \
  --password-stdin < "$AXORA_REGISTRY_TOKEN_FILE" >/dev/null
docker pull "$AXORA_IMAGE"
docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$AXORA_IMAGE" \
  | grep -Fqx "$AXORA_IMAGE" \
  || die "Pulled image does not expose the requested immutable digest."
image_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$AXORA_IMAGE")"
[[ "$image_revision" == "$target_sha" ]] || die "Built image does not carry the expected revision label."
image_id="$(docker image inspect --format '{{.Id}}' "$AXORA_IMAGE")"
valid_image_id "$image_id" || die "Built image does not have a valid content-addressed image ID."

if ! db_container="$(find_service_container db)"; then
  log "PostgreSQL is not running; starting only the persistent database service."
  compose_release "$release" up -d --no-build --wait \
    --wait-timeout "$AXORA_DEPLOY_TIMEOUT_SECONDS" db
  db_container="$(find_service_container db)" || die "PostgreSQL did not start."
fi
db_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$db_container")"
[[ "$db_health" == "healthy" ]] || die "PostgreSQL is not healthy."
if ! tailscale_container="$(find_service_container tailscale-db)"; then
  log "Required tailscale-db service is not running; starting it without touching PostgreSQL."
  compose_release "$release" up -d --no-deps --no-build --wait \
    --wait-timeout "$AXORA_DEPLOY_TIMEOUT_SECONDS" tailscale-db
  tailscale_container="$(find_service_container tailscale-db)" \
    || die "Required tailscale-db service did not start."
fi
tailscale_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$tailscale_container")"
[[ "$tailscale_health" == "healthy" ]] || die "Required tailscale-db service is not healthy."

pending_migrations="$("$SCRIPT_DIR/migration-status.sh" "$release" "$db_container" "$AXORA_DATABASE_NAME")"
if [[ "$pending_migrations" == "required" ]]; then
  log "Pending migrations detected; creating a restore-verified backup before database changes."
  "$SCRIPT_DIR/backup.sh" --commit "$target_sha"

  log "Applying pending transactional migrations from the exact release."
  for migration_secret in postgres_admin_password axora_cleanup_worker_password; do
    migration_secret_path="$AXORA_SECRETS_DIR/$migration_secret"
    [[ -f "$migration_secret_path" && ! -L "$migration_secret_path" && -s "$migration_secret_path" ]] \
      || die "Required migration secret is missing or unsafe: $migration_secret"
  done
  docker run \
    --rm \
    --label "axora.deployment.migration=$target_sha" \
    --network "$AXORA_BACKEND_NETWORK" \
    --group-add 1000 \
    --cpus 2 \
    --memory 1g \
    --pids-limit 128 \
    --env POSTGRES_USER=postgres \
    --env "POSTGRES_DB=$AXORA_DATABASE_NAME" \
    --env PGHOST=db \
    --mount "type=bind,source=$AXORA_SECRETS_DIR/postgres_admin_password,target=/run/secrets/postgres_admin_password,readonly" \
    --mount "type=bind,source=$AXORA_SECRETS_DIR/axora_cleanup_worker_password,target=/run/secrets/axora_cleanup_worker_password,readonly" \
    --mount "type=bind,source=$release/database/init,target=/database/init,readonly" \
    --mount "type=bind,source=$release/database/migrations,target=/migrations,readonly" \
    --entrypoint /bin/sh \
    "$AXORA_POSTGRES_IMAGE" \
    /database/init/01-run-migration.sh
elif [[ "$pending_migrations" == "none" ]]; then
  log "Migration ledger matches this release; skipping deployment backup and migration runner."
else
  die "Migration status returned an unexpected result."
fi

latest_main="$(remote_main_sha)"
[[ "$latest_main" == "$target_sha" ]] \
  || die "GitHub main advanced during deployment; refusing to replace production with a stale commit."

if old_app_container="$(find_service_container app)"; then
  old_image="$(docker inspect --format '{{.Config.Image}}' "$old_app_container")"
  old_image_id="$(docker inspect --format '{{.Image}}' "$old_app_container")"
fi
old_release="$(read_state_file "$AXORA_CURRENT_RELEASE_FILE")"
if [[ ! -d "$old_release" ]]; then
  old_release="$release"
fi
valid_image_reference "$old_image" || old_image=""

if [[ "$deployment_mode" == "bootstrap" ]]; then
  legacy_path_containers=()
  for service in app caddy; do
    mapfile -t service_containers < <(
      docker ps \
        --all \
        --filter "label=com.docker.compose.project=$AXORA_COMPOSE_PROJECT" \
        --filter "label=com.docker.compose.service=$service" \
        --format '{{.ID}}'
    )
    (( "${#service_containers[@]}" <= 1 )) \
      || die "Expected at most one legacy $service container."
    if (( "${#service_containers[@]}" == 1 )); then
      legacy_path_containers+=("${service_containers[0]}")
    fi
  done
  if (( "${#legacy_path_containers[@]}" > 0 )); then
    log "Removing only legacy app-path containers before the one-time network-topology migration."
    # Containers are ephemeral and no -v flag is used. PostgreSQL,
    # tailscale-db, named volumes, secrets, and persistent uploads are untouched.
    docker rm --force "${legacy_path_containers[@]}" >/dev/null
  fi
fi

services=(app budget-worker document-worker company-deletion-cleanup-worker email-sender caddy)
if bool_is_true "$AXORA_ENABLE_TUNNEL"; then
  services+=(cloudflared)
fi
log "Replacing only application-path services: ${services[*]}."
swapped=true
compose_release "$release" up -d --no-deps --no-build --wait \
  --wait-timeout "$AXORA_DEPLOY_TIMEOUT_SECONDS" "${services[@]}"
"$SCRIPT_DIR/health-check.sh" --local
if bool_is_true "$AXORA_REQUIRE_EXTERNAL"; then
  "$SCRIPT_DIR/health-check.sh" --external
fi

if [[ -n "$current_sha" ]] && valid_sha "$current_sha"; then
  atomic_write "$AXORA_PREVIOUS_SHA_FILE" "$current_sha"
else
  atomic_write "$AXORA_PREVIOUS_SHA_FILE" "legacy"
fi
if [[ -n "$old_image" ]]; then
  atomic_write "$AXORA_PREVIOUS_IMAGE_FILE" "$old_image"
  if valid_image_id "$old_image_id"; then
    atomic_write "$AXORA_PREVIOUS_IMAGE_ID_FILE" "$old_image_id"
  fi
  atomic_write "$AXORA_PREVIOUS_RELEASE_FILE" "$old_release"
fi
atomic_write "$AXORA_CURRENT_SHA_FILE" "$target_sha"
atomic_write "$AXORA_CURRENT_IMAGE_FILE" "$AXORA_IMAGE"
atomic_write "$AXORA_CURRENT_IMAGE_ID_FILE" "$image_id"
atomic_write "$AXORA_CURRENT_RELEASE_FILE" "$release"
swapped=false
log "Deployment succeeded at commit $target_sha."
if [[ "$pending_migrations" == "required" ]]; then
  log "Verified pre-migration backup: $(read_state_file "$AXORA_LAST_BACKUP_FILE")"
fi

mapfile -t release_candidates < <(
  find "$AXORA_RELEASES_ROOT" \
    -mindepth 1 \
    -maxdepth 1 \
    -type d \
    -printf '%T@ %p\n' \
    | sort -rn \
    | awk '{print $2}'
)
kept=0
previous_release="$(read_state_file "$AXORA_PREVIOUS_RELEASE_FILE")"
for old_release_candidate in "${release_candidates[@]}"; do
  old_release_name="$(basename -- "$old_release_candidate")"
  valid_sha "$old_release_name" || continue
  if [[ "$old_release_candidate" == "$release" || "$old_release_candidate" == "$previous_release" ]]; then
    continue
  fi
  kept=$(( kept + 1 ))
  if (( kept > AXORA_RELEASE_RETENTION_COUNT - 2 )); then
    if [[ "$(stat -c '%u' "$old_release_candidate")" != "0" ]]; then
      warn "Skipping non-root-owned release during retention: $old_release_candidate"
      continue
    fi
    resolved_candidate="$(realpath "$old_release_candidate")"
    if [[ "$resolved_candidate" != "$AXORA_RELEASES_ROOT"/[0-9a-f]* ]]; then
      warn "Skipping unsafe release retention target: $resolved_candidate"
      continue
    fi
    if ! rm -rf -- "$resolved_candidate"; then
      warn "Could not prune old release: $old_release_name"
      continue
    fi
    docker image rm "${AXORA_IMAGE_REPOSITORY}:${old_release_name}" >/dev/null 2>&1 || true
    log "Pruned old release beyond retention: $old_release_name"
  fi
done

find "$AXORA_LOG_ROOT" \
  -mindepth 1 \
  -maxdepth 1 \
  -type f \
  \( -name 'deploy-*.log' -o -name 'rollback-*.log' \) \
  -mtime "+$AXORA_LOG_RETENTION_DAYS" \
  -delete || warn "Some old deployment logs could not be pruned."
