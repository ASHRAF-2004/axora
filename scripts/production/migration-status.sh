#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

release="${1:-}"
db_container="${2:-}"
database_name="${3:-}"
[[ -d "$release/database/migrations" && ! -L "$release" ]] \
  || die "Migration status requires a safe release directory."
[[ "$db_container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] \
  || die "Migration status received an unsafe database container identifier."
valid_database_name "$database_name" || die "Unsafe database name: $database_name"

expected_manifest="$(mktemp)"
applied_manifest="$(mktemp)"
cleanup() {
  rm -f -- "$expected_manifest" "$applied_manifest"
}
trap cleanup EXIT HUP INT TERM

for migration in "$release"/database/migrations/[0-9][0-9][0-9]_*.sql; do
  [[ -f "$migration" && ! -L "$migration" ]] || continue
  filename="$(basename -- "$migration")"
  [[ "$filename" =~ ^[0-9]{3}_[A-Za-z0-9._-]+\.sql$ ]] \
    || die "Unsafe migration filename: $filename"
  checksum="$(sha256sum "$migration" | awk '{print $1}')"
  printf '%s\t%s\n' "$filename" "$checksum" >> "$expected_manifest"
done
LC_ALL=C sort -o "$expected_manifest" "$expected_manifest"

table_exists="$(
  docker exec "$db_container" psql \
    --username postgres \
    --dbname "$database_name" \
    --tuples-only \
    --no-align \
    --set=ON_ERROR_STOP=1 \
    --command "SELECT to_regclass('public.schema_migrations') IS NOT NULL;" \
    | tr -d '[:space:]'
)"
if [[ "$table_exists" == "f" ]]; then
  printf 'required\n'
  exit 0
fi
[[ "$table_exists" == "t" ]] || die "Unable to determine migration-ledger status."

docker exec "$db_container" psql \
  --username postgres \
  --dbname "$database_name" \
  --tuples-only \
  --no-align \
  --field-separator $'\t' \
  --set=ON_ERROR_STOP=1 \
  --command "SELECT filename, sha256 FROM schema_migrations ORDER BY filename;" \
  > "$applied_manifest"

while IFS=$'\t' read -r filename checksum extra; do
  [[ -z "$filename" ]] && continue
  [[ -z "${extra:-}" && "$filename" =~ ^[0-9]{3}_[A-Za-z0-9._-]+\.sql$ \
    && "$checksum" =~ ^[0-9a-f]{64}$ ]] \
    || die "Production migration ledger contains an invalid row."
done < "$applied_manifest"

unexpected="$(LC_ALL=C comm -23 "$applied_manifest" "$expected_manifest" | sed -n '1p')"
[[ -z "$unexpected" ]] \
  || die "Production migration history is not an immutable subset of this release."

if cmp --silent "$expected_manifest" "$applied_manifest"; then
  printf 'none\n'
else
  printf 'required\n'
fi
