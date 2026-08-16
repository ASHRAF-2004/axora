import { expect, test } from "@playwright/test";

test("simple login preserves safe form values while controls change", async ({ page }) => {
  await page.goto("/login");

  const email = page.getByLabel("Email");
  const password = page.getByLabel("Password", { exact: true });
  await expect(page.locator(".login-guide")).toHaveCount(0);
  await email.fill("person@example.com");
  await password.fill("a-private-value");

  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(email).toHaveValue("person@example.com");
  await expect(password).toHaveValue("a-private-value");

  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveValue("a-private-value");
});
