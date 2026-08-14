BEGIN;

CREATE TABLE public.company_deletion_tombstones (
  company_id uuid PRIMARY KEY,
  company_code text NOT NULL,
  deletion_mode text NOT NULL CHECK (deletion_mode IN ('HARD_DELETED','ARCHIVED_RETAINED')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  deleted_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  deleted_at timestamptz NOT NULL,
  impact jsonb NOT NULL CHECK (jsonb_typeof(impact)='object')
);
ALTER TABLE public.company_deletion_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_deletion_tombstones FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_deletion_tombstones FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_company_is_retained(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.companies company
    WHERE company.id=p_company_id
      AND company.lifecycle_status<>'ARCHIVED'
      AND NOT EXISTS (
        SELECT 1 FROM public.company_deletion_tombstones tombstone
        WHERE tombstone.company_id=company.id
      )
  )
$$;
REVOKE ALL ON FUNCTION public.axora_company_is_retained(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_company_is_operational(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT public.axora_company_is_retained(p_company_id) AND EXISTS (
    SELECT 1 FROM public.companies company
    WHERE company.id=p_company_id AND company.active
  )
$$;
REVOKE ALL ON FUNCTION public.axora_company_is_operational(uuid) FROM PUBLIC;

-- Every scoped capability observes the same tombstone boundary. Archived
-- tenants therefore disappear from lists, details, selectors, exports and
-- live snapshots without granting the application direct table access.
CREATE OR REPLACE FUNCTION public.axora_snapshot_has_permission(
  p_snapshot jsonb,p_permission_code text,p_scope_type text,
  p_company_id uuid,p_branch_id uuid,p_department_id uuid,p_supplier_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE effective_code text; actor_user_id uuid;
BEGIN
  IF p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT') AND p_company_id IS NOT NULL THEN
    IF NOT public.axora_company_is_retained(p_company_id) THEN RETURN false; END IF;
    IF NOT public.axora_company_is_operational(p_company_id) AND (
      p_snapshot->>'accountKind'<>'PLATFORM'
      OR p_permission_code NOT IN (
        'company.view','company.view.all','company.view.assigned',
        'company.create','company.edit','company.activate'
      )
    ) THEN RETURN false; END IF;
  END IF;
  effective_code:=public.axora_scoped_user_permission_code(
    p_permission_code,p_scope_type
  );
  IF effective_code IS NULL OR NOT public.axora_snapshot_has_permission_base(
    p_snapshot,effective_code,p_scope_type,p_company_id,p_branch_id,
    p_department_id,p_supplier_id
  ) THEN RETURN false; END IF;
  IF p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT')
    AND p_company_id IS NOT NULL
    AND p_snapshot->>'accountKind'='PLATFORM'
    AND NOT public.axora_company_actor_is_owner(p_snapshot) THEN
    IF public.axora_snapshot_has_permission_base(
      p_snapshot,'company.view.all',p_scope_type,p_company_id,p_branch_id,
      p_department_id,p_supplier_id
    ) THEN RETURN true; END IF;
    SELECT assignment.user_id INTO actor_user_id
    FROM public.role_assignments assignment
    WHERE assignment.id=NULLIF(p_snapshot->>'roleAssignmentId','')::uuid
      AND assignment.active AND assignment.revoked_at IS NULL;
    RETURN actor_user_id IS NOT NULL
      AND public.axora_company_assignment_allows_permission(
        actor_user_id,p_company_id,effective_code,now()
      );
  END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_actor_can_view(
  p_snapshot jsonb,p_actor_user_id uuid,p_company_id uuid,p_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF NOT public.axora_company_is_retained(p_company_id) THEN RETURN false; END IF;
  IF public.axora_company_actor_is_owner(p_snapshot) THEN RETURN true; END IF;
  IF p_snapshot->>'accountKind'='PLATFORM' THEN
    RETURN public.axora_snapshot_has_permission_base(
      p_snapshot,'company.view.all','COMPANY',p_company_id,NULL,NULL,NULL
    ) OR (
      public.axora_company_assignment_is_active(p_actor_user_id,p_company_id,p_at)
      AND public.axora_snapshot_has_permission_base(
        p_snapshot,'company.view.assigned','COMPANY',p_company_id,NULL,NULL,NULL
      )
    );
  END IF;
  IF p_snapshot->>'accountKind'='COMPANY' THEN
    RETURN public.axora_company_is_operational(p_company_id)
    AND public.axora_snapshot_scope_contains(
      p_snapshot,'COMPANY',p_company_id,NULL,NULL,NULL
    ) AND public.axora_snapshot_has_permission_base(
      p_snapshot,'company.view','COMPANY',p_company_id,NULL,NULL,NULL
    );
  END IF;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_deletion_impact(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; company_row public.companies%ROWTYPE;
DECLARE result jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  IF snapshot IS NULL OR NOT (
    COALESCE((snapshot->>'isOwner')::boolean,false)
    AND snapshot->>'accountKind'='PLATFORM'
    AND snapshot->>'roleKey'='PLATFORM_OWNER'
  ) THEN RAISE EXCEPTION 'Company deletion is unavailable'; END IF;
  SELECT * INTO company_row FROM public.companies WHERE id=p_company_id;
  IF company_row.id IS NULL THEN RAISE EXCEPTION 'Company deletion is unavailable'; END IF;
  SELECT jsonb_build_object(
    'companyId',company_row.id,'companyCode',company_row.company_code,
    'users',(SELECT count(*) FROM public.users WHERE company_id=company_row.id),
    'memberships',(SELECT count(*) FROM public.company_memberships WHERE company_id=company_row.id),
    'branches',(SELECT count(*) FROM public.branches WHERE company_id=company_row.id),
    'departments',(SELECT count(*) FROM public.departments WHERE company_id=company_row.id),
    'roleAssignments',(SELECT count(*) FROM public.role_assignments WHERE company_id=company_row.id),
    'sessions',(SELECT count(*) FROM public.user_sessions session WHERE session.user_id IN (SELECT id FROM public.users WHERE company_id=company_row.id)),
    'requests',(SELECT count(*) FROM public.requests WHERE company_id=company_row.id),
    'budgets',(SELECT count(*) FROM public.budget_accounts WHERE company_id=company_row.id),
    'approvalPolicies',(SELECT count(*) FROM public.request_approval_policies WHERE company_id=company_row.id),
    'invoices',(SELECT count(*) FROM public.invoices WHERE company_id=company_row.id),
    'finalizedInvoices',(SELECT count(*) FROM public.invoices WHERE company_id=company_row.id AND lifecycle_status='FINALIZED'),
    'paidPayments',(SELECT count(*) FROM public.payments payment JOIN public.invoices invoice ON invoice.id=payment.invoice_id WHERE invoice.company_id=company_row.id AND payment.payment_status='PAID'),
    'deliveries',(SELECT count(*) FROM public.delivery_jobs WHERE company_id=company_row.id),
    'completedDeliveries',(SELECT count(*) FROM public.delivery_jobs WHERE company_id=company_row.id AND status IN ('DELIVERED','COMPLETED')),
    'receipts',(SELECT count(*) FROM public.receipts WHERE company_id=company_row.id),
    'documents',(SELECT count(*) FROM public.generated_documents WHERE company_id=company_row.id),
    'branding',(SELECT count(*) FROM public.company_brand_themes WHERE company_id=company_row.id),
    'notifications',(SELECT count(*) FROM public.in_app_notifications WHERE company_id=company_row.id),
    'workflowEvents',(SELECT count(*) FROM public.workflow_events WHERE company_id=company_row.id),
    'lifecycleHistory',(SELECT count(*) FROM public.company_status_history WHERE company_id=company_row.id),
    'pendingInvitations',(SELECT count(*) FROM public.account_setup_invitations WHERE company_id=company_row.id AND consumed_at IS NULL AND revoked_at IS NULL),
    'pendingWorkflowEmails',(SELECT count(*) FROM public.workflow_email_outbox WHERE company_id=company_row.id AND delivery_status='PENDING'),
    'inFlightWork',(
      (SELECT count(*) FROM public.account_setup_invitations WHERE company_id=company_row.id AND delivery_status='SENDING')
      +(SELECT count(*) FROM public.workflow_email_outbox WHERE company_id=company_row.id AND delivery_status='SENDING')
      +(SELECT count(*) FROM public.request_approval_outbox WHERE company_id=company_row.id AND status='PROCESSING')
      +(SELECT count(*) FROM public.transactional_email_outbox outbox
        WHERE outbox.delivery_status='SENDING' AND (
          EXISTS (SELECT 1 FROM public.invoices invoice WHERE invoice.id=outbox.invoice_id AND invoice.company_id=company_row.id)
          OR EXISTS (SELECT 1 FROM public.password_reset_tokens token JOIN public.users account ON account.id=token.user_id WHERE token.id=outbox.password_reset_token_id AND account.company_id=company_row.id)
          OR EXISTS (SELECT 1 FROM public.email_verification_tokens token JOIN public.users account ON account.id=token.user_id WHERE token.id=outbox.email_verification_token_id AND account.company_id=company_row.id)
        ))
    ),
    'protectedEvidence',(SELECT
      (SELECT count(*) FROM public.invoices WHERE company_id=company_row.id AND lifecycle_status='FINALIZED')
      +(SELECT count(*) FROM public.payments payment JOIN public.invoices invoice ON invoice.id=payment.invoice_id WHERE invoice.company_id=company_row.id AND payment.payment_status='PAID')
      +(SELECT count(*) FROM public.delivery_jobs WHERE company_id=company_row.id AND status IN ('DELIVERED','COMPLETED'))
      +(SELECT count(*) FROM public.receipts WHERE company_id=company_row.id)
    ),
    'confirmation','DELETE '||company_row.company_code
  ) INTO result;
  RETURN result || jsonb_build_object(
    'hardDeleteEligible',(
      (result->>'users')::bigint=0 AND (result->>'memberships')::bigint=0
      AND (result->>'branches')::bigint=0 AND (result->>'departments')::bigint=0
      AND (result->>'roleAssignments')::bigint=0 AND (result->>'sessions')::bigint=0
      AND (result->>'requests')::bigint=0 AND (result->>'budgets')::bigint=0
      AND (result->>'approvalPolicies')::bigint=0
      AND (result->>'invoices')::bigint=0 AND (result->>'deliveries')::bigint=0
      AND (result->>'documents')::bigint=0 AND (result->>'branding')::bigint=0
      AND (result->>'notifications')::bigint=0 AND (result->>'workflowEvents')::bigint=0
      AND (result->>'lifecycleHistory')::bigint=0
    )
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_delete_or_archive_company(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_confirmation text,p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE company_row public.companies%ROWTYPE; impact jsonb; mode text;
BEGIN
  IF char_length(btrim(p_reason)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'A deletion reason is required';
  END IF;
  SELECT * INTO company_row FROM public.companies WHERE id=p_company_id FOR UPDATE;
  impact:=public.axora_company_deletion_impact(p_actor_user_id,p_actor_role_assignment_id,p_company_id,p_at);
  IF p_confirmation IS DISTINCT FROM impact->>'confirmation' THEN
    RAISE EXCEPTION 'The irreversible confirmation did not match';
  END IF;
  IF (impact->>'inFlightWork')::bigint>0 THEN
    RAISE EXCEPTION 'Company deletion is temporarily unavailable while work is in flight';
  END IF;
  IF COALESCE((impact->>'hardDeleteEligible')::boolean,false) THEN
    BEGIN
      DELETE FROM public.companies WHERE id=company_row.id;
      mode:='HARD_DELETED';
    EXCEPTION WHEN foreign_key_violation THEN
      mode:=NULL;
    END;
  END IF;
  IF mode IS NULL THEN
    UPDATE public.company_assignments
    SET status='ENDED',ended_by=p_actor_user_id,ended_at=p_at,
      end_reason='Company archived: '||left(btrim(p_reason),980)
    WHERE company_id=company_row.id AND status='ACTIVE';
    UPDATE public.account_setup_invitations
    SET revoked_at=p_at,revoked_reason=left('Company archived: '||btrim(p_reason),240),
      delivery_status=CASE WHEN delivery_status='PENDING' THEN 'CANCELLED' ELSE delivery_status END,
      last_delivery_error=CASE WHEN delivery_status='PENDING' THEN 'company_archived' ELSE last_delivery_error END
    WHERE company_id=company_row.id AND consumed_at IS NULL AND revoked_at IS NULL;
    UPDATE public.password_reset_tokens SET revoked_at=p_at
    WHERE revoked_at IS NULL AND used_at IS NULL AND user_id IN (
      SELECT id FROM public.users WHERE company_id=company_row.id
    );
    UPDATE public.email_verification_tokens SET revoked_at=p_at
    WHERE revoked_at IS NULL AND used_at IS NULL AND user_id IN (
      SELECT id FROM public.users WHERE company_id=company_row.id
    );
    UPDATE public.workflow_email_outbox
    SET delivery_status='CANCELLED',last_delivery_error='company_archived'
    WHERE company_id=company_row.id AND delivery_status='PENDING';
    UPDATE public.transactional_email_outbox outbox
    SET delivery_status='CANCELLED',last_delivery_error='company_archived',
      token_ciphertext=NULL,token_nonce=NULL,token_authentication_tag=NULL
    WHERE outbox.delivery_status='PENDING' AND (
      EXISTS (SELECT 1 FROM public.invoices invoice WHERE invoice.id=outbox.invoice_id AND invoice.company_id=company_row.id)
      OR EXISTS (SELECT 1 FROM public.password_reset_tokens token JOIN public.users account ON account.id=token.user_id WHERE token.id=outbox.password_reset_token_id AND account.company_id=company_row.id)
      OR EXISTS (SELECT 1 FROM public.email_verification_tokens token JOIN public.users account ON account.id=token.user_id WHERE token.id=outbox.email_verification_token_id AND account.company_id=company_row.id)
    );
    UPDATE public.request_approval_outbox
    SET status='FAILED',completed_at=p_at,last_error='company_archived'
    WHERE company_id=company_row.id AND status='PENDING';
    UPDATE public.notification_reminders reminder
    SET status='CANCELLED',cancelled_at=p_at,cancelled_reason='company_archived'
    FROM public.in_app_notifications notification
    WHERE notification.id=reminder.original_notification_id
      AND notification.company_id=company_row.id AND reminder.status='PENDING';
    UPDATE public.in_app_notifications SET archived_at=COALESCE(archived_at,p_at)
    WHERE company_id=company_row.id;
    UPDATE public.user_sessions SET revoked_at=COALESCE(revoked_at,p_at),revoked_by=p_actor_user_id,
      revoke_reason=COALESCE(revoke_reason,'Company archived')
    WHERE user_id IN (SELECT id FROM public.users WHERE company_id=company_row.id)
      AND revoked_at IS NULL;
    UPDATE public.branch_assignments SET status='ENDED',ended_at=COALESCE(ended_at,p_at)
    WHERE company_id=company_row.id AND status<>'ENDED';
    UPDATE public.company_memberships SET status='ENDED',ended_at=COALESCE(ended_at,p_at),updated_at=p_at
    WHERE company_id=company_row.id AND status<>'ENDED';
    UPDATE public.user_permission_overrides SET active=false
    WHERE active AND user_id IN (SELECT id FROM public.users WHERE company_id=company_row.id);
    UPDATE public.role_assignments SET active=false,revoked_at=COALESCE(revoked_at,p_at),
      revoked_by=COALESCE(revoked_by,p_actor_user_id),
      revoke_reason=COALESCE(revoke_reason,'Company archived')
    WHERE (company_id=company_row.id OR user_id IN (
      SELECT id FROM public.users WHERE company_id=company_row.id
    )) AND active;
    UPDATE public.users SET active=false,account_status='DEACTIVATED',auth_version=auth_version+1,updated_at=p_at
    WHERE company_id=company_row.id AND active;
    UPDATE public.companies SET active=false,lifecycle_status='ARCHIVED',
      portal_access_enabled=false,is_publicly_listed=false,
      verification_status='INACTIVE',lifecycle_version=lifecycle_version+1,
      lifecycle_updated_at=p_at,updated_at=p_at
    WHERE id=company_row.id;
    mode:='ARCHIVED_RETAINED';
  END IF;
  INSERT INTO public.company_deletion_tombstones(
    company_id,company_code,deletion_mode,reason,deleted_by,deleted_at,impact
  ) VALUES (company_row.id,company_row.company_code,mode,btrim(p_reason),p_actor_user_id,p_at,impact)
  ON CONFLICT (company_id) DO UPDATE SET deletion_mode=EXCLUDED.deletion_mode,
    reason=EXCLUDED.reason,deleted_by=EXCLUDED.deleted_by,deleted_at=EXCLUDED.deleted_at,
    impact=EXCLUDED.impact;
  INSERT INTO public.audit_logs(entity_type,record_id,action,new_values,actor_id,reason,occurred_at)
  VALUES ('companies',company_row.id,mode,NULL,p_actor_user_id,btrim(p_reason),p_at);
  RETURN jsonb_build_object('companyId',company_row.id,'mode',mode,'impact',impact);
END
$$;

REVOKE ALL ON FUNCTION public.axora_company_deletion_impact(uuid,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_delete_or_archive_company(uuid,uuid,uuid,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_company_is_retained(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_snapshot_has_permission(jsonb,text,text,uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_company_actor_can_view(jsonb,uuid,uuid,timestamptz) FROM PUBLIC;
DO $axora_runtime_role$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    EXECUTE 'REVOKE ALL ON public.company_deletion_tombstones FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_company_deletion_impact(uuid,uuid,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_delete_or_archive_company(uuid,uuid,uuid,text,text,timestamptz) TO axora_app';
  END IF;
END
$axora_runtime_role$;

COMMIT;
