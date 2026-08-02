BEGIN;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS company_information text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS website_url text;

ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_website_url_check;
ALTER TABLE companies ADD CONSTRAINT companies_website_url_check CHECK (
  website_url IS NULL
  OR (
    char_length(website_url) <= 500
    AND website_url ~ '^https://[^[:space:]]+$'
  )
);

CREATE TABLE IF NOT EXISTS company_logos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  logo_content bytea NOT NULL CHECK (octet_length(logo_content) BETWEEN 1 AND 2097152),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 4096),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 4096),
  has_transparency boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, version),
  UNIQUE(company_id, sha256)
);

CREATE UNIQUE INDEX IF NOT EXISTS company_logos_one_active_uq
  ON company_logos(company_id) WHERE active;

CREATE OR REPLACE FUNCTION all_hex_colors(colors text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(bool_and(color ~ '^#[0-9A-F]{6}$'), false)
  FROM unnest(colors) AS color
$$;

CREATE TABLE IF NOT EXISTS company_brand_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  source_logo_id uuid NOT NULL REFERENCES company_logos(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  algorithm_version text NOT NULL CHECK (char_length(algorithm_version) BETWEEN 1 AND 80),
  primary_color text NOT NULL,
  secondary_color text NOT NULL,
  accent_color text NOT NULL,
  primary_foreground text NOT NULL,
  secondary_foreground text NOT NULL,
  page_background text NOT NULL,
  surface_color text NOT NULL,
  muted_surface text NOT NULL,
  border_color text NOT NULL,
  success_color text NOT NULL,
  warning_color text NOT NULL,
  danger_color text NOT NULL,
  focus_ring text NOT NULL,
  link_color text NOT NULL,
  chart_colors text[] NOT NULL,
  extraction_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  contrast_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, version),
  CHECK (cardinality(chart_colors) BETWEEN 3 AND 8),
  CHECK (
    primary_color ~ '^#[0-9A-F]{6}$'
    AND secondary_color ~ '^#[0-9A-F]{6}$'
    AND accent_color ~ '^#[0-9A-F]{6}$'
    AND primary_foreground ~ '^#[0-9A-F]{6}$'
    AND secondary_foreground ~ '^#[0-9A-F]{6}$'
    AND page_background ~ '^#[0-9A-F]{6}$'
    AND surface_color ~ '^#[0-9A-F]{6}$'
    AND muted_surface ~ '^#[0-9A-F]{6}$'
    AND border_color ~ '^#[0-9A-F]{6}$'
    AND success_color ~ '^#[0-9A-F]{6}$'
    AND warning_color ~ '^#[0-9A-F]{6}$'
    AND danger_color ~ '^#[0-9A-F]{6}$'
    AND focus_ring ~ '^#[0-9A-F]{6}$'
    AND link_color ~ '^#[0-9A-F]{6}$'
  ),
  CHECK (all_hex_colors(chart_colors))
);

CREATE UNIQUE INDEX IF NOT EXISTS company_brand_themes_one_active_uq
  ON company_brand_themes(company_id) WHERE active;

-- A theme is immutable evidence of the extraction result. Regeneration
-- deactivates the previous row and inserts a new version.
CREATE OR REPLACE FUNCTION protect_company_brand_theme() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.source_logo_id IS DISTINCT FROM OLD.source_logo_id
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.algorithm_version IS DISTINCT FROM OLD.algorithm_version
    OR NEW.primary_color IS DISTINCT FROM OLD.primary_color
    OR NEW.secondary_color IS DISTINCT FROM OLD.secondary_color
    OR NEW.accent_color IS DISTINCT FROM OLD.accent_color
    OR NEW.primary_foreground IS DISTINCT FROM OLD.primary_foreground
    OR NEW.secondary_foreground IS DISTINCT FROM OLD.secondary_foreground
    OR NEW.page_background IS DISTINCT FROM OLD.page_background
    OR NEW.surface_color IS DISTINCT FROM OLD.surface_color
    OR NEW.muted_surface IS DISTINCT FROM OLD.muted_surface
    OR NEW.border_color IS DISTINCT FROM OLD.border_color
    OR NEW.success_color IS DISTINCT FROM OLD.success_color
    OR NEW.warning_color IS DISTINCT FROM OLD.warning_color
    OR NEW.danger_color IS DISTINCT FROM OLD.danger_color
    OR NEW.focus_ring IS DISTINCT FROM OLD.focus_ring
    OR NEW.link_color IS DISTINCT FROM OLD.link_color
    OR NEW.chart_colors IS DISTINCT FROM OLD.chart_colors
    OR NEW.extraction_summary IS DISTINCT FROM OLD.extraction_summary
    OR NEW.contrast_summary IS DISTINCT FROM OLD.contrast_summary
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Published company brand themes are immutable';
  END IF;
  IF OLD.active=false AND NEW.active=true THEN
    RAISE EXCEPTION 'A retired company brand theme cannot be reactivated';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION audit_company_brand_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  actor_text text;
  actor uuid;
  row_data jsonb;
  affected_company uuid;
  linked_id uuid;
BEGIN
  actor_text := current_setting('axora.user_id', true);
  IF actor_text IS NOT NULL AND actor_text<>'' THEN actor := actor_text::uuid; END IF;
  row_data := (CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END) - 'logo_content';
  affected_company := NULLIF(row_data->>'company_id','')::uuid;
  linked_id := NULLIF(row_data->>'id','')::uuid;
  INSERT INTO public.audit_logs(
    entity_type,record_id,action,old_values,new_values,actor_id,company_id,reason
  ) VALUES (
    TG_TABLE_NAME,linked_id,TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD)-'logo_content' ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW)-'logo_content' ELSE NULL END,
    actor,affected_company,current_setting('axora.change_reason',true)
  );
  RETURN COALESCE(NEW,OLD);
END $$;

DROP TRIGGER IF EXISTS protect_company_brand_themes ON company_brand_themes;
CREATE TRIGGER protect_company_brand_themes
BEFORE UPDATE ON company_brand_themes
FOR EACH ROW EXECUTE FUNCTION protect_company_brand_theme();

DROP TRIGGER IF EXISTS audit_company_logos ON company_logos;
CREATE TRIGGER audit_company_logos
AFTER INSERT OR UPDATE OR DELETE ON company_logos
FOR EACH ROW EXECUTE FUNCTION audit_company_brand_change();

DROP TRIGGER IF EXISTS audit_company_brand_themes ON company_brand_themes;
CREATE TRIGGER audit_company_brand_themes
AFTER INSERT OR UPDATE OR DELETE ON company_brand_themes
FOR EACH ROW EXECUTE FUNCTION audit_company_brand_change();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE company_logos, company_brand_themes TO axora_app;
    REVOKE DELETE ON TABLE company_logos, company_brand_themes FROM axora_app;
    GRANT EXECUTE ON FUNCTION protect_company_brand_theme() TO axora_app;
    GRANT EXECUTE ON FUNCTION audit_company_brand_change() TO axora_app;
  END IF;
END $$;

COMMIT;
