#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"

install -m 700 -d secrets

store_key() {
  local target="$1" label="$2" key
  if [[ -s "$target" ]]; then
    info "Keeping the existing $label"
    return
  fi

  read -r -s -p "$label: " key
  printf '\n'
  [[ "$key" == tskey-auth-* ]] \
    || fail "That does not look like a Tailscale auth key."
  [[ ${#key} -ge 30 ]] || fail "The Tailscale auth key is too short."

  umask 077
  printf '%s\n' "$key" > "$target"
  chmod 600 "$target"
  unset key
}

printf 'Paste the two separately generated Tailscale keys. They will not be shown or saved in shell history.\n'
store_key secrets/tailscale_db_auth_key "One-time tag:axora-db key"
store_key secrets/tailscale_render_auth_key "Reusable ephemeral tag:axora-render key"

if cmp -s secrets/tailscale_db_auth_key secrets/tailscale_render_auth_key; then
  : > secrets/tailscale_render_auth_key
  rm -- secrets/tailscale_render_auth_key
  fail "Use two separate tagged keys. The Render key was not kept; run this script again."
fi

info "Saved both Tailscale keys with owner-only permissions"
printf 'To rotate one, remove only its matching file and run this script again.\n'
