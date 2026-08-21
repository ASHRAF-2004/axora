import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFile(
  new URL(`../${path}`, import.meta.url),
  "utf8",
);

describe("P0-02 active isolation coverage", () => {
  it("uses predicate-first operational registers", async () => {
    const [runtime, finance, delivery, approvals, documents] =
      await Promise.all([
        source("src/lib/operational-isolation.ts"),
        source("src/lib/finance-isolation.ts"),
        source("src/lib/delivery-isolation.ts"),
        source("src/app/(portal)/approvals/page.tsx"),
        source("src/lib/document-register-isolation.ts"),
      ]);

    expect(runtime).toContain("axora_operation_request_access_rows");
    expect(runtime).toContain("'request.approval_queue.view'");
    expect(runtime).toContain("'delivery.view'");
    expect(runtime).toContain("'finance.invoice.view'");
    expect(finance).not.toContain('from "./operations"');
    expect(delivery).not.toContain('from "./operations"');
    expect(approvals).toContain("getApprovalWorkspace(actor)");
    expect(approvals).not.toContain("listApprovals()");
    expect(documents).toContain("listAuthorizedInvoices(actor)");
    expect(documents).toContain("listAuthorizedDeliveries(actor)");
  });

  it("reauthorizes operational mutations in the write transaction", async () => {
    const [runtime, actions] = await Promise.all([
      source("src/lib/scoped-operations.ts"),
      source("src/app/(portal)/operations/actions.ts"),
    ]);

    expect(runtime).toContain("axora_lock_request_resource_access");
    expect(runtime).toContain("axora_lock_request_line_access");
    expect(runtime).toContain("axora_lock_invoice_access");
    expect(runtime).toContain("withAuditTransaction");
    expect(actions).toContain("recordScopedApproval");
    expect(actions).not.toMatch(/\b(createQuotation|selectQuotation|recordApproval|recordDelivery|createInvoice|recordPayment)\b.*from \"@\/lib\/operations\"/s);
  });

  it("uses exact-assignment user and organization administration", async () => {
    const [users, newUser, newCompanyUser, userActions, userRuntime,
      accountSetup, newRequest, settingsAction] = await Promise.all([
        source("src/app/(portal)/users/page.tsx"),
        source("src/app/(portal)/users/new/page.tsx"),
        source("src/app/(portal)/companies/[companyId]/users/new/page.tsx"),
        source("src/app/(portal)/users/actions.ts"),
        source("src/lib/user-isolation.ts"),
        source("src/lib/account-setup.ts"),
        source("src/app/(portal)/requests/new/page.tsx"),
        source("src/app/(portal)/settings/actions.ts"),
      ]);

    expect(users).toContain("listAuthorizedUsers(actor)");
    expect(newUser).not.toContain("loadOrganizationDirectory(actor)");
    expect(newUser).toContain('creationContext="PLATFORM"');
    expect(newCompanyUser).toContain("loadOrganizationDirectory(actor)");
    expect(newCompanyUser).toContain('creationContext="COMPANY"');
    expect(users).not.toContain("listUsers(actor)");
    expect(users).not.toContain("listCompanies(actor)");
    expect(users).not.toContain("listBranches(actor)");
    expect(userActions).toContain("setAuthorizedUserActive");
    expect(userActions).toContain(
      "resendAccountSetupInvitation(parsedUserId.data, actor)",
    );
    expect(accountSetup).toContain(
      "lockAuthorizedInvitationCreationScope(client, actor, resolved)",
    );
    expect(accountSetup).toContain(
      "lockAuthorizedInvitationResendTarget(",
    );
    expect(userRuntime).toContain("axora_user_directory_rows");
    expect(userRuntime).toContain("axora_lock_user_target_access");
    expect(newRequest).toContain("loadOrganizationDirectory(actor)");
    expect(newRequest).not.toContain("listCompanies");
    expect(newRequest).not.toContain("listBranches");
    expect(settingsAction).toContain(
      "updateAuthorizedCompanyPricingConfiguration",
    );
  });

  it("keeps direct files, exports, catalogue, notifications and role portals scoped", async () => {
    const [attachmentRoute, requestExport, catalog, cart, notifications,
      rolePortals, audit] = await Promise.all([
        source("src/app/api/attachments/[id]/route.ts"),
        source("src/app/api/export/requests/route.ts"),
        source("src/app/api/catalog/route.ts"),
        source("src/app/api/catalog/cart/route.ts"),
        source("src/lib/notification-repository.ts"),
        source("src/lib/role-portals-repository.ts"),
        source("src/lib/audit-isolation.ts"),
      ]);

    expect(attachmentRoute).toContain("loadAuthorizedAttachmentFile(actor");
    expect(requestExport).toContain("listAuthorizedFilteredRequests(user,filters)");
    expect(catalog).toContain("searchCatalogProducts");
    expect(catalog).toContain('"Cache-Control": "private, no-store"');
    expect(cart).toContain("getCustomerCatalogProductsByPublicRefs");
    expect(cart).toContain('"Cache-Control": "private, no-store"');
    expect(notifications).toContain("axora_notification_center_snapshot");
    expect(notifications).not.toMatch(/FROM\s+(?:public\.)?in_app_notifications\b/i);
    expect(rolePortals).not.toContain("activeSupplierScope");
    expect(rolePortals).toContain("activeDriverScope");
    expect(rolePortals).toContain("delivery_job_assignments");
    expect(audit).toContain("listAuthorizedAttachments(actor)");
    expect(audit).toContain("listAuthorizedRequests(actor)");
    expect(audit).not.toMatch(/FROM\s+attachments\b/i);
  });
});
