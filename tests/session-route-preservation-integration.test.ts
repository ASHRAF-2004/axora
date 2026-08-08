import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFile(
  new URL(`../${path}`, import.meta.url),
  "utf8",
);

describe("P0-03 route and session integration", () => {
  it("derives the return route from the parsed proxy URL", async () => {
    const proxy = await source("src/proxy.ts");
    expect(proxy).toContain('const SESSION_RETURN_HEADER = "x-axora-return-to"');
    expect(proxy).toContain("request.nextUrl.pathname");
    expect(proxy).toContain("request.nextUrl.search");
    expect(proxy).toContain("requestHeaders.set(SESSION_RETURN_HEADER, returnTo)");
    expect(proxy).not.toContain(
      'request.headers.get("x-axora-return-to")',
    );
  });

  it("redirects an absent or expired session with the exact protected route", async () => {
    const layout = await source("src/app/(portal)/layout.tsx");
    expect(layout).toContain("SESSION_RETURN_HEADER");
    expect(layout).toContain('cookieStore.get("axora_session")');
    expect(layout).toContain('hadSessionCookie ? "expired" : "required"');
    expect(layout).toContain('redirect(`/login?${params.toString()}`)');
    expect(layout).toContain("returnTo,");
  });

  it("validates and authorizes the post-login destination", async () => {
    const [page, action, form] = await Promise.all([
      source("src/app/login/page.tsx"),
      source("src/app/login/actions.ts"),
      source("src/components/LoginForm.tsx"),
    ]);
    expect(page).toContain("authorizedSessionReturnPath(");
    expect(page).toContain("params.returnTo");
    expect(action).toContain("safeInternalReturnPath(");
    expect(action).toContain("authorizedSessionReturnPath(");
    expect(action).toContain("requestedReturnTo");
    expect(form).toContain('name="returnTo"');
    expect(form).toContain("mergeStoredReturnHash(");
    expect(form).toContain('reason === "expired"');
  });

  it("rotates the base token before granting sensitive step-up authority", async () => {
    const action = await source("src/app/(portal)/account/actions.ts");
    const clear = action.indexOf("await clearSession();");
    const rotate = action.indexOf("await setSession(verified);");
    const elevate = action.indexOf("await setStepUpAfterPassword(verified, next);");
    expect(clear).toBeGreaterThan(0);
    expect(rotate).toBeGreaterThan(clear);
    expect(elevate).toBeGreaterThan(rotate);
  });

  it("preserves the original route through mandatory profile onboarding", async () => {
    const [page, action] = await Promise.all([
      source("src/app/(portal)/profile/page.tsx"),
      source("src/app/(portal)/profile/actions.ts"),
    ]);
    expect(page).toContain('name="returnTo"');
    expect(page).toContain("safeInternalReturnPath(");
    expect(action).toContain("authorizedSessionReturnPath(");
    expect(action).toContain('parsed.searchParams.set("tutorial", "1")');
  });

  it("namespaces browser drafts and clears them on logout or committed submission", async () => {
    const [cart, draft, shell, continuity, requestPage] = await Promise.all([
      source("src/lib/request-cart.ts"),
      source("src/lib/request-draft.ts"),
      source("src/components/app-shell/AppShell.tsx"),
      source("src/components/SessionContinuity.tsx"),
      source("src/app/(portal)/requests/new/page.tsx"),
    ]);
    expect(cart).toContain('const REQUEST_CART_STORAGE_PREFIX = "axora-request-cart:v2"');
    expect(cart).toContain("scopedBrowserStorageKey(");
    expect(draft).toContain('const REQUEST_DRAFT_PREFIX = "axora-request-draft:v1"');
    expect(shell).toContain("data-session-user-id={user.id}");
    expect(shell).toContain("clearBrowserSessionWorkspace(browserScope)");
    expect(continuity).toContain('searchParams.get("notice") !== "request-submitted"');
    expect(continuity).toContain("clearRequestCart();");
    expect(continuity).toContain("clearRequestDraft();");
    expect(requestPage).toContain("<RequestDraftBoundary");
  });

  it("uses a retry-safe submission key and a neutral session loading state", async () => {
    const [requestAction, writer, migration, loading] = await Promise.all([
      source("src/app/(portal)/requests/actions.ts"),
      source("src/lib/request-writer.ts"),
      source("database/migrations/050_request_submission_idempotency.sql"),
      source("src/app/(portal)/loading.tsx"),
    ]);
    expect(requestAction).toContain('readFormText(formData, "submissionKey")');
    expect(writer).toContain("client_submission_key");
    expect(writer).toContain("ON CONFLICT(created_by,client_submission_key)");
    expect(migration).toContain("requests_creator_submission_key_uq");
    expect(migration).toContain("Request submission identity is immutable");
    expect(loading).toContain("Checking your secure session");
    expect(loading).not.toContain("Signing you out");
  });
});
