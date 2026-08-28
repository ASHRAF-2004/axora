#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
POSTGRES_IMAGE="${AXORA_NATIVE_POSTGRES_IMAGE:-postgres:18.4-alpine3.24@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15}"
CONTAINER_NAME="axora-native-postgres-${GITHUB_RUN_ID:-local}-$$"
DATABASE_NAME="axora_native_ci"
ADMIN_USER="postgres"
ADMIN_PASSWORD="axora-native-admin-fixture"
APP_PASSWORD="axora-native-app-fixture"
CLEANUP_PASSWORD="axora-native-cleanup-fixture"
EXPECTED_MIGRATIONS="$(find "$ROOT_DIR/database/migrations" -maxdepth 1 -type f -name '[0-9][0-9][0-9]_*.sql' | wc -l | tr -d '[:space:]')"
TEMP_DIR="$(mktemp -d)"

cleanup() {
  docker rm --force "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -rf -- "$TEMP_DIR"
}
trap cleanup EXIT HUP INT TERM

case "$POSTGRES_IMAGE" in
  postgres:*@sha256:*) ;;
  *) printf 'Native PostgreSQL verification requires a digest-pinned official image.\n' >&2; exit 1 ;;
esac

install -m 0600 /dev/null "$TEMP_DIR/postgres_admin_password"
install -m 0600 /dev/null "$TEMP_DIR/axora_app_password"
install -m 0600 /dev/null "$TEMP_DIR/axora_cleanup_worker_password"
printf '%s' "$ADMIN_PASSWORD" > "$TEMP_DIR/postgres_admin_password"
printf '%s' "$APP_PASSWORD" > "$TEMP_DIR/axora_app_password"
printf '%s' "$CLEANUP_PASSWORD" > "$TEMP_DIR/axora_cleanup_worker_password"
chmod 0444 "$TEMP_DIR"/*

docker run --detach --name "$CONTAINER_NAME" \
  --publish 127.0.0.1::5432 \
  --env "POSTGRES_DB=$DATABASE_NAME" \
  --env "POSTGRES_USER=$ADMIN_USER" \
  --env "POSTGRES_PASSWORD=$ADMIN_PASSWORD" \
  --mount "type=bind,source=$ROOT_DIR/database/init,target=/docker-entrypoint-initdb.d,readonly" \
  --mount "type=bind,source=$ROOT_DIR/database/migrations,target=/migrations,readonly" \
  --mount "type=bind,source=$ROOT_DIR/database/admin,target=/database/admin,readonly" \
  --mount "type=bind,source=$TEMP_DIR/postgres_admin_password,target=/run/secrets/postgres_admin_password,readonly" \
  --mount "type=bind,source=$TEMP_DIR/axora_app_password,target=/run/secrets/axora_app_password,readonly" \
  --mount "type=bind,source=$TEMP_DIR/axora_cleanup_worker_password,target=/run/secrets/axora_cleanup_worker_password,readonly" \
  "$POSTGRES_IMAGE" >/dev/null

ready=false
for _ in $(seq 1 120); do
  applied="$(docker exec \
    --env "PGPASSWORD=$ADMIN_PASSWORD" \
    "$CONTAINER_NAME" psql --quiet --tuples-only --no-align \
      --username "$ADMIN_USER" --dbname "$DATABASE_NAME" \
      --command "SELECT count(*) FROM schema_migrations" 2>/dev/null || true)"
  if [[ "$applied" == "$EXPECTED_MIGRATIONS" ]]; then
    ready=true
    break
  fi
  if [[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || true)" != "true" ]]; then
    docker logs "$CONTAINER_NAME" >&2
    exit 1
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  docker logs "$CONTAINER_NAME" >&2
  printf 'Native PostgreSQL did not apply all %s migrations.\n' "$EXPECTED_MIGRATIONS" >&2
  exit 1
fi

# The official image first runs init scripts against a temporary postmaster,
# then shuts it down and starts the long-lived server. The migration ledger can
# become complete in the narrow interval before that intentional shutdown, so
# wait for the entrypoint's init-complete marker and the final postmaster before
# issuing grant or test commands.
final_ready=false
for _ in $(seq 1 120); do
  if docker logs "$CONTAINER_NAME" 2>&1 \
      | grep -Fq 'PostgreSQL init process complete; ready for start up.' \
    && docker exec \
      --env "PGPASSWORD=$ADMIN_PASSWORD" \
      "$CONTAINER_NAME" psql --quiet --tuples-only --no-align \
        --username "$ADMIN_USER" --dbname "$DATABASE_NAME" \
        --command 'SELECT 1' 2>/dev/null | grep -qx '1'; then
    final_ready=true
    break
  fi
  if [[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || true)" != "true" ]]; then
    docker logs "$CONTAINER_NAME" >&2
    exit 1
  fi
  sleep 1
done
if [[ "$final_ready" != true ]]; then
  docker logs "$CONTAINER_NAME" >&2
  printf 'Native PostgreSQL final postmaster did not become ready.\n' >&2
  exit 1
fi

docker exec \
  --env "PGPASSWORD=$ADMIN_PASSWORD" \
  "$CONTAINER_NAME" psql --quiet --set=ON_ERROR_STOP=1 \
    --username "$ADMIN_USER" --dbname "$DATABASE_NAME" \
    --file /database/admin/apply-app-grants.sql >/dev/null

# Exercise the deployment migration path a second time. It must recognize every
# immutable checksum and leave the schema and grants unchanged.
docker exec \
  --env "POSTGRES_USER=$ADMIN_USER" \
  --env "POSTGRES_DB=$DATABASE_NAME" \
  "$CONTAINER_NAME" /bin/sh /docker-entrypoint-initdb.d/01-run-migration.sh >/dev/null
docker exec \
  --env "PGPASSWORD=$ADMIN_PASSWORD" \
  "$CONTAINER_NAME" psql --quiet --set=ON_ERROR_STOP=1 \
    --username "$ADMIN_USER" --dbname "$DATABASE_NAME" \
    --file /database/admin/apply-app-grants.sql >/dev/null

docker exec --interactive \
  --env "PGPASSWORD=$ADMIN_PASSWORD" \
  "$CONTAINER_NAME" psql --quiet --set=ON_ERROR_STOP=1 \
    --username "$ADMIN_USER" --dbname "$DATABASE_NAME" <<'SQL'
DO $email_completion_capability$
BEGIN
  IF has_table_privilege(
    'axora_app','public.email_delivery_attempts','INSERT'
  ) THEN
    RAISE EXCEPTION 'Application role has direct email attempt INSERT';
  END IF;
  IF NOT has_function_privilege(
    'axora_app',
    'public.axora_record_transactional_email_attempt(uuid,text,text,integer,text,text,integer,text,text,text,integer,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Application email completion capability is unavailable';
  END IF;
  IF has_function_privilege(
    'public',
    'public.axora_record_transactional_email_attempt(uuid,text,text,integer,text,text,integer,text,text,text,integer,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Email completion capability is exposed to PUBLIC';
  END IF;
  IF has_function_privilege(
    'axora_app',
    'public.axora_reconcile_transactional_email_delivery(uuid,text,text,timestamptz,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'public',
    'public.axora_reconcile_transactional_email_delivery(uuid,text,text,timestamptz,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Owner-only email reconciliation capability is exposed';
  END IF;
END
$email_completion_capability$;

SET ROLE axora_app;
DO $metadata_binding$
BEGIN
  BEGIN
    PERFORM public.axora_record_transactional_email_attempt(
      '10000000-0000-4000-8000-000000000001',
      'CONTACT_NOTIFICATION','new-lead-internal-alert',1,
      'resend','axora-platform',1,'sent',NULL,NULL,NULL,
      '10000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'Unbound email attempt was accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'Transactional email attempt does not match its delivery' THEN
      RAISE;
    END IF;
  END;
END
$metadata_binding$;
RESET ROLE;
SQL

host_port="$(docker port "$CONTAINER_NAME" 5432/tcp \
  | sed -n 's/^127\.0\.0\.1:\([0-9][0-9]*\)$/\1/p' \
  | head -n 1)"
case "$host_port" in
  ''|*[!0-9]*)
    printf 'Native PostgreSQL loopback port could not be resolved.\n' >&2
    exit 1
    ;;
esac

run_native_test() {
  local test_file="$1"
  (
    cd "$ROOT_DIR"
    env -u DATABASE_URL -u DB_PASSWORD_FILE \
      AXORA_NATIVE_POSTGRES_INTEGRATION=true \
      AXORA_NATIVE_POSTGRES_HOST=127.0.0.1 \
      AXORA_NATIVE_POSTGRES_PORT="$host_port" \
      AXORA_NATIVE_POSTGRES_DATABASE="$DATABASE_NAME" \
      AXORA_NATIVE_POSTGRES_ADMIN_USER="$ADMIN_USER" \
      AXORA_NATIVE_POSTGRES_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
      DEMO_MODE=false \
      DATABASE_SSL=false \
      DB_HOST=127.0.0.1 \
      DB_PORT="$host_port" \
      DB_NAME="$DATABASE_NAME" \
      DB_USER=axora_app \
      DB_PASSWORD="$APP_PASSWORD" \
      npx --no-install vitest run "$test_file"
  )
}

# Keep these application-level suites sequential. The Prompt 5 suite ends by
# proving the global last-Platform-Owner invariant and intentionally retires
# other native owner fixtures only after the PR #137 regression is complete.
run_native_test tests/company-activation-contract-native-postgres.test.ts
run_native_test tests/delivery-guy-invitation-native-postgres.test.ts
run_native_test tests/operating-model-concurrency-native-postgres.test.ts
run_native_test tests/company-admin-direct-purchase-native-postgres.test.ts
run_native_test tests/existing-user-management-native-postgres.test.ts

docker exec --interactive \
  --env "PGPASSWORD=$ADMIN_PASSWORD" \
  "$CONTAINER_NAME" psql --quiet --set=ON_ERROR_STOP=1 \
    --set="expected_migrations=$EXPECTED_MIGRATIONS" \
    --username "$ADMIN_USER" --dbname "$DATABASE_NAME" <<'SQL'
SELECT set_config('axora.expected_migrations', :'expected_migrations', false);
DO $verify$
DECLARE
  expected_migrations integer := current_setting('axora.expected_migrations')::integer;
  applied_migrations integer;
  invalid_constraints text[];
  missing_rls text[];
  exposed_cleanup_functions text[];
  exposed_prompt7_functions text[];
  exposed_prompt7_tables text[];
  missing_prompt7_capabilities text[];
BEGIN
  SELECT count(*) INTO applied_migrations FROM public.schema_migrations;
  IF applied_migrations <> expected_migrations THEN
    RAISE EXCEPTION 'Expected % migrations, found %', expected_migrations, applied_migrations;
  END IF;
  IF current_setting('session_replication_role') <> 'origin' THEN
    RAISE EXCEPTION 'Migration verification disabled PostgreSQL triggers or constraints';
  END IF;

  SELECT array_agg(constraint_name ORDER BY constraint_name)
  INTO invalid_constraints
  FROM information_schema.table_constraints
  JOIN pg_constraint ON conname=constraint_name
  WHERE table_schema='public'
    AND constraint_name IN (
      'company_deletion_ownership_rules_unprotected_action_check',
      'company_deletion_cleanup_tasks_status_check',
      'company_deletion_cleanup_tasks_lease_state_check',
      'company_deletion_cleanup_tasks_completion_check'
    )
    AND NOT pg_constraint.convalidated;
  IF coalesce(cardinality(invalid_constraints), 0) <> 0 THEN
    RAISE EXCEPTION 'Deletion constraints are not validated: %', invalid_constraints;
  END IF;

  SELECT array_agg(relname ORDER BY relname)
  INTO missing_rls
  FROM pg_class
  WHERE relnamespace='public'::regnamespace
    AND relname IN (
      'company_deletion_commands',
      'company_deletion_cleanup_tasks',
      'company_deletion_execution_authorizations',
      'company_deletion_tombstones'
    )
    AND (NOT relrowsecurity OR NOT relforcerowsecurity);
  IF coalesce(cardinality(missing_rls), 0) <> 0 THEN
    RAISE EXCEPTION 'Deletion tables lack forced RLS: %', missing_rls;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE pronamespace='public'::regnamespace
      AND proname='axora_company_deletion_impact_v2'
      AND has_function_privilege('axora_app', oid, 'EXECUTE')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE pronamespace='public'::regnamespace
      AND proname='axora_delete_or_archive_company_v2'
      AND has_function_privilege('axora_app', oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Application deletion capabilities are unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE pronamespace='public'::regnamespace
      AND proname='axora_replace_user_role_scope'
      AND has_function_privilege('axora_app', oid, 'EXECUTE')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE pronamespace='public'::regnamespace
      AND proname='axora_pending_access_administration_snapshot'
      AND has_function_privilege('axora_app', oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Prompt 5 application access capabilities are unavailable';
  END IF;

  SELECT array_agg(proname ORDER BY proname)
  INTO exposed_cleanup_functions
  FROM pg_proc
  WHERE pronamespace='public'::regnamespace
    AND proname LIKE 'axora_%company_deletion_cleanup_task%'
    AND has_function_privilege('axora_app', oid, 'EXECUTE');
  IF coalesce(cardinality(exposed_cleanup_functions), 0) <> 0 THEN
    RAISE EXCEPTION 'Cleanup-only functions are exposed to axora_app: %', exposed_cleanup_functions;
  END IF;
  IF has_table_privilege('axora_app', 'public.company_deletion_cleanup_tasks', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'Cleanup task storage is directly exposed to axora_app';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE pronamespace='public'::regnamespace
      AND proname='axora_claim_company_deletion_cleanup_task'
      AND has_function_privilege('axora_cleanup_worker', oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Cleanup worker cannot lease cleanup tasks';
  END IF;

  SELECT array_agg(relname ORDER BY relname)
  INTO missing_rls
  FROM pg_class
  WHERE relnamespace='public'::regnamespace
    AND relname IN (
      'company_lead_profiles',
      'branch_delivery_location_commands',
      'company_wallets',
      'company_wallet_top_up_requests',
      'company_wallet_ledger_entries',
      'company_wallet_top_up_events',
      'approve_and_pay_commands',
      'company_admin_direct_purchase_commands'
    )
    AND (NOT relrowsecurity OR NOT relforcerowsecurity);
  IF coalesce(cardinality(missing_rls), 0) <> 0 THEN
    RAISE EXCEPTION 'Prompt 7 evidence tables lack forced RLS: %', missing_rls;
  END IF;

  SELECT array_agg(DISTINCT table_name ORDER BY table_name)
  INTO exposed_prompt7_tables
  FROM information_schema.role_table_grants
  WHERE grantee='axora_app' AND table_schema='public'
    AND table_name IN (
      'company_lead_profiles','company_lead_intake_rows',
      'branch_delivery_location_commands',
      'company_wallets','company_wallet_top_up_requests',
      'company_wallet_ledger_entries','company_wallet_top_up_events',
      'approve_and_pay_commands','company_admin_direct_purchase_commands'
    );
  IF coalesce(cardinality(exposed_prompt7_tables), 0) <> 0 THEN
    RAISE EXCEPTION 'Prompt 7 raw tables are exposed to axora_app: %',
      exposed_prompt7_tables;
  END IF;

  SELECT array_agg(oid::regprocedure::text ORDER BY oid::regprocedure::text)
  INTO exposed_prompt7_functions
  FROM pg_proc
  WHERE pronamespace='public'::regnamespace
    AND proname IN (
      'axora_create_company_record_internal',
      'axora_delivery_notification_recipients',
      'axora_effective_access_snapshot_unfiltered_internal',
      'axora_workflow_notification_recipient_is_valid_base',
      'axora_create_company_wallet',
      'axora_protect_top_up_request',
      'axora_protect_company_wallet',
      'axora_finance_event_copy',
      'axora_emit_company_finance_event',
      'axora_complete_payment_internal',
      'axora_approve_and_pay_internal',
      'axora_finalize_request_budget',
      'axora_company_admin_direct_purchase_internal',
      'axora_store_company_admin_direct_purchase_result'
    )
    AND has_function_privilege('axora_app', oid, 'EXECUTE');
  IF coalesce(cardinality(exposed_prompt7_functions), 0) <> 0 THEN
    RAISE EXCEPTION 'Prompt 7 internal functions are exposed to axora_app: %',
      exposed_prompt7_functions;
  END IF;

  WITH required(proname) AS (VALUES
    ('axora_record_public_contact_submission'),
    ('axora_create_company_direct'),
    ('axora_create_acquisition_lead'),
    ('axora_branch_delivery_location_workspace'),
    ('axora_save_branch_delivery_location'),
    ('axora_company_wallet_workspace'),
    ('axora_request_company_wallet_top_up'),
    ('axora_record_company_wallet_top_up'),
    ('axora_request_approval_workspace_v2'),
    ('axora_approve_and_pay'),
    ('axora_company_admin_direct_purchase_workspace'),
    ('axora_company_admin_direct_purchase'),
    ('axora_company_admin_direct_purchase_result'),
    ('axora_delivery_evidence_file'),
    ('axora_final_invoice_summary'),
    ('axora_complete_payment'),
    ('axora_company_deletion_impact_v2')
  )
  SELECT array_agg(required.proname ORDER BY required.proname)
  INTO missing_prompt7_capabilities
  FROM required
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE pronamespace='public'::regnamespace
      AND pg_proc.proname=required.proname
      AND has_function_privilege('axora_app', pg_proc.oid, 'EXECUTE')
  );
  IF coalesce(cardinality(missing_prompt7_capabilities), 0) <> 0 THEN
    RAISE EXCEPTION 'Prompt 7 application capabilities are unavailable: %',
      missing_prompt7_capabilities;
  END IF;
END
$verify$;
SQL

printf 'Native PostgreSQL verified: %s migrations, application authorization lifecycles, forced RLS, and least-privilege grants.\n' "$EXPECTED_MIGRATIONS"
