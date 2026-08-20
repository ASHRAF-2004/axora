#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly DEPLOY_USER="axora-deploy"
readonly DEPLOY_HOME="/var/lib/axora-deploy-trigger"
readonly AUTHORIZED_KEYS="$DEPLOY_HOME/.ssh/authorized_keys"
readonly FORCED_COMMAND="/usr/local/bin/axora-deploy-trigger"
readonly SUDOERS_SOURCE="/usr/local/libexec/axora-production/axora-deploy.sudoers"
readonly SUDOERS_TARGET="/etc/sudoers.d/axora-deploy"

fail() {
  printf '[axora-production] ERROR: %s\n' "$*" >&2
  exit 1
}

[[ "$(id -u)" -eq 0 ]] || fail "Run this command as root."
[[ "$#" -eq 1 ]] || fail "Usage: $0 /path/to/github-actions-deploy-key.pub"
public_key_file="$1"
[[ -f "$public_key_file" && ! -L "$public_key_file" ]] \
  || fail "The deployment public key must be a regular, non-symlink file."
(( $(stat -c '%s' "$public_key_file") <= 2048 )) \
  || fail "The deployment public key is unexpectedly large."
[[ "$(wc -l < "$public_key_file")" -eq 1 ]] \
  || fail "The deployment public key must contain exactly one line."

read -r key_type key_material key_comment < "$public_key_file"
[[ "$key_type" == "ssh-ed25519" ]] || fail "Only Ed25519 deployment keys are accepted."
[[ "$key_material" =~ ^[A-Za-z0-9+/]+={0,2}$ ]] \
  || fail "The deployment public key is malformed."
ssh-keygen -l -f "$public_key_file" >/dev/null \
  || fail "ssh-keygen rejected the deployment public key."

if id "$DEPLOY_USER" >/dev/null 2>&1; then
  passwd_record="$(getent passwd "$DEPLOY_USER")"
  IFS=: read -r _ _ _ deploy_gid _ deploy_home deploy_shell <<< "$passwd_record"
  [[ "$deploy_home" == "$DEPLOY_HOME" && "$deploy_shell" == "/bin/bash" ]] \
    || fail "Existing deployment account has an unexpected home or shell."
  [[ "$(id -g "$DEPLOY_USER")" == "$deploy_gid" ]] \
    || fail "Existing deployment account has an unexpected primary group."
  [[ "$(id -G "$DEPLOY_USER" | tr ' ' '\n' | sort -u | wc -l)" -eq 1 ]] \
    || fail "Deployment account must not have supplementary groups."
else
  useradd \
    --system \
    --create-home \
    --home-dir "$DEPLOY_HOME" \
    --shell /bin/bash \
    --user-group \
    "$DEPLOY_USER"
fi
passwd --lock "$DEPLOY_USER" >/dev/null

deploy_group="$(id -gn "$DEPLOY_USER")"
install -d -o "$DEPLOY_USER" -g "$deploy_group" -m 0750 "$DEPLOY_HOME"
install -d -o "$DEPLOY_USER" -g "$deploy_group" -m 0700 "$DEPLOY_HOME/.ssh"

temporary_keys="$(mktemp)"
trap 'rm -f -- "$temporary_keys"' EXIT
printf '%s %s %s\n' \
  'restrict,command="/usr/local/bin/axora-deploy-trigger",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding' \
  "$key_type" \
  "$key_material" \
  > "$temporary_keys"
install -o "$DEPLOY_USER" -g "$deploy_group" -m 0600 "$temporary_keys" "$AUTHORIZED_KEYS"
rm -f -- "$temporary_keys"
trap - EXIT

[[ -x "$FORCED_COMMAND" && ! -L "$FORCED_COMMAND" ]] \
  || fail "Installed forced-command wrapper is missing or unsafe."
[[ -f "$SUDOERS_SOURCE" && ! -L "$SUDOERS_SOURCE" ]] \
  || fail "Installed sudoers policy is missing or unsafe."
install -o root -g root -m 0440 "$SUDOERS_SOURCE" "$SUDOERS_TARGET"
visudo -cf "$SUDOERS_TARGET" >/dev/null || fail "The deployment sudoers policy is invalid."

printf '[axora-production] Restricted SSH deployment identity configured for %s.\n' "$DEPLOY_USER"
