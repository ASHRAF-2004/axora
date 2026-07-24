#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
require_command node
require_command docker

[[ -t 0 ]] || fail "Run this command in an interactive terminal."

printf 'This uses a temporary Tailscale API access token to configure only Axora.\n'
printf 'The token will not be shown, saved, or added to shell history.\n'

tailscale_api_token=""
trap 'tailscale_api_token=""' EXIT HUP INT TERM
if ! read -r -s -p "Temporary Tailscale API access token: " tailscale_api_token; then
  printf '\n'
  fail "No token was entered."
fi
printf '\n'
[[ "$tailscale_api_token" == tskey-api-* ]] \
  || fail "That does not look like a Tailscale API access token."

node server-tools/configure-tailscale.mjs 3<<<"$tailscale_api_token"
tailscale_api_token=""
trap - EXIT HUP INT TERM

info "Starting Ubuntu's private database endpoint"
if docker info >/dev/null 2>&1; then
  bash scripts/server/hybrid-up.sh
elif id -nG "$(id -un)" | tr ' ' '\n' | grep -Fxq docker; then
  sg docker -c 'bash scripts/server/hybrid-up.sh'
else
  fail "Your Linux user needs access to Docker before the private endpoint can start."
fi

info "Tailscale is ready. Return to Codex and say: done"
