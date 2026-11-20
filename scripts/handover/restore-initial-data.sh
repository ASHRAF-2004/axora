#!/usr/bin/env bash
# Load the handover database (first Owner account + product catalogue) into a
# NEW Axora installation. It refuses to touch a database that already has users
# unless you pass --replace-existing-data (that DELETES all existing data).
#   bash scripts/handover/restore-initial-data.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

dump="database/handover/axora-initial.dump"
[ -f "$dump" ] || { echo "Missing $dump" >&2; exit 1; }

echo "Starting the database (first start creates roles and runs all migrations)..."
docker compose up -d --wait db
db="$(docker compose exec -T db printenv POSTGRES_DB)"
psql() { docker compose exec -T db psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

docker compose run --rm migrate >/dev/null
users="$(psql -d "$db" -Atc 'SELECT count(*) FROM users')"
if [ "$users" != "0" ] && [ "${1:-}" != "--replace-existing-data" ]; then
  echo "Refusing: database '$db' already has $users user(s). Nothing was changed." >&2
  exit 1
fi

echo "Stopping application containers..."
docker compose stop app email-sender budget-worker document-worker \
  company-deletion-cleanup-worker integration-worker caddy >/dev/null 2>&1 || true

echo "Replacing database '$db' with the handover snapshot..."
psql -d postgres -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" >/dev/null
docker compose exec -T db pg_restore -U postgres --create --exit-on-error -d postgres < "$dump"

echo "Re-applying migrations and permission grants..."
docker compose run --rm migrate >/dev/null

echo "Starting Axora..."
docker compose up -d --wait
psql -d "$db" -Atc "SELECT 'owner account: '||email FROM users WHERE is_owner"
psql -d "$db" -Atc "SELECT 'products: '||count(*) FROM products"
echo "Done. Sign in with the credentials in OWNER-ACCOUNT.txt and change the password."
