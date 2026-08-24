import { expect, test } from "@playwright/test";
import { signInAsDemoRole } from "./helpers/auth";
import { installReliabilityGuard } from "./helpers/reliability";

const companyId = "11111111-1111-4111-8111-111111111111";
const isNextDevelopmentStyleNoise = (message: string) => (
  process.env.AXORA_PLAYWRIGHT_STANDALONE !== "true"
  && message.startsWith("Applying inline style violates")
  && message.includes("style-src-elem")
);
const localeCases = [
  {
    locale: "en" as const,
    message: "Verification required before activation.",
    approve: "Approve verification",
    direction: "ltr",
  },
  {
    locale: "ar" as const,
    message: "يلزم التحقق قبل تفعيل الشركة.",
    approve: "اعتماد التحقق",
    direction: "rtl",
  },
  {
    locale: "ms" as const,
    message: "Pengesahan diperlukan sebelum pengaktifan.",
    approve: "Luluskan pengesahan",
    direction: "ltr",
  },
] as const;

function actorId(projectName: string, index: number) {
  const project = projectName === "mobile-chrome" ? 2 : 1;
  return `d1200000-0000-4000-8${project}${index}0-00000000000${index}`;
}

for (const [index, localeCase] of localeCases.entries()) {
  test(`${localeCase.locale} DRAFT company presents verification as the activation blocker`, async ({
    page,
  }, testInfo) => {
    const reliability = installReliabilityGuard(page, {
      ignoreConsoleError: isNextDevelopmentStyleNoise,
    });
    await page.emulateMedia({
      colorScheme: testInfo.project.name === "mobile-chrome" ? "dark" : "light",
    });
    await signInAsDemoRole(page, {
      id: actorId(testInfo.project.name, index + 1),
      email: `activation-${localeCase.locale}-${testInfo.project.name}@axora.invalid`,
      name: "Activation Owner Fixture",
      role: "PLATFORM_OWNER",
      accountKind: "PLATFORM",
      scopeType: "PLATFORM",
      isOwner: true,
      preferredLocale: localeCase.locale,
    });
    await page.goto(`/companies/${companyId}`);

    const main = page.getByRole("main");
    await expect(page.locator("html")).toHaveAttribute("dir", localeCase.direction);
    await expect(main.getByText(localeCase.message, { exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: localeCase.approve, exact: true })).toBeVisible();
    await expect(main.getByRole("button", {
      name: localeCase.locale === "ar"
        ? "تفعيل الشركة"
        : localeCase.locale === "ms"
          ? "Aktifkan syarikat"
          : "Activate company",
      exact: true,
    })).toBeDisabled();
    await expect(main.getByText(/SQLSTATE|companies_active_requires_verification/)).toHaveCount(0);
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(2);
    await reliability.assertHealthy();
  });
}

test("verified company activates on the first click and remains active through history navigation", async ({
  page,
}, testInfo) => {
  const reliability = installReliabilityGuard(page, {
    ignoreConsoleError: isNextDevelopmentStyleNoise,
  });
  const mutationRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.includes("companies")) {
      mutationRequests.push(new URL(request.url()).pathname);
    }
  });
  await page.emulateMedia({
    colorScheme: testInfo.project.name === "mobile-chrome" ? "dark" : "light",
  });
  await signInAsDemoRole(page, {
    id: testInfo.project.name === "mobile-chrome"
      ? "e1200000-0000-4000-8200-000000000002"
      : "e1200000-0000-4000-8100-000000000001",
    email: `activation-flow-${testInfo.project.name}@axora.invalid`,
    name: "Activation Flow Owner",
    role: "PLATFORM_OWNER",
    accountKind: "PLATFORM",
    scopeType: "PLATFORM",
    isOwner: true,
    preferredLocale: "en",
  });
  await page.goto(`/companies/${companyId}`);

  await page.getByRole("button", { name: "Approve verification", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(
    `/companies/${companyId}\\?notice=company-verification-approved$`,
  ));
  await expect(page.getByText(
    "Company verification approved. Activation requirements were refreshed.",
    { exact: true },
  )).toBeVisible();
  await expect(page.getByText("Company verification is approved.", { exact: true })).toBeVisible();
  const activation = page.getByRole("button", { name: "Activate company", exact: true });
  await expect(activation).toBeEnabled();

  const beforeActivation = mutationRequests.length;
  await activation.click();
  await expect(page).toHaveURL(new RegExp(
    `/companies/${companyId}\\?notice=company-activated$`,
  ));
  expect(mutationRequests).toHaveLength(beforeActivation + 1);
  await expect(page.getByText(
    "Company activated successfully. Portal access is now enabled.",
    { exact: true },
  )).toBeVisible();
  await expect(page.locator(".status-badge", { hasText: "Active" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate company", exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".status-badge", { hasText: "Active" })).toBeVisible();
  const afterRefresh = mutationRequests.length;
  await page.goBack();
  await page.goForward();
  await expect(page.locator(".status-badge", { hasText: "Active" })).toBeVisible();
  expect(mutationRequests).toHaveLength(afterRefresh);
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(2);
  await reliability.assertHealthy();
});
