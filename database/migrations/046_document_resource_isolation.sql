BEGIN;

-- P0-02 document-isolation slice. Every attachment is resolved through its
-- trusted request parent before metadata, bytes, or write authority is exposed.
-- The application role loses raw attachments-table access and receives only
-- minimized SECURITY DEFINER capabilities.

ALTER TABLE public.attachments
  ADD COLUMN IF NOT EXISTS request_id uuid;

ALTER TABLE public.attachments
  DROP CONSTRAINT IF EXISTS attachments_request_fkey;
ALTER TABLE public.attachments
  ADD CONSTRAINT attachments_request_fkey
  FOREIGN KEY(request_id)
  REFERENCES public.requests(id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS attachments_request_visibility_created_idx
  ON public.attachments(request_id,visibility,created_at DESC,id);

CREATE OR REPLACE FUNCTION public.axora_resolve_attachment_parent(
  p_entity_type text,
  p_record_id uuid
)
RETURNS TABLE(
  entity_type text,
  record_id uuid,
  request_id uuid,
  company_id uuid,
  branch_id uuid,
  department_id uuid,
  request_created_by uuid,
  invoice_direction text,
  resource_active boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF p_entity_type='request' THEN
    RETURN QUERY
    SELECT
      'request'::text,
      request.id,
      request.id,
      request.company_id,
      request.branch_id,
      request.department_id,
      request.created_by,
      NULL::text,
      company.active
        AND branch.active
        AND (request.department_id IS NULL OR department.active)
    FROM public.requests request
    JOIN public.companies company ON company.id=request.company_id
    JOIN public.branches branch
      ON branch.id=request.branch_id
     AND branch.company_id=request.company_id
    LEFT JOIN public.departments department
      ON department.id=request.department_id
     AND department.company_id=request.company_id
    WHERE request.id=p_record_id;
    RETURN;
  END IF;

  IF p_entity_type='invoice' THEN
    RETURN QUERY
    SELECT
      'invoice'::text,
      invoice.id,
      request.id,
      request.company_id,
      request.branch_id,
      request.department_id,
      request.created_by,
      invoice.direction,
      company.active
        AND branch.active
        AND (request.department_id IS NULL OR department.active)
    FROM public.invoices invoice
    JOIN public.requests request ON request.id=invoice.request_id
    JOIN public.companies company ON company.id=request.company_id
    JOIN public.branches branch
      ON branch.id=request.branch_id
     AND branch.company_id=request.company_id
    LEFT JOIN public.departments department
      ON department.id=request.department_id
     AND department.company_id=request.company_id
    WHERE invoice.id=p_record_id;
    RETURN;
  END IF;

  IF p_entity_type='delivery' THEN
    RETURN QUERY
    SELECT
      'delivery'::text,
      delivery.id,
      request.id,
      request.company_id,
      request.branch_id,
      request.department_id,
      request.created_by,
      NULL::text,
      company.active
        AND branch.active
        AND (request.department_id IS NULL OR department.active)
    FROM public.deliveries delivery
    JOIN public.request_lines line ON line.id=delivery.request_line_id
    JOIN public.requests request ON request.id=line.request_id
    JOIN public.companies company ON company.id=request.company_id
    JOIN public.branches branch
      ON branch.id=request.branch_id
     AND branch.company_id=request.company_id
    LEFT JOIN public.departments department
      ON department.id=request.department_id
     AND department.company_id=request.company_id
    WHERE delivery.id=p_record_id;
    RETURN;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.axora_resolve_attachment_parent(text,uuid)
FROM PUBLIC;

-- Link every resolvable historical attachment without inventing ownership for
-- unsupported or missing legacy parents.
WITH resolved AS (
  SELECT attachment.id,parent.request_id,parent.company_id
  FROM public.attachments attachment
  CROSS JOIN LATERAL public.axora_resolve_attachment_parent(
    attachment.entity_type,attachment.record_id
  ) parent
)
UPDATE public.attachments attachment
SET request_id=resolved.request_id,
    company_id=resolved.company_id
FROM resolved
WHERE attachment.id=resolved.id
  AND (
    attachment.request_id IS DISTINCT FROM resolved.request_id
    OR attachment.company_id IS DISTINCT FROM resolved.company_id
  );

-- Supplier invoices are always internal commercial evidence.
UPDATE public.attachments attachment
SET visibility='INTERNAL'
FROM public.invoices invoice
WHERE attachment.entity_type='invoice'
  AND attachment.record_id=invoice.id
  AND invoice.direction='SUPPLIER'
  AND attachment.visibility<>'INTERNAL';

CREATE OR REPLACE FUNCTION public.axora_validate_attachment_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  parent_row record;
BEGIN
  SELECT * INTO parent_row
  FROM public.axora_resolve_attachment_parent(
    NEW.entity_type,NEW.record_id
  );

  IF parent_row.request_id IS NULL THEN
    RAISE EXCEPTION 'The linked document record is unavailable';
  END IF;

  NEW.request_id:=parent_row.request_id;
  NEW.company_id:=parent_row.company_id;
  IF parent_row.invoice_direction='SUPPLIER' THEN
    NEW.visibility:='INTERNAL';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.axora_validate_attachment_parent()
FROM PUBLIC;

DROP TRIGGER IF EXISTS validate_attachment_parent
  ON public.attachments;
CREATE TRIGGER validate_attachment_parent
BEFORE INSERT OR UPDATE OF
  entity_type,record_id,request_id,company_id,visibility
ON public.attachments
FOR EACH ROW
EXECUTE FUNCTION public.axora_validate_attachment_parent();

CREATE OR REPLACE FUNCTION public.axora_attachment_permission_is_effective(
  p_snapshot jsonb,
  p_actor_user_id uuid,
  p_document_permission text,
  p_entity_type text,
  p_visibility text,
  p_request_created_by uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_department_id uuid,
  p_invoice_direction text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  resource_type text:=public.axora_request_scope_type(p_department_id);
  entity_allowed boolean:=false;
BEGIN
  IF p_snapshot IS NULL
    OR p_actor_user_id IS NULL
    OR p_document_permission NOT IN (
      'document.view','document.download','document.manage'
    )
    OR p_entity_type NOT IN ('request','invoice','delivery')
    OR p_visibility NOT IN ('CUSTOMER','INTERNAL')
    OR p_company_id IS NULL
    OR p_branch_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT public.axora_request_permission_is_effective(
    p_snapshot,p_actor_user_id,'request.view',p_request_created_by,
    p_company_id,p_branch_id,p_department_id
  ) OR NOT public.axora_snapshot_has_permission(
    p_snapshot,p_document_permission,resource_type,
    p_company_id,p_branch_id,p_department_id,NULL
  ) THEN
    RETURN false;
  END IF;

  IF p_entity_type='request' THEN
    entity_allowed:=true;
  ELSIF p_entity_type='delivery' THEN
    entity_allowed:=public.axora_snapshot_has_permission(
      p_snapshot,'delivery.view',resource_type,
      p_company_id,p_branch_id,p_department_id,NULL
    );
  ELSIF p_invoice_direction='SUPPLIER' THEN
    entity_allowed:=public.axora_snapshot_has_permission(
      p_snapshot,'finance.invoice.view',resource_type,
      p_company_id,p_branch_id,p_department_id,NULL
    ) OR public.axora_snapshot_has_permission(
      p_snapshot,'sourcing.manage',resource_type,
      p_company_id,p_branch_id,p_department_id,NULL
    );
  ELSE
    entity_allowed:=public.axora_snapshot_has_permission(
      p_snapshot,'finance.invoice.view',resource_type,
      p_company_id,p_branch_id,p_department_id,NULL
    );
  END IF;

  IF NOT entity_allowed THEN RETURN false; END IF;

  IF p_visibility='INTERNAL' AND NOT public.axora_snapshot_has_permission(
    p_snapshot,'platform.view',resource_type,
    p_company_id,p_branch_id,p_department_id,NULL
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.axora_attachment_permission_is_effective(
  jsonb,uuid,text,text,text,uuid,uuid,uuid,uuid,text
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_attachment_access_rows(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE(
  captured_at timestamptz,
  attachment_id uuid,
  entity_type text,
  record_id uuid,
  request_id uuid,
  file_name text,
  content_type text,
  visibility text,
  created_at timestamptz,
  uploaded_by_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    p_at,
    attachment.id,
    attachment.entity_type,
    attachment.record_id,
    parent.request_id,
    attachment.file_name,
    attachment.content_type,
    attachment.visibility,
    attachment.created_at,
    uploader.display_name
  FROM public.attachments attachment
  CROSS JOIN LATERAL public.axora_resolve_attachment_parent(
    attachment.entity_type,attachment.record_id
  ) parent
  LEFT JOIN public.users uploader ON uploader.id=attachment.uploaded_by
  WHERE attachment.request_id=parent.request_id
    AND attachment.company_id=parent.company_id
    AND public.axora_attachment_permission_is_effective(
      actor_snapshot,p_actor_user_id,'document.view',
      attachment.entity_type,attachment.visibility,
      parent.request_created_by,parent.company_id,parent.branch_id,
      parent.department_id,parent.invoice_direction
    )
  ORDER BY attachment.created_at DESC,attachment.id;
END $$;

REVOKE ALL ON FUNCTION public.axora_attachment_access_rows(
  uuid,uuid,timestamptz
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_attachment_download(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_attachment_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE(
  captured_at timestamptz,
  attachment_id uuid,
  file_name text,
  content_type text,
  storage_path text,
  file_content bytea,
  visibility text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
BEGIN
  IF p_attachment_id IS NULL THEN RETURN; END IF;
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    p_at,
    attachment.id,
    attachment.file_name,
    attachment.content_type,
    attachment.storage_path,
    attachment.file_content,
    attachment.visibility
  FROM public.attachments attachment
  CROSS JOIN LATERAL public.axora_resolve_attachment_parent(
    attachment.entity_type,attachment.record_id
  ) parent
  WHERE attachment.id=p_attachment_id
    AND attachment.request_id=parent.request_id
    AND attachment.company_id=parent.company_id
    AND public.axora_attachment_permission_is_effective(
      actor_snapshot,p_actor_user_id,'document.download',
      attachment.entity_type,attachment.visibility,
      parent.request_created_by,parent.company_id,parent.branch_id,
      parent.department_id,parent.invoice_direction
    );
END $$;

REVOKE ALL ON FUNCTION public.axora_attachment_download(
  uuid,uuid,uuid,timestamptz
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_create_attachment(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_entity_type text,
  p_record_id uuid,
  p_file_name text,
  p_content_type text,
  p_file_content bytea,
  p_requested_visibility text DEFAULT 'CUSTOMER',
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE(
  attachment_id uuid,
  visibility text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  parent_row record;
  resource_type text;
  internal_allowed boolean:=false;
  actual_visibility text;
  created_id uuid:=gen_random_uuid();
BEGIN
  IF p_actor_user_id IS NULL
    OR p_actor_role_assignment_id IS NULL
    OR p_entity_type NOT IN ('request','invoice','delivery')
    OR p_record_id IS NULL
    OR p_file_name IS NULL
    OR char_length(p_file_name) NOT BETWEEN 1 AND 120
    OR p_file_name IN ('.','..')
    OR p_file_name !~ '^[A-Za-z0-9._-]+$'
    OR p_content_type NOT IN (
      'application/pdf','image/png','image/jpeg','text/plain','text/csv'
    )
    OR p_file_content IS NULL
    OR octet_length(p_file_content) NOT BETWEEN 1 AND 2097152
    OR p_requested_visibility NOT IN ('CUSTOMER','INTERNAL')
    OR p_at IS NULL THEN
    RETURN;
  END IF;

  PERFORM 1 FROM public.users account
  WHERE account.id=p_actor_user_id
  FOR KEY SHARE;
  IF NOT FOUND THEN RETURN; END IF;

  PERFORM 1 FROM public.role_assignments assignment
  WHERE assignment.id=p_actor_role_assignment_id
    AND assignment.user_id=p_actor_user_id
  FOR KEY SHARE;
  IF NOT FOUND THEN RETURN; END IF;

  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL THEN RETURN; END IF;

  SELECT * INTO parent_row
  FROM public.axora_resolve_attachment_parent(
    p_entity_type,p_record_id
  );
  IF parent_row.request_id IS NULL OR NOT parent_row.resource_active THEN
    RETURN;
  END IF;

  resource_type:=public.axora_request_scope_type(parent_row.department_id);
  internal_allowed:=public.axora_snapshot_has_permission(
    actor_snapshot,'platform.view',resource_type,
    parent_row.company_id,parent_row.branch_id,parent_row.department_id,NULL
  );

  IF parent_row.invoice_direction='SUPPLIER' THEN
    actual_visibility:='INTERNAL';
  ELSIF p_requested_visibility='INTERNAL' AND internal_allowed THEN
    actual_visibility:='INTERNAL';
  ELSE
    actual_visibility:='CUSTOMER';
  END IF;

  IF NOT public.axora_attachment_permission_is_effective(
    actor_snapshot,p_actor_user_id,'document.manage',
    p_entity_type,actual_visibility,parent_row.request_created_by,
    parent_row.company_id,parent_row.branch_id,parent_row.department_id,
    parent_row.invoice_direction
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.attachments(
    id,entity_type,record_id,request_id,file_name,content_type,
    storage_path,uploaded_by,company_id,file_content,visibility
  ) VALUES (
    created_id,p_entity_type,p_record_id,parent_row.request_id,
    p_file_name,p_content_type,
    format('db/%s-%s',created_id,p_file_name),
    p_actor_user_id,parent_row.company_id,p_file_content,actual_visibility
  );

  RETURN QUERY SELECT created_id,actual_visibility;
END $$;

REVOKE ALL ON FUNCTION public.axora_create_attachment(
  uuid,uuid,text,uuid,text,text,bytea,text,timestamptz
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE public.attachments FROM axora_app;

    REVOKE ALL ON FUNCTION
      public.axora_resolve_attachment_parent(text,uuid),
      public.axora_validate_attachment_parent(),
      public.axora_attachment_permission_is_effective(
        jsonb,uuid,text,text,text,uuid,uuid,uuid,uuid,text
      ),
      public.axora_attachment_access_rows(uuid,uuid,timestamptz),
      public.axora_attachment_download(uuid,uuid,uuid,timestamptz),
      public.axora_create_attachment(
        uuid,uuid,text,uuid,text,text,bytea,text,timestamptz
      )
    FROM axora_app;

    GRANT EXECUTE ON FUNCTION
      public.axora_attachment_access_rows(uuid,uuid,timestamptz),
      public.axora_attachment_download(uuid,uuid,uuid,timestamptz),
      public.axora_create_attachment(
        uuid,uuid,text,uuid,text,text,bytea,text,timestamptz
      )
    TO axora_app;
  END IF;
END $$;

COMMIT;
