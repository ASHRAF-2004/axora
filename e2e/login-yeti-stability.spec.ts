import { expect, test } from "@playwright/test";

test("Yeti animation nodes remain stable while typing email and password", async ({
  page,
}) => {
  await page.goto("/login");

  const guide = page.locator(".login-guide");
  const email = page.getByLabel("Email");
  const password = page.getByLabel("Password", { exact: true });
  const eye = guide.locator(".eyeL");
  const leftArm = guide.locator(".armL");
  const mouth = guide.locator(".mouthBG");

  await expect(guide.locator("svg")).toBeVisible();
  await email.focus();
  await expect(guide).toHaveAttribute("data-state", "email");

  const originalEyeNode = await eye.elementHandle();
  expect(originalEyeNode).not.toBeNull();

  await email.type("a");

  expect(
    await page.evaluate(
      (node) => document.querySelector(".login-guide .eyeL") === node,
      originalEyeNode,
    ),
  ).toBe(true);
  await expect.poll(() => eye.evaluate((node) => node.style.transform)).not.toBe("");

  await email.type("shraf@example.com", { delay: 8 });

  expect(
    await page.evaluate(
      (node) => document.querySelector(".login-guide .eyeL") === node,
      originalEyeNode,
    ),
  ).toBe(true);

  const openMouthPath = await mouth.getAttribute("d");
  expect(openMouthPath).toContain("M100 110.2");

  await password.focus();
  await expect(guide).toHaveAttribute("data-state", "private");
  await expect.poll(() => leftArm.evaluate((node) => node.style.visibility)).toBe(
    "visible",
  );

  const coveredArmNode = await leftArm.elementHandle();
  expect(coveredArmNode).not.toBeNull();

  await password.type("x");

  expect(
    await page.evaluate(
      (node) => document.querySelector(".login-guide .armL") === node,
      coveredArmNode,
    ),
  ).toBe(true);
  await expect(guide).toHaveAttribute("data-state", "private");
  await expect.poll(() => leftArm.evaluate((node) => node.style.visibility)).toBe(
    "visible",
  );
  await expect
    .poll(() => leftArm.evaluate((node) => node.style.transform))
    .toContain("translate(-93px, 10px)");
  await expect(mouth).toHaveAttribute("d", openMouthPath ?? "");

  await email.focus();
  await email.type("z");

  await expect(guide).toHaveAttribute("data-state", "email");
  expect(
    await page.evaluate(
      (node) => document.querySelector(".login-guide .eyeL") === node,
      originalEyeNode,
    ),
  ).toBe(true);
  await expect
    .poll(() => eye.evaluate((node) => node.style.transform))
    .not.toBe("translate(0px, 0px) scale(0.65)");
  await expect
    .poll(() => leftArm.evaluate((node) => node.style.visibility), {
      timeout: 2500,
    })
    .toBe("hidden");
});
