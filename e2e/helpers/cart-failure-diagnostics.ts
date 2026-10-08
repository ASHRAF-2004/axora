// Temporary failure-only public-demo diagnostic; no mutation or command replay.
import type { Page, TestInfo } from "@playwright/test";

function cartFiberSnapshot() {
  const element = document.querySelector(".cart-review");
  const safeDocument = {
    hidden: document.hidden, visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(), online: navigator.onLine,
    financialAuthorityPresent: Boolean(document.querySelector(".cart-financial-authority")),
    dialogOpen: Boolean(document.querySelector("dialog[open]")),
  };
  if (!element) return { found: false, ...safeDocument };
  const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
  type Fiber = { tag?: number; return?: Fiber | null; child?: Fiber | null; sibling?: Fiber | null; alternate?: Fiber | null; stateNode?: { current?: Fiber }; memoizedProps?: Record<string, unknown>; memoizedState?: Hook | null };
  type Hook = { memoizedState?: unknown; next?: Hook | null };
  const attached = key ? (element as unknown as Record<string, Fiber>)[key] : undefined;
  const findHostRoot = (start?: Fiber | null) => {
    let node = start;
    const visited = new Set<Fiber>();
    for (let hops = 0; node && hops < 256; hops += 1) {
      if (visited.has(node)) return undefined;
      visited.add(node);
      if (node.tag === 3) return node;
      node = node.return;
    }
    return undefined;
  };
  const attachedRoot = findHostRoot(attached);
  const currentRoot = attachedRoot?.stateNode?.current;
  let owner: Fiber | undefined;
  for (let node = attached, hops = 0; node && hops < 60; node = node.return ?? undefined, hops += 1) {
    const props = node.memoizedProps;
    if (props && Object.hasOwn(props, "initialCart") && Object.hasOwn(props, "purchaseRecoveryScope")) {
      owner = node; break;
    }
  }
  if (!owner || !currentRoot || currentRoot.tag !== 3) return { found: false, ...safeDocument };
  // React19 alternates can share .return links. Parent-chain equality alone
  // does not establish which owner is actually in the committed tree.
  const alternateOwner = owner.alternate;
  const pending: Fiber[] = currentRoot.child ? [currentRoot.child] : [];
  const visited = new Set<Fiber>();
  const matches: Fiber[] = [];
  while (pending.length) {
    if (visited.size >= 10_000) return { found: false, fiberCurrentResolved: false, resolverBoundExceeded: true, ...safeDocument };
    const node = pending.pop()!;
    if (visited.has(node)) return { found: false, fiberCurrentResolved: false, resolverRepeatedNode: true, ...safeDocument };
    visited.add(node);
    if (node === owner || node === alternateOwner) matches.push(node);
    if (node.sibling) pending.push(node.sibling);
    if (node.child) pending.push(node.child);
  }
  if (matches.length !== 1) return { found: false, fiberCurrentResolved: false, resolverAmbiguous: matches.length > 1, ...safeDocument };
  owner = matches[0];
  const props = owner.memoizedProps ?? {};
  const states: unknown[] = [];
  for (let hook = owner.memoizedState, count = 0; hook && count < 17; hook = hook.next, count += 1) states.push(hook.memoizedState);
  type Cart = { id?: unknown; version?: unknown; items?: { publicRef?: unknown; quantity?: unknown }[] };
  type Workspace = { cartId?: unknown; cartVersion?: unknown };
  const initial = props.initialCart as Cart | undefined;
  const workspace = props.directPurchase as Workspace | undefined;
  const local = states[0] as Cart | undefined;
  const drafts = states[1] as Record<string, unknown> | undefined;
  const errors = states[2] as Record<string, unknown> | undefined;
  const confirmation = states[11] as { expectedCartVersion?: unknown } | undefined;
  const version = (value: unknown) => Number.isSafeInteger(value) ? Number(value) : null;
  const hookShapeValid = Array.isArray(local?.items) && typeof drafts === "object" && drafts !== null
    && typeof errors === "object" && errors !== null
    && [6, 7, 8, 9].every((index) => typeof states[index] === "boolean");
  const identityEqual = typeof local?.id === "string" && local.id === workspace?.cartId;
  const button = [...element.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.trim() === "Place order");
  return {
    found: true, fiberCurrentResolved: true, hookShapeValid,
    propsInitialCartVersion: version(initial?.version), propsWorkspaceVersion: version(workspace?.cartVersion),
    localCartVersion: version(local?.version), initialIdentityEqual: local?.id === initial?.id,
    workspaceIdentityEqual: identityEqual,
    workspaceMatchesLocalCart: identityEqual && workspace?.cartVersion === local?.version,
    confirmationExpectedCartVersion: version(confirmation?.expectedCartVersion),
    buttonDisabled: button ? button.disabled : null,
    busyIsNull: states[3] === null, purchaseBusy: states[7] === true,
    unknownOutcome: states[8] === true, recoveryReady: states[9] === true,
    pendingPurchasePresent: states[10] !== undefined, confirmationPresent: states[11] !== undefined,
    draftMatchesLocalCart: hookShapeValid ? local!.items!.every((item) => (
      typeof item.publicRef === "string" && String(drafts![item.publicRef] ?? item.quantity) === String(item.quantity)
    )) : null,
    errorsPresent: hookShapeValid ? Object.values(errors!).some(Boolean) : null,
    quantityTwo: element.querySelector<HTMLInputElement>('input[type="number"]')?.value === "2",
    checkoutDirect: props.checkoutMode === "DIRECT", ...safeDocument,
  };
}

export async function captureCompanyAdminCartFailure(page: Page, testInfo: TestInfo) {
  if (process.env.AXORA_E2E_CART_FAILURE_DIAGNOSTICS
    !== "b7c1c8a00184d4fa047fc7d3322f7299ab378eae:full-combined:failure-only:01"
    || process.env.AXORA_PLAYWRIGHT_STANDALONE !== "true"
    || testInfo.retry !== 0
    || testInfo.project.name !== "mobile-chrome"
    || testInfo.title !== "Company Administrator places one order and reconciles a lost success response"
    || (testInfo.status !== "failed" && testInfo.status !== "timedOut")
    || testInfo.project.use.baseURL !== "http://127.0.0.1:3100") return;

  // Resolve only the already-open test page. Never navigate, focus, retry a
  // read/action, inspect storage/auth/body data, or invoke application functions.
  let attachment: Record<string, unknown> = {
    event: "cart_failure_current_state", outcome: "snapshot_unavailable",
  };
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!page.isClosed()) {
      const url = new URL(page.url());
      if (url.origin !== "http://127.0.0.1:3100" || url.pathname !== "/cart") return;
      const snapshot = await Promise.race([
        page.evaluate(cartFiberSnapshot),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error("cart_snapshot_read_deadline")), 2_000);
        }),
      ]);
      attachment = { event: "cart_failure_current_state", outcome: "captured", snapshot };
    }
  } catch {
    // Diagnosis must never replace the original test failure or expose errors.
  } finally {
    if (deadline) clearTimeout(deadline);
  }
  try {
    await testInfo.attach("cart-failure-current-state", {
      body: Buffer.from(JSON.stringify(attachment)), contentType: "application/json",
    });
  } catch {
    // Preserve the original failed assertion even if artifact writing fails.
  }
}
