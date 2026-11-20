#!/usr/bin/env bash
# Create the secret files Axora needs, with fresh random values.
# Existing files are never overwritten. Run from the project folder:
#   bash scripts/handover/new-secrets.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

dir="$(sed -n "s/^AXORA_SECRETS_DIR=//p" .env 2>/dev/null)"; dir="${dir:-./secrets}"
mkdir -p "$dir" data/uploads
chmod 0750 "$dir" 2>/dev/null || true

random_value() { head -c 48 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n'; }

# Generated internal secrets (database passwords, session and service keys).
for name in postgres_admin_password axora_app_password axora_cleanup_worker_password \
  axora_integration_worker_password session_secret axora_integration_encryption_key \
  axora_email_service_auth_key; do
  [ -e "$dir/$name" ] || { random_value > "$dir/$name"; echo "created  $dir/$name"; }
done

# Third-party secrets: replace these placeholder values with the real values
# from Resend / Cloudflare / Slack when you enable those features.
for name in resend_api_key resend_webhook_secret turnstile_secret \
  axora_slack_client_secret axora_slack_signing_secret cloudflare_tunnel_token \
  tailscale_db_auth_key; do
  [ -e "$dir/$name" ] || { printf 'NOT_CONFIGURED' > "$dir/$name"; echo "created  $dir/$name (placeholder)"; }
done

# Containers read secrets as group 1000 and write uploads as user 1001.
chmod 0640 "$dir"/* 2>/dev/null || true
if [ "$(id -u)" = "0" ]; then
  chgrp 1000 "$dir" "$dir"/* && chown 1001:1001 data/uploads
else
  echo "Note: on Linux run this script with sudo so file owners are set for the containers."
fi
echo "Done. Keep $dir private and back it up: the database cannot be opened without these passwords."
