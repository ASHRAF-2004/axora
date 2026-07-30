#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
load_config

deployment_mode=manual
requested_sha=""
case "${1:-}" in
  --automatic)
    deployment_mode=automatic
    requested_sha="${2:-}"
    [[ -z "${3:-}" ]] || die "Usage: $0 [--automatic|--local-bootstrap] [40-character-main-commit-sha]"
    ;;
  --local-bootstrap)
    deployment_mode=bootstrap
    requested_sha="${2:-}"
    [[ -z "${3:-}" ]] || die "Usage: $0 [--automatic|--local-bootstrap] [40-character-main-commit-sha]"
    ;;
  "")
    ;;
  *)
    requested_sha="$1"
    [[ -z "${2:-}" ]] || die "Usage: $0 [--automatic|--local-bootstrap] [40-character-main-commit-sha]"
    ;;
esac
if [[ -n "$requested_sha" ]] && ! valid_sha "$requested_sha"; then
  die "Usage: $0 [--automatic|--local-bootstrap] [40-character-main-commit-sha]"
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

candidate_container=""
temporary_release=""
swapped=false
old_image=""
old_image_id=""
old_release=""

cleanup_candidate() {
  if [[ -n "$candidate_container" ]] && docker container inspect "$candidate_container" >/dev/null 2>&1; then
    docker rm --force "$candidate_container" >/dev/null 2>&1 || true
  fi
  candidate_container=""
}

automatic_revert() {
  if ! "$swapped" || ! valid_image_reference "$old_image" || [[ ! -d "$old_release" ]]; then
    return
  fi

  warn "A post-swap gate failed; restoring the previously running application image."
  export AXORA_IMAGE="$old_image"
  local -a services=(app caddy)
  if bool_is_true "$AXORA_ENABLE_TUNNEL"; then
    services+=(cloudflared)
  fi
  if compose_release "$old_release" up -d --no-deps --no-build --wait \
    --wait-timeout "$AXORA_DEPLOY_TIMEOUT_SECONDS" "${services[@]}"; then
    "$SCRIPT_DIR/health-check.sh" --local || warn "The automatic app-only rollback also failed its local health gate."
  else
    warn "The automatic app-only rollback could not restart the prior application."
  fi
}

on_exit() {
  status=$?
  cleanup_candidate
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
if [[ "$current_sha" == "$target_sha" ]]; then
  recorded_image="$(read_state_file "$AXORA_CURRENT_IMAGE_FILE")"
  recorded_image_id="$(read_state_file "$AXORA_CURRENT_IMAGE_ID_FILE")"
  valid_image_reference "$recorded_image" || die "Current image state is invalid."
  valid_image_id "$recorded_image_id" || die "Current image digest state is invalid."
  current_app_container="$(find_service_container app)" || die "Expected one running production app container."
  [[ "$(docker inspect --format '{{.Image}}' "$current_app_container")" == "$recorded_image_id" ]] \
    || die "Running application image differs from the recorded content digest."
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
  # The deploy unit is already a root-owned, protected controller. Avoid a
  # host-side UID transition: this Ubuntu/systemd sandbox rejects runuser.

  log "Installing locked dependencies and running lint, type checks, tests, and production build in the disposable workspace."
  env -i \
    HOME="$controller_home" \
    USER=root \
    LOGNAME=root \
    PATH=/usr/local/bin:/usr/bin:/bin \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    npm_config_cache="$controller_home/npm" \
    XDG_CACHE_HOME="$controller_home/xdg" \
    npm_config_audit=false \
    npm_config_fund=false \
    npm ci --prefix "$temporary_release"
  env -i \
    HOME="$controller_home" \
    USER=root \
    LOGNAME=root \
    PATH=/usr/local/bin:/usr/bin:/bin \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    npm_config_cache="$controller_home/npm" \
    XDG_CACHE_HOME="$controller_home/xdg" \
    npm run --prefix "$temporary_release" verify

  # npm lifecycle and verification code can modify its workspace. Discard it,
  # then export the trusted commit again so the sealed Docker context is the
  # exact Git tree that passed all checks.
  rm -rf -- "$temporary_release"
  temporary_release="$(mktemp -d "$AXORA_BUILD_HOME/.release-${target_sha}.XXXXXX")"
  materialize_git_tree "$AXORA_REPOSITORY_DIR" "$target_sha" "$temporary_release"
  printf '%s\n' "$target_sha" > "$temporary_release/.axora-commit"
  chmod -R go-w "$temporary_release"
  mv -- "$temporary_release" "$release"
  temporary_release=""
else
  [[ "$(tr -d '\r\n' < "$release/.axora-commit")" == "$target_sha" ]] \
    || die "Existing release directory has the wrong commit marker."
  [[ "$(stat -c '%u' "$release")" == "0" ]] || die "Existing release is not root-owned."
fi

export AXORA_IMAGE="${AXORA_IMAGE_REPOSITORY}:${target_sha}"
log "Running Dockerfile static build checks against the sanitized build context."
docker buildx build --check \
  --build-arg "AXORA_REVISION=$target_sha" \
  "$release"
log "Building immutable application image $AXORA_IMAGE."
docker build \
  --build-arg "AXORA_REVISION=$target_sha" \
  --label "org.opencontainers.image.revision=$target_sha" \
  --label "org.opencontainers.image.source=https://github.com/ASHRAF-2004/axora" \
  --tag "$AXORA_IMAGE" \
  "$release"
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

candidate_container="axora-candidate-${target_sha:0:12}"
if docker container inspect "$candidate_container" >/dev/null 2>&1; then
  die "Candidate container name is already in use: $candidate_container"
fi
log "Starting an isolated candidate container with no published ports."
docker run \
  --detach \
  --name "$candidate_container" \
  --label "axora.deployment.candidate=$target_sha" \
  --network "$AXORA_BACKEND_NETWORK" \
  --group-add 1000 \
  --cpus 2 \
  --memory 2g \
  --pids-limit 256 \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --tmpfs /app/.next/cache:rw,noexec,nosuid,size=128m,uid=1001,gid=1001 \
  --env NODE_ENV=production \
  --env DEMO_MODE=false \
  --env DB_HOST=db \
  --env DB_PORT=5432 \
  --env "DB_NAME=$AXORA_DATABASE_NAME" \
  --env DB_USER=axora_app \
  --env DB_PASSWORD_FILE=/run/secrets/axora_app_password \
  --env SESSION_SECRET_FILE=/run/secrets/session_secret \
  --env "APP_BASE_URL=$AXORA_PUBLIC_URL" \
  --mount "type=bind,source=$AXORA_SECRETS_DIR/axora_app_password,target=/run/secrets/axora_app_password,readonly" \
  --mount "type=bind,source=$AXORA_SECRETS_DIR/session_secret,target=/run/secrets/session_secret,readonly" \
  "$AXORA_IMAGE" >/dev/null

candidate_ready=false
candidate_attempts=$(( AXORA_DEPLOY_TIMEOUT_SECONDS / 2 ))
(( candidate_attempts >= 15 )) || candidate_attempts=15
for (( attempt=1; attempt<=candidate_attempts; attempt++ )); do
  if docker exec "$candidate_container" node -e \
    "fetch('http://127.0.0.1:3000/api/health/ready').then(async r=>process.exit(r.ok&&(await r.json()).status==='ready'?0:1)).catch(()=>process.exit(1))"; then
    candidate_ready=true
    break
  fi
  sleep 2
done
if ! "$candidate_ready"; then
  docker logs --tail 100 "$candidate_container" || true
  die "Candidate image failed its database readiness gate."
fi
log "Candidate image passed its database readiness gate."

"$SCRIPT_DIR/backup.sh" --commit "$target_sha"

log "Applying pending transactional migrations from the exact release."
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
  --mount "type=bind,source=$release/database/init,target=/database/init,readonly" \
  --mount "type=bind,source=$release/database/migrations,target=/migrations,readonly" \
  --entrypoint /bin/sh \
  "$AXORA_POSTGRES_IMAGE" \
  /database/init/01-run-migration.sh

if ! docker exec "$candidate_container" node -e \
  "fetch('http://127.0.0.1:3000/api/health/ready').then(async r=>process.exit(r.ok&&(await r.json()).status==='ready'?0:1)).catch(()=>process.exit(1))"; then
  die "Candidate failed readiness after database migrations."
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

services=(app caddy)
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
cleanup_candidate

log "Deployment succeeded at commit $target_sha."
log "Verified backup: $(read_state_file "$AXORA_LAST_BACKUP_FILE")"

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
