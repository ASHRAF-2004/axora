import { expect, test } from "@playwright/test";
import { openDemoInteractionEditor } from "./helpers/auth";

test.describe("owner interaction editor", () => {
  test("shows the AI recommendation, rationale, evidence, and owner decision actions", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Editor content is covered once in desktop Chromium.");

    await openDemoInteractionEditor(page);
    const editor = page.getByTestId("interaction-editor");

    await expect(editor.getByText("AI design recommendation")).toBeVisible();
    await expect(editor.getByRole("heading", { name: "Axora Buddy" })).toBeVisible();
    await expect(editor.getByText(/Axora selected a friendly learning guide/i)).toBeVisible();
    await expect(editor.getByLabel("Recommendation evidence")).toContainText("Tone fit");
    await expect(editor.getByLabel("Recommendation evidence")).toContainText("Accessibility");
    await expect(editor.getByLabel("Recommendation evidence")).toContainText("Performance");
    await expect(editor.getByText("Commercial use approved")).toBeVisible();

    for (const action of [
      "Accept recommendation",
      "Try another concept",
      "Reduce motion",
      "Disable",
      "Reset to AI recommendation",
    ]) {
      await expect(editor.getByRole("button", { name: action })).toBeVisible();
    }
  });

  test("previews every supported device and operating condition", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Preview modes are covered once in desktop Chromium.");

    await openDemoInteractionEditor(page);
    const preview = page.getByTestId("interaction-preview");
    const cases = [
      { name: "Preview desktop", mode: "desktop", viewport: "desktop" },
      { name: "Preview tablet", mode: "tablet", viewport: "tablet" },
      { name: "Preview mobile", mode: "mobile", viewport: "mobile" },
      { name: "Preview reduced motion", mode: "reduced-motion", viewport: "desktop" },
      { name: "Preview low performance", mode: "low-performance", viewport: "desktop" },
    ];

    for (const condition of cases) {
      const button = page.getByRole("button", { name: condition.name });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(preview).toHaveAttribute("data-mode", condition.mode);
      await expect(preview).toHaveAttribute("data-viewport", condition.viewport);
    }
  });

  test("keeps bounded owner settings while switching previews and supports local save and undo", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Owner editing is covered once in desktop Chromium.");

    await openDemoInteractionEditor(page);
    const editor = page.getByTestId("interaction-editor");
    const size = page.getByRole("slider", { name: "Interaction size" });
    const speed = page.getByRole("slider", { name: "Walking speed" });

    await page.getByLabel("Approved asset").selectOption("axora-buddy-v1");
    await size.fill("1.25");
    await page.getByLabel("Color treatment").selectOption("high-contrast");
    await page.getByLabel("Animation intensity").selectOption("lively");
    await page.getByLabel("Automatic movement").check();
    await page.getByLabel("Allow visitor drag").check();
    await speed.fill("88");
    await page.getByLabel("Starting location").selectOption("hero-left");
    await page.getByLabel("Permitted movement region").selectOption("hero");

    await page.getByRole("button", { name: "Preview tablet" }).click();
    await page.getByRole("button", { name: "Preview mobile" }).click();
    await expect(size).toHaveValue("1.25");
    await expect(speed).toHaveValue("88");
    await expect(page.getByLabel("Color treatment")).toHaveValue("high-contrast");
    await expect(page.getByLabel("Starting location")).toHaveValue("hero-left");

    const localSave = editor.getByRole("button", { name: /Keep local preview|Save draft/ });
    await localSave.click();
    await expect(editor.getByRole("status")).toContainText(/Local preview updated|Owner override saved/);

    await size.fill("0.75");
    await expect(editor.getByRole("button", { name: "Undo changes" })).toBeEnabled();
    await editor.getByRole("button", { name: "Undo changes" }).click();
    await expect(size).toHaveValue("1.25");

    await expect(size).toHaveAttribute("min", "0.5");
    await expect(size).toHaveAttribute("max", "1.5");
    await expect(speed).toHaveAttribute("min", "8");
    await expect(speed).toHaveAttribute("max", "120");
  });

  test("preserves compatible customization when trying another approved concept", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Concept replacement is covered once in desktop Chromium.");

    await openDemoInteractionEditor(page);
    const asset = page.getByLabel("Approved asset");
    const size = page.getByRole("slider", { name: "Interaction size" });
    const color = page.getByLabel("Color treatment");
    const originalAsset = await asset.inputValue();

    await size.fill("1.2");
    await color.selectOption("monochrome");
    await page.getByRole("button", { name: "Try another concept" }).click();

    await expect(asset).not.toHaveValue(originalAsset);
    await expect(size).toHaveValue("1.2");
    await expect(color).toHaveValue("monochrome");

    await page.getByRole("button", { name: "Accept recommendation" }).click();
    await expect(asset).toHaveValue(originalAsset);
  });

  test("can reduce motion, disable the runtime, and reset to the AI recommendation", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Owner decision controls are covered once in desktop Chromium.");

    await openDemoInteractionEditor(page);
    const editor = page.getByTestId("interaction-editor");
    const renderer = page.getByTestId("trusted-interaction");

    await editor.getByRole("button", { name: "Reduce motion" }).click();
    await expect(page.getByLabel("Animation intensity")).toHaveValue("subtle");
    await expect(page.getByLabel("Automatic movement")).not.toBeChecked();
    await expect(page.getByLabel("Desktop behavior")).toHaveValue("reduced");
    await expect(page.getByLabel("Mobile behavior")).toHaveValue("static");
    await expect(page.getByLabel("Performance tier")).toHaveValue("balanced");
    await expect(page.getByTestId("interaction-preview")).toHaveAttribute("data-mode", "reduced-motion");

    await editor.getByRole("button", { name: "Disable" }).click();
    await expect(page.getByLabel("Enable interactive experience")).not.toBeChecked();
    await expect(editor.getByText("No runtime will load.")).toBeVisible();
    await expect(renderer).toHaveAttribute("data-state", "hidden");
    await expect(renderer).toHaveAttribute("data-fallback", "disabled");

    await editor.getByRole("button", { name: "Reset to AI recommendation" }).click();
    await expect(page.getByLabel("Enable interactive experience")).toBeChecked();
    await expect(page.getByLabel("Approved asset")).toHaveValue("axora-buddy-v1");
    await expect(editor.getByRole("status")).toContainText(/Reset to the original AI recommendation|AI recommendation is active again/);
  });

  test("rejects an invalid informative configuration and recovers with an accessible description", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Validation behavior is covered once in desktop Chromium.");

    await openDemoInteractionEditor(page);
    const renderer = page.getByTestId("trusted-interaction");
    const publish = page.getByRole("button", { name: "Publish interaction" });

    await page.getByLabel("Semantic role").selectOption("informative");
    const description = page.getByLabel("Accessible description");
    await description.fill("");
    await expect(renderer).toHaveAttribute("data-state", "error-fallback");
    await expect(renderer).toHaveAttribute("data-fallback", "invalid-config");
    await expect(page.getByText("Publishing check failed").first()).toBeVisible();
    await expect(publish).toBeDisabled();

    await description.fill("A friendly guide that decorates the company introduction.");
    await expect(renderer).not.toHaveAttribute("data-fallback", "invalid-config");
    await expect(renderer.getByRole("img", { name: "A friendly guide that decorates the company introduction." })).toBeVisible();
  });
});
