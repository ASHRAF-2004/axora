BEGIN;

-- P0-01 authorization foundation. Existing role assignments and deployed
-- snake_case permission checks remain compatible while the application moves
-- to stable dot-delimited permission codes and explicit scoped grants.
INSERT INTO roles(role_key,label,description) VALUES
  ('CLIENT_ACCOUNT_MANAGER','Client account manager',
   'Manages only explicitly assigned client companies and their onboarding work'),
  ('DEPARTMENT_ADMIN','Department administrator',
   'Manages users, requests and approvals inside one assigned department'),
  ('DELIVERY_TEAM_SUPERVISOR','Delivery team supervisor',
   'Assigns and supervises delivery work without platform or company authority'),
  ('DELIVERY_AGENT','Delivery agent',
   'Purchases, transports and delivers only explicitly assigned work')
ON CONFLICT(role_key) DO UPDATE SET
  label=EXCLUDED.label,
  description=EXCLUDED.description;

CREATE TABLE IF NOT EXISTS permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permission_code text NOT NULL UNIQUE
    CHECK (permission_code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  permission_group text NOT NULL
    CHECK (char_length(btrim(permission_group)) BETWEEN 2 AND 80),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 2 AND 160),
  description text NOT NULL DEFAULT ''
    CHECK (char_length(description) <= 1000),
  high_risk boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO permissions(
  permission_code,permission_group,label,description,high_risk
) VALUES
  ('dashboard.view','Navigation','View dashboard','Open the role-appropriate dashboard and summary surfaces.',false),
  ('platform.view','Platform','View platform context','View platform-level records where the assigned role and resource policy permit.',true),
  ('company.view','Companies','View company','View one company within the effective scope.',false),
  ('company.view.assigned','Companies','View assigned companies','View companies explicitly assigned to the user.',false),
  ('company.lead.view','Companies','View company leads','View company enquiry and lead records within scope.',true),
  ('company.lead.create','Companies','Create company leads','Create a persistent company lead.',true),
  ('company.lead.assign','Companies','Assign company leads','Assign an unassigned lead or company to an authorized account manager.',true),
  ('company.lead.reassign','Companies','Reassign company leads','Move an assigned lead or company to another authorized account manager.',true),
  ('company.edit','Companies','Edit company','Edit permitted company profile and onboarding information.',true),
  ('company.activate','Companies','Activate company','Activate a company after mandatory onboarding checks pass.',true),
  ('company.suspend','Companies','Suspend company','Suspend company access and new transactions under policy.',true),
  ('company.portal.preview','Companies','Preview company portal','Preview a private company portal and theme.',false),
  ('company.portal.publish','Companies','Publish company portal','Publish an approved company portal or public listing.',true),
  ('user.view','People','View users','View users in the effective scope.',false),
  ('user.create','People','Create users','Create an invited account in the effective scope.',true),
  ('user.invite','People','Invite users','Issue or resend a secure account invitation.',true),
  ('user.edit','People','Edit users','Edit permitted profile fields for a scoped user.',true),
  ('user.deactivate','People','Deactivate users','Deactivate or reactivate a scoped account.',true),
  ('user.permission.manage','People','Manage user permissions','Grant or deny explicit permissions within delegation authority.',true),
  ('user.manage','People','Manage users (compatibility)','Compatibility capability for existing user-management routes.',true),
  ('organization.branch.view','Organization','View branches','View branches in the effective company scope.',false),
  ('organization.branch.manage','Organization','Manage branches','Create, edit, or deactivate branches in scope.',true),
  ('organization.department.manage','Organization','Manage departments','Create, edit, or deactivate departments in scope.',true),
  ('organization.cost_center.manage','Organization','Manage cost centres','Create, edit, or deactivate cost centres in scope.',true),
  ('organization.delivery_location.manage','Organization','Manage delivery locations','Create, edit, or deactivate delivery locations in scope.',true),
  ('product.view','Catalogue','View products','View products and customer-safe catalogue details.',false),
  ('catalog.manage','Catalogue','Manage catalogue','Manage Axora catalogue products and availability.',true),
  ('supplier.manage','Sourcing','Manage suppliers','Manage supplier records and approved contacts.',true),
  ('sourcing.manage','Sourcing','Manage sourcing','Run quotation, supplier selection, and sourcing operations.',true),
  ('cart.manage','Requests','Manage cart','Create and edit a scoped purchase cart.',false),
  ('request.view','Requests','View requests','View requests allowed by entity ownership and scope policy.',false),
  ('request.view.own','Requests','View own requests','View requests created by the current user.',false),
  ('request.create','Requests','Create requests','Create a purchase request in scope.',false),
  ('request.edit','Requests','Edit requests','Edit a permitted draft or returned request.',false),
  ('request.submit','Requests','Submit requests','Submit a valid request into approval workflow.',true),
  ('request.cancel','Requests','Cancel requests','Cancel a request when the current state and financial policy permit.',true),
  ('request.approval_queue.view','Approvals','View approval queue','View approval work eligible for the current user.',false),
  ('request.approve.other','Approvals','Approve other users'' requests','Approve a request created by another user within scope and limit.',true),
  ('request.approve.self','Approvals','Approve own requests','Approve a request created by the same user when explicitly permitted.',true),
  ('request.approve.over_budget','Approvals','Approve over-budget requests','Approve a documented budget exception within authorized scope.',true),
  ('request.approve.additional_actual','Approvals','Approve additional actual cost','Approve actual-price variance above the existing reservation.',true),
  ('budget.view','Budgets','View budgets','View virtual authorization balances in scope.',true),
  ('budget.branch.manage','Budgets','Manage branch budget (compatibility)','Compatibility capability for current branch-budget routes.',true),
  ('budget.assign','Budgets','Assign budget','Create or transfer an authorized allocation.',true),
  ('budget.increase','Budgets','Increase budget','Increase an allocation within the company ceiling.',true),
  ('budget.reduce','Budgets','Reduce budget','Reduce an allocation without rewriting posted ledger history.',true),
  ('budget.refresh','Budgets','Refresh budget','Run or correct an authorized period refresh.',true),
  ('commercial.cost.view','Commercial','View internal cost','View confidential supplier or base cost.',true),
  ('commercial.markup.view','Commercial','View markup','View confidential markup rules and calculations.',true),
  ('commercial.company_ceiling.view','Commercial','View company ceiling','View contractual company ceiling and exposure.',true),
  ('commercial.company_ceiling.override','Commercial','Override company ceiling','Approve a documented company-ceiling exception.',true),
  ('commercial.platform_margin.view','Commercial','View platform margin','View confidential Axora margin and profitability.',true),
  ('commercial.pricing.manage','Commercial','Manage commercial pricing','Manage confidential pricing rules and effective periods.',true),
  ('delivery.view','Delivery','View deliveries','View delivery records allowed by company or assignment scope.',false),
  ('delivery.manage','Delivery','Manage deliveries','Coordinate delivery operations and controlled transitions.',true),
  ('delivery.assign','Delivery','Assign deliveries','Assign or reassign delivery work.',true),
  ('delivery.accept','Delivery','Accept delivery assignment','Accept or decline an assigned delivery job.',false),
  ('delivery.shop','Delivery','Record shopping activity','Record item availability, substitutions, actual prices, and shopping progress.',true),
  ('delivery.receipt.upload','Delivery','Upload receipts','Upload and associate private purchase receipts.',true),
  ('delivery.track','Delivery','Manage live tracking','Start, update, pause, or stop an authorized delivery tracking session.',true),
  ('delivery.complete','Delivery','Complete delivery','Complete delivery after required proof or authorized exception.',true),
  ('delivery.portal.view','Delivery','View delivery portal','Open the delivery-focused portal.',false),
  ('delivery.assignment.update','Delivery','Update assigned deliveries','Submit permitted idempotent status and evidence updates for assigned work.',true),
  ('receiving.view','Receiving','View receiving','View assigned receiving work and evidence.',false),
  ('receiving.confirm','Receiving','Confirm receipt','Independently confirm received, damaged, or missing quantities.',true),
  ('finance.invoice.view','Finance','View invoices','View permitted invoice and finance evidence.',true),
  ('finance.manage','Finance','Manage finance workflow','Manage authorized invoice, matching, and finance exception actions.',true),
  ('finance.match.review','Finance','Review three-way matches','Review request, receipt, and invoice matching exceptions.',true),
  ('document.view','Documents','View documents','View permitted generated and uploaded documents.',false),
  ('document.manage','Documents','Manage documents (compatibility)','Compatibility capability for current document-management routes.',true),
  ('document.generate','Documents','Generate documents','Generate a versioned private document from an immutable snapshot.',true),
  ('document.download','Documents','Download documents','Download a private document after current authorization is rechecked.',false),
  ('document.dispatch.supplier','Documents','Dispatch supplier documents','Dispatch an approved supplier-facing document.',true),
  ('document.dispatch.company','Documents','Dispatch company documents','Dispatch an approved company-facing document.',true),
  ('report.view','Reporting','View reports','View role- and scope-appropriate reports.',false),
  ('analytics.platform.view','Analytics','View platform analytics','View Axora-wide analytics and operational aggregates.',true),
  ('analytics.company.view','Analytics','View company analytics','View company-, branch-, or department-scoped analytics.',true),
  ('email.operations.view','Email','View email operations','View transactional email queue, delivery, suppression, and provider health.',true),
  ('audit.view','Audit','View audit history','View permitted immutable accountability records.',true),
  ('settings.manage','Settings','Manage settings','Manage authorized platform or company settings.',true),
  ('system.diagnostics.view','Support','View system diagnostics','View audited technical diagnostics without business authority.',true),
  ('supplier.portal.view','Supplier','View supplier portal','Open the supplier-focused portal for assigned work.',false),
  ('supplier.rfq.respond','Supplier','Respond to RFQs','Respond to assigned quotation requests.',true)
ON CONFLICT(permission_code) DO UPDATE SET
  permission_group=EXCLUDED.permission_group,
  label=EXCLUDED.label,
  description=EXCLUDED.description,
  high_risk=EXCLUDED.high_risk,
  active=true,
  updated_at=now();

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(role_id,permission_id)
);

INSERT INTO role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM (VALUES
    ('PLATFORM_OWNER','dashboard.view'),
    ('PLATFORM_OWNER','platform.view'),
    ('PLATFORM_OWNER','company.view'),
    ('PLATFORM_OWNER','company.lead.view'),
    ('PLATFORM_OWNER','company.lead.create'),
    ('PLATFORM_OWNER','company.lead.assign'),
    ('PLATFORM_OWNER','company.lead.reassign'),
    ('PLATFORM_OWNER','company.edit'),
    ('PLATFORM_OWNER','company.activate'),
    ('PLATFORM_OWNER','company.suspend'),
    ('PLATFORM_OWNER','company.portal.preview'),
    ('PLATFORM_OWNER','company.portal.publish'),
    ('PLATFORM_OWNER','user.view'),
    ('PLATFORM_OWNER','user.create'),
    ('PLATFORM_OWNER','user.invite'),
    ('PLATFORM_OWNER','user.edit'),
    ('PLATFORM_OWNER','user.deactivate'),
    ('PLATFORM_OWNER','user.permission.manage'),
    ('PLATFORM_OWNER','user.manage'),
    ('PLATFORM_OWNER','organization.branch.view'),
    ('PLATFORM_OWNER','organization.branch.manage'),
    ('PLATFORM_OWNER','organization.department.manage'),
    ('PLATFORM_OWNER','organization.cost_center.manage'),
    ('PLATFORM_OWNER','organization.delivery_location.manage'),
    ('PLATFORM_OWNER','product.view'),
    ('PLATFORM_OWNER','catalog.manage'),
    ('PLATFORM_OWNER','supplier.manage'),
    ('PLATFORM_OWNER','sourcing.manage'),
    ('PLATFORM_OWNER','request.view'),
    ('PLATFORM_OWNER','request.approval_queue.view'),
    ('PLATFORM_OWNER','budget.view'),
    ('PLATFORM_OWNER','commercial.cost.view'),
    ('PLATFORM_OWNER','commercial.markup.view'),
    ('PLATFORM_OWNER','commercial.company_ceiling.view'),
    ('PLATFORM_OWNER','commercial.company_ceiling.override'),
    ('PLATFORM_OWNER','commercial.platform_margin.view'),
    ('PLATFORM_OWNER','commercial.pricing.manage'),
    ('PLATFORM_OWNER','delivery.view'),
    ('PLATFORM_OWNER','delivery.manage'),
    ('PLATFORM_OWNER','delivery.assign'),
    ('PLATFORM_OWNER','receiving.view'),
    ('PLATFORM_OWNER','finance.invoice.view'),
    ('PLATFORM_OWNER','finance.manage'),
    ('PLATFORM_OWNER','finance.match.review'),
    ('PLATFORM_OWNER','document.view'),
    ('PLATFORM_OWNER','document.manage'),
    ('PLATFORM_OWNER','document.generate'),
    ('PLATFORM_OWNER','document.download'),
    ('PLATFORM_OWNER','document.dispatch.supplier'),
    ('PLATFORM_OWNER','document.dispatch.company'),
    ('PLATFORM_OWNER','report.view'),
    ('PLATFORM_OWNER','analytics.platform.view'),
    ('PLATFORM_OWNER','analytics.company.view'),
    ('PLATFORM_OWNER','email.operations.view'),
    ('PLATFORM_OWNER','audit.view'),
    ('PLATFORM_OWNER','settings.manage'),
    ('PLATFORM_OWNER','system.diagnostics.view'),
    ('PLATFORM_OPERATIONS','dashboard.view'),
    ('PLATFORM_OPERATIONS','platform.view'),
    ('PLATFORM_OPERATIONS','product.view'),
    ('PLATFORM_OPERATIONS','catalog.manage'),
    ('PLATFORM_OPERATIONS','supplier.manage'),
    ('PLATFORM_OPERATIONS','sourcing.manage'),
    ('PLATFORM_OPERATIONS','request.view'),
    ('PLATFORM_OPERATIONS','delivery.view'),
    ('PLATFORM_OPERATIONS','delivery.manage'),
    ('PLATFORM_OPERATIONS','delivery.assign'),
    ('PLATFORM_OPERATIONS','receiving.view'),
    ('PLATFORM_OPERATIONS','document.view'),
    ('PLATFORM_OPERATIONS','document.manage'),
    ('PLATFORM_OPERATIONS','document.generate'),
    ('PLATFORM_OPERATIONS','document.download'),
    ('PLATFORM_OPERATIONS','document.dispatch.supplier'),
    ('PLATFORM_OPERATIONS','report.view'),
    ('CLIENT_ACCOUNT_MANAGER','dashboard.view'),
    ('CLIENT_ACCOUNT_MANAGER','company.view.assigned'),
    ('CLIENT_ACCOUNT_MANAGER','company.lead.view'),
    ('CLIENT_ACCOUNT_MANAGER','company.lead.create'),
    ('CLIENT_ACCOUNT_MANAGER','company.lead.assign'),
    ('CLIENT_ACCOUNT_MANAGER','company.lead.reassign'),
    ('CLIENT_ACCOUNT_MANAGER','company.edit'),
    ('CLIENT_ACCOUNT_MANAGER','company.activate'),
    ('CLIENT_ACCOUNT_MANAGER','company.suspend'),
    ('CLIENT_ACCOUNT_MANAGER','company.portal.preview'),
    ('CLIENT_ACCOUNT_MANAGER','user.view'),
    ('CLIENT_ACCOUNT_MANAGER','user.create'),
    ('CLIENT_ACCOUNT_MANAGER','user.invite'),
    ('CLIENT_ACCOUNT_MANAGER','user.edit'),
    ('CLIENT_ACCOUNT_MANAGER','user.deactivate'),
    ('CLIENT_ACCOUNT_MANAGER','organization.branch.view'),
    ('CLIENT_ACCOUNT_MANAGER','product.view'),
    ('CLIENT_ACCOUNT_MANAGER','request.view'),
    ('CLIENT_ACCOUNT_MANAGER','delivery.view'),
    ('CLIENT_ACCOUNT_MANAGER','budget.view'),
    ('CLIENT_ACCOUNT_MANAGER','commercial.company_ceiling.view'),
    ('CLIENT_ACCOUNT_MANAGER','document.view'),
    ('CLIENT_ACCOUNT_MANAGER','document.download'),
    ('CLIENT_ACCOUNT_MANAGER','report.view'),
    ('CLIENT_ACCOUNT_MANAGER','analytics.company.view'),
    ('CLIENT_ACCOUNT_MANAGER','audit.view'),
    ('TECHNICAL_SUPPORT','system.diagnostics.view'),
    ('COMPANY_ADMIN','dashboard.view'),
    ('COMPANY_ADMIN','company.view'),
    ('COMPANY_ADMIN','user.view'),
    ('COMPANY_ADMIN','user.create'),
    ('COMPANY_ADMIN','user.invite'),
    ('COMPANY_ADMIN','user.edit'),
    ('COMPANY_ADMIN','user.deactivate'),
    ('COMPANY_ADMIN','user.permission.manage'),
    ('COMPANY_ADMIN','user.manage'),
    ('COMPANY_ADMIN','organization.branch.view'),
    ('COMPANY_ADMIN','organization.branch.manage'),
    ('COMPANY_ADMIN','organization.department.manage'),
    ('COMPANY_ADMIN','organization.cost_center.manage'),
    ('COMPANY_ADMIN','organization.delivery_location.manage'),
    ('COMPANY_ADMIN','product.view'),
    ('COMPANY_ADMIN','request.view'),
    ('COMPANY_ADMIN','request.approval_queue.view'),
    ('COMPANY_ADMIN','request.approve.other'),
    ('COMPANY_ADMIN','request.approve.over_budget'),
    ('COMPANY_ADMIN','budget.view'),
    ('COMPANY_ADMIN','budget.branch.manage'),
    ('COMPANY_ADMIN','budget.assign'),
    ('COMPANY_ADMIN','budget.increase'),
    ('COMPANY_ADMIN','budget.reduce'),
    ('COMPANY_ADMIN','budget.refresh'),
    ('COMPANY_ADMIN','delivery.view'),
    ('COMPANY_ADMIN','finance.invoice.view'),
    ('COMPANY_ADMIN','document.view'),
    ('COMPANY_ADMIN','document.manage'),
    ('COMPANY_ADMIN','document.generate'),
    ('COMPANY_ADMIN','document.download'),
    ('COMPANY_ADMIN','document.dispatch.company'),
    ('COMPANY_ADMIN','report.view'),
    ('COMPANY_ADMIN','analytics.company.view'),
    ('COMPANY_ADMIN','audit.view'),
    ('COMPANY_ADMIN','settings.manage'),
    ('BRANCH_ADMIN','dashboard.view'),
    ('BRANCH_ADMIN','company.view'),
    ('BRANCH_ADMIN','user.view'),
    ('BRANCH_ADMIN','user.create'),
    ('BRANCH_ADMIN','user.invite'),
    ('BRANCH_ADMIN','user.edit'),
    ('BRANCH_ADMIN','user.deactivate'),
    ('BRANCH_ADMIN','user.manage'),
    ('BRANCH_ADMIN','organization.branch.view'),
    ('BRANCH_ADMIN','organization.department.manage'),
    ('BRANCH_ADMIN','organization.delivery_location.manage'),
    ('BRANCH_ADMIN','product.view'),
    ('BRANCH_ADMIN','cart.manage'),
    ('BRANCH_ADMIN','request.view'),
    ('BRANCH_ADMIN','request.create'),
    ('BRANCH_ADMIN','request.edit'),
    ('BRANCH_ADMIN','request.submit'),
    ('BRANCH_ADMIN','request.cancel'),
    ('BRANCH_ADMIN','request.approval_queue.view'),
    ('BRANCH_ADMIN','request.approve.other'),
    ('BRANCH_ADMIN','budget.view'),
    ('BRANCH_ADMIN','delivery.view'),
    ('BRANCH_ADMIN','finance.invoice.view'),
    ('BRANCH_ADMIN','document.view'),
    ('BRANCH_ADMIN','document.manage'),
    ('BRANCH_ADMIN','document.generate'),
    ('BRANCH_ADMIN','document.download'),
    ('BRANCH_ADMIN','report.view'),
    ('BRANCH_ADMIN','analytics.company.view'),
    ('DEPARTMENT_ADMIN','dashboard.view'),
    ('DEPARTMENT_ADMIN','company.view'),
    ('DEPARTMENT_ADMIN','user.view'),
    ('DEPARTMENT_ADMIN','user.create'),
    ('DEPARTMENT_ADMIN','user.invite'),
    ('DEPARTMENT_ADMIN','user.edit'),
    ('DEPARTMENT_ADMIN','user.deactivate'),
    ('DEPARTMENT_ADMIN','user.manage'),
    ('DEPARTMENT_ADMIN','organization.branch.view'),
    ('DEPARTMENT_ADMIN','organization.department.manage'),
    ('DEPARTMENT_ADMIN','product.view'),
    ('DEPARTMENT_ADMIN','cart.manage'),
    ('DEPARTMENT_ADMIN','request.view'),
    ('DEPARTMENT_ADMIN','request.create'),
    ('DEPARTMENT_ADMIN','request.edit'),
    ('DEPARTMENT_ADMIN','request.submit'),
    ('DEPARTMENT_ADMIN','request.cancel'),
    ('DEPARTMENT_ADMIN','request.approval_queue.view'),
    ('DEPARTMENT_ADMIN','request.approve.other'),
    ('DEPARTMENT_ADMIN','budget.view'),
    ('DEPARTMENT_ADMIN','delivery.view'),
    ('DEPARTMENT_ADMIN','document.view'),
    ('DEPARTMENT_ADMIN','document.manage'),
    ('DEPARTMENT_ADMIN','document.generate'),
    ('DEPARTMENT_ADMIN','document.download'),
    ('DEPARTMENT_ADMIN','report.view'),
    ('DEPARTMENT_ADMIN','analytics.company.view'),
    ('COMPANY_APPROVER','dashboard.view'),
    ('COMPANY_APPROVER','company.view'),
    ('COMPANY_APPROVER','organization.branch.view'),
    ('COMPANY_APPROVER','product.view'),
    ('COMPANY_APPROVER','request.view'),
    ('COMPANY_APPROVER','request.approval_queue.view'),
    ('COMPANY_APPROVER','request.approve.other'),
    ('COMPANY_APPROVER','budget.view'),
    ('COMPANY_APPROVER','delivery.view'),
    ('COMPANY_APPROVER','document.view'),
    ('COMPANY_APPROVER','document.download'),
    ('COMPANY_APPROVER','report.view'),
    ('COMPANY_APPROVER','analytics.company.view'),
    ('BRANCH_APPROVER','dashboard.view'),
    ('BRANCH_APPROVER','company.view'),
    ('BRANCH_APPROVER','organization.branch.view'),
    ('BRANCH_APPROVER','product.view'),
    ('BRANCH_APPROVER','request.view'),
    ('BRANCH_APPROVER','request.approval_queue.view'),
    ('BRANCH_APPROVER','request.approve.other'),
    ('BRANCH_APPROVER','budget.view'),
    ('BRANCH_APPROVER','delivery.view'),
    ('BRANCH_APPROVER','document.view'),
    ('BRANCH_APPROVER','document.download'),
    ('BRANCH_APPROVER','report.view'),
    ('REQUESTER','dashboard.view'),
    ('REQUESTER','company.view'),
    ('REQUESTER','organization.branch.view'),
    ('REQUESTER','product.view'),
    ('REQUESTER','cart.manage'),
    ('REQUESTER','request.view.own'),
    ('REQUESTER','request.create'),
    ('REQUESTER','request.edit'),
    ('REQUESTER','request.submit'),
    ('REQUESTER','request.cancel'),
    ('REQUESTER','delivery.view'),
    ('REQUESTER','document.view'),
    ('REQUESTER','document.download'),
    ('FINANCE_REVIEWER','dashboard.view'),
    ('FINANCE_REVIEWER','company.view'),
    ('FINANCE_REVIEWER','organization.branch.view'),
    ('FINANCE_REVIEWER','product.view'),
    ('FINANCE_REVIEWER','request.view'),
    ('FINANCE_REVIEWER','budget.view'),
    ('FINANCE_REVIEWER','delivery.view'),
    ('FINANCE_REVIEWER','finance.invoice.view'),
    ('FINANCE_REVIEWER','finance.manage'),
    ('FINANCE_REVIEWER','finance.match.review'),
    ('FINANCE_REVIEWER','document.view'),
    ('FINANCE_REVIEWER','document.download'),
    ('FINANCE_REVIEWER','report.view'),
    ('FINANCE_REVIEWER','analytics.company.view'),
    ('AUDITOR','dashboard.view'),
    ('AUDITOR','company.view'),
    ('AUDITOR','organization.branch.view'),
    ('AUDITOR','product.view'),
    ('AUDITOR','request.view'),
    ('AUDITOR','budget.view'),
    ('AUDITOR','delivery.view'),
    ('AUDITOR','finance.invoice.view'),
    ('AUDITOR','document.view'),
    ('AUDITOR','document.download'),
    ('AUDITOR','report.view'),
    ('AUDITOR','analytics.company.view'),
    ('AUDITOR','audit.view'),
    ('RECEIVING_USER','company.view'),
    ('RECEIVING_USER','delivery.view'),
    ('RECEIVING_USER','receiving.view'),
    ('RECEIVING_USER','receiving.confirm'),
    ('RECEIVING_USER','document.view'),
    ('RECEIVING_USER','document.download'),
    ('SUPPLIER_USER','supplier.portal.view'),
    ('SUPPLIER_USER','supplier.rfq.respond'),
    ('SUPPLIER_USER','document.view'),
    ('SUPPLIER_USER','document.download'),
    ('DELIVERY_TEAM_SUPERVISOR','dashboard.view'),
    ('DELIVERY_TEAM_SUPERVISOR','user.view'),
    ('DELIVERY_TEAM_SUPERVISOR','user.create'),
    ('DELIVERY_TEAM_SUPERVISOR','user.invite'),
    ('DELIVERY_TEAM_SUPERVISOR','user.edit'),
    ('DELIVERY_TEAM_SUPERVISOR','user.deactivate'),
    ('DELIVERY_TEAM_SUPERVISOR','delivery.view'),
    ('DELIVERY_TEAM_SUPERVISOR','delivery.manage'),
    ('DELIVERY_TEAM_SUPERVISOR','delivery.assign'),
    ('DELIVERY_TEAM_SUPERVISOR','delivery.portal.view'),
    ('DELIVERY_TEAM_SUPERVISOR','delivery.assignment.update'),
    ('DELIVERY_TEAM_SUPERVISOR','delivery.track'),
    ('DELIVERY_TEAM_SUPERVISOR','delivery.complete'),
    ('DELIVERY_TEAM_SUPERVISOR','document.view'),
    ('DELIVERY_TEAM_SUPERVISOR','document.download'),
    ('DELIVERY_TEAM_SUPERVISOR','report.view'),
    ('DELIVERY_AGENT','delivery.view'),
    ('DELIVERY_AGENT','delivery.portal.view'),
    ('DELIVERY_AGENT','delivery.assignment.update'),
    ('DELIVERY_AGENT','delivery.accept'),
    ('DELIVERY_AGENT','delivery.shop'),
    ('DELIVERY_AGENT','delivery.receipt.upload'),
    ('DELIVERY_AGENT','delivery.track'),
    ('DELIVERY_AGENT','delivery.complete'),
    ('DELIVERY_AGENT','document.view'),
    ('DELIVERY_AGENT','document.download'),
    ('DELIVERY_DRIVER','delivery.view'),
    ('DELIVERY_DRIVER','delivery.portal.view'),
    ('DELIVERY_DRIVER','delivery.assignment.update'),
    ('DELIVERY_DRIVER','delivery.accept'),
    ('DELIVERY_DRIVER','delivery.shop'),
    ('DELIVERY_DRIVER','delivery.receipt.upload'),
    ('DELIVERY_DRIVER','delivery.track'),
    ('DELIVERY_DRIVER','delivery.complete'),
    ('DELIVERY_DRIVER','document.view'),
    ('DELIVERY_DRIVER','document.download')
) AS defaults(role_key,permission_code)
JOIN roles role ON role.role_key=defaults.role_key
JOIN permissions permission
  ON permission.permission_code=defaults.permission_code
ON CONFLICT(role_id,permission_id) DO NOTHING;

-- Department is introduced here only as the minimum stable scope object needed
-- by the authorization model. P1-02 extends its operational attributes.
CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid,
  department_code text NOT NULL
    CHECK (char_length(btrim(department_code)) BETWEEN 1 AND 40),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 200),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(branch_id,company_id)
    REFERENCES branches(id,company_id) ON DELETE RESTRICT,
  UNIQUE(id,company_id),
  UNIQUE(company_id,department_code)
);
CREATE UNIQUE INDEX IF NOT EXISTS departments_company_name_lower_uq
  ON departments(company_id,lower(name));

CREATE TABLE IF NOT EXISTS department_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','SUSPENDED','ENDED')),
  is_primary boolean NOT NULL DEFAULT false,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  FOREIGN KEY(department_id,company_id)
    REFERENCES departments(id,company_id) ON DELETE RESTRICT,
  CHECK (
    (status='ENDED' AND ended_at IS NOT NULL)
    OR (status<>'ENDED' AND ended_at IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS department_assignments_active_uq
  ON department_assignments(user_id,department_id)
  WHERE status='ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS department_assignments_one_primary_uq
  ON department_assignments(user_id)
  WHERE status='ACTIVE' AND is_primary;

CREATE TABLE IF NOT EXISTS user_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type text NOT NULL
    CHECK (scope_type IN (
      'PLATFORM','COMPANY','BRANCH','DEPARTMENT','SUPPLIER','DELIVERY'
    )),
  company_id uuid REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid,
  department_id uuid,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE RESTRICT,
  source text NOT NULL
    CHECK (source IN (
      'ROLE_ASSIGNMENT','DIRECT','DELEGATION','BACKUP_ASSIGNMENT'
    )),
  source_reference uuid,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(branch_id,company_id)
    REFERENCES branches(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(department_id,company_id)
    REFERENCES departments(id,company_id) ON DELETE RESTRICT,
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (
    (scope_type='PLATFORM'
      AND company_id IS NULL AND branch_id IS NULL
      AND department_id IS NULL AND supplier_id IS NULL)
    OR
    (scope_type='COMPANY'
      AND company_id IS NOT NULL AND branch_id IS NULL
      AND department_id IS NULL AND supplier_id IS NULL)
    OR
    (scope_type='BRANCH'
      AND company_id IS NOT NULL AND branch_id IS NOT NULL
      AND department_id IS NULL AND supplier_id IS NULL)
    OR
    (scope_type='DEPARTMENT'
      AND company_id IS NOT NULL AND department_id IS NOT NULL
      AND supplier_id IS NULL)
    OR
    (scope_type='SUPPLIER'
      AND company_id IS NULL AND branch_id IS NULL
      AND department_id IS NULL AND supplier_id IS NOT NULL)
    OR
    (scope_type='DELIVERY'
      AND company_id IS NULL AND branch_id IS NULL
      AND department_id IS NULL AND supplier_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS user_scopes_active_identity_uq
  ON user_scopes(
    user_id,scope_type,
    COALESCE(company_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(branch_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(department_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(supplier_id,'00000000-0000-0000-0000-000000000000'::uuid),
    source,
    COALESCE(source_reference,'00000000-0000-0000-0000-000000000000'::uuid)
  ) WHERE active;

INSERT INTO user_scopes(
  user_id,scope_type,company_id,branch_id,supplier_id,
  source,source_reference,starts_at,ends_at,active,assigned_by
)
SELECT
  assignment.user_id,assignment.scope_type,assignment.company_id,
  assignment.branch_id,assignment.supplier_id,
  'ROLE_ASSIGNMENT',assignment.id,assignment.assigned_at,
  assignment.revoked_at,assignment.active,assignment.assigned_by
FROM role_assignments assignment
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
  effect text NOT NULL CHECK (effect IN ('GRANT','DENY')),
  scope_type text NOT NULL
    CHECK (scope_type IN (
      'PLATFORM','COMPANY','BRANCH','DEPARTMENT','SUPPLIER','DELIVERY'
    )),
  company_id uuid REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid,
  department_id uuid,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(branch_id,company_id)
    REFERENCES branches(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(department_id,company_id)
    REFERENCES departments(id,company_id) ON DELETE RESTRICT,
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (
    (scope_type='PLATFORM'
      AND company_id IS NULL AND branch_id IS NULL
      AND department_id IS NULL AND supplier_id IS NULL)
    OR
    (scope_type='COMPANY'
      AND company_id IS NOT NULL AND branch_id IS NULL
      AND department_id IS NULL AND supplier_id IS NULL)
    OR
    (scope_type='BRANCH'
      AND company_id IS NOT NULL AND branch_id IS NOT NULL
      AND department_id IS NULL AND supplier_id IS NULL)
    OR
    (scope_type='DEPARTMENT'
      AND company_id IS NOT NULL AND department_id IS NOT NULL
      AND supplier_id IS NULL)
    OR
    (scope_type='SUPPLIER'
      AND company_id IS NULL AND branch_id IS NULL
      AND department_id IS NULL AND supplier_id IS NOT NULL)
    OR
    (scope_type='DELIVERY'
      AND company_id IS NULL AND branch_id IS NULL
      AND department_id IS NULL AND supplier_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS user_permission_overrides_lookup_idx
  ON user_permission_overrides(user_id,permission_id,active,starts_at,ends_at);

CREATE TABLE IF NOT EXISTS approval_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
  scope_type text NOT NULL
    CHECK (scope_type IN ('COMPANY','BRANCH','DEPARTMENT')),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid,
  department_id uuid,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  maximum_amount numeric(18,2) NOT NULL CHECK (maximum_amount >= 0),
  allow_self_approval boolean NOT NULL DEFAULT false,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(branch_id,company_id)
    REFERENCES branches(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(department_id,company_id)
    REFERENCES departments(id,company_id) ON DELETE RESTRICT,
  CHECK ((user_id IS NOT NULL) <> (role_id IS NOT NULL)),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (
    (scope_type='COMPANY' AND branch_id IS NULL AND department_id IS NULL)
    OR
    (scope_type='BRANCH' AND branch_id IS NOT NULL AND department_id IS NULL)
    OR
    (scope_type='DEPARTMENT' AND department_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS approval_limits_subject_lookup_idx
  ON approval_limits(user_id,role_id,permission_id,active,starts_at,ends_at);

CREATE TABLE IF NOT EXISTS delegated_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grantee_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  authorized_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','REVOKED','EXPIRED')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (
    (status='REVOKED' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
    OR (status<>'REVOKED' AND revoked_at IS NULL AND revoked_by IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS delegated_access_permissions (
  delegated_access_id uuid NOT NULL
    REFERENCES delegated_access(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
  PRIMARY KEY(delegated_access_id,permission_id)
);

CREATE TABLE IF NOT EXISTS delegated_access_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delegated_access_id uuid NOT NULL
    REFERENCES delegated_access(id) ON DELETE CASCADE,
  scope_type text NOT NULL
    CHECK (scope_type IN (
      'PLATFORM','COMPANY','BRANCH','DEPARTMENT','SUPPLIER','DELIVERY'
    )),
  company_id uuid REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid,
  department_id uuid,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE RESTRICT,
  FOREIGN KEY(branch_id,company_id)
    REFERENCES branches(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(department_id,company_id)
    REFERENCES departments(id,company_id) ON DELETE RESTRICT,
  CHECK (
    (scope_type='PLATFORM'
      AND company_id IS NULL AND branch_id IS NULL
      AND department_id IS NULL AND supplier_id IS NULL)
    OR
    (scope_type='COMPANY'
      AND company_id IS NOT NULL AND branch_id IS NULL
      AND department_id IS NULL AND supplier_id IS NULL)
    OR
    (scope_type='BRANCH'
      AND company_id IS NOT NULL AND branch_id IS NOT NULL
      AND department_id IS NULL AND supplier_id IS NULL)
    OR
    (scope_type='DEPARTMENT'
      AND company_id IS NOT NULL AND department_id IS NOT NULL
      AND supplier_id IS NULL)
    OR
    (scope_type='SUPPLIER'
      AND company_id IS NULL AND branch_id IS NULL
      AND department_id IS NULL AND supplier_id IS NOT NULL)
    OR
    (scope_type='DELIVERY'
      AND company_id IS NULL AND branch_id IS NULL
      AND department_id IS NULL AND supplier_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS delegated_access_scopes_identity_uq
  ON delegated_access_scopes(
    delegated_access_id,scope_type,
    COALESCE(company_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(branch_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(department_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(supplier_id,'00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE TABLE IF NOT EXISTS permission_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  target_role_id uuid REFERENCES roles(id) ON DELETE RESTRICT,
  permission_id uuid REFERENCES permissions(id) ON DELETE RESTRICT,
  change_type text NOT NULL CHECK (change_type IN (
    'ROLE_ASSIGNED','ROLE_REVOKED','SCOPE_GRANTED','SCOPE_REVOKED',
    'PERMISSION_GRANTED','PERMISSION_DENIED','PERMISSION_REMOVED',
    'APPROVAL_LIMIT_SET','APPROVAL_LIMIT_REMOVED',
    'DELEGATION_CREATED','DELEGATION_REVOKED'
  )),
  previous_value jsonb,
  new_value jsonb,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (target_user_id IS NOT NULL AND target_role_id IS NULL)
    OR (target_user_id IS NULL AND target_role_id IS NOT NULL)
  ),
  CHECK (previous_value IS NOT NULL OR new_value IS NOT NULL)
);

CREATE OR REPLACE FUNCTION reject_permission_change_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Permission change history is append-only';
END $$;

DROP TRIGGER IF EXISTS permission_change_history_append_only
  ON permission_change_history;
CREATE TRIGGER permission_change_history_append_only
BEFORE UPDATE OR DELETE ON permission_change_history
FOR EACH ROW EXECUTE FUNCTION reject_permission_change_history_mutation();

REVOKE ALL ON FUNCTION reject_permission_change_history_mutation()
  FROM PUBLIC;
REVOKE ALL ON TABLE
  permissions,role_permissions,departments,department_assignments,user_scopes,
  user_permission_overrides,approval_limits,delegated_access,
  delegated_access_permissions,delegated_access_scopes,
  permission_change_history
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE
      permissions,role_permissions,departments,department_assignments,user_scopes,
      user_permission_overrides,approval_limits,delegated_access,
      delegated_access_permissions,delegated_access_scopes,
      permission_change_history
    FROM axora_app;
    GRANT SELECT ON TABLE permissions,role_permissions TO axora_app;
  END IF;
END $$;

COMMIT;
