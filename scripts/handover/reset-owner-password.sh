#!/usr/bin/env bash
# Emergency Platform Owner password reset (use when the email "forgot password"
# flow is not configured). Usage:
#   bash scripts/handover/reset-owner-password.sh owner@axora.management
set -euo pipefail
cd "$(dirname "$0")/../.."
export MSYS_NO_PATHCONV=1  # Git Bash on Windows: keep container paths as written
email="${1:?Usage: reset-owner-password.sh <owner-email>}"
secrets="$(sed -n "s/^AXORA_SECRETS_DIR=//p" .env 2>/dev/null)"; secrets="${secrets:-./secrets}"
db="$(docker compose exec -T db printenv POSTGRES_DB </dev/null)"

read -rsp "New password (15-128 characters): " password; echo
read -rsp "Repeat new password: " again; echo
[ "$password" = "$again" ] || { echo "Passwords do not match." >&2; exit 1; }

printf '%s' "$password" | docker compose run --rm --no-deps -T \
  -v "./scripts/handover/reset-owner-password.mjs:/app/scripts/reset-owner-password.mjs:ro" \
  -e OWNER_EMAIL="$email" \
  -e DATABASE_URL="postgresql://postgres:$(cat "$secrets/postgres_admin_password")@db:5432/$db" \
  app node scripts/reset-owner-password.mjs
