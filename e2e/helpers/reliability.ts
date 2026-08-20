import { expect, type Page } from "@playwright/test";

function safePath(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return "<invalid-url>";
  }
}

/**
 * Fails a critical browser journey when the page reaches Axora's unexpected
 * recovery boundary, emits an unexpected browser exception/console error, or
 * receives an unexpected HTTP 5xx. No query strings or payloads are retained
 * in failure evidence.
 */
export function installReliabilityGuard(
  page: Page,
  options: { ignoreConsoleError?: (message: string) => boolean } = {},
) {
  const failures: string[] = [];

  page.on("pageerror", (error) => {
    failures.push(`pageerror:${error.name}`);
  });

  page.on("console", (message) => {
    if (message.type() === "error") {
      const text = message.text();
      if (!options.ignoreConsoleError?.(text)) {
        failures.push(`console.error:${text.slice(0, 240)}`);
      }
    }
  });

  page.on("response", (response) => {
    if (response.status() >= 500) {
      failures.push(`http:${response.status()}:${safePath(response.url())}`);
    }
  });

  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText;
    if (!reason || reason.includes("ERR_ABORTED")) return;
    failures.push(`requestfailed:${reason}:${safePath(request.url())}`);
  });

  return {
    async assertHealthy() {
      await expect(page.getByTestId("portal-error-boundary")).toHaveCount(0);
      expect(failures, "unexpected browser/runtime failures").toEqual([]);
    },
  };
}
