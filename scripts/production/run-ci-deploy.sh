#!/usr/bin/env bash
set -Eeuo pipefail

readonly DEPLOY_CONTROLLER="/usr/local/libexec/axora-production/deploy.sh"
readonly DEPLOY_CONFIG="/etc/axora-production/deploy.env"

deny() {
  printf 'Invalid privileged deployment request.\n' >&2
  exit 64
}

[[ "$#" -eq 0 ]] || deny
[[ "$(id -u)" -eq 0 ]] || deny

IFS= read -r commit_sha || deny
IFS= read -r image_digest || deny
if IFS= read -r unexpected_input; then
  deny
fi
[[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || deny
[[ "$image_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || deny

exec /usr/bin/env -i \
  HOME=/root \
  USER=root \
  LOGNAME=root \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  AXORA_CONFIG_FILE="$DEPLOY_CONFIG" \
  "$DEPLOY_CONTROLLER" --automatic "$commit_sha" "$image_digest"
