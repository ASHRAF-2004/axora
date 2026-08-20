#!/usr/bin/env bash
set -Eeuo pipefail

readonly ROOT_GATEWAY="/usr/local/libexec/axora-production/run-ci-deploy.sh"
readonly SAFE_PATH="/usr/bin:/bin"
export PATH="$SAFE_PATH"
umask 077

deny() {
  printf 'Axora deployment command rejected.\n' >&2
  exit 64
}

[[ "$#" -eq 0 ]] || deny
[[ -n "${SSH_CONNECTION:-}" && -z "${SSH_TTY:-}" ]] || deny
original_command="${SSH_ORIGINAL_COMMAND:-}"
(( ${#original_command} <= 160 )) || deny

if [[ "$original_command" =~ ^deploy\ ([0-9a-f]{40})\ (sha256:[0-9a-f]{64})$ ]]; then
  commit_sha="${BASH_REMATCH[1]}"
  image_digest="${BASH_REMATCH[2]}"
else
  deny
fi

unset SSH_ORIGINAL_COMMAND BASH_REMATCH
printf '%s\n%s\n' "$commit_sha" "$image_digest" \
  | /usr/bin/sudo --non-interactive "$ROOT_GATEWAY"
