from pathlib import Path

path = Path("database/admin/apply-app-grants.sql")
source = path.read_text()
marker = "public.axora_operation_request_access_rows(uuid,uuid,text,timestamptz)"
if marker in source:
    raise SystemExit(0)

suffix = "END\n$$;"
if not source.endswith(suffix):
    raise RuntimeError("Unexpected application grant script ending")

block = '''  IF to_regprocedure(
    'public.axora_operation_request_access_rows(uuid,uuid,text,timestamptz)'
  ) IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_operation_request_access_rows(uuid,uuid,text,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_lock_request_line_access(uuid,uuid,text,uuid,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_lock_quotation_access(uuid,uuid,text,uuid,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_lock_invoice_access(uuid,uuid,text,uuid,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_user_directory_rows(uuid,uuid,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_lock_user_target_access(uuid,uuid,text,uuid,timestamptz) FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_operation_request_access_rows(uuid,uuid,text,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_lock_request_line_access(uuid,uuid,text,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_lock_quotation_access(uuid,uuid,text,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_lock_invoice_access(uuid,uuid,text,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_user_directory_rows(uuid,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_lock_user_target_access(uuid,uuid,text,uuid,timestamptz) TO axora_app';
  END IF;

  IF to_regprocedure(
    'public.axora_lock_user_creation_scope(uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz)'
  ) IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_lock_user_creation_scope(uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz) FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_lock_user_creation_scope(uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz) TO axora_app';
  END IF;
'''

path.write_text(source[:-len(suffix)] + block + suffix + "\n")
