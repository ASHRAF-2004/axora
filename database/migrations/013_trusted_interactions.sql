BEGIN;

-- Trusted interaction data is deliberately company-scoped. The AI proposal,
-- the owner's decision, and the published snapshot are separate values so a
-- later recommendation can never silently overwrite an owner's choice.
CREATE TABLE IF NOT EXISTS company_interaction_profiles (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  ai_recommendation jsonb,
  ai_rationale text NOT NULL DEFAULT '' CHECK (char_length(ai_rationale) <= 1200),
  ai_recommended_at timestamptz,
  ai_recommended_by uuid REFERENCES users(id) ON DELETE SET NULL,
  owner_override jsonb,
  owner_override_at timestamptz,
  owner_override_by uuid REFERENCES users(id) ON DELETE SET NULL,
  published_config jsonb,
  published_at timestamptz,
  published_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ai_recommendation IS NULL OR (
    jsonb_typeof(ai_recommendation) = 'object'
    AND octet_length(ai_recommendation::text) <= 65536
  )),
  CHECK (owner_override IS NULL OR (
    jsonb_typeof(owner_override) = 'object'
    AND octet_length(owner_override::text) <= 65536
  )),
  CHECK (published_config IS NULL OR (
    jsonb_typeof(published_config) = 'object'
    AND octet_length(published_config::text) <= 65536
  )),
  CHECK ((ai_recommendation IS NULL AND ai_recommended_at IS NULL AND ai_recommended_by IS NULL)
    OR (ai_recommendation IS NOT NULL AND ai_recommended_at IS NOT NULL
      AND char_length(btrim(ai_rationale)) > 0)),
  CHECK ((owner_override IS NULL AND owner_override_at IS NULL AND owner_override_by IS NULL)
    OR (owner_override IS NOT NULL AND owner_override_at IS NOT NULL)),
  CHECK ((published_config IS NULL AND published_at IS NULL AND published_by IS NULL)
    OR (published_config IS NOT NULL AND published_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS interaction_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  config jsonb NOT NULL CHECK (
    jsonb_typeof(config) = 'object'
    AND octet_length(config::text) <= 65536
  ),
  source text NOT NULL CHECK (source IN ('PUBLISH', 'ROLLBACK')),
  source_revision_id uuid,
  is_current boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, revision_number),
  UNIQUE(id, company_id),
  FOREIGN KEY(source_revision_id, company_id)
    REFERENCES interaction_revisions(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS interaction_revisions_company_created_idx
  ON interaction_revisions(company_id, revision_number DESC);
CREATE UNIQUE INDEX IF NOT EXISTS interaction_revisions_one_current_uq
  ON interaction_revisions(company_id) WHERE is_current;

-- Asset bytes live in approved persistent storage. This table stores only the
-- tenant-bound integrity and licensing record; remote hotlinks are rejected.
CREATE TABLE IF NOT EXISTS interaction_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_key text NOT NULL CHECK (asset_key ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
  asset_type text NOT NULL CHECK (asset_type IN ('SVG', 'RIVE', 'IMAGE', 'STATIC_FALLBACK')),
  content_type text NOT NULL CHECK (content_type IN (
    'image/svg+xml', 'application/octet-stream', 'application/rive',
    'image/png', 'image/jpeg', 'image/webp'
  )),
  storage_path text NOT NULL CHECK (
    char_length(btrim(storage_path)) BETWEEN 1 AND 500
    AND storage_path !~* '^https?://'
    AND storage_path !~ '(^|/)\.\.(/|$)'
    AND storage_path !~ '^//'
  ),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  source_url text NOT NULL CHECK (char_length(btrim(source_url)) BETWEEN 1 AND 1000),
  license_name text NOT NULL CHECK (char_length(btrim(license_name)) BETWEEN 1 AND 200),
  license_reference text NOT NULL CHECK (char_length(btrim(license_reference)) BETWEEN 1 AND 2000),
  commercial_use_approved boolean NOT NULL CHECK (commercial_use_approved),
  attribution_required boolean NOT NULL DEFAULT false,
  attribution_text text,
  active boolean NOT NULL DEFAULT true,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT attribution_required OR char_length(btrim(COALESCE(attribution_text, ''))) > 0),
  UNIQUE(company_id, asset_key),
  UNIQUE(company_id, sha256),
  UNIQUE(id, company_id)
);

CREATE INDEX IF NOT EXISTS interaction_assets_company_active_idx
  ON interaction_assets(company_id, active, display_name);

CREATE OR REPLACE FUNCTION protect_interaction_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.revision_number IS DISTINCT FROM OLD.revision_number
    OR NEW.config IS DISTINCT FROM OLD.config
    OR NEW.source IS DISTINCT FROM OLD.source
    OR NEW.source_revision_id IS DISTINCT FROM OLD.source_revision_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Published interaction revisions are immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION audit_company_interaction_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  actor_text text;
  actor uuid;
  row_data jsonb;
  affected_company uuid;
  linked_id uuid;
BEGIN
  actor_text := current_setting('axora.user_id', true);
  IF actor_text IS NOT NULL AND actor_text <> '' THEN
    actor := actor_text::uuid;
  END IF;

  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  affected_company := NULLIF(row_data->>'company_id', '')::uuid;
  linked_id := COALESCE(
    NULLIF(row_data->>'id', '')::uuid,
    affected_company
  );

  INSERT INTO public.audit_logs(
    entity_type, record_id, action, old_values, new_values,
    actor_id, company_id, reason
  ) VALUES (
    TG_TABLE_NAME,
    linked_id,
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    actor,
    affected_company,
    current_setting('axora.change_reason', true)
  );
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS set_updated_at_company_interaction_profiles
  ON company_interaction_profiles;
CREATE TRIGGER set_updated_at_company_interaction_profiles
BEFORE UPDATE ON company_interaction_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_interaction_assets ON interaction_assets;
CREATE TRIGGER set_updated_at_interaction_assets
BEFORE UPDATE ON interaction_assets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS audit_company_interaction_profiles
  ON company_interaction_profiles;
CREATE TRIGGER audit_company_interaction_profiles
AFTER INSERT OR UPDATE OR DELETE ON company_interaction_profiles
FOR EACH ROW EXECUTE FUNCTION audit_company_interaction_change();

DROP TRIGGER IF EXISTS audit_interaction_revisions ON interaction_revisions;
CREATE TRIGGER audit_interaction_revisions
AFTER INSERT OR UPDATE OR DELETE ON interaction_revisions
FOR EACH ROW EXECUTE FUNCTION audit_company_interaction_change();

DROP TRIGGER IF EXISTS protect_interaction_revisions ON interaction_revisions;
CREATE TRIGGER protect_interaction_revisions
BEFORE UPDATE ON interaction_revisions
FOR EACH ROW EXECUTE FUNCTION protect_interaction_revision();

DROP TRIGGER IF EXISTS audit_interaction_assets ON interaction_assets;
CREATE TRIGGER audit_interaction_assets
AFTER INSERT OR UPDATE OR DELETE ON interaction_assets
FOR EACH ROW EXECUTE FUNCTION audit_company_interaction_change();

-- Production installs have this login; isolated migration tests intentionally
-- do not. Keep grants explicit without making that test setup privileged.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'axora_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE
      company_interaction_profiles, interaction_revisions, interaction_assets
      TO axora_app;
    REVOKE DELETE ON TABLE
      company_interaction_profiles, interaction_revisions, interaction_assets
      FROM axora_app;
    GRANT EXECUTE ON FUNCTION audit_company_interaction_change() TO axora_app;
    GRANT EXECUTE ON FUNCTION protect_interaction_revision() TO axora_app;
  END IF;
END $$;

COMMIT;
