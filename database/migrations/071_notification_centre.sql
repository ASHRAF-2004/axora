BEGIN;

-- P2-05 keeps authoritative workflow evidence in-app while allowing only
-- optional email and reminder delivery to be configured. Event policy is
-- data, not browser logic, so enqueue, claim, preference, and UI capabilities
-- all resolve the same rule.
CREATE TABLE public.notification_event_policies (
  event_key text PRIMARY KEY CHECK (
    char_length(event_key) BETWEEN 2 AND 120
    AND event_key ~ '^[a-z][a-z0-9_.-]*$'
  ),
  category text NOT NULL CHECK (category IN (
    'ACCOUNT','LEAD','APPROVAL','BUDGET','SOURCING','DELIVERY','FINANCE',
    'EMAIL','WORKFLOW'
  )),
  email_mandatory boolean NOT NULL DEFAULT false,
  default_reminder_hours smallint CHECK (
    default_reminder_hours IS NULL OR default_reminder_hours BETWEEN 1 AND 720
  ),
  company_configurable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.notification_event_policies(
  event_key,category,email_mandatory,default_reminder_hours,company_configurable
) VALUES
  ('invitation.sent','ACCOUNT',true,NULL,false),
  ('invitation.accepted','ACCOUNT',true,NULL,false),
  ('password.changed','ACCOUNT',true,NULL,false),
  ('email.verification','ACCOUNT',true,NULL,false),
  ('company.lead.created','LEAD',false,24,false),
  ('company.lead.submitted','LEAD',false,24,false),
  ('company.lead.assigned','LEAD',false,24,false),
  ('company.lead.reassigned','LEAD',false,NULL,false),
  ('company.lead.contacted','LEAD',false,NULL,false),
  ('company.lead.information_requested','LEAD',false,24,false),
  ('company.lead.qualified','LEAD',false,NULL,false),
  ('company.lead.converted','LEAD',false,NULL,false),
  ('company.lead.rejected','LEAD',false,NULL,false),
  ('company.lead.archived','LEAD',false,NULL,false),
  ('company.lead.sla_overdue','LEAD',true,12,false),
  ('request.submitted','WORKFLOW',false,NULL,true),
  ('request.status_changed','WORKFLOW',false,NULL,true),
  ('request.approved','APPROVAL',false,NULL,true),
  ('request.rejected','APPROVAL',false,NULL,true),
  ('approval.needed','APPROVAL',true,24,true),
  ('approval.company_required','APPROVAL',true,24,true),
  ('budget.low','BUDGET',false,NULL,true),
  ('budget.zero','BUDGET',true,24,true),
  ('budget.refreshed','BUDGET',false,NULL,true),
  ('budget.refresh_failed','BUDGET',true,24,true),
  ('quotation.requested','SOURCING',false,NULL,true),
  ('quotation.received','SOURCING',false,NULL,true),
  ('supplier.selected','SOURCING',false,NULL,true),
  ('supplier.order_selected','SOURCING',false,NULL,true),
  ('supplier.order_acknowledged','SOURCING',false,NULL,true),
  ('supplier.rfq_acknowledged','SOURCING',false,NULL,true),
  ('delivery.scheduled','DELIVERY',false,NULL,true),
  ('driver.assigned','DELIVERY',false,12,true),
  ('delivery.out_for_delivery','DELIVERY',false,NULL,true),
  ('delivery.arrived','DELIVERY',false,NULL,true),
  ('delivery.completed','DELIVERY',false,NULL,true),
  ('receipt.required','DELIVERY',true,12,true),
  ('receipt.confirmed','DELIVERY',false,NULL,true),
  ('discrepancy.opened','DELIVERY',true,24,true),
  ('invoice.issued','FINANCE',false,NULL,true),
  ('payment.status_changed','FINANCE',false,NULL,true),
  ('three_way_match.completed','FINANCE',false,NULL,true),
  ('three_way_match.exception','FINANCE',true,24,true),
  ('email.hard_bounce','EMAIL',true,NULL,false)
ON CONFLICT(event_key) DO UPDATE SET
  category=EXCLUDED.category,
  email_mandatory=EXCLUDED.email_mandatory,
  default_reminder_hours=EXCLUDED.default_reminder_hours,
  company_configurable=EXCLUDED.company_configurable;

CREATE OR REPLACE FUNCTION public.axora_notification_category(p_event_key text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT COALESCE(
    (SELECT policy.category FROM public.notification_event_policies policy
      WHERE policy.event_key=p_event_key),
    CASE
      WHEN p_event_key LIKE 'company.lead.%' THEN 'LEAD'
      WHEN p_event_key LIKE 'approval.%' OR p_event_key LIKE 'request.approv%'
        OR p_event_key LIKE 'request.reject%' THEN 'APPROVAL'
      WHEN p_event_key LIKE 'budget.%' THEN 'BUDGET'
      WHEN p_event_key LIKE 'quotation.%' OR p_event_key LIKE 'supplier.%'
        THEN 'SOURCING'
      WHEN p_event_key LIKE 'delivery.%' OR p_event_key LIKE 'driver.%'
        OR p_event_key LIKE 'receipt.%' OR p_event_key LIKE 'discrepancy.%'
        THEN 'DELIVERY'
      WHEN p_event_key LIKE 'invoice.%' OR p_event_key LIKE 'payment.%'
        OR p_event_key LIKE 'three_way_match.%' THEN 'FINANCE'
      WHEN p_event_key LIKE 'invitation.%' OR p_event_key LIKE 'password.%'
        OR p_event_key LIKE 'account.%' THEN 'ACCOUNT'
      WHEN p_event_key LIKE 'email.%' THEN 'EMAIL'
      ELSE 'WORKFLOW'
    END
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_notification_email_is_mandatory(
  p_event_key text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT COALESCE((
    SELECT policy.email_mandatory
    FROM public.notification_event_policies policy
    WHERE policy.event_key=p_event_key
  ),false)
$$;

-- A profile-level in-app opt-out was a legacy presentation preference. It is
-- normalized before the database constraint makes authoritative in-app
-- evidence non-disableable.
UPDATE public.user_profiles SET notification_in_app_enabled=true
WHERE NOT notification_in_app_enabled;
ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_authoritative_in_app_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_authoritative_in_app_check
    CHECK (notification_in_app_enabled);

UPDATE public.notification_preferences SET in_app_enabled=true
WHERE NOT in_app_enabled;
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS reminder_interval_hours smallint;
ALTER TABLE public.notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_reminder_hours_check;
ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_reminder_hours_check CHECK (
    reminder_interval_hours IS NULL OR reminder_interval_hours=0
      OR reminder_interval_hours BETWEEN 1 AND 720
  );
ALTER TABLE public.notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_authoritative_in_app_check;
ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_authoritative_in_app_check
    CHECK (in_app_enabled);

CREATE TABLE public.company_notification_preferences (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  event_key text NOT NULL REFERENCES public.notification_event_policies(event_key)
    ON DELETE RESTRICT,
  email_enabled boolean NOT NULL DEFAULT true,
  digest_mode text NOT NULL DEFAULT 'IMMEDIATE'
    CHECK (digest_mode IN ('IMMEDIATE','DAILY','WEEKLY')),
  reminder_interval_hours smallint CHECK (
    reminder_interval_hours IS NULL OR reminder_interval_hours=0
      OR reminder_interval_hours BETWEEN 1 AND 720
  ),
  updated_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,event_key)
);

ALTER TABLE public.in_app_notifications
  DROP CONSTRAINT IF EXISTS in_app_notifications_source_check;
ALTER TABLE public.in_app_notifications
  ADD COLUMN IF NOT EXISTS email_provider_event_id uuid
    REFERENCES public.email_provider_events(provider_event_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_to_client_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_of_notification_id uuid,
  ADD COLUMN IF NOT EXISTS state_version bigint NOT NULL DEFAULT 1;

UPDATE public.in_app_notifications
SET category=public.axora_notification_category(event_key),
    expires_at=created_at+CASE
      WHEN priority IN ('HIGH','URGENT') THEN interval '365 days'
      ELSE interval '180 days' END
WHERE category IS NULL OR expires_at IS NULL;

ALTER TABLE public.in_app_notifications
  ALTER COLUMN category SET NOT NULL,
  ALTER COLUMN expires_at SET NOT NULL,
  ADD CONSTRAINT in_app_notifications_category_check CHECK (category IN (
    'ACCOUNT','LEAD','APPROVAL','BUDGET','SOURCING','DELIVERY','FINANCE',
    'EMAIL','WORKFLOW'
  )),
  ADD CONSTRAINT in_app_notifications_source_check CHECK (
    (company_id IS NOT NULL AND workflow_event_id IS NOT NULL
      AND lead_event_id IS NULL AND email_provider_event_id IS NULL)
    OR (company_id IS NULL AND workflow_event_id IS NULL
      AND lead_event_id IS NOT NULL AND email_provider_event_id IS NULL)
    OR (workflow_event_id IS NULL AND lead_event_id IS NULL
      AND email_provider_event_id IS NOT NULL)
  ),
  ADD CONSTRAINT in_app_notifications_expiry_check CHECK (
    expires_at>created_at
  ),
  ADD CONSTRAINT in_app_notifications_delivery_check CHECK (
    delivered_to_client_at IS NULL OR delivered_to_client_at>=created_at
  ),
  ADD CONSTRAINT in_app_notifications_state_version_check CHECK (
    state_version>0
  ),
  ADD CONSTRAINT in_app_notifications_reminder_source_fk
    FOREIGN KEY(reminder_of_notification_id)
    REFERENCES public.in_app_notifications(id) ON DELETE RESTRICT,
  ADD CONSTRAINT in_app_notifications_not_own_reminder_check CHECK (
    reminder_of_notification_id IS NULL OR reminder_of_notification_id<>id
  );

CREATE UNIQUE INDEX in_app_notifications_email_event_dedupe_uq
  ON public.in_app_notifications(recipient_user_id,dedupe_key)
  WHERE email_provider_event_id IS NOT NULL;
CREATE INDEX in_app_notifications_recipient_state_idx
  ON public.in_app_notifications(
    recipient_user_id,archived_at,read_at,created_at DESC,id DESC
  );
CREATE INDEX in_app_notifications_expiry_idx
  ON public.in_app_notifications(recipient_user_id,expires_at)
  WHERE archived_at IS NULL;

CREATE TABLE public.notification_email_relations (
  notification_id uuid PRIMARY KEY
    REFERENCES public.in_app_notifications(id) ON DELETE RESTRICT,
  workflow_email_outbox_id uuid NOT NULL UNIQUE
    REFERENCES public.workflow_email_outbox(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.notification_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_notification_id uuid NOT NULL UNIQUE
    REFERENCES public.in_app_notifications(id) ON DELETE RESTRICT,
  recipient_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','MATERIALIZED','CANCELLED')),
  materialized_notification_id uuid UNIQUE
    REFERENCES public.in_app_notifications(id) ON DELETE RESTRICT,
  cancelled_reason text CHECK (
    cancelled_reason IS NULL OR char_length(cancelled_reason) BETWEEN 2 AND 240
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  materialized_at timestamptz,
  cancelled_at timestamptz,
  CHECK (due_at>created_at-interval '5 seconds'),
  CHECK (
    (status='PENDING' AND materialized_notification_id IS NULL
      AND materialized_at IS NULL AND cancelled_at IS NULL)
    OR (status='MATERIALIZED' AND materialized_notification_id IS NOT NULL
      AND materialized_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status='CANCELLED' AND materialized_notification_id IS NULL
      AND materialized_at IS NULL AND cancelled_at IS NOT NULL
      AND cancelled_reason IS NOT NULL)
  )
);
CREATE INDEX notification_reminders_due_idx
  ON public.notification_reminders(due_at,id) WHERE status='PENDING';

CREATE TABLE public.notification_commands (
  command_id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN (
    'MARK_READ','MARK_ALL_READ','ARCHIVE','SAVE_USER_PREFERENCE',
    'SAVE_COMPANY_PREFERENCE'
  )),
  outcome text NOT NULL CHECK (outcome IN ('SUCCESS','NOOP')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result)='object'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.notification_state_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL
    REFERENCES public.in_app_notifications(id) ON DELETE RESTRICT,
  command_id uuid REFERENCES public.notification_commands(command_id)
    ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN (
    'CREATED','DELIVERED','READ','ARCHIVED','REMINDER_SCHEDULED',
    'REMINDER_MATERIALIZED','REMINDER_CANCELLED'
  )),
  state_version bigint NOT NULL CHECK (state_version>0),
  related_notification_id uuid
    REFERENCES public.in_app_notifications(id) ON DELETE RESTRICT,
  reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 2 AND 240),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_state_events_notification_idx
  ON public.notification_state_events(notification_id,occurred_at,id);

CREATE OR REPLACE FUNCTION public.axora_reject_notification_evidence_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Notification evidence is append-only';
END $$;

CREATE TRIGGER notification_commands_append_only
BEFORE UPDATE OR DELETE ON public.notification_commands
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_notification_evidence_change();
CREATE TRIGGER notification_state_events_append_only
BEFORE UPDATE OR DELETE ON public.notification_state_events
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_notification_evidence_change();
CREATE TRIGGER notification_email_relations_append_only
BEFORE UPDATE OR DELETE ON public.notification_email_relations
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_notification_evidence_change();

CREATE OR REPLACE FUNCTION public.validate_in_app_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  source_event_key text;
  recipient_is_active boolean;
  reminder_matches boolean;
BEGIN
  IF NEW.workflow_event_id IS NOT NULL THEN
    SELECT event.event_key INTO source_event_key
    FROM public.workflow_events event
    WHERE event.id=NEW.workflow_event_id AND event.company_id=NEW.company_id;
  ELSIF NEW.lead_event_id IS NOT NULL THEN
    SELECT event.event_key INTO source_event_key
    FROM public.company_lead_events event WHERE event.id=NEW.lead_event_id;
  ELSIF NEW.email_provider_event_id IS NOT NULL THEN
    SELECT CASE WHEN event.event_type='MESSAGE_BOUNCED'
        AND event.bounce_type='HARD' THEN 'email.hard_bounce' END
    INTO source_event_key
    FROM public.email_provider_events event
    WHERE event.provider_event_id=NEW.email_provider_event_id;
  END IF;

  IF source_event_key IS NULL OR source_event_key<>NEW.event_key THEN
    RAISE EXCEPTION 'Notification event key must match its source event';
  END IF;

  SELECT account.active AND account.account_status IN ('ACTIVE','INVITED')
  INTO recipient_is_active
  FROM public.users account WHERE account.id=NEW.recipient_user_id;
  IF recipient_is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Notification recipient must be an active account';
  END IF;

  IF NEW.reminder_of_notification_id IS NOT NULL THEN
    SELECT original.recipient_user_id=NEW.recipient_user_id
      AND original.workflow_event_id IS NOT DISTINCT FROM NEW.workflow_event_id
      AND original.lead_event_id IS NOT DISTINCT FROM NEW.lead_event_id
      AND original.email_provider_event_id
        IS NOT DISTINCT FROM NEW.email_provider_event_id
    INTO reminder_matches
    FROM public.in_app_notifications original
    WHERE original.id=NEW.reminder_of_notification_id;
    IF reminder_matches IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Notification reminder source is invalid';
    END IF;
  END IF;

  NEW.category:=public.axora_notification_category(NEW.event_key);
  NEW.expires_at:=COALESCE(NEW.expires_at,NEW.created_at+CASE
    WHEN NEW.priority IN ('HIGH','URGENT') THEN interval '365 days'
    ELSE interval '180 days' END);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.protect_in_app_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'In-app notifications cannot be deleted'
      USING ERRCODE='55000';
  END IF;
  IF (to_jsonb(NEW)-ARRAY[
      'read_at','archived_at','delivered_to_client_at','state_version'
    ]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY[
      'read_at','archived_at','delivered_to_client_at','state_version'
    ]) THEN
    RAISE EXCEPTION 'Notification identity and content are immutable'
      USING ERRCODE='55000';
  END IF;
  IF (OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at)
    OR (OLD.archived_at IS NOT NULL
      AND NEW.archived_at IS DISTINCT FROM OLD.archived_at)
    OR (OLD.delivered_to_client_at IS NOT NULL
      AND NEW.delivered_to_client_at IS DISTINCT FROM OLD.delivered_to_client_at)
  THEN
    RAISE EXCEPTION 'Notification lifecycle timestamps are monotonic'
      USING ERRCODE='55000';
  END IF;
  IF NEW.read_at IS DISTINCT FROM OLD.read_at
    OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
    OR NEW.delivered_to_client_at IS DISTINCT FROM OLD.delivered_to_client_at
  THEN
    NEW.state_version:=OLD.state_version+1;
  ELSE
    NEW.state_version:=OLD.state_version;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_in_app_notification_mutation
  ON public.in_app_notifications;
CREATE TRIGGER protect_in_app_notification_mutation
BEFORE UPDATE OR DELETE ON public.in_app_notifications
FOR EACH ROW EXECUTE FUNCTION public.protect_in_app_notification();

CREATE OR REPLACE FUNCTION public.axora_record_notification_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_id uuid:=public.axora_context_user_id();
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO public.notification_state_events(
      notification_id,actor_user_id,action,state_version,occurred_at
    ) VALUES (NEW.id,actor_id,'CREATED',NEW.state_version,NEW.created_at);
    RETURN NEW;
  END IF;
  IF NEW.delivered_to_client_at IS DISTINCT FROM OLD.delivered_to_client_at THEN
    INSERT INTO public.notification_state_events(
      notification_id,actor_user_id,action,state_version,occurred_at
    ) VALUES (
      NEW.id,actor_id,'DELIVERED',NEW.state_version,NEW.delivered_to_client_at
    );
  END IF;
  IF NEW.read_at IS DISTINCT FROM OLD.read_at THEN
    INSERT INTO public.notification_state_events(
      notification_id,actor_user_id,action,state_version,occurred_at
    ) VALUES (NEW.id,actor_id,'READ',NEW.state_version,NEW.read_at);
  END IF;
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    INSERT INTO public.notification_state_events(
      notification_id,actor_user_id,action,state_version,occurred_at
    ) VALUES (NEW.id,actor_id,'ARCHIVED',NEW.state_version,NEW.archived_at);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS record_notification_state_insert
  ON public.in_app_notifications;
DROP TRIGGER IF EXISTS record_notification_state_update
  ON public.in_app_notifications;
CREATE TRIGGER record_notification_state_insert
AFTER INSERT ON public.in_app_notifications
FOR EACH ROW EXECUTE FUNCTION public.axora_record_notification_state();
CREATE TRIGGER record_notification_state_update
AFTER UPDATE ON public.in_app_notifications
FOR EACH ROW EXECUTE FUNCTION public.axora_record_notification_state();

CREATE OR REPLACE FUNCTION public.axora_notification_source_is_visible(
  p_snapshot jsonb,p_actor_user_id uuid,p_notification_id uuid,
  p_at timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE notification_row public.in_app_notifications%ROWTYPE; lead_id uuid;
BEGIN
  IF p_snapshot IS NULL THEN RETURN false; END IF;
  SELECT * INTO notification_row FROM public.in_app_notifications item
  WHERE item.id=p_notification_id AND item.recipient_user_id=p_actor_user_id;
  IF notification_row.id IS NULL THEN RETURN false; END IF;
  IF notification_row.workflow_event_id IS NOT NULL THEN
    RETURN public.axora_workflow_notification_recipient_is_valid(
      notification_row.company_id,notification_row.workflow_event_id,
      p_actor_user_id
    );
  END IF;
  IF notification_row.lead_event_id IS NOT NULL THEN
    SELECT event.lead_id INTO lead_id FROM public.company_lead_events event
    WHERE event.id=notification_row.lead_event_id;
    RETURN public.axora_company_lead_actor_can_view(
      p_snapshot,p_actor_user_id,lead_id,p_at
    );
  END IF;
  RETURN notification_row.email_provider_event_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.email_provider_events event
    WHERE event.provider_event_id=notification_row.email_provider_event_id
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_notification_route_is_authorized(
  p_snapshot jsonb,p_actor_user_id uuid,p_notification_id uuid,
  p_at timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  notification_row public.in_app_notifications%ROWTYPE;
  event_row public.workflow_events%ROWTYPE;
  request_row public.requests%ROWTYPE;
  resource_type text;
  supplier_id uuid;
BEGIN
  IF NOT public.axora_notification_source_is_visible(
    p_snapshot,p_actor_user_id,p_notification_id,p_at
  ) THEN RETURN false; END IF;
  SELECT * INTO notification_row FROM public.in_app_notifications item
  WHERE item.id=p_notification_id;
  IF notification_row.route_path IS NULL THEN RETURN false; END IF;
  IF notification_row.route_path='/notifications'
    OR notification_row.route_path LIKE '/notifications?%'
    OR notification_row.route_path='/account'
    OR notification_row.route_path LIKE '/account?%'
    OR notification_row.route_path='/profile'
    OR notification_row.route_path LIKE '/profile?%'
    OR notification_row.route_path='/help'
    OR notification_row.route_path LIKE '/help?%'
    OR notification_row.route_path='/settings'
    OR notification_row.route_path LIKE '/settings?%'
  THEN RETURN true; END IF;
  IF notification_row.lead_event_id IS NOT NULL THEN RETURN true; END IF;
  IF notification_row.email_provider_event_id IS NOT NULL THEN
    RETURN notification_row.route_path LIKE '/email-operations%'
      AND (
        public.axora_snapshot_has_permission(
          p_snapshot,'email.operations.view','PLATFORM',NULL,NULL,NULL,NULL
        ) OR (notification_row.company_id IS NOT NULL AND
          public.axora_snapshot_has_permission(
            p_snapshot,'email.operations.view','COMPANY',
            notification_row.company_id,NULL,NULL,NULL
          ))
      );
  END IF;

  SELECT * INTO event_row FROM public.workflow_events event
  WHERE event.id=notification_row.workflow_event_id
    AND event.company_id=notification_row.company_id;
  IF event_row.request_id IS NOT NULL THEN
    SELECT * INTO request_row FROM public.requests request
    WHERE request.id=event_row.request_id AND request.company_id=event_row.company_id;
  END IF;
  resource_type:=CASE
    WHEN request_row.department_id IS NOT NULL THEN 'DEPARTMENT'
    WHEN COALESCE(request_row.branch_id,event_row.branch_id) IS NOT NULL
      THEN 'BRANCH'
    ELSE 'COMPANY' END;

  IF notification_row.route_path LIKE '/requests%' THEN
    RETURN request_row.id IS NOT NULL AND
      public.axora_request_permission_is_effective(
        p_snapshot,p_actor_user_id,'request.view',request_row.company_id,
        request_row.branch_id,request_row.department_id,request_row.created_by
      );
  ELSIF notification_row.route_path LIKE '/approvals%' THEN
    RETURN public.axora_snapshot_has_permission(
      p_snapshot,'request.approval_queue.view',resource_type,event_row.company_id,
      COALESCE(request_row.branch_id,event_row.branch_id),
      request_row.department_id,NULL
    );
  ELSIF notification_row.route_path LIKE '/budgets%' THEN
    RETURN public.axora_snapshot_has_permission(
      p_snapshot,'budget.view',resource_type,event_row.company_id,
      COALESCE(request_row.branch_id,event_row.branch_id),
      request_row.department_id,NULL
    );
  ELSIF notification_row.route_path LIKE '/finance%' THEN
    RETURN public.axora_snapshot_has_permission(
      p_snapshot,'finance.invoice.view',resource_type,event_row.company_id,
      COALESCE(request_row.branch_id,event_row.branch_id),
      request_row.department_id,NULL
    ) OR public.axora_snapshot_has_permission(
      p_snapshot,'finance.manage',resource_type,event_row.company_id,
      COALESCE(request_row.branch_id,event_row.branch_id),
      request_row.department_id,NULL
    );
  ELSIF notification_row.route_path LIKE '/receiving%' THEN
    RETURN public.axora_snapshot_has_permission(
      p_snapshot,'receiving.view',resource_type,event_row.company_id,
      COALESCE(request_row.branch_id,event_row.branch_id),
      request_row.department_id,NULL
    );
  ELSIF notification_row.route_path LIKE '/driver%' THEN
    RETURN public.axora_snapshot_has_permission(
      p_snapshot,'delivery.portal.view','DELIVERY',NULL,NULL,NULL,NULL
    );
  ELSIF notification_row.route_path LIKE '/supplier%' THEN
    SELECT NULLIF(scope->>'supplierId','')::uuid INTO supplier_id
    FROM jsonb_array_elements(COALESCE(p_snapshot->'scopes','[]'::jsonb)) scope
    WHERE scope->>'type'='SUPPLIER' LIMIT 1;
    RETURN public.axora_snapshot_has_permission(
      p_snapshot,'supplier.portal.view','SUPPLIER',NULL,NULL,NULL,supplier_id
    );
  ELSIF notification_row.route_path LIKE '/sourcing%' THEN
    RETURN public.axora_snapshot_has_permission(
      p_snapshot,'sourcing.manage',resource_type,event_row.company_id,
      COALESCE(request_row.branch_id,event_row.branch_id),
      request_row.department_id,NULL
    );
  ELSIF notification_row.route_path LIKE '/deliveries%' THEN
    RETURN public.axora_snapshot_has_permission(
      p_snapshot,'delivery.view',resource_type,event_row.company_id,
      COALESCE(request_row.branch_id,event_row.branch_id),
      request_row.department_id,NULL
    );
  ELSIF notification_row.route_path LIKE '/users%' THEN
    RETURN public.axora_snapshot_has_permission(
      p_snapshot,'user.view','COMPANY',event_row.company_id,NULL,NULL,NULL
    );
  ELSIF notification_row.route_path LIKE '/companies%' THEN
    RETURN public.axora_snapshot_has_permission(
      p_snapshot,'company.view','COMPANY',event_row.company_id,NULL,NULL,NULL
    ) OR public.axora_snapshot_has_permission(
      p_snapshot,'platform.view','PLATFORM',NULL,NULL,NULL,NULL
    );
  END IF;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.axora_notification_reminder_hours(
  p_user_id uuid,p_company_id uuid,p_event_key text
) RETURNS smallint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT COALESCE(
    (SELECT preference.reminder_interval_hours
      FROM public.notification_preferences preference
      WHERE preference.user_id=p_user_id AND preference.event_key=p_event_key),
    (SELECT preference.reminder_interval_hours
      FROM public.company_notification_preferences preference
      WHERE preference.company_id=p_company_id
        AND preference.event_key=p_event_key),
    (SELECT policy.default_reminder_hours
      FROM public.notification_event_policies policy
      WHERE policy.event_key=p_event_key)
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_schedule_notification_reminder()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE reminder_hours smallint; reminder_id uuid;
BEGIN
  IF NEW.reminder_of_notification_id IS NOT NULL THEN RETURN NEW; END IF;
  reminder_hours:=public.axora_notification_reminder_hours(
    NEW.recipient_user_id,NEW.company_id,NEW.event_key
  );
  IF reminder_hours IS NULL OR reminder_hours=0 THEN RETURN NEW; END IF;
  INSERT INTO public.notification_reminders(
    original_notification_id,recipient_user_id,due_at,created_at
  ) VALUES (
    NEW.id,NEW.recipient_user_id,
    NEW.created_at+make_interval(hours=>reminder_hours),NEW.created_at
  ) ON CONFLICT(original_notification_id) DO NOTHING
  RETURNING id INTO reminder_id;
  IF reminder_id IS NOT NULL THEN
    INSERT INTO public.notification_state_events(
      notification_id,actor_user_id,action,state_version,reason,occurred_at
    ) VALUES (
      NEW.id,public.axora_context_user_id(),'REMINDER_SCHEDULED',
      NEW.state_version,'policy_schedule',NEW.created_at
    );
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER schedule_notification_reminder
AFTER INSERT ON public.in_app_notifications
FOR EACH ROW EXECUTE FUNCTION public.axora_schedule_notification_reminder();

CREATE OR REPLACE FUNCTION public.axora_notification_reminder_should_cancel(
  p_original_event_key text,p_new_event_key text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_new_event_key IN (
    'request.approved','request.rejected','request.cancelled',
    'delivery.completed','receipt.confirmed','three_way_match.completed',
    'company.lead.contacted','company.lead.qualified',
    'company.lead.converted','company.lead.rejected',
    'company.lead.archived','company.lead.reassigned'
  ) OR p_new_event_key ~ '(approved|rejected|cancelled|completed|closed|confirmed|converted|archived|reassigned)$'
$$;

CREATE OR REPLACE FUNCTION public.axora_cancel_workflow_notification_reminders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  WITH cancelled AS (
    UPDATE public.notification_reminders reminder
    SET status='CANCELLED',cancelled_at=NEW.occurred_at,
      cancelled_reason=left('source_event:'||NEW.event_key,240)
    FROM public.in_app_notifications notification
    JOIN public.workflow_events source
      ON source.id=notification.workflow_event_id
     AND source.company_id=notification.company_id
    WHERE reminder.original_notification_id=notification.id
      AND reminder.status='PENDING'
      AND source.company_id=NEW.company_id
      AND source.aggregate_type=NEW.aggregate_type
      AND source.aggregate_id=NEW.aggregate_id
      AND public.axora_notification_reminder_should_cancel(
        source.event_key,NEW.event_key
      )
    RETURNING reminder.original_notification_id
  )
  INSERT INTO public.notification_state_events(
    notification_id,actor_user_id,action,state_version,reason,occurred_at
  )
  SELECT cancelled.original_notification_id,NEW.actor_user_id,
    'REMINDER_CANCELLED',notification.state_version,
    left('source_event:'||NEW.event_key,240),NEW.occurred_at
  FROM cancelled
  JOIN public.in_app_notifications notification
    ON notification.id=cancelled.original_notification_id;
  RETURN NEW;
END $$;

CREATE TRIGGER cancel_workflow_notification_reminders
AFTER INSERT ON public.workflow_events
FOR EACH ROW EXECUTE FUNCTION public.axora_cancel_workflow_notification_reminders();

CREATE OR REPLACE FUNCTION public.axora_cancel_lead_notification_reminders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  WITH cancelled AS (
    UPDATE public.notification_reminders reminder
    SET status='CANCELLED',cancelled_at=NEW.occurred_at,
      cancelled_reason=left('source_event:'||NEW.event_key,240)
    FROM public.in_app_notifications notification
    JOIN public.company_lead_events source
      ON source.id=notification.lead_event_id
    WHERE reminder.original_notification_id=notification.id
      AND reminder.status='PENDING' AND source.lead_id=NEW.lead_id
      AND public.axora_notification_reminder_should_cancel(
        source.event_key,NEW.event_key
      )
    RETURNING reminder.original_notification_id
  )
  INSERT INTO public.notification_state_events(
    notification_id,actor_user_id,action,state_version,reason,occurred_at
  )
  SELECT cancelled.original_notification_id,NEW.actor_user_id,
    'REMINDER_CANCELLED',notification.state_version,
    left('source_event:'||NEW.event_key,240),NEW.occurred_at
  FROM cancelled
  JOIN public.in_app_notifications notification
    ON notification.id=cancelled.original_notification_id;
  RETURN NEW;
END $$;

CREATE TRIGGER cancel_lead_notification_reminders
AFTER INSERT ON public.company_lead_events
FOR EACH ROW EXECUTE FUNCTION public.axora_cancel_lead_notification_reminders();

CREATE OR REPLACE FUNCTION public.axora_insert_in_app_notification(
  p_notification_id uuid,p_company_id uuid,p_recipient_user_id uuid,
  p_workflow_event_id uuid,p_lead_event_id uuid,p_event_key text,
  p_dedupe_key text,p_title text,p_body text,p_priority text,
  p_route_path text,p_created_at timestamptz DEFAULT now()
) RETURNS TABLE(notification_id uuid,created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_id uuid:=public.axora_context_user_id();
  source_actor_id uuid;
  source_lead_id uuid;
  inserted_id uuid;
BEGIN
  IF p_notification_id IS NULL OR p_recipient_user_id IS NULL
    OR p_event_key IS NULL OR p_created_at IS NULL
    OR ((p_workflow_event_id IS NULL)::integer
      +(p_lead_event_id IS NULL)::integer)<>1 THEN
    RAISE EXCEPTION 'Notification source is unavailable';
  END IF;
  IF p_workflow_event_id IS NOT NULL THEN
    SELECT event.actor_user_id INTO source_actor_id
    FROM public.workflow_events event
    WHERE event.id=p_workflow_event_id AND event.company_id=p_company_id
      AND event.event_key=p_event_key;
    IF source_actor_id IS NULL
      OR (source_actor_id IS DISTINCT FROM actor_id
        AND NOT public.axora_context_is_platform())
      OR NOT public.axora_workflow_notification_recipient_is_valid(
        p_company_id,p_workflow_event_id,p_recipient_user_id
      ) THEN
      RAISE EXCEPTION 'Notification source is unavailable';
    END IF;
  ELSE
    SELECT event.actor_user_id,event.lead_id INTO source_actor_id,source_lead_id
    FROM public.company_lead_events event
    WHERE event.id=p_lead_event_id AND event.event_key=p_event_key;
    IF source_lead_id IS NULL
      OR (source_actor_id IS NOT NULL AND source_actor_id IS DISTINCT FROM actor_id
        AND NOT public.axora_context_is_platform())
      OR NOT (public.axora_company_lead_recipient_ids(source_lead_id,true)
        ? p_recipient_user_id::text) THEN
      RAISE EXCEPTION 'Notification source is unavailable';
    END IF;
  END IF;

  INSERT INTO public.in_app_notifications(
    id,company_id,recipient_user_id,workflow_event_id,lead_event_id,
    event_key,dedupe_key,title,body,priority,route_path,created_at
  ) VALUES (
    p_notification_id,p_company_id,p_recipient_user_id,p_workflow_event_id,
    p_lead_event_id,p_event_key,p_dedupe_key,p_title,p_body,p_priority,
    p_route_path,p_created_at
  ) ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN
    RETURN QUERY SELECT inserted_id,true;
    RETURN;
  END IF;
  SELECT item.id INTO inserted_id FROM public.in_app_notifications item
  WHERE item.recipient_user_id=p_recipient_user_id
    AND item.dedupe_key=p_dedupe_key
    AND item.workflow_event_id IS NOT DISTINCT FROM p_workflow_event_id
    AND item.lead_event_id IS NOT DISTINCT FROM p_lead_event_id;
  IF inserted_id IS NULL THEN
    RAISE EXCEPTION 'Notification identity conflict';
  END IF;
  RETURN QUERY SELECT inserted_id,false;
END $$;

CREATE OR REPLACE FUNCTION public.axora_link_workflow_notification_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  INSERT INTO public.notification_email_relations(
    notification_id,workflow_email_outbox_id,linked_at
  )
  SELECT notification.id,NEW.id,NEW.created_at
  FROM public.in_app_notifications notification
  WHERE notification.company_id=NEW.company_id
    AND notification.recipient_user_id=NEW.recipient_user_id
    AND notification.workflow_event_id=NEW.workflow_event_id
    AND notification.dedupe_key=NEW.dedupe_key
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER link_workflow_notification_email
AFTER INSERT ON public.workflow_email_outbox
FOR EACH ROW EXECUTE FUNCTION public.axora_link_workflow_notification_email();

CREATE OR REPLACE FUNCTION public.axora_materialize_notification_reminders(
  p_snapshot jsonb,p_actor_user_id uuid,p_at timestamptz DEFAULT now()
) RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE item record; inserted_id uuid; materialized_count integer:=0;
BEGIN
  IF p_snapshot IS NULL THEN RETURN 0; END IF;
  FOR item IN
    SELECT reminder.id AS reminder_id,notification.*
    FROM public.notification_reminders reminder
    JOIN public.in_app_notifications notification
      ON notification.id=reminder.original_notification_id
    WHERE reminder.recipient_user_id=p_actor_user_id
      AND reminder.status='PENDING' AND reminder.due_at<=p_at
    ORDER BY reminder.due_at,reminder.id
    FOR UPDATE OF reminder SKIP LOCKED
  LOOP
    IF item.archived_at IS NOT NULL OR item.expires_at<=p_at
      OR NOT public.axora_notification_source_is_visible(
        p_snapshot,p_actor_user_id,item.id,p_at
      ) THEN
      UPDATE public.notification_reminders SET status='CANCELLED',
        cancelled_at=p_at,cancelled_reason='source_unavailable'
      WHERE id=item.reminder_id AND status='PENDING';
      INSERT INTO public.notification_state_events(
        notification_id,actor_user_id,action,state_version,reason,occurred_at
      ) VALUES (
        item.id,p_actor_user_id,'REMINDER_CANCELLED',item.state_version,
        'source_unavailable',p_at
      );
      CONTINUE;
    END IF;
    inserted_id:=gen_random_uuid();
    INSERT INTO public.in_app_notifications(
      id,company_id,recipient_user_id,workflow_event_id,lead_event_id,
      email_provider_event_id,event_key,dedupe_key,title,body,priority,
      route_path,created_at,expires_at,reminder_of_notification_id
    ) VALUES (
      inserted_id,item.company_id,item.recipient_user_id,item.workflow_event_id,
      item.lead_event_id,item.email_provider_event_id,item.event_key,
      'reminder:'||item.id::text,item.title,item.body,
      CASE WHEN item.priority IN ('LOW','NORMAL') THEN 'HIGH' ELSE item.priority END,
      item.route_path,p_at,p_at+interval '90 days',item.id
    ) ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
      SELECT notification.id INTO inserted_id
      FROM public.in_app_notifications notification
      WHERE notification.recipient_user_id=item.recipient_user_id
        AND notification.dedupe_key='reminder:'||item.id::text;
    END IF;
    UPDATE public.notification_reminders SET status='MATERIALIZED',
      materialized_notification_id=inserted_id,materialized_at=p_at
    WHERE id=item.reminder_id AND status='PENDING';
    IF FOUND THEN
      materialized_count:=materialized_count+1;
      INSERT INTO public.notification_state_events(
        notification_id,actor_user_id,action,state_version,
        related_notification_id,reason,occurred_at
      ) VALUES (
        inserted_id,p_actor_user_id,'REMINDER_MATERIALIZED',1,item.id,
        'scheduled_reminder',p_at
      );
    END IF;
  END LOOP;
  RETURN materialized_count;
END $$;

CREATE OR REPLACE FUNCTION public.axora_notification_summary(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,
  p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; result jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL THEN RETURN NULL; END IF;
  PERFORM public.axora_materialize_notification_reminders(
    snapshot,p_actor_user_id,p_at
  );
  UPDATE public.in_app_notifications notification
  SET delivered_to_client_at=p_at
  WHERE notification.recipient_user_id=p_actor_user_id
    AND notification.delivered_to_client_at IS NULL
    AND notification.archived_at IS NULL AND notification.expires_at>p_at
    AND public.axora_notification_source_is_visible(
      snapshot,p_actor_user_id,notification.id,p_at
    );
  SELECT jsonb_build_object(
    'capturedAt',p_at,
    'unreadCount',count(*) FILTER (
      WHERE notification.read_at IS NULL
        AND notification.archived_at IS NULL AND notification.expires_at>p_at
    ),
    'versionToken',md5(
      count(*)::text||':'||
      COALESCE(max(GREATEST(
        notification.created_at,
        COALESCE(notification.read_at,notification.created_at),
        COALESCE(notification.archived_at,notification.created_at),
        COALESCE(notification.delivered_to_client_at,notification.created_at)
      ))::text,'')||':'||COALESCE(sum(notification.state_version),0)::text
    )
  ) INTO result
  FROM public.in_app_notifications notification
  WHERE notification.recipient_user_id=p_actor_user_id
    AND public.axora_notification_source_is_visible(
      snapshot,p_actor_user_id,notification.id,p_at
    );
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.axora_notification_center_snapshot(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,
  p_filters jsonb DEFAULT '{}'::jsonb,p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
  summary jsonb;
  status_filter text:=upper(COALESCE(p_filters->>'status','ALL'));
  category_filter text:=upper(COALESCE(p_filters->>'category','ALL'));
  row_limit integer:=100;
  actor_company_id uuid;
  can_manage_company boolean:=false;
  result jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL THEN RETURN NULL; END IF;
  summary:=public.axora_notification_summary(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF status_filter NOT IN ('ALL','UNREAD','READ','ARCHIVED') THEN
    status_filter:='ALL';
  END IF;
  IF category_filter NOT IN (
    'ALL','ACCOUNT','LEAD','APPROVAL','BUDGET','SOURCING','DELIVERY',
    'FINANCE','EMAIL','WORKFLOW'
  ) THEN category_filter:='ALL'; END IF;
  IF COALESCE(p_filters->>'limit','') ~ '^[0-9]{1,3}$' THEN
    row_limit:=LEAST(GREATEST((p_filters->>'limit')::integer,1),200);
  END IF;
  SELECT NULLIF(scope->>'companyId','')::uuid INTO actor_company_id
  FROM jsonb_array_elements(COALESCE(snapshot->'scopes','[]'::jsonb)) scope
  WHERE scope->>'type'='COMPANY' LIMIT 1;
  IF actor_company_id IS NOT NULL THEN
    can_manage_company:=public.axora_snapshot_has_permission(
      snapshot,'user.manage','COMPANY',actor_company_id,NULL,NULL,NULL
    );
  END IF;

  WITH visible AS (
    SELECT notification.*,
      COALESCE(notification.archived_at,
        CASE WHEN notification.expires_at<=p_at
          THEN notification.expires_at END) AS effective_archived_at
    FROM public.in_app_notifications notification
    WHERE notification.recipient_user_id=p_actor_user_id
      AND public.axora_notification_source_is_visible(
        snapshot,p_actor_user_id,notification.id,p_at
      )
  ), filtered AS (
    SELECT * FROM visible notification
    WHERE (category_filter='ALL' OR notification.category=category_filter)
      AND (status_filter='ALL'
        OR (status_filter='UNREAD' AND notification.read_at IS NULL
          AND notification.effective_archived_at IS NULL)
        OR (status_filter='READ' AND notification.read_at IS NOT NULL
          AND notification.effective_archived_at IS NULL)
        OR (status_filter='ARCHIVED'
          AND notification.effective_archived_at IS NOT NULL))
  ), page_rows AS (
    SELECT * FROM filtered
    ORDER BY created_at DESC,id DESC LIMIT row_limit
  ), preference_rows AS (
    SELECT policy.event_key,policy.category,policy.email_mandatory,
      CASE WHEN policy.email_mandatory THEN true ELSE
        profile.notification_email_enabled
        AND COALESCE(user_preference.email_enabled,true)
        AND COALESCE(company_preference.email_enabled,true) END
        AS email_enabled,
      CASE WHEN policy.email_mandatory THEN 'IMMEDIATE' ELSE
        COALESCE(user_preference.digest_mode,
          company_preference.digest_mode,'IMMEDIATE') END AS delivery_schedule,
      COALESCE(user_preference.reminder_interval_hours,
        company_preference.reminder_interval_hours,
        policy.default_reminder_hours) AS reminder_hours,
      company_preference.email_enabled AS company_email_enabled,
      company_preference.digest_mode AS company_delivery_schedule,
      company_preference.reminder_interval_hours AS company_reminder_hours,
      policy.company_configurable
    FROM public.notification_event_policies policy
    JOIN public.user_profiles profile ON profile.user_id=p_actor_user_id
    LEFT JOIN public.notification_preferences user_preference
      ON user_preference.user_id=p_actor_user_id
     AND user_preference.event_key=policy.event_key
    LEFT JOIN public.company_notification_preferences company_preference
      ON company_preference.company_id=actor_company_id
     AND company_preference.event_key=policy.event_key
  )
  SELECT summary||jsonb_build_object(
    'filters',jsonb_build_object(
      'status',status_filter,'category',category_filter
    ),
    'totalCount',(SELECT count(*) FROM filtered),
    'canManageCompanyPreferences',can_manage_company,
    'companyId',actor_company_id,
    'notifications',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',notification.id,
      'eventKey',notification.event_key,
      'category',notification.category,
      'title',notification.title,
      'body',notification.body,
      'priority',notification.priority,
      'routePath',CASE WHEN public.axora_notification_route_is_authorized(
        snapshot,p_actor_user_id,notification.id,p_at
      ) THEN notification.route_path ELSE NULL END,
      'createdAt',notification.created_at,
      'deliveredAt',notification.delivered_to_client_at,
      'readAt',notification.read_at,
      'archivedAt',notification.effective_archived_at,
      'expiresAt',notification.expires_at,
      'stateVersion',notification.state_version,
      'reminderOfNotificationId',notification.reminder_of_notification_id,
      'emailDeliveryRelated',EXISTS (
        SELECT 1 FROM public.notification_email_relations relation
        WHERE relation.notification_id=notification.id
      )
    ) ORDER BY notification.created_at DESC,notification.id DESC)
      FROM page_rows notification),'[]'::jsonb),
    'preferences',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'eventKey',preference.event_key,
      'category',preference.category,
      'mandatoryEmail',preference.email_mandatory,
      'emailEnabled',preference.email_enabled,
      'deliverySchedule',preference.delivery_schedule,
      'reminderHours',preference.reminder_hours,
      'companyEmailEnabled',preference.company_email_enabled,
      'companyDeliverySchedule',preference.company_delivery_schedule,
      'companyReminderHours',preference.company_reminder_hours,
      'companyConfigurable',preference.company_configurable
    ) ORDER BY preference.category,preference.event_key)
      FROM preference_rows preference),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.axora_notification_command(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_command_id uuid,
  p_action text,p_payload jsonb DEFAULT '{}'::jsonb,
  p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
  existing public.notification_commands%ROWTYPE;
  notification_row public.in_app_notifications%ROWTYPE;
  result jsonb;
  changed_count integer:=0;
  event_key_value text;
  schedule_value text;
  email_value boolean;
  reminder_value smallint;
  company_value uuid;
  policy_row public.notification_event_policies%ROWTYPE;
BEGIN
  IF p_command_id IS NULL OR p_action NOT IN (
    'MARK_READ','MARK_ALL_READ','ARCHIVE','SAVE_USER_PREFERENCE',
    'SAVE_COMPANY_PREFERENCE'
  ) OR jsonb_typeof(COALESCE(p_payload,'{}'::jsonb))<>'object' THEN
    RAISE EXCEPTION 'Notification command is unavailable';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_command_id::text));
  SELECT * INTO existing FROM public.notification_commands command
  WHERE command.command_id=p_command_id;
  IF existing.command_id IS NOT NULL THEN
    IF existing.actor_user_id<>p_actor_user_id
      OR existing.action<>p_action THEN
      RAISE EXCEPTION 'Notification command is unavailable';
    END IF;
    RETURN existing.result;
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL THEN RAISE EXCEPTION 'Notification command is unavailable'; END IF;

  IF p_action IN ('MARK_READ','ARCHIVE') THEN
    IF COALESCE(p_payload->>'notificationId','')
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN RAISE EXCEPTION 'Notification command is unavailable'; END IF;
    SELECT * INTO notification_row FROM public.in_app_notifications notification
    WHERE notification.id=(p_payload->>'notificationId')::uuid
      AND notification.recipient_user_id=p_actor_user_id
    FOR UPDATE;
    IF notification_row.id IS NULL OR NOT public.axora_notification_source_is_visible(
      snapshot,p_actor_user_id,notification_row.id,p_at
    ) THEN RAISE EXCEPTION 'Notification command is unavailable'; END IF;
    IF p_action='MARK_READ' AND notification_row.read_at IS NULL THEN
      UPDATE public.in_app_notifications SET read_at=p_at
      WHERE id=notification_row.id;
      changed_count:=1;
    ELSIF p_action='ARCHIVE' AND notification_row.archived_at IS NULL THEN
      UPDATE public.in_app_notifications
      SET read_at=COALESCE(read_at,p_at),archived_at=p_at
      WHERE id=notification_row.id;
      changed_count:=1;
      UPDATE public.notification_reminders SET status='CANCELLED',
        cancelled_at=p_at,cancelled_reason='notification_archived'
      WHERE original_notification_id=notification_row.id AND status='PENDING';
    END IF;
    SELECT jsonb_build_object(
      'changed',changed_count=1,'notificationId',notification_row.id,
      'stateVersion',state_version
    ) INTO result FROM public.in_app_notifications
    WHERE id=notification_row.id;
  ELSIF p_action='MARK_ALL_READ' THEN
    UPDATE public.in_app_notifications notification
    SET read_at=p_at
    WHERE notification.recipient_user_id=p_actor_user_id
      AND notification.read_at IS NULL AND notification.archived_at IS NULL
      AND notification.expires_at>p_at
      AND public.axora_notification_source_is_visible(
        snapshot,p_actor_user_id,notification.id,p_at
      );
    GET DIAGNOSTICS changed_count=ROW_COUNT;
    result:=jsonb_build_object('changed',changed_count>0,'changedCount',changed_count);
  ELSE
    event_key_value:=NULLIF(p_payload->>'eventKey','');
    SELECT * INTO policy_row FROM public.notification_event_policies policy
    WHERE policy.event_key=event_key_value;
    IF policy_row.event_key IS NULL THEN
      RAISE EXCEPTION 'Notification preference is unavailable';
    END IF;
    schedule_value:=upper(COALESCE(p_payload->>'deliverySchedule','IMMEDIATE'));
    IF schedule_value NOT IN ('IMMEDIATE','DAILY','WEEKLY') THEN
      RAISE EXCEPTION 'Notification preference is unavailable';
    END IF;
    email_value:=COALESCE((p_payload->>'emailEnabled')::boolean,true);
    IF COALESCE(p_payload->>'reminderHours','') !~ '^[0-9]{1,3}$' THEN
      reminder_value:=NULL;
    ELSE
      reminder_value:=(p_payload->>'reminderHours')::smallint;
      IF reminder_value>720 THEN
        RAISE EXCEPTION 'Notification preference is unavailable';
      END IF;
    END IF;
    IF p_action='SAVE_USER_PREFERENCE' THEN
      INSERT INTO public.notification_preferences(
        user_id,event_key,in_app_enabled,email_enabled,digest_mode,
        muted_until,reminder_interval_hours,updated_at
      ) VALUES (
        p_actor_user_id,event_key_value,true,
        CASE WHEN policy_row.email_mandatory THEN true ELSE email_value END,
        CASE WHEN policy_row.email_mandatory THEN 'IMMEDIATE'
          ELSE schedule_value END,
        NULL,reminder_value,p_at
      ) ON CONFLICT(user_id,event_key) DO UPDATE SET
        in_app_enabled=true,
        email_enabled=EXCLUDED.email_enabled,
        digest_mode=EXCLUDED.digest_mode,
        muted_until=NULL,
        reminder_interval_hours=EXCLUDED.reminder_interval_hours,
        updated_at=p_at;
      IF reminder_value=0 THEN
        UPDATE public.notification_reminders reminder
        SET status='CANCELLED',cancelled_at=p_at,
          cancelled_reason='user_preference_disabled'
        FROM public.in_app_notifications notification
        WHERE reminder.original_notification_id=notification.id
          AND reminder.status='PENDING'
          AND notification.recipient_user_id=p_actor_user_id
          AND notification.event_key=event_key_value;
      ELSIF reminder_value IS NOT NULL THEN
        UPDATE public.notification_reminders reminder
        SET due_at=notification.created_at
          +make_interval(hours=>reminder_value)
        FROM public.in_app_notifications notification
        WHERE reminder.original_notification_id=notification.id
          AND reminder.status='PENDING'
          AND notification.recipient_user_id=p_actor_user_id
          AND notification.event_key=event_key_value;
      END IF;
      result:=jsonb_build_object(
        'changed',true,'eventKey',event_key_value,'scope','USER',
        'emailEnabled',CASE WHEN policy_row.email_mandatory
          THEN true ELSE email_value END,
        'deliverySchedule',CASE WHEN policy_row.email_mandatory
          THEN 'IMMEDIATE' ELSE schedule_value END,
        'reminderHours',reminder_value
      );
    ELSE
      IF COALESCE(p_payload->>'companyId','')
        !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN RAISE EXCEPTION 'Notification preference is unavailable'; END IF;
      company_value:=(p_payload->>'companyId')::uuid;
      IF NOT policy_row.company_configurable
        OR NOT public.axora_snapshot_has_permission(
          snapshot,'user.manage','COMPANY',company_value,NULL,NULL,NULL
        ) THEN RAISE EXCEPTION 'Notification preference is unavailable'; END IF;
      INSERT INTO public.company_notification_preferences(
        company_id,event_key,email_enabled,digest_mode,
        reminder_interval_hours,updated_by,updated_at
      ) VALUES (
        company_value,event_key_value,
        CASE WHEN policy_row.email_mandatory THEN true ELSE email_value END,
        CASE WHEN policy_row.email_mandatory THEN 'IMMEDIATE'
          ELSE schedule_value END,
        reminder_value,p_actor_user_id,p_at
      ) ON CONFLICT(company_id,event_key) DO UPDATE SET
        email_enabled=EXCLUDED.email_enabled,
        digest_mode=EXCLUDED.digest_mode,
        reminder_interval_hours=EXCLUDED.reminder_interval_hours,
        updated_by=p_actor_user_id,updated_at=p_at;
      result:=jsonb_build_object(
        'changed',true,'eventKey',event_key_value,'scope','COMPANY',
        'companyId',company_value
      );
    END IF;
  END IF;

  INSERT INTO public.notification_commands(
    command_id,actor_user_id,actor_role_assignment_id,action,outcome,result,
    occurred_at
  ) VALUES (
    p_command_id,p_actor_user_id,p_actor_role_assignment_id,p_action,
    CASE WHEN COALESCE((result->>'changed')::boolean,false)
      THEN 'SUCCESS' ELSE 'NOOP' END,result,p_at
  );
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.axora_notification_email_channel_enabled(
  p_user_id uuid,p_company_id uuid,p_event_key text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT public.axora_notification_email_is_mandatory(p_event_key) OR COALESCE((
    SELECT profile.notification_email_enabled
      AND COALESCE(user_preference.email_enabled,true)
      AND COALESCE(company_preference.email_enabled,true)
    FROM public.user_profiles profile
    LEFT JOIN public.notification_preferences user_preference
      ON user_preference.user_id=profile.user_id
     AND user_preference.event_key=p_event_key
    LEFT JOIN public.company_notification_preferences company_preference
      ON company_preference.company_id=p_company_id
     AND company_preference.event_key=p_event_key
    WHERE profile.user_id=p_user_id
  ),false)
$$;

CREATE OR REPLACE FUNCTION public.axora_notification_email_muted_until(
  p_user_id uuid,p_event_key text
) RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT CASE WHEN public.axora_notification_email_is_mandatory(p_event_key)
    THEN NULL ELSE (
      SELECT preference.muted_until
      FROM public.notification_preferences preference
      WHERE preference.user_id=p_user_id AND preference.event_key=p_event_key
    ) END
$$;

CREATE OR REPLACE FUNCTION public.axora_notification_delivery_schedule(
  p_user_id uuid,p_company_id uuid,p_event_key text
) RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT CASE WHEN public.axora_notification_email_is_mandatory(p_event_key)
    THEN 'IMMEDIATE' ELSE COALESCE(
      (SELECT preference.digest_mode
        FROM public.notification_preferences preference
        WHERE preference.user_id=p_user_id AND preference.event_key=p_event_key),
      (SELECT preference.digest_mode
        FROM public.company_notification_preferences preference
        WHERE preference.company_id=p_company_id
          AND preference.event_key=p_event_key),
      'IMMEDIATE'
    ) END
$$;

CREATE OR REPLACE FUNCTION public.axora_workflow_notification_preference(
  p_company_id uuid,p_workflow_event_id uuid,p_recipient_user_id uuid,
  p_event_key text
) RETURNS TABLE(
  global_in_app_enabled boolean,global_email_enabled boolean,
  event_preference_exists boolean,event_in_app_enabled boolean,
  event_email_enabled boolean,delivery_schedule text,
  muted_until timestamptz,recipient_locale text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE source_event public.workflow_events%ROWTYPE;
BEGIN
  SELECT * INTO source_event FROM public.workflow_events event
  WHERE event.id=p_workflow_event_id AND event.company_id=p_company_id;
  IF NOT FOUND OR source_event.event_key IS DISTINCT FROM p_event_key THEN
    RAISE EXCEPTION 'Workflow notification source event is invalid';
  END IF;
  IF NOT public.axora_context_is_platform()
    AND source_event.actor_user_id IS DISTINCT FROM public.axora_context_user_id()
  THEN RAISE EXCEPTION 'Workflow notification preferences require the event actor';
  END IF;
  IF NOT public.axora_workflow_notification_recipient_is_valid(
    p_company_id,p_workflow_event_id,p_recipient_user_id
  ) THEN RETURN; END IF;
  RETURN QUERY
  SELECT true,
    public.axora_notification_email_is_mandatory(p_event_key)
      OR profile.notification_email_enabled,
    preference.user_id IS NOT NULL,
    true,
    public.axora_notification_email_is_mandatory(p_event_key)
      OR COALESCE(preference.email_enabled,true),
    public.axora_notification_delivery_schedule(
      p_recipient_user_id,p_company_id,p_event_key
    ),
    public.axora_notification_email_muted_until(
      p_recipient_user_id,p_event_key
    ),
    profile.preferred_locale
  FROM public.user_profiles profile
  LEFT JOIN public.notification_preferences preference
    ON preference.user_id=profile.user_id
   AND preference.event_key=p_event_key
  WHERE profile.user_id=p_recipient_user_id;
END $$;

CREATE OR REPLACE FUNCTION public.axora_enqueue_workflow_email(
  p_company_id uuid,p_workflow_event_id uuid,p_recipient_user_id uuid,
  p_event_key text,p_dedupe_key text,p_title text,p_body text,p_route_path text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  source_event public.workflow_events%ROWTYPE;
  selected_locale text;
  selected_schedule text;
  muted_until_value timestamptz;
  inserted_id uuid;
BEGIN
  SELECT * INTO source_event FROM public.workflow_events event
  WHERE event.id=p_workflow_event_id AND event.company_id=p_company_id;
  IF NOT FOUND OR source_event.event_key IS DISTINCT FROM p_event_key THEN
    RAISE EXCEPTION 'Workflow email source event is invalid';
  END IF;
  IF NOT public.axora_context_is_platform()
    AND source_event.actor_user_id IS DISTINCT FROM public.axora_context_user_id()
  THEN RAISE EXCEPTION 'Workflow email can be enqueued only by its event actor';
  END IF;
  IF NOT public.axora_workflow_email_recipient_is_valid(
    p_company_id,p_workflow_event_id,p_recipient_user_id
  ) OR NOT public.axora_notification_email_channel_enabled(
    p_recipient_user_id,p_company_id,p_event_key
  ) THEN RETURN NULL; END IF;
  muted_until_value:=public.axora_notification_email_muted_until(
    p_recipient_user_id,p_event_key
  );
  IF muted_until_value>now() THEN RETURN NULL; END IF;
  SELECT profile.preferred_locale INTO selected_locale
  FROM public.user_profiles profile WHERE profile.user_id=p_recipient_user_id;
  selected_schedule:=public.axora_notification_delivery_schedule(
    p_recipient_user_id,p_company_id,p_event_key
  );
  INSERT INTO public.workflow_email_outbox(
    company_id,recipient_user_id,workflow_event_id,event_key,dedupe_key,
    title,body,route_path,locale,delivery_schedule,delivery_available_at
  ) VALUES (
    p_company_id,p_recipient_user_id,p_workflow_event_id,p_event_key,
    p_dedupe_key,p_title,p_body,p_route_path,selected_locale,selected_schedule,
    public.axora_workflow_email_available_at(selected_schedule,now())
  ) ON CONFLICT(company_id,recipient_user_id,dedupe_key) DO NOTHING
  RETURNING id INTO inserted_id;
  RETURN inserted_id;
END $$;

-- The legacy claimant remains behaviorally safe for rolling workers. Both it
-- and the current provider-neutral claimant use the same mandatory-channel
-- policy and revalidate live recipient scope immediately before leasing.
CREATE OR REPLACE FUNCTION public.axora_claim_workflow_email(
  p_lease_seconds integer DEFAULT 90,p_max_attempts integer DEFAULT 3
) RETURNS TABLE(
  delivery_id uuid,lease_id uuid,locale text,recipient_email text,
  recipient_name text,title text,body text,route_path text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE selected_row record; selected_lease uuid;
BEGIN
  IF p_lease_seconds<30 OR p_lease_seconds>300
    OR p_max_attempts<1 OR p_max_attempts>3 THEN
    RAISE EXCEPTION 'Workflow email lease configuration is invalid';
  END IF;
  UPDATE public.workflow_email_outbox outbox
  SET delivery_status='CANCELLED',last_delivery_error='recipient_unavailable'
  WHERE outbox.delivery_status='PENDING'
    AND NOT public.axora_workflow_email_recipient_is_valid(
      outbox.company_id,outbox.workflow_event_id,outbox.recipient_user_id
    );
  UPDATE public.workflow_email_outbox outbox
  SET delivery_status='CANCELLED',last_delivery_error='email_preference_disabled'
  WHERE outbox.delivery_status='PENDING'
    AND NOT public.axora_notification_email_channel_enabled(
      outbox.recipient_user_id,outbox.company_id,outbox.event_key
    );
  UPDATE public.workflow_email_outbox outbox
  SET delivery_available_at=GREATEST(
    outbox.delivery_available_at,
    public.axora_notification_email_muted_until(
      outbox.recipient_user_id,outbox.event_key
    )
  )
  WHERE outbox.delivery_status='PENDING'
    AND public.axora_notification_email_muted_until(
      outbox.recipient_user_id,outbox.event_key
    )>now();
  UPDATE public.workflow_email_outbox outbox
  SET delivery_status='UNCERTAIN',delivery_lease_id=NULL,
    delivery_lease_expires_at=NULL,last_delivery_error='lease_expired'
  WHERE outbox.delivery_status='SENDING'
    AND outbox.delivery_lease_expires_at<=now();
  SELECT outbox.id,outbox.locale,lower(account.email) AS email,
    profile.display_name,outbox.title,outbox.body,outbox.route_path
  INTO selected_row
  FROM public.workflow_email_outbox outbox
  JOIN public.users account ON account.id=outbox.recipient_user_id
  JOIN public.user_profiles profile ON profile.user_id=account.id
  WHERE outbox.delivery_status='PENDING'
    AND outbox.delivery_attempt_count<p_max_attempts
    AND outbox.delivery_available_at<=now()
    AND public.axora_notification_email_channel_enabled(
      outbox.recipient_user_id,outbox.company_id,outbox.event_key
    )
    AND COALESCE(public.axora_notification_email_muted_until(
      outbox.recipient_user_id,outbox.event_key
    ),'-infinity'::timestamptz)<=now()
    AND public.axora_workflow_email_recipient_is_valid(
      outbox.company_id,outbox.workflow_event_id,outbox.recipient_user_id
    )
  ORDER BY outbox.delivery_available_at,outbox.created_at,outbox.id
  FOR UPDATE OF outbox SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  selected_lease:=gen_random_uuid();
  UPDATE public.workflow_email_outbox SET delivery_status='SENDING',
    delivery_attempt_count=delivery_attempt_count+1,delivery_attempted_at=now(),
    delivery_lease_id=selected_lease,
    delivery_lease_expires_at=now()+make_interval(secs=>p_lease_seconds),
    last_delivery_error=NULL
  WHERE id=selected_row.id AND delivery_status='PENDING';
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT selected_row.id::uuid,selected_lease,
    selected_row.locale::text,selected_row.email::text,
    selected_row.display_name::text,selected_row.title::text,
    selected_row.body::text,selected_row.route_path::text;
END $$;

CREATE OR REPLACE FUNCTION public.axora_claim_workflow_email_v2(
  p_lease_seconds integer DEFAULT 90,p_max_attempts integer DEFAULT 7
) RETURNS TABLE(
  delivery_id uuid,lease_id uuid,locale text,recipient_email text,
  recipient_name text,title text,body text,route_path text,event_key text,
  template_key text,template_version smallint,priority text,provider_agent text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE selected_row record; selected_lease uuid;
BEGIN
  IF p_lease_seconds<30 OR p_lease_seconds>300
    OR p_max_attempts<1 OR p_max_attempts>7 THEN
    RAISE EXCEPTION 'Workflow email lease configuration is invalid';
  END IF;
  UPDATE public.workflow_email_outbox outbox
  SET delivery_status='CANCELLED',last_delivery_error='recipient_unavailable'
  WHERE outbox.delivery_status='PENDING'
    AND NOT public.axora_workflow_email_recipient_is_valid(
      outbox.company_id,outbox.workflow_event_id,outbox.recipient_user_id
    );
  UPDATE public.workflow_email_outbox outbox
  SET delivery_status='CANCELLED',last_delivery_error='email_preference_disabled'
  WHERE outbox.delivery_status='PENDING'
    AND NOT public.axora_notification_email_channel_enabled(
      outbox.recipient_user_id,outbox.company_id,outbox.event_key
    );
  UPDATE public.workflow_email_outbox outbox
  SET delivery_available_at=GREATEST(
    outbox.delivery_available_at,
    public.axora_notification_email_muted_until(
      outbox.recipient_user_id,outbox.event_key
    )
  )
  WHERE outbox.delivery_status='PENDING'
    AND public.axora_notification_email_muted_until(
      outbox.recipient_user_id,outbox.event_key
    )>now();
  UPDATE public.workflow_email_outbox outbox
  SET delivery_status='UNCERTAIN',delivery_lease_id=NULL,
    delivery_lease_expires_at=NULL,last_delivery_error='lease_expired'
  WHERE outbox.delivery_status='SENDING'
    AND outbox.delivery_lease_expires_at<=now();
  SELECT outbox.id,outbox.locale,lower(account.email) AS email,
    profile.display_name,outbox.title,outbox.body,outbox.route_path,
    outbox.event_key,outbox.template_key,outbox.template_version,
    outbox.priority,outbox.provider_agent
  INTO selected_row
  FROM public.workflow_email_outbox outbox
  JOIN public.users account ON account.id=outbox.recipient_user_id
  JOIN public.user_profiles profile ON profile.user_id=account.id
  WHERE outbox.delivery_status='PENDING'
    AND outbox.delivery_attempt_count<p_max_attempts
    AND outbox.delivery_available_at<=now()
    AND public.axora_notification_email_channel_enabled(
      outbox.recipient_user_id,outbox.company_id,outbox.event_key
    )
    AND COALESCE(public.axora_notification_email_muted_until(
      outbox.recipient_user_id,outbox.event_key
    ),'-infinity'::timestamptz)<=now()
    AND public.axora_workflow_email_recipient_is_valid(
      outbox.company_id,outbox.workflow_event_id,outbox.recipient_user_id
    )
  ORDER BY CASE outbox.priority
      WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END,
    outbox.delivery_available_at,outbox.created_at,outbox.id
  FOR UPDATE OF outbox SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  selected_lease:=gen_random_uuid();
  UPDATE public.workflow_email_outbox SET delivery_status='SENDING',
    delivery_attempt_count=delivery_attempt_count+1,delivery_attempted_at=now(),
    delivery_lease_id=selected_lease,
    delivery_lease_expires_at=now()+make_interval(secs=>p_lease_seconds),
    last_delivery_error=NULL
  WHERE id=selected_row.id AND delivery_status='PENDING';
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT selected_row.id::uuid,selected_lease,
    selected_row.locale::text,selected_row.email::text,
    selected_row.display_name::text,selected_row.title::text,
    selected_row.body::text,selected_row.route_path::text,
    selected_row.event_key::text,selected_row.template_key::text,
    selected_row.template_version::smallint,selected_row.priority::text,
    selected_row.provider_agent::text;
END $$;

CREATE OR REPLACE FUNCTION public.axora_notify_hard_bounce()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE affected_user_id uuid; affected_company_id uuid; recipient record;
BEGIN
  IF NEW.event_type<>'MESSAGE_BOUNCED' OR NEW.bounce_type<>'HARD' THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(invitation.user_id,workflow.recipient_user_id,
      reset.user_id,verification.user_id),
    COALESCE(invitation.company_id,workflow.company_id,
      reset_account.company_id,verification_account.company_id)
  INTO affected_user_id,affected_company_id
  FROM public.email_delivery_attempts attempt
  LEFT JOIN public.account_setup_invitations invitation
    ON attempt.delivery_kind='ACCOUNT_SETUP'
   AND invitation.id=attempt.delivery_id
  LEFT JOIN public.workflow_email_outbox workflow
    ON attempt.delivery_kind='WORKFLOW' AND workflow.id=attempt.delivery_id
  LEFT JOIN public.transactional_email_outbox transactional
    ON attempt.delivery_kind='TRANSACTIONAL'
   AND transactional.id=attempt.delivery_id
  LEFT JOIN public.password_reset_tokens reset
    ON reset.id=transactional.password_reset_token_id
  LEFT JOIN public.users reset_account ON reset_account.id=reset.user_id
  LEFT JOIN public.email_verification_tokens verification
    ON verification.id=transactional.email_verification_token_id
  LEFT JOIN public.users verification_account
    ON verification_account.id=verification.user_id
  WHERE attempt.provider_message_fingerprint=NEW.provider_message_fingerprint
  ORDER BY attempt.attempted_at DESC,attempt.id DESC LIMIT 1;

  FOR recipient IN
    SELECT DISTINCT account.id,account.company_id,profile.preferred_locale,
      CASE WHEN account.id=affected_user_id THEN '/account'
        ELSE '/email-operations' END AS route_path
    FROM public.users account
    JOIN public.user_profiles profile ON profile.user_id=account.id
    WHERE account.active AND account.account_status IN ('ACTIVE','INVITED')
      AND (account.id=affected_user_id OR EXISTS (
        SELECT 1 FROM public.role_assignments assignment
        JOIN public.roles role ON role.id=assignment.role_id
        WHERE assignment.user_id=account.id AND assignment.active
          AND assignment.revoked_at IS NULL
          AND role.role_key IN ('PLATFORM_OWNER','PLATFORM_OPERATIONS')
      ))
  LOOP
    INSERT INTO public.in_app_notifications(
      id,company_id,recipient_user_id,email_provider_event_id,event_key,
      dedupe_key,title,body,priority,route_path,created_at
    ) VALUES (
      gen_random_uuid(),CASE WHEN recipient.id=affected_user_id
        THEN affected_company_id ELSE affected_company_id END,
      recipient.id,NEW.provider_event_id,'email.hard_bounce',
      'email-hard-bounce:'||NEW.provider_event_id::text||':'||recipient.id::text,
      CASE recipient.preferred_locale
        WHEN 'ar' THEN 'تعذر تسليم رسالة بريد إلكتروني'
        WHEN 'ms' THEN 'Penghantaran e-mel gagal'
        ELSE 'Email delivery needs attention' END,
      CASE
        WHEN recipient.id=affected_user_id AND recipient.preferred_locale='ar'
          THEN 'تعذر تسليم رسالة إلى عنوان حسابك. راجع إعدادات الحساب أو تواصل مع مسؤول مخوّل.'
        WHEN recipient.id=affected_user_id AND recipient.preferred_locale='ms'
          THEN 'Mesej tidak dapat dihantar ke alamat akaun anda. Semak tetapan akaun atau hubungi pentadbir yang dibenarkan.'
        WHEN recipient.id=affected_user_id
          THEN 'A message could not be delivered to your account address. Review account settings or contact an authorized administrator.'
        WHEN recipient.preferred_locale='ar'
          THEN 'سجل مزود البريد ارتداداً دائماً. راجع حالة التسليم دون مشاركة عنوان المستلم.'
        WHEN recipient.preferred_locale='ms'
          THEN 'Penyedia e-mel merekodkan lantunan kekal. Semak status penghantaran tanpa berkongsi alamat penerima.'
        ELSE 'The email provider recorded a hard bounce. Review delivery status without sharing the recipient address.' END,
      'HIGH',recipient.route_path,NEW.received_at
    ) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER notify_hard_bounce
AFTER INSERT ON public.email_provider_events
FOR EACH ROW EXECUTE FUNCTION public.axora_notify_hard_bounce();

ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.in_app_notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE public.company_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_notification_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_event_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_event_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_email_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_email_relations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reminders FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_commands FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_state_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_state_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS in_app_notifications_select_scope
  ON public.in_app_notifications;
DROP POLICY IF EXISTS in_app_notifications_insert_scope
  ON public.in_app_notifications;
DROP POLICY IF EXISTS in_app_notifications_update_scope
  ON public.in_app_notifications;
CREATE POLICY in_app_notifications_recipient_only
ON public.in_app_notifications FOR SELECT
USING (recipient_user_id=public.axora_context_user_id());
DROP POLICY IF EXISTS notification_preferences_self_scope
  ON public.notification_preferences;
CREATE POLICY notification_preferences_recipient_only
ON public.notification_preferences FOR ALL
USING (user_id=public.axora_context_user_id())
WITH CHECK (user_id=public.axora_context_user_id() AND in_app_enabled);

REVOKE ALL ON TABLE
  public.in_app_notifications,public.notification_preferences,
  public.notification_event_policies,public.company_notification_preferences,
  public.notification_email_relations,public.notification_reminders,
  public.notification_commands,public.notification_state_events
FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.axora_notification_category(text),
  public.axora_notification_email_is_mandatory(text),
  public.axora_reject_notification_evidence_change(),
  public.validate_in_app_notification(),
  public.protect_in_app_notification(),
  public.axora_record_notification_state(),
  public.axora_notification_source_is_visible(jsonb,uuid,uuid,timestamptz),
  public.axora_notification_route_is_authorized(jsonb,uuid,uuid,timestamptz),
  public.axora_notification_reminder_hours(uuid,uuid,text),
  public.axora_schedule_notification_reminder(),
  public.axora_notification_reminder_should_cancel(text,text),
  public.axora_cancel_workflow_notification_reminders(),
  public.axora_cancel_lead_notification_reminders(),
  public.axora_insert_in_app_notification(
    uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,timestamptz
  ),
  public.axora_link_workflow_notification_email(),
  public.axora_materialize_notification_reminders(jsonb,uuid,timestamptz),
  public.axora_notification_summary(uuid,uuid,timestamptz),
  public.axora_notification_center_snapshot(uuid,uuid,jsonb,timestamptz),
  public.axora_notification_command(uuid,uuid,uuid,text,jsonb,timestamptz),
  public.axora_notification_email_channel_enabled(uuid,uuid,text),
  public.axora_notification_email_muted_until(uuid,text),
  public.axora_notification_delivery_schedule(uuid,uuid,text),
  public.axora_workflow_notification_preference(uuid,uuid,uuid,text),
  public.axora_enqueue_workflow_email(uuid,uuid,uuid,text,text,text,text,text),
  public.axora_claim_workflow_email(integer,integer),
  public.axora_claim_workflow_email_v2(integer,integer),
  public.axora_notify_hard_bounce()
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE
      public.in_app_notifications,public.notification_preferences,
      public.notification_event_policies,
      public.company_notification_preferences,
      public.notification_email_relations,public.notification_reminders,
      public.notification_commands,public.notification_state_events
    FROM axora_app;
    GRANT EXECUTE ON FUNCTION
      public.axora_insert_in_app_notification(
        uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,timestamptz
      ),
      public.axora_notification_summary(uuid,uuid,timestamptz),
      public.axora_notification_center_snapshot(uuid,uuid,jsonb,timestamptz),
      public.axora_notification_command(uuid,uuid,uuid,text,jsonb,timestamptz),
      public.axora_workflow_notification_preference(uuid,uuid,uuid,text),
      public.axora_enqueue_workflow_email(uuid,uuid,uuid,text,text,text,text,text),
      public.axora_claim_workflow_email(integer,integer),
      public.axora_claim_workflow_email_v2(integer,integer)
    TO axora_app;
  END IF;
END $$;

COMMIT;
