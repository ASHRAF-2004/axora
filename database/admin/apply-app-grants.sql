\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'axora_app') THEN
    RAISE EXCEPTION 'Required database role axora_app does not exist';
  END IF;
END
$$;

SELECT format('GRANT CONNECT ON DATABASE %I TO axora_app', current_database())
\gexec

GRANT USAGE ON SCHEMA public TO axora_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO axora_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM axora_app;
GRANT DELETE ON TABLE public.products, public.product_suppliers, public.product_images TO axora_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO axora_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO axora_app;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.audit_logs FROM axora_app;
GRANT SELECT ON TABLE public.audit_logs TO axora_app;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.schema_migrations FROM axora_app;
GRANT SELECT ON TABLE public.schema_migrations TO axora_app;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO axora_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO axora_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO axora_app;
