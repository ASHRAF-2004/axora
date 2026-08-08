#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_DIR="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

for command in bash cmp cut docker git grep jq mkdir mktemp node rm touch; do
  command -v "$command" >/dev/null 2>&1 \
    || { printf 'Required command not found: %s\n' "$command" >&2; exit 1; }
done

bash -n "$SCRIPT_DIR"/*.sh
for ignore_rule in .git .env '.env.*' secrets backups data/uploads output; do
  grep -Fqx "$ignore_rule" "$REPOSITORY_DIR/.dockerignore" \
    || die ".dockerignore is missing mandatory rule: $ignore_rule"
done
node --check "$REPOSITORY_DIR/server-tools/migrate.mjs"
node --check "$REPOSITORY_DIR/server-tools/account-setup-email.mjs"
node --check "$REPOSITORY_DIR/server-tools/transactional-email.mjs"
node --check "$REPOSITORY_DIR/server-tools/email-template-catalogue.mjs"
node --check "$REPOSITORY_DIR/server-tools/email-sender.mjs"
node --check "$REPOSITORY_DIR/scripts/production/check-email-service.mjs"

checker_install_mentions="$(grep -cF 'check-email-service.mjs' "$SCRIPT_DIR/install.sh")"
(( checker_install_mentions >= 2 )) \
  || die "Installer must validate and install the Cloudflare email checker."
for runtime_key in \
  AXORA_EMAIL_DELIVERY_ENABLED \
  CLOUDFLARE_ACCOUNT_ID \
  CLOUDFLARE_ZONE_ID \
  AXORA_EMAIL_FROM_ADDRESS \
  AXORA_EMAIL_FROM_NAME \
  AXORA_EMAIL_REPLY_TO \
  AXORA_EMAIL_PROVIDER \
  TURNSTILE_SITE_KEY \
  TURNSTILE_HOSTNAMES \
  AXORA_TURNSTILE_EXPECTED_HOSTNAME \
  ACCOUNT_SETUP_TTL_HOURS; do
  grep -Fq "ensure_runtime_default $runtime_key" "$SCRIPT_DIR/install.sh" \
    || die "Installer does not backfill runtime key: $runtime_key"
  grep -Fq "runtime_env_value \"\$AXORA_RUNTIME_ENV_FILE\" $runtime_key" "$SCRIPT_DIR/preflight.sh" \
    || die "Preflight does not uniquely validate runtime key: $runtime_key"
done
rollback_cleanup_line="$(
  grep -nF 'remove_email_sender_if_release_lacks_it "$target_release"' \
    "$SCRIPT_DIR/rollback.sh" | cut -d: -f1
)"
rollback_swap_line="$(
  grep -nF 'compose_release "$target_release" up' "$SCRIPT_DIR/rollback.sh" | cut -d: -f1
)"
[[ "$rollback_cleanup_line" =~ ^[0-9]+$ && "$rollback_swap_line" =~ ^[0-9]+$ ]] \
  && (( rollback_cleanup_line > rollback_swap_line )) \
  || die "Rollback must remove a legacy target's orphan email-sender only after its gated Compose swap."

validation_dir="$(mktemp -d)"
cleanup() {
  if [[ -n "${validation_dir:-}" && -d "$validation_dir" && ! -L "$validation_dir" ]]; then
    rm -rf -- "$validation_dir"
  fi
}
trap cleanup EXIT

legacy_release="$validation_dir/legacy-release"
email_release="$validation_dir/email-release"
mkdir "$legacy_release" "$email_release"
for compose_file in compose.yaml compose.hybrid.yaml compose.production.yaml; do
  touch "$legacy_release/$compose_file" "$email_release/$compose_file"
done
printf 'services:\n  email-sender:\n    image: fixture\n' > "$email_release/compose.yaml"
AXORA_COMPOSE_FILES=compose.yaml:compose.hybrid.yaml:compose.production.yaml
email_sender_removals=0
remove_ephemeral_email_sender() {
  email_sender_removals=$(( email_sender_removals + 1 ))
}
remove_email_sender_if_release_lacks_it "$legacy_release"
[[ "$email_sender_removals" -eq 1 ]] \
  || die "A release without email-sender must trigger orphan cleanup."
remove_email_sender_if_release_lacks_it "$email_release"
[[ "$email_sender_removals" -eq 1 ]] \
  || die "A release that defines email-sender must retain the service."

release_export_dir="$validation_dir/release-export"
release_bare_repository="$validation_dir/repository.git"
mkdir "$release_export_dir"
validation_sha="$(git -C "$REPOSITORY_DIR" rev-parse --verify HEAD)"
git init --quiet --bare --initial-branch=main "$release_bare_repository"
git --git-dir="$release_bare_repository" fetch \
  --quiet \
  --no-tags \
  "$REPOSITORY_DIR" \
  "$validation_sha"
materialize_git_tree \
  "$release_bare_repository" \
  "$validation_sha" \
  "$release_export_dir"
cmp --silent "$REPOSITORY_DIR/package.json" "$release_export_dir/package.json" \
  || die "Isolated Git release export changed package.json."
[[ ! -e "$release_export_dir/.axora-deployment-control" ]] \
  || die "Isolated Git release export leaked its control directory."
grep -Fq 'materialize_git_tree "$AXORA_REPOSITORY_DIR"' \
  "$SCRIPT_DIR/deploy.sh" \
  || die "Deployment must use the systemd-compatible isolated Git export."

secrets_dir="$validation_dir/secrets"
uploads_dir="$validation_dir/uploads"
compose_json="$validation_dir/compose.json"
mkdir -p "$secrets_dir" "$uploads_dir"
for secret in \
  postgres_admin_password \
  axora_app_password \
  session_secret \
  tailscale_db_auth_key \
  cloudflare_tunnel_token \
  cloudflare_email_api_token \
  axora_email_service_auth_key \
  turnstile_secret; do
  touch "$secrets_dir/$secret"
done
touch "$secrets_dir/zeptomail_send_token" "$secrets_dir/zeptomail_send_token_next"

export AXORA_HOST=axora.management
export LAN_IP=127.0.0.1
export AXORA_HYBRID_DB_NAME=axora_hybrid
export AXORA_ORIGIN_BIND=127.0.0.1
export AXORA_ORIGIN_PORT=8080
export AXORA_SECRETS_DIR="$secrets_dir"
export AXORA_UPLOADS_DIR="$uploads_dir"
export AXORA_IMAGE=axora-app:0123456789012345678901234567890123456789
export AXORA_EMAIL_DELIVERY_ENABLED=false
export CLOUDFLARE_ACCOUNT_ID=00000000000000000000000000000000
export CLOUDFLARE_ZONE_ID=00000000000000000000000000000000
export AXORA_EMAIL_FROM_ADDRESS=noreply@axora.management
export AXORA_EMAIL_FROM_NAME=Axora
export AXORA_EMAIL_REPLY_TO=support@axora.management
export AXORA_EMAIL_PROVIDER=cloudflare-email-service
export TURNSTILE_SITE_KEY=
export TURNSTILE_HOSTNAMES=axora.management
export AXORA_TURNSTILE_EXPECTED_HOSTNAME=axora.management

docker compose \
  --project-directory "$REPOSITORY_DIR" \
  -f "$REPOSITORY_DIR/compose.yaml" \
  -f "$REPOSITORY_DIR/compose.hybrid.yaml" \
  -f "$REPOSITORY_DIR/compose.production.yaml" \
  config --quiet
docker compose \
  --project-directory "$REPOSITORY_DIR" \
  -f "$REPOSITORY_DIR/compose.yaml" \
  -f "$REPOSITORY_DIR/compose.hybrid.yaml" \
  -f "$REPOSITORY_DIR/compose.production.yaml" \
  config --format json > "$compose_json"

jq --exit-status \
  --arg secrets "$secrets_dir" \
  --arg uploads "$uploads_dir" \
  '
    (.services | keys | sort) ==
      ["app","caddy","cloudflared","db","email-sender","migrate","tailscale-db"]
    and .services.app.environment.DEMO_MODE == "false"
    and .services.app.environment.DB_NAME == "axora_hybrid"
    and .services.app.environment.APP_BASE_URL == "https://axora.management"
    and .services.app.environment.AXORA_EMAIL_DELIVERY_ENABLED == "false"
    and .services.app.environment.AXORA_EMAIL_SENDER_URL == "http://email-sender:3100"
    and .services.app.environment.AXORA_EMAIL_SERVICE_AUTH_KEY_FILE == "/run/secrets/axora_email_service_auth_key"
    and .services.app.environment.ACCOUNT_SETUP_TTL_HOURS == "24"
    and .services.app.environment.AXORA_EMAIL_REPLY_TO == "support@axora.management"
    and .services.app.environment.AXORA_UPLOADS_CONTAINER_DIR == "/app/data/uploads"
    and .services.app.environment.TURNSTILE_SECRET_FILE == "/run/secrets/turnstile_secret"
    and .services.app.environment.TURNSTILE_HOSTNAMES == "axora.management"
    and .services.app.environment.AXORA_TURNSTILE_EXPECTED_HOSTNAME == "axora.management"
    and .services["email-sender"].environment.AXORA_EMAIL_PROVIDER == "cloudflare-email-service"
    and .services["email-sender"].environment.ZEPTOMAIL_SEND_TOKEN_FILE == "/run/secrets/zeptomail_send_token"
    and .services["email-sender"].environment.ZEPTOMAIL_SEND_TOKEN_NEXT_FILE == "/run/secrets/zeptomail_send_token_next"
    and .services["email-sender"].environment.AXORA_EMAIL_OUTBOX_URL == "http://app:3000/account/email-outbox"
    and .services["email-sender"].environment.AXORA_EMAIL_SERVICE_AUTH_KEY_FILE == "/run/secrets/axora_email_service_auth_key"
    and .services.db.environment.POSTGRES_DB == "axora_hybrid"
    and .services.migrate.environment.POSTGRES_DB == "axora_hybrid"
    and .networks.backend.internal == true
    and .networks.frontend.internal == true
    and .networks.mail.internal == true
    and (.services.db.ports // []) == []
    and (.services.app.ports // []) == []
    and (.services.cloudflared.ports // []) == []
    and (.services["email-sender"].ports // []) == []
    and ([.services.app.secrets[].source] | index("axora_email_service_auth_key")) != null
    and ([.services.app.secrets[].source] | index("turnstile_secret")) != null
    and ([.services["email-sender"].secrets[].source] | sort) ==
      ["axora_email_service_auth_key","cloudflare_email_api_token","zeptomail_send_token","zeptomail_send_token_next"]
    and (
      [
        .services
        | to_entries[]
        | .key as $service
        | .value.ports[]?
        | {
            service: $service,
            host_ip: .host_ip,
            published: .published,
            target: .target
          }
      ]
      ==
      [{
        service: "caddy",
        host_ip: "127.0.0.1",
        published: "8080",
        target: 8080
      }]
    )
    and (.services.cloudflared.networks | keys) == ["edge"]
    and (.services.caddy.networks | keys | sort) == ["edge","frontend"]
    and (.services.db.networks | keys) == ["backend"]
    and (.services.app.networks | keys | sort) == ["backend","frontend","mail"]
    and (.services["email-sender"].networks | keys | sort) == ["email-egress","mail"]
    and .services["email-sender"].networks["email-egress"].gw_priority == 1
    and .services.app.read_only == true
    and .services["email-sender"].read_only == true
    and .services.cloudflared.read_only == true
    and (.services.app.cap_drop | index("ALL")) != null
    and (.services["email-sender"].cap_drop | index("ALL")) != null
    and (.services.caddy.cap_drop | index("ALL")) != null
    and .services.caddy.cap_add == ["NET_BIND_SERVICE"]
    and (.services.cloudflared.cap_drop | index("ALL")) != null
    and (.services.app.volumes[0].source == $uploads)
    and (.secrets.postgres_admin_password.file == ($secrets + "/postgres_admin_password"))
    and (.secrets.axora_app_password.file == ($secrets + "/axora_app_password"))
    and (.secrets.session_secret.file == ($secrets + "/session_secret"))
    and (.secrets.tailscale_db_auth_key.file == ($secrets + "/tailscale_db_auth_key"))
    and (.secrets.cloudflare_tunnel_token.file == ($secrets + "/cloudflare_tunnel_token"))
    and (.secrets.cloudflare_email_api_token.file == ($secrets + "/cloudflare_email_api_token"))
    and (.secrets.zeptomail_send_token.file == ($secrets + "/zeptomail_send_token"))
    and (.secrets.zeptomail_send_token_next.file == ($secrets + "/zeptomail_send_token_next"))
    and (.secrets.axora_email_service_auth_key.file == ($secrets + "/axora_email_service_auth_key"))
    and (.secrets.turnstile_secret.file == ($secrets + "/turnstile_secret"))
    and (
      . as $root
      | ["app","caddy","cloudflared","db","email-sender","tailscale-db"]
      | all(
          . as $service
          | $root.services[$service].restart == "unless-stopped"
          and $root.services[$service].healthcheck != null
          and $root.services[$service].logging.driver == "local"
          and $root.services[$service].cpus > 0
          and $root.services[$service].mem_limit != null
          and $root.services[$service].pids_limit > 0
        )
    )
    and (.services.db.image | contains("@sha256:"))
    and (.services.caddy.image | contains("@sha256:"))
    and (.services["tailscale-db"].image | contains("@sha256:"))
    and (.services.cloudflared.image | contains("@sha256:"))
  ' \
  "$compose_json" >/dev/null

caddy_image="$(jq -r '.services.caddy.image' "$compose_json")"
if [[ -z "$caddy_image" || "$caddy_image" == "null" ]]; then
  die "Could not determine caddy image from compose output."
fi

validate_caddy() {
  local image="$1"
  local caddyfile="$2"
  local attempts="${3:-4}"
  local attempt=1

  while (( attempt <= attempts )); do
    if ! docker image inspect "$image" >/dev/null 2>&1; then
      if ! docker pull "$image"; then
        echo "Attempt $attempt/$attempts to pull $image failed. Retrying..." >&2
        if (( attempt == attempts )); then
          return 1
        fi
      fi
    fi

    if docker run --rm \
      --env AXORA_HOST=axora.management \
      --volume "$caddyfile:/etc/caddy/Caddyfile:ro" \
      --entrypoint caddy \
      "$image" \
      validate --config /etc/caddy/Caddyfile >/dev/null; then
      return 0
    fi

    if (( attempt == attempts )); then
      return 1
    fi

    sleep $(( attempt * 2 ))
    attempt=$(( attempt + 1 ))
  done
}

if ! validate_caddy "$caddy_image" "$REPOSITORY_DIR/caddy/Caddyfile.production"; then
  die "Caddyfile validation failed after retrying with image $caddy_image."
fi

printf 'Production deployment assets are valid.\n'
