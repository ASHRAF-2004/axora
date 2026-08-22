#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

expected_utc_day="${1:-}"
monthly_opening="${2:-}"
daily_opening="${3:-}"
operator_reference="${4:-}"

[[ "$expected_utc_day" =~ ^20[0-9]{2}-[0-9]{2}-[0-9]{2}$ ]] \
  || die "Expected UTC day must use YYYY-MM-DD."
[[ "$monthly_opening" =~ ^[0-9]{1,10}$ ]] \
  || die "Monthly opening usage must be a non-negative decimal integer."
[[ "$daily_opening" =~ ^[0-9]{1,10}$ ]] \
  || die "Daily opening usage must be a non-negative decimal integer."
[[ "$operator_reference" =~ ^[A-Za-z0-9_.:@-]{3,120}$ ]] \
  || die "Operator reference contains unsupported characters."

require_root
require_command docker
load_config
db_container="$(find_service_container db)" \
  || die "Expected exactly one running production database container."

current_utc_day="$(date --utc +%F)"
[[ "$current_utc_day" == "$expected_utc_day" ]] \
  || die "UTC day changed since the opening usage was confirmed; baseline was not written."

latest_migration="$(
  docker exec "$db_container" psql --username postgres \
    --dbname "$AXORA_DATABASE_NAME" --tuples-only --no-align \
    --set=ON_ERROR_STOP=1 \
    --command "SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1;" \
    | tr -d '[:space:]'
)"
[[ "$latest_migration" == "109_axora_email_usage_tracking.sql" ]] \
  || die "Production migration ledger is not at migration 109."

docker exec --interactive "$db_container" psql --username postgres \
  --dbname "$AXORA_DATABASE_NAME" --set=ON_ERROR_STOP=1 \
  --set=baseline_day="$expected_utc_day" \
  --set=monthly_opening="$monthly_opening" \
  --set=daily_opening="$daily_opening" \
  --set=operator_reference="$operator_reference" <<'SQL'
BEGIN;
CREATE TEMP TABLE axora_email_usage_baseline_input ON COMMIT DROP AS
SELECT :'baseline_day'::date AS baseline_day,
  :'monthly_opening'::bigint AS monthly_opening,
  :'daily_opening'::bigint AS daily_opening,
  :'operator_reference'::text AS operator_reference;
DO $baseline$
DECLARE existing public.email_usage_opening_baselines%ROWTYPE;
  cutover_at timestamptz:=clock_timestamp();
  input record;
BEGIN
  SELECT * INTO STRICT input FROM axora_email_usage_baseline_input;
  SELECT * INTO existing FROM public.email_usage_opening_baselines
  WHERE provider_name='resend' FOR UPDATE;
  IF FOUND THEN
    IF existing.day_start<>input.baseline_day
      OR existing.month_start<>date_trunc('month',input.baseline_day)::date
      OR existing.monthly_opening_used<>input.monthly_opening
      OR existing.daily_opening_used<>input.daily_opening
      OR existing.source<>'USER_CONFIRMED_RESEND_DASHBOARD'
      OR existing.operator_reference<>input.operator_reference THEN
      RAISE EXCEPTION 'Existing email usage baseline does not match the authorized initialization';
    END IF;
    RETURN;
  END IF;

  IF (cutover_at AT TIME ZONE 'UTC')::date<>input.baseline_day THEN
    RAISE EXCEPTION 'UTC day changed before baseline insertion';
  END IF;
  INSERT INTO public.email_usage_opening_baselines(
    provider_name,baseline_at,period_timezone,month_start,
    monthly_opening_used,day_start,daily_opening_used,source,operator_reference
  ) VALUES (
    'resend',cutover_at,'UTC',date_trunc('month',cutover_at AT TIME ZONE 'UTC')::date,
    input.monthly_opening,(cutover_at AT TIME ZONE 'UTC')::date,
    input.daily_opening,'USER_CONFIRMED_RESEND_DASHBOARD',input.operator_reference
  );
END $baseline$;
COMMIT;
SELECT provider_name,baseline_at,period_timezone,month_start,
  monthly_opening_used,day_start,daily_opening_used,source,operator_reference
FROM public.email_usage_opening_baselines WHERE provider_name='resend';
SQL

log "Axora email usage opening baseline is initialized and unchanged on replay."
