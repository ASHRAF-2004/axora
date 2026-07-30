#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_DIR="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

for command in bash cmp docker git jq mktemp node; do
  command -v "$command" >/dev/null 2>&1 \
    || { printf 'Required command not found: %s\n' "$command" >&2; exit 1; }
done

bash -n "$SCRIPT_DIR"/*.sh
node --check "$REPOSITORY_DIR/server-tools/migrate.mjs"

validation_dir="$(mktemp -d)"
cleanup() {
  if [[ -n "${validation_dir:-}" && -d "$validation_dir" && ! -L "$validation_dir" ]]; then
    rm -rf -- "$validation_dir"
  fi
}
trap cleanup EXIT

release_export_dir="$validation_dir/release-export"
mkdir "$release_export_dir"
validation_sha="$(git -C "$REPOSITORY_DIR" rev-parse --verify HEAD)"
materialize_git_tree \
  "$REPOSITORY_DIR/.git" \
  "$validation_sha" \
  "$release_export_dir"
cmp --silent "$REPOSITORY_DIR/package.json" "$release_export_dir/package.json" \
  || die "Isolated Git release export changed package.json."
[[ ! -e "$release_export_dir/.axora-deployment-control" ]] \
  || die "Isolated Git release export leaked its control directory."

secrets_dir="$validation_dir/secrets"
uploads_dir="$validation_dir/uploads"
compose_json="$validation_dir/compose.json"
mkdir -p "$secrets_dir" "$uploads_dir"
for secret in \
  postgres_admin_password \
  axora_app_password \
  session_secret \
  tailscale_db_auth_key \
  cloudflare_tunnel_token; do
  touch "$secrets_dir/$secret"
done

export AXORA_HOST=axora.management
export LAN_IP=127.0.0.1
export AXORA_HYBRID_DB_NAME=axora_hybrid
export AXORA_ORIGIN_BIND=127.0.0.1
export AXORA_ORIGIN_PORT=8080
export AXORA_SECRETS_DIR="$secrets_dir"
export AXORA_UPLOADS_DIR="$uploads_dir"
export AXORA_IMAGE=axora-app:0123456789012345678901234567890123456789

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
      ["app","caddy","cloudflared","db","migrate","tailscale-db"]
    and .services.app.environment.DEMO_MODE == "false"
    and .services.app.environment.DB_NAME == "axora_hybrid"
    and .services.app.environment.APP_BASE_URL == "https://axora.management"
    and .services.db.environment.POSTGRES_DB == "axora_hybrid"
    and .services.migrate.environment.POSTGRES_DB == "axora_hybrid"
    and .networks.backend.internal == true
    and .networks.frontend.internal == true
    and (.services.db.ports // []) == []
    and (.services.app.ports // []) == []
    and (.services.cloudflared.ports // []) == []
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
    and (.services.app.networks | keys | sort) == ["backend","frontend"]
    and .services.app.read_only == true
    and .services.cloudflared.read_only == true
    and (.services.app.cap_drop | index("ALL")) != null
    and (.services.caddy.cap_drop | index("ALL")) != null
    and .services.caddy.cap_add == ["NET_BIND_SERVICE"]
    and (.services.cloudflared.cap_drop | index("ALL")) != null
    and (.services.app.volumes[0].source == $uploads)
    and (.secrets.postgres_admin_password.file == ($secrets + "/postgres_admin_password"))
    and (.secrets.axora_app_password.file == ($secrets + "/axora_app_password"))
    and (.secrets.session_secret.file == ($secrets + "/session_secret"))
    and (.secrets.tailscale_db_auth_key.file == ($secrets + "/tailscale_db_auth_key"))
    and (.secrets.cloudflare_tunnel_token.file == ($secrets + "/cloudflare_tunnel_token"))
    and (
      . as $root
      | ["app","caddy","cloudflared","db","tailscale-db"]
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

docker run --rm \
  --env AXORA_HOST=axora.management \
  --volume "$REPOSITORY_DIR/caddy/Caddyfile.production:/etc/caddy/Caddyfile:ro" \
  --entrypoint caddy \
  "caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648" \
  validate --config /etc/caddy/Caddyfile >/dev/null

printf 'Production deployment assets are valid.\n'
