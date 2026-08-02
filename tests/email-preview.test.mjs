import { describe, expect, it, vi } from "vitest";
import { previewInternals, sendPreview } from "../scripts/email/preview.mjs";

describe("local captured email preview", () => {
  it("accepts only reviewed templates and locales", () => {
    expect(previewInternals.parseArguments(["--template", "password-reset", "--locale", "ar"]))
      .toEqual({ template: "password-reset", locale: "ar" });
    expect(() => previewInternals.parseArguments(["--template", "raw-html"]))
      .toThrow(/Template must be/);
    expect(() => previewInternals.parseArguments(["--locale", "fr"]))
      .toThrow(/Locale must be/);
  });

  it("uses only a fixed loopback Mailpit endpoint", () => {
    expect(previewInternals.previewEndpoint({ MAILPIT_PREVIEW_PORT: "18025" }).toString())
      .toBe("http://127.0.0.1:18025/api/v1/send");
    expect(() => previewInternals.previewEndpoint({ MAILPIT_PREVIEW_PORT: "443/path" }))
      .toThrow(/invalid/);
    expect(() => previewInternals.previewEndpoint({ MAILPIT_PREVIEW_PORT: "0" }))
      .toThrow(/invalid/);
    expect(() => previewInternals.previewEndpoint({ MAILPIT_PREVIEW_PORT: "65536" }))
      .toThrow(/invalid/);
  });

  it("captures a safe rendered invitation without provider credentials", async () => {
    const fetchImpl = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      expect(body.From.Email).toBe("noreply@axora.management");
      expect(body.To).toEqual([{ Email: "preview@axora.test", Name: "Axora Preview User" }]);
      expect(body.Subject).toMatch(/^\[Preview\]/);
      expect(body.HTML).not.toMatch(/{{[A-Z0-9_]+}}/);
      expect(body.HTML).toContain("cid:axora-logo");
      expect(body.Attachments).toHaveLength(2);
      return new Response("{}", { status: 200 });
    });
    await expect(sendPreview(
      { template: "account-setup", locale: "ms" },
      { fetchImpl, env: { NODE_ENV: "test", MAILPIT_PREVIEW_PORT: "8025" } },
    )).resolves.toEqual({ template: "account-setup", locale: "ms" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("refuses to preview in production", async () => {
    await expect(sendPreview(
      { template: "account-setup", locale: "en" },
      { env: { NODE_ENV: "production" } },
    )).rejects.toThrow(/disabled in production/);
  });

  it.each([
    ["contact-notification", "New Axora website enquiry"],
    ["workflow-update", "Axora workflow update"],
  ])("renders a fixed local %s sample", async (template, expectedSubject) => {
    const rendered = await previewInternals.renderPreview({ template, locale: "en" });
    expect(rendered.rendered.subject).toBe(expectedSubject);
    expect(rendered.rendered.html).not.toMatch(/{{[A-Z0-9_]+}}/);
    expect(rendered.attachments).toHaveLength(1);
  });
});
