import { expect, test, type Page, type Response } from "@playwright/test";
import { signInAsDemoRole, type DemoRoleSession } from "./helpers/auth";

const companyId = "11111111-1111-4111-8111-111111111111";
const branchId = "88888888-8888-4888-8888-888888888888";

const roles = {
  owner: {
    id: "91000000-0000-4000-8000-000000000001",
    email: "final-owner@axora.invalid",
    name: "Final Platform Owner",
    role: "PLATFORM_OWNER",
    accountKind: "PLATFORM",
    scopeType: "PLATFORM",
    isOwner: true,
  },
  cam: {
    id: "91000000-0000-4000-8000-000000000002",
    email: "final-cam@axora.invalid",
    name: "Final Client Account Manager",
    role: "CLIENT_ACCOUNT_MANAGER",
    accountKind: "PLATFORM",
    scopeType: "PLATFORM",
  },
  companyAdmin: {
    id: "91000000-0000-4000-8000-000000000003",
    email: "final-company-admin@axora.invalid",
    name: "Final Company Administrator",
    role: "COMPANY_ADMIN",
    accountKind: "COMPANY",
    scopeType: "COMPANY",
    companyId,
  },
  branchAdmin: {
    id: "91000000-0000-4000-8000-000000000004",
    email: "final-branch-admin@axora.invalid",
    name: "Final Branch Administrator",
    role: "BRANCH_ADMIN",
    accountKind: "COMPANY",
    scopeType: "BRANCH",
    companyId,
    branchId,
  },
  requester: {
    id: "91000000-0000-4000-8000-000000000005",
    email: "final-requester@axora.invalid",
    name: "Final Requester",
    role: "REQUESTER",
    accountKind: "COMPANY",
    scopeType: "BRANCH",
    companyId,
    branchId,
  },
  delivery: {
    id: "91000000-0000-4000-8000-000000000006",
    email: "final-delivery@axora.invalid",
    name: "Final Delivery Agent",
    role: "DELIVERY_GUY",
    accountKind: "DELIVERY",
    scopeType: "DELIVERY",
  },
} satisfies Record<string, DemoRoleSession>;

type Role = keyof typeof roles;
type Outcome =
  | { kind: "ALLOW"; path: string }
  | { kind: "REDIRECT" | "ACCESS_DENIED"; path: string }
  | { kind: "NOT_FOUND" };

const allow = (path: string): Outcome => ({ kind: "ALLOW", path });
const redirect = (path: string): Outcome => ({ kind: "REDIRECT", path });
const denied: Outcome = { kind: "ACCESS_DENIED", path: "/access-denied" };
const notFound: Outcome = { kind: "NOT_FOUND" };

const routes: Array<{
  route: string;
  expected: Record<Role, Outcome>;
}> = [
  {
    route: "/dashboard",
    expected: {
      owner: allow("/dashboard"), cam: allow("/dashboard"),
      companyAdmin: allow("/dashboard"), branchAdmin: allow("/dashboard"),
      requester: allow("/dashboard"), delivery: redirect("/driver"),
    },
  },
  {
    route: "/companies",
    expected: {
      owner: allow("/companies"), cam: allow("/companies"), companyAdmin: denied,
      branchAdmin: denied, requester: denied, delivery: denied,
    },
  },
  {
    route: `/companies/${companyId}`,
    expected: {
      owner: allow(`/companies/${companyId}`), cam: allow(`/companies/${companyId}`),
      companyAdmin: denied, branchAdmin: denied, requester: denied, delivery: denied,
    },
  },
  {
    route: "/companies/not-a-valid-id",
    expected: {
      owner: notFound, cam: notFound, companyAdmin: denied,
      branchAdmin: denied, requester: denied, delivery: denied,
    },
  },
  {
    route: "/users",
    expected: {
      owner: allow("/users"), cam: allow("/users"), companyAdmin: allow("/users"),
      branchAdmin: allow("/users"), requester: denied, delivery: denied,
    },
  },
  {
    route: "/integrations",
    expected: {
      owner: allow("/integrations"), cam: denied,
      companyAdmin: allow("/integrations"), branchAdmin: denied,
      requester: denied, delivery: denied,
    },
  },
  {
    route: "/branches",
    expected: {
      owner: allow("/branches"), cam: allow("/branches"),
      companyAdmin: allow("/branches"), branchAdmin: allow("/branches"),
      requester: allow("/branches"), delivery: denied,
    },
  },
  {
    route: `/branches/${branchId}`,
    expected: {
      owner: allow(`/branches/${branchId}`), cam: allow(`/branches/${branchId}`),
      companyAdmin: allow(`/branches/${branchId}`), branchAdmin: allow(`/branches/${branchId}`),
      requester: allow(`/branches/${branchId}`), delivery: denied,
    },
  },
  {
    route: "/branches/not-a-valid-id",
    expected: {
      owner: notFound, cam: notFound, companyAdmin: notFound,
      branchAdmin: notFound, requester: notFound, delivery: denied,
    },
  },
  {
    route: "/budgets",
    expected: {
      owner: denied, cam: denied, companyAdmin: allow("/budgets"),
      branchAdmin: allow("/budgets"), requester: denied, delivery: denied,
    },
  },
  {
    route: "/wallet",
    expected: {
      owner: allow("/wallet"), cam: denied, companyAdmin: allow("/wallet"),
      branchAdmin: denied, requester: denied, delivery: denied,
    },
  },
  {
    route: "/products",
    expected: {
      owner: allow("/products"), cam: allow("/products"),
      companyAdmin: allow("/products"), branchAdmin: allow("/products"),
      requester: allow("/products"), delivery: denied,
    },
  },
  {
    route: `/cart?branch=${branchId}`,
    expected: {
      owner: denied, cam: denied, companyAdmin: allow("/cart"),
      branchAdmin: allow("/cart"), requester: allow("/cart"), delivery: denied,
    },
  },
  {
    route: "/requests",
    expected: {
      owner: allow("/requests"), cam: allow("/requests"),
      companyAdmin: allow("/requests"), branchAdmin: allow("/requests"),
      requester: allow("/requests"), delivery: denied,
    },
  },
  {
    route: "/requests/order-1",
    expected: {
      owner: allow("/requests/order-1"), cam: allow("/requests/order-1"),
      companyAdmin: notFound, branchAdmin: notFound, requester: notFound,
      delivery: denied,
    },
  },
  {
    route: "/requests/not-a-valid-id",
    expected: {
      owner: notFound, cam: notFound, companyAdmin: notFound,
      branchAdmin: notFound, requester: notFound, delivery: denied,
    },
  },
  {
    route: `/requests/new?branch=${branchId}`,
    expected: {
      owner: denied, cam: denied, companyAdmin: redirect("/cart"),
      branchAdmin: allow("/requests/new"), requester: allow("/requests/new"),
      delivery: denied,
    },
  },
  {
    route: "/approvals",
    expected: {
      owner: allow("/approvals"), cam: denied, companyAdmin: allow("/approvals"),
      branchAdmin: allow("/approvals"), requester: denied, delivery: denied,
    },
  },
  {
    route: "/finance",
    expected: {
      owner: allow("/finance"), cam: allow("/requests"),
      companyAdmin: allow("/requests"), branchAdmin: allow("/requests"),
      requester: denied, delivery: denied,
    },
  },
  {
    route: "/deliveries",
    expected: {
      owner: allow("/deliveries"), cam: allow("/deliveries"),
      companyAdmin: allow("/deliveries"), branchAdmin: allow("/deliveries"),
      requester: allow("/deliveries"), delivery: denied,
    },
  },
  {
    route: "/receiving",
    expected: {
      owner: allow("/requests"), cam: allow("/requests"), companyAdmin: allow("/requests"),
      branchAdmin: allow("/requests"), requester: allow("/requests"), delivery: denied,
    },
  },
  {
    route: "/driver",
    expected: {
      owner: denied, cam: denied, companyAdmin: denied, branchAdmin: denied,
      requester: denied, delivery: allow("/driver"),
    },
  },
  {
    route: "/settings/procurement",
    expected: {
      owner: allow("/settings/procurement"), cam: denied,
      companyAdmin: allow("/settings/procurement"), branchAdmin: denied,
      requester: denied, delivery: denied,
    },
  },
  {
    route: "/profile",
    expected: {
      owner: allow("/profile"), cam: allow("/profile"),
      companyAdmin: allow("/profile"), branchAdmin: allow("/profile"),
      requester: allow("/profile"), delivery: allow("/profile"),
    },
  },
  {
    route: "/notifications",
    expected: {
      owner: allow("/notifications"), cam: allow("/notifications"),
      companyAdmin: allow("/notifications"), branchAdmin: allow("/notifications"),
      requester: allow("/notifications"), delivery: allow("/notifications"),
    },
  },
  {
    route: "/settings",
    expected: {
      owner: redirect("/profile"), cam: redirect("/profile"),
      companyAdmin: redirect("/profile"), branchAdmin: redirect("/profile"),
      requester: redirect("/profile"), delivery: redirect("/profile"),
    },
  },
  {
    route: "/reports",
    expected: {
      owner: redirect("/dashboard"), cam: redirect("/dashboard"),
      companyAdmin: redirect("/dashboard"), branchAdmin: redirect("/dashboard"),
      requester: redirect("/dashboard"), delivery: redirect("/driver"),
    },
  },
  {
    route: "/help",
    expected: {
      owner: redirect("/dashboard"), cam: redirect("/dashboard"),
      companyAdmin: redirect("/dashboard"), branchAdmin: redirect("/dashboard"),
      requester: redirect("/dashboard"), delivery: redirect("/driver"),
    },
  },
  {
    route: "/email-operations",
    expected: {
      owner: allow("/email-operations"), cam: notFound, companyAdmin: denied,
      branchAdmin: denied, requester: denied, delivery: denied,
    },
  },
  {
    route: "/audit",
    expected: {
      owner: redirect("/dashboard"), cam: redirect("/dashboard"),
      companyAdmin: redirect("/dashboard"), branchAdmin: redirect("/dashboard"),
      requester: redirect("/dashboard"), delivery: redirect("/driver"),
    },
  },
  {
    route: "/branches/organization",
    expected: {
      owner: redirect("/branches"), cam: redirect("/branches"),
      companyAdmin: redirect("/branches"), branchAdmin: redirect("/branches"),
      requester: redirect("/branches"), delivery: denied,
    },
  },
  {
    route: "/company-wallet",
    expected: {
      owner: notFound, cam: notFound, companyAdmin: notFound,
      branchAdmin: notFound, requester: notFound, delivery: notFound,
    },
  },
  {
    route: "/company/users",
    expected: {
      owner: notFound, cam: notFound, companyAdmin: notFound,
      branchAdmin: notFound, requester: notFound, delivery: notFound,
    },
  },
];

async function assertRoute(page: Page, route: string, outcome: Outcome) {
  const serverFailures: string[] = [];
  const pageErrors: string[] = [];
  const onResponse = (response: Response) => {
    if (response.status() >= 500) serverFailures.push(`${response.status()} ${response.url()}`);
  };
  const onPageError = (error: Error) => pageErrors.push(error.message);
  page.on("response", onResponse);
  page.on("pageerror", onPageError);

  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Something went wrong", { exact: true })).toHaveCount(0);
  await expect(page.getByText("This page could not be restored", { exact: true })).toHaveCount(0);

  if (outcome.kind === "NOT_FOUND") {
    await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
    expect([200, 404], `${route} should render the framework NOT_FOUND boundary`)
      .toContain(response?.status());
  } else {
    await expect(page.locator("#portal-main")).toBeVisible();
    await expect(page, `${route} should be ${outcome.kind}`).toHaveURL((url) => (
      url.pathname === outcome.path
    ));
    expect(response?.status(), `${route} should not fail`).toBeLessThan(400);
  }
  expect(serverFailures, `${route} emitted HTTP 5xx`).toEqual([]);
  expect(pageErrors, `${route} emitted a browser page error`).toEqual([]);

  page.off("response", onResponse);
  page.off("pageerror", onPageError);
}

for (const [role, principal] of Object.entries(roles) as Array<[Role, DemoRoleSession]>) {
  test(`${role} follows the final material route contract`, async ({ page }) => {
    await signInAsDemoRole(page, principal);
    for (const entry of routes) {
      await test.step(`${entry.route} -> ${entry.expected[role].kind}`, async () => {
        await assertRoute(page, entry.route, entry.expected[role]);
      });
    }
  });
}
