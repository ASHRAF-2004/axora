\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL idle_in_transaction_session_timeout = '2min';

CREATE TEMP TABLE reset_parameters (
  retained_owner_id uuid PRIMARY KEY,
  canonical_email text NOT NULL
) ON COMMIT DROP;

INSERT INTO reset_parameters(retained_owner_id, canonical_email)
VALUES (:'retained_owner_id'::uuid, :'canonical_email');

DO $reset_validation$
DECLARE
  owner_count integer;
  credential_count integer;
  profile_count integer;
  platform_assignment_count integer;
BEGIN
  SELECT count(*) INTO owner_count
  FROM users account
  JOIN reset_parameters parameter ON parameter.retained_owner_id=account.id
  WHERE account.active
    AND account.is_owner
    AND account.company_id IS NULL
    AND account.branch_id IS NULL;

  SELECT count(*) INTO credential_count
  FROM account_credentials credential
  JOIN reset_parameters parameter ON parameter.retained_owner_id=credential.user_id
  WHERE credential.password_hash IS NOT NULL;

  SELECT count(*) INTO profile_count
  FROM user_profiles profile
  JOIN reset_parameters parameter ON parameter.retained_owner_id=profile.user_id;

  SELECT count(*) INTO platform_assignment_count
  FROM role_assignments assignment
  JOIN roles role ON role.id=assignment.role_id
  JOIN reset_parameters parameter ON parameter.retained_owner_id=assignment.user_id
  WHERE role.role_key='PLATFORM_OWNER'
    AND assignment.active
    AND assignment.revoked_at IS NULL
    AND assignment.scope_type='PLATFORM'
    AND assignment.company_id IS NULL
    AND assignment.branch_id IS NULL
    AND assignment.department_id IS NULL
    AND assignment.supplier_id IS NULL;

  IF owner_count<>1 OR credential_count<>1 OR profile_count<>1
    OR platform_assignment_count<>1 THEN
    RAISE EXCEPTION 'Retained Platform Owner identity is incomplete or ambiguous';
  END IF;
END
$reset_validation$;

CREATE TEMP TABLE reset_preserved_tables(table_name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO reset_preserved_tables(table_name) VALUES
  ('commercial_pricing_rules'),
  ('document_templates'),
  ('email_agent_controls'),
  ('industry_taxonomy'),
  ('lookup_types'),
  ('lookup_values'),
  ('notification_event_policies'),
  ('permissions'),
  ('product_commercial_price_history'),
  ('product_images'),
  ('product_supplier_quantity_rule_history'),
  ('product_suppliers'),
  ('products'),
  ('profile_image_policies'),
  ('request_status_transitions'),
  ('role_assignment_management_rules'),
  ('role_permissions'),
  ('roles'),
  ('schema_migrations'),
  ('suppliers');

CREATE TEMP TABLE reset_preserved_counts(
  table_name text PRIMARY KEY,
  row_count bigint NOT NULL
) ON COMMIT DROP;

DO $capture_preserved$
DECLARE
  preserved record;
  preserved_count bigint;
BEGIN
  FOR preserved IN SELECT table_name FROM reset_preserved_tables ORDER BY table_name LOOP
    IF to_regclass(format('public.%I',preserved.table_name)) IS NULL THEN
      RAISE EXCEPTION 'Required preserved table is missing: %',preserved.table_name;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I',preserved.table_name)
      INTO preserved_count;
    INSERT INTO reset_preserved_counts VALUES(preserved.table_name,preserved_count);
  END LOOP;
END
$capture_preserved$;

-- The generic reset must never mutate append-only commercial/source evidence.
-- Company-specific catalog/source data or preserved global evidence attributed
-- to a removed user requires a separate reviewed migration and blocks this run.
DO $catalog_validation$
BEGIN
  IF EXISTS (SELECT 1 FROM products WHERE company_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM suppliers WHERE company_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Company-specific catalog/source rows require explicit review';
  END IF;
  IF EXISTS (
    SELECT 1 FROM commercial_pricing_rules
    WHERE created_by IS NOT NULL
      AND created_by<>(SELECT retained_owner_id FROM reset_parameters)
  ) OR EXISTS (
    SELECT 1 FROM email_agent_controls
    WHERE changed_by IS NOT NULL
      AND changed_by<>(SELECT retained_owner_id FROM reset_parameters)
  ) OR EXISTS (
    SELECT 1 FROM product_suppliers
    WHERE quantity_rule_updated_by IS NOT NULL
      AND quantity_rule_updated_by<>(SELECT retained_owner_id FROM reset_parameters)
  ) OR EXISTS (
    SELECT 1 FROM profile_image_policies
    WHERE updated_by IS NOT NULL
      AND updated_by<>(SELECT retained_owner_id FROM reset_parameters)
  ) THEN
    RAISE EXCEPTION 'Preserved evidence/configuration references a removed user';
  END IF;
END
$catalog_validation$;

-- Product image provenance is mutable metadata rather than commercial
-- evidence. Clear references to removed accounts without re-attributing them.
UPDATE product_images SET created_by=NULL
WHERE created_by IS DISTINCT FROM (SELECT retained_owner_id FROM reset_parameters);

CREATE TEMP TABLE reset_keep_schema_migrations ON COMMIT DROP AS TABLE schema_migrations;
CREATE TEMP TABLE reset_keep_roles ON COMMIT DROP AS TABLE roles;
CREATE TEMP TABLE reset_keep_permissions ON COMMIT DROP AS TABLE permissions;
CREATE TEMP TABLE reset_keep_role_permissions ON COMMIT DROP AS TABLE role_permissions;
CREATE TEMP TABLE reset_keep_role_management ON COMMIT DROP AS TABLE role_assignment_management_rules;
CREATE TEMP TABLE reset_keep_lookup_types ON COMMIT DROP AS TABLE lookup_types;
CREATE TEMP TABLE reset_keep_lookup_values ON COMMIT DROP AS TABLE lookup_values;
CREATE TEMP TABLE reset_keep_industry_taxonomy ON COMMIT DROP AS TABLE industry_taxonomy;
CREATE TEMP TABLE reset_keep_request_transitions ON COMMIT DROP AS TABLE request_status_transitions;
CREATE TEMP TABLE reset_keep_document_templates ON COMMIT DROP AS TABLE document_templates;
CREATE TEMP TABLE reset_keep_notification_policies ON COMMIT DROP AS TABLE notification_event_policies;
CREATE TEMP TABLE reset_keep_products ON COMMIT DROP AS TABLE products;
CREATE TEMP TABLE reset_keep_product_images ON COMMIT DROP AS TABLE product_images;
CREATE TEMP TABLE reset_keep_product_prices ON COMMIT DROP AS TABLE product_commercial_price_history;
CREATE TEMP TABLE reset_keep_suppliers ON COMMIT DROP AS TABLE suppliers;
CREATE TEMP TABLE reset_keep_product_suppliers ON COMMIT DROP AS TABLE product_suppliers;
CREATE TEMP TABLE reset_keep_quantity_history ON COMMIT DROP AS TABLE product_supplier_quantity_rule_history;
CREATE TEMP TABLE reset_keep_pricing_rules ON COMMIT DROP AS TABLE commercial_pricing_rules;
CREATE TEMP TABLE reset_keep_profile_policy ON COMMIT DROP AS TABLE profile_image_policies;
CREATE TEMP TABLE reset_keep_email_controls ON COMMIT DROP AS TABLE email_agent_controls;

CREATE TEMP TABLE reset_keep_user ON COMMIT DROP AS
SELECT * FROM users
WHERE id=(SELECT retained_owner_id FROM reset_parameters);
UPDATE reset_keep_user
SET email=(SELECT canonical_email FROM reset_parameters),
    role_id=(SELECT id FROM reset_keep_roles WHERE role_key='PLATFORM_OWNER'),
    active=true,is_owner=true,company_id=NULL,branch_id=NULL,
    account_kind='PLATFORM',account_status='ACTIVE',
    auth_version=auth_version+CASE
      WHEN lower(email)<>lower((SELECT canonical_email FROM reset_parameters))
        THEN 1 ELSE 0 END,
    last_login_at=NULL,updated_at=now();

CREATE TEMP TABLE reset_keep_credential ON COMMIT DROP AS
SELECT * FROM account_credentials
WHERE user_id=(SELECT retained_owner_id FROM reset_parameters);
UPDATE reset_keep_credential
SET failed_sign_in_count=0,first_failed_sign_in_at=NULL,locked_until=NULL,
    credential_version=credential_version+CASE
      WHEN lower((SELECT email FROM users
        WHERE id=(SELECT retained_owner_id FROM reset_parameters)))
        <>lower((SELECT canonical_email FROM reset_parameters))
        THEN 1 ELSE 0 END,
    updated_at=now();

CREATE TEMP TABLE reset_keep_profile ON COMMIT DROP AS
SELECT * FROM user_profiles
WHERE user_id=(SELECT retained_owner_id FROM reset_parameters);
UPDATE reset_keep_profile SET active_avatar_version_id=NULL,updated_at=now();

CREATE TEMP TABLE reset_keep_assignment ON COMMIT DROP AS
SELECT assignment.*
FROM role_assignments assignment
JOIN roles role ON role.id=assignment.role_id
WHERE assignment.user_id=(SELECT retained_owner_id FROM reset_parameters)
  AND role.role_key='PLATFORM_OWNER'
  AND assignment.active AND assignment.revoked_at IS NULL
  AND assignment.scope_type='PLATFORM'
ORDER BY assignment.assigned_at,assignment.id
LIMIT 1;
UPDATE reset_keep_assignment
SET scope_type='PLATFORM',company_id=NULL,branch_id=NULL,department_id=NULL,
    supplier_id=NULL,active=true,revoked_at=NULL,revoked_by=NULL,
    revoke_reason=NULL,assigned_by=(SELECT retained_owner_id FROM reset_parameters);

-- A live authorization snapshot is the assignment plus its canonical
-- user_scopes row. Preserve that row when available. An interrupted or older
-- owner-retaining baseline may contain the assignment without its trigger-
-- generated scope because replay runs in replica mode; reconstruct only that
-- exact platform scope so a guarded rerun repairs the baseline idempotently.
CREATE TEMP TABLE reset_keep_scope ON COMMIT DROP AS
SELECT scope.*
FROM user_scopes scope
JOIN reset_keep_assignment assignment
  ON assignment.user_id=scope.user_id
 AND assignment.id=scope.source_reference
WHERE scope.scope_type='PLATFORM'
  AND scope.company_id IS NULL
  AND scope.branch_id IS NULL
  AND scope.department_id IS NULL
  AND scope.supplier_id IS NULL
  AND scope.source='ROLE_ASSIGNMENT'
  AND scope.active
  AND scope.ends_at IS NULL
ORDER BY scope.created_at,scope.id
LIMIT 1;

INSERT INTO reset_keep_scope(
  id,user_id,scope_type,company_id,branch_id,department_id,supplier_id,
  source,source_reference,starts_at,ends_at,active,assigned_by,created_at
)
SELECT
  gen_random_uuid(),assignment.user_id,'PLATFORM',NULL,NULL,NULL,NULL,
  'ROLE_ASSIGNMENT',assignment.id,assignment.assigned_at,NULL,true,
  assignment.assigned_by,now()
FROM reset_keep_assignment assignment
WHERE NOT EXISTS (SELECT 1 FROM reset_keep_scope);

UPDATE reset_keep_scope scope
SET user_id=assignment.user_id,scope_type='PLATFORM',company_id=NULL,
    branch_id=NULL,department_id=NULL,supplier_id=NULL,
    source='ROLE_ASSIGNMENT',source_reference=assignment.id,
    starts_at=assignment.assigned_at,ends_at=NULL,active=true,
    assigned_by=(SELECT retained_owner_id FROM reset_parameters)
FROM reset_keep_assignment assignment;

-- Clear all public data in the isolated candidate only. The original database
-- and upload tree remain quarantined by the controller as immutable pre-reset
-- evidence and rollback material. Temporary snapshots are in pg_temp and are
-- not included in this statement.
DO $clear_candidate$
DECLARE
  clear_list text;
BEGIN
  SELECT string_agg(format('public.%I',table_name),',' ORDER BY table_name)
  INTO clear_list
  FROM information_schema.tables
  WHERE table_schema='public'
    AND table_type='BASE TABLE';

  IF clear_list IS NULL THEN
    RAISE EXCEPTION 'No public tables were discovered for reset';
  END IF;
  EXECUTE 'TRUNCATE TABLE '||clear_list||' RESTART IDENTITY CASCADE';
END
$clear_candidate$;

-- Snapshot replay must not manufacture fresh catalog history or audit entries.
-- Replica mode is local to this transaction and is reset immediately after
-- replay. Every public foreign key is then checked explicitly before commit.
SET LOCAL session_replication_role = replica;

INSERT INTO schema_migrations SELECT * FROM reset_keep_schema_migrations;
INSERT INTO roles SELECT * FROM reset_keep_roles;
INSERT INTO permissions SELECT * FROM reset_keep_permissions;
INSERT INTO role_permissions SELECT * FROM reset_keep_role_permissions;
INSERT INTO role_assignment_management_rules SELECT * FROM reset_keep_role_management;
INSERT INTO lookup_types SELECT * FROM reset_keep_lookup_types;
INSERT INTO lookup_values SELECT * FROM reset_keep_lookup_values;
INSERT INTO industry_taxonomy SELECT * FROM reset_keep_industry_taxonomy;
INSERT INTO request_status_transitions SELECT * FROM reset_keep_request_transitions;
INSERT INTO document_templates SELECT * FROM reset_keep_document_templates;
INSERT INTO notification_event_policies SELECT * FROM reset_keep_notification_policies;

INSERT INTO users SELECT * FROM reset_keep_user;
SELECT set_config('axora.user_id',(SELECT retained_owner_id::text FROM reset_parameters),true);
SELECT set_config('axora.change_reason','Approved pre-launch owner-retaining production reset',true);
INSERT INTO account_credentials SELECT * FROM reset_keep_credential;
INSERT INTO user_profiles SELECT * FROM reset_keep_profile;
INSERT INTO role_assignments SELECT * FROM reset_keep_assignment;
INSERT INTO user_scopes SELECT * FROM reset_keep_scope;

INSERT INTO products SELECT * FROM reset_keep_products;
INSERT INTO suppliers SELECT * FROM reset_keep_suppliers;
INSERT INTO product_images SELECT * FROM reset_keep_product_images;
INSERT INTO product_commercial_price_history SELECT * FROM reset_keep_product_prices;
INSERT INTO product_suppliers SELECT * FROM reset_keep_product_suppliers;
INSERT INTO product_supplier_quantity_rule_history SELECT * FROM reset_keep_quantity_history;
INSERT INTO commercial_pricing_rules SELECT * FROM reset_keep_pricing_rules;
INSERT INTO profile_image_policies SELECT * FROM reset_keep_profile_policy;
INSERT INTO email_agent_controls SELECT * FROM reset_keep_email_controls;

SET LOCAL session_replication_role = origin;

DO $validate_foreign_keys$
DECLARE
  foreign_key record;
  join_condition text;
  nonnull_condition text;
  orphan_exists boolean;
BEGIN
  FOR foreign_key IN
    SELECT constraint_row.oid,
           child_ns.nspname AS child_schema,child.relname AS child_table,
           parent_ns.nspname AS parent_schema,parent.relname AS parent_table,
           constraint_row.conkey,constraint_row.confkey
    FROM pg_constraint constraint_row
    JOIN pg_class child ON child.oid=constraint_row.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace
    JOIN pg_class parent ON parent.oid=constraint_row.confrelid
    JOIN pg_namespace parent_ns ON parent_ns.oid=parent.relnamespace
    WHERE constraint_row.contype='f' AND child_ns.nspname='public'
  LOOP
    SELECT string_agg(
             format('child.%I=parent.%I',child_attribute.attname,parent_attribute.attname),
             ' AND ' ORDER BY key_column.ordinality
           ),
           string_agg(
             format('child.%I IS NOT NULL',child_attribute.attname),
             ' AND ' ORDER BY key_column.ordinality
           )
    INTO join_condition,nonnull_condition
    FROM unnest(foreign_key.conkey,foreign_key.confkey)
         WITH ORDINALITY key_column(child_number,parent_number,ordinality)
    JOIN pg_attribute child_attribute
      ON child_attribute.attrelid=to_regclass(format('%I.%I',foreign_key.child_schema,foreign_key.child_table))
     AND child_attribute.attnum=key_column.child_number
    JOIN pg_attribute parent_attribute
      ON parent_attribute.attrelid=to_regclass(format('%I.%I',foreign_key.parent_schema,foreign_key.parent_table))
     AND parent_attribute.attnum=key_column.parent_number;

    EXECUTE format(
      'SELECT EXISTS(SELECT 1 FROM %I.%I child WHERE %s AND NOT EXISTS (SELECT 1 FROM %I.%I parent WHERE %s))',
      foreign_key.child_schema,foreign_key.child_table,nonnull_condition,
      foreign_key.parent_schema,foreign_key.parent_table,join_condition
    ) INTO orphan_exists;
    IF orphan_exists THEN
      RAISE EXCEPTION 'Owner-retaining candidate contains a foreign-key orphan';
    END IF;
  END LOOP;
END
$validate_foreign_keys$;

-- Explicit IDs are restored from snapshots. Advance every sequence owned by a
-- preserved table so the first post-reset insert cannot collide with them.
DO $reseed_sequences$
DECLARE
  sequence_row record;
  maximum_value bigint;
  has_rows boolean;
BEGIN
  FOR sequence_row IN
    SELECT sequence_ns.nspname AS sequence_schema,
           sequence.relname AS sequence_name,
           table_ns.nspname AS table_schema,
           table_rel.relname AS table_name,
           attribute.attname AS column_name
    FROM pg_class sequence
    JOIN pg_namespace sequence_ns ON sequence_ns.oid=sequence.relnamespace
    JOIN pg_depend dependency ON dependency.objid=sequence.oid
      AND dependency.deptype IN ('a','i')
    JOIN pg_class table_rel ON table_rel.oid=dependency.refobjid
    JOIN pg_namespace table_ns ON table_ns.oid=table_rel.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid=table_rel.oid
      AND attribute.attnum=dependency.refobjsubid
    WHERE sequence.relkind='S' AND table_ns.nspname='public'
  LOOP
    EXECUTE format(
      'SELECT max(%I)::bigint,count(*)>0 FROM %I.%I',
      sequence_row.column_name,sequence_row.table_schema,sequence_row.table_name
    ) INTO maximum_value,has_rows;
    IF has_rows THEN
      PERFORM setval(
        format('%I.%I',sequence_row.sequence_schema,sequence_row.sequence_name)::regclass,
        maximum_value,
        true
      );
    ELSE
      PERFORM setval(
        format('%I.%I',sequence_row.sequence_schema,sequence_row.sequence_name)::regclass,
        1,
        false
      );
    END IF;
  END LOOP;
END
$reseed_sequences$;

DO $preservation_validation$
DECLARE
  preserved record;
  actual_count bigint;
  owner_count integer;
  company_count integer;
  assignment_count integer;
  scope_count integer;
  catalog_access boolean;
BEGIN
  FOR preserved IN SELECT table_name,row_count FROM reset_preserved_counts ORDER BY table_name LOOP
    EXECUTE format('SELECT count(*) FROM public.%I',preserved.table_name)
      INTO actual_count;
    IF actual_count<>preserved.row_count THEN
      RAISE EXCEPTION 'Preserved table changed unexpectedly: %',preserved.table_name;
    END IF;
  END LOOP;

  SELECT count(*) INTO owner_count FROM users;
  SELECT count(*) INTO company_count FROM companies;
  SELECT count(*) INTO assignment_count
  FROM role_assignments assignment
  JOIN roles role ON role.id=assignment.role_id
  JOIN reset_parameters parameter ON parameter.retained_owner_id=assignment.user_id
  WHERE role.role_key='PLATFORM_OWNER'
    AND assignment.active AND assignment.revoked_at IS NULL
    AND assignment.scope_type='PLATFORM'
    AND assignment.company_id IS NULL
    AND assignment.branch_id IS NULL
    AND assignment.department_id IS NULL
    AND assignment.supplier_id IS NULL;

  SELECT count(*) INTO scope_count
  FROM user_scopes scope
  JOIN role_assignments assignment
    ON assignment.id=scope.source_reference
   AND assignment.user_id=scope.user_id
  JOIN reset_parameters parameter
    ON parameter.retained_owner_id=scope.user_id
  WHERE scope.scope_type='PLATFORM'
    AND scope.company_id IS NULL
    AND scope.branch_id IS NULL
    AND scope.department_id IS NULL
    AND scope.supplier_id IS NULL
    AND scope.source='ROLE_ASSIGNMENT'
    AND scope.active
    AND scope.ends_at IS NULL;

  SELECT public.axora_snapshot_has_permission(
    public.axora_live_authorization_snapshot(
      parameter.retained_owner_id,assignment.id,now()
    ),
    'catalog.manage','PLATFORM',NULL,NULL,NULL,NULL
  ) INTO catalog_access
  FROM reset_parameters parameter
  JOIN role_assignments assignment
    ON assignment.user_id=parameter.retained_owner_id
   AND assignment.active
   AND assignment.revoked_at IS NULL;

  IF owner_count<>1 OR company_count<>0 OR assignment_count<>1
    OR scope_count<>1 OR catalog_access IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Owner-retaining reset postconditions failed';
  END IF;
  IF (SELECT count(*) FROM account_credentials)<>1
    OR (SELECT count(*) FROM user_profiles)<>1 THEN
    RAISE EXCEPTION 'Retained owner credential/profile postconditions failed';
  END IF;
END
$preservation_validation$;

INSERT INTO audit_logs(
  entity_type,record_id,action,actor_id,reason,event_type,
  event_schema_version,actor_kind,result_code,outcome,system_identity
) SELECT
  'production_baseline',retained_owner_id,'RESET',retained_owner_id,
  'Approved pre-launch owner-retaining production reset',
  'PRODUCTION_BASELINE_RESET',1,'USER','OWNER_RETAINED','SUCCESS',
  'guarded-reset-controller'
FROM reset_parameters;

COMMIT;
