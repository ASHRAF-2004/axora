BEGIN;

-- P1-13/P1-14: support stable, permission-scoped procurement discovery without
-- replacing or rewriting any request, product, approval, or delivery record.
CREATE INDEX IF NOT EXISTS requests_filter_scope_date_idx
  ON public.requests(company_id,branch_id,department_id,request_date DESC,id);
CREATE INDEX IF NOT EXISTS requests_filter_cost_centre_idx
  ON public.requests(cost_centre_id,request_date DESC,id)
  WHERE cost_centre_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS requests_filter_requester_idx
  ON public.requests(created_by,request_date DESC,id)
  WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS requests_filter_needed_by_idx
  ON public.requests(needed_by_date,id);
CREATE INDEX IF NOT EXISTS requests_filter_submitted_idx
  ON public.requests(approval_submitted_at DESC,id)
  WHERE approval_submitted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS requests_filter_approved_idx
  ON public.requests(approval_decided_at DESC,id)
  WHERE approval_decided_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS requests_filter_completed_idx
  ON public.requests(completed_at DESC,id)
  WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS request_lines_filter_category_idx
  ON public.request_lines(category_snapshot,request_id);
CREATE INDEX IF NOT EXISTS request_lines_filter_supplier_idx
  ON public.request_lines(selected_supplier_id,request_id)
  WHERE selected_supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS request_lines_filter_product_name_idx
  ON public.request_lines(lower(product_name_snapshot) text_pattern_ops,request_id);
CREATE INDEX IF NOT EXISTS approvals_filter_reviewer_idx
  ON public.approvals(reviewer_id,request_id,created_at DESC)
  WHERE reviewer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS request_escalations_filter_idx
  ON public.request_approval_escalations(request_id,request_version,created_at DESC,escalation_type);
CREATE INDEX IF NOT EXISTS delivery_jobs_filter_request_idx
  ON public.delivery_jobs(request_id,id);
CREATE INDEX IF NOT EXISTS delivery_assignments_filter_driver_idx
  ON public.delivery_job_assignments(driver_user_id,delivery_job_id)
  WHERE ended_at IS NULL AND status IN ('ASSIGNED','ACCEPTED');

COMMIT;
