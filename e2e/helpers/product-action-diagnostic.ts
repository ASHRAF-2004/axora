import type { CDPSession, Page, TestInfo } from "@playwright/test";

type RequestDiagnostic = {
  requestId: string;
  route: string;
  method: string;
  action: boolean;
  initiator: string;
  started: number;
  wallTime: number;
  response?: number;
  status?: number;
  mimeType?: string;
  revalidated?: boolean;
  receivedBytes: number;
  finished?: number;
  failed?: number;
  failure?: string;
};

/** Failure-only public-demo evidence; never retain headers, bodies or storage. */
export async function productActionDiagnostic(page: Page) {
  let client: CDPSession | undefined;
  try {
    client = await page.context().newCDPSession(page);
    return await observeProductActions(page, client);
  } catch {
    await client?.detach().catch(() => undefined);
    // Optional observation must never prevent the original journey from running.
    return async (_testInfo: TestInfo, failed: boolean) => {
      if (failed) console.log(JSON.stringify({ kind: "public-demo-product-action-completion", unavailable: true }));
    };
  }
}

async function observeProductActions(page: Page, client: CDPSession) {
  const requests = new Map<string, RequestDiagnostic>();
  const views: { at: number; route: string; articles: number; files: number; uploaded: number }[] = [];
  const origin = "http://127.0.0.1:3100";
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const productRoute = new RegExp(`^/(?:products(?:/new|/${uuid}(?:/edit)?)?|api/products/${uuid}/images/${uuid})$`, "i");
  const editRoute = new RegExp(`^/products/${uuid}/edit$`, "i");
  const routeFor = (url: string) => {
    const parsed = new URL(url);
    return parsed.origin === origin && productRoute.test(parsed.pathname)
      ? parsed.pathname : undefined;
  };
  client.on("Network.requestWillBeSent", (event) => {
    const route = routeFor(event.request.url);
    if (!route || requests.size >= 64) return;
    requests.set(event.requestId, {
      requestId: event.requestId, route, method: event.request.method,
      action: Object.keys(event.request.headers).some((name) => name.toLowerCase() === "next-action"),
      initiator: event.initiator.type,
      started: event.timestamp, wallTime: event.wallTime, receivedBytes: 0,
    });
  });
  client.on("Network.responseReceived", (event) => {
    const request = requests.get(event.requestId);
    if (!request) return;
    request.response = event.timestamp;
    request.status = event.response.status;
    request.mimeType = event.response.mimeType;
    request.revalidated = Object.keys(event.response.headers)
      .some((name) => name.toLowerCase() === "x-action-revalidated");
  });
  client.on("Network.dataReceived", (event) => {
    const request = requests.get(event.requestId);
    if (request) request.receivedBytes += event.dataLength;
  });
  client.on("Network.loadingFinished", (event) => {
    const request = requests.get(event.requestId);
    if (request) request.finished = event.timestamp;
  });
  client.on("Network.loadingFailed", (event) => {
    const request = requests.get(event.requestId);
    if (request) {
      request.failed = event.timestamp;
      request.failure = /^net::ERR_[A-Z_]+$/.test(event.errorText) ? event.errorText : "other-network-failure";
    }
  });
  await client.send("Network.enable");
  await page.exposeFunction("__axoraProductDiagnostic", (value: unknown) => {
    if (views.length >= 64 || !value || typeof value !== "object") return;
    const { at, route, articles, files, uploaded } = value as Record<string, unknown>;
    if (typeof route !== "string" || !editRoute.test(route)
      || typeof at !== "number" || !Number.isFinite(at) || at < 0
      || ![articles, files, uploaded].every((count) => typeof count === "number"
        && Number.isSafeInteger(count) && count >= 0 && count <= 64)) return;
    views.push({ at, route, articles: articles as number, files: files as number, uploaded: uploaded as number });
  });
  await page.addInitScript(() => {
    let previous = "";
    const record = () => {
      if (!/^\/products\/[0-9a-f-]+\/edit$/i.test(location.pathname)) return;
      const gallery = [...document.querySelectorAll("section.panel")]
        .find((section) => section.querySelector("h2")?.textContent === "Manage gallery");
      const images = document.querySelector<HTMLInputElement>('input[name="images"]');
      const upload = images?.closest("form");
      const state = {
        route: location.pathname,
        articles: gallery?.querySelectorAll("article").length ?? 0,
        files: images?.files?.length ?? 0,
        uploaded: Number(upload?.querySelector(".panel-header p")?.textContent?.match(/^\d+/)?.[0] ?? 0),
      };
      const key = JSON.stringify(state);
      if (key === previous) return;
      previous = key;
      void (window as unknown as {
        __axoraProductDiagnostic: (value: typeof state & { at: number }) => Promise<void>;
      }).__axoraProductDiagnostic({ ...state, at: performance.timeOrigin + performance.now() }).catch(() => undefined);
    };
    new MutationObserver(record).observe(document, { childList: true, subtree: true });
    document.addEventListener("change", record, true);
  });
  return async (testInfo: TestInfo, failed: boolean) => {
    try {
      if (failed) {
        const evidence = { kind: "public-demo-product-action-completion", requests: [...requests.values()], views };
        await testInfo.attach("product-action-completion", {
          body: Buffer.from(JSON.stringify(evidence)), contentType: "application/json",
        });
        // CI can pass after its existing retry; retain first-failure facts in logs.
        console.log(JSON.stringify(evidence));
      }
    } catch {
      console.log(JSON.stringify({ kind: "public-demo-product-action-completion", unavailable: true }));
    } finally {
      // Diagnostics/page closure must not replace the original assertion failure.
      await client.detach().catch(() => undefined);
    }
  };
}
