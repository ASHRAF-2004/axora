import { describe, expect, it } from "vitest";
import { renderTransactionalEmail } from "../server-tools/transactional-email.mjs";

const deliveryId = "00000000-0000-4000-8000-000000000031";

describe("localized workflow email renderer", () => {
  it.each([
    ["en", "Axora workflow update", "There is an update in Axora"],
    ["ar", "تحديث إجراء في Axora", "يوجد تحديث في Axora"],
    ["ms", "Kemas kini aliran kerja Axora", "Terdapat kemas kini dalam Axora"],
  ])("uses a fixed non-sensitive %s subject and safe local action", async (
    locale,
    subject,
    heading,
  ) => {
    const rendered = await renderTransactionalEmail({
      deliveryId,
      messageKind: "WORKFLOW_UPDATE",
      locale,
      recipientEmail: "person@example.test",
      recipientName: "Aisha Rahman",
      workflow: {
        title: "Request PR-204 was approved",
        body: "The request has moved to Axora buying preparation.",
        actionPath: "/requests/00000000-0000-4000-8000-000000000032",
      },
    }, { appBaseUrl: "https://axora.management" });

    expect(rendered.subject).toBe(subject);
    expect(rendered.subject).not.toContain("PR-204");
    expect(rendered.html).toContain(heading);
    expect(rendered.html).toContain(
      "https://axora.management/requests/00000000-0000-4000-8000-000000000032",
    );
    expect(rendered.text).toContain("The request has moved to Axora buying preparation.");
    expect(rendered.html).toContain('src="cid:axora-logo"');
    expect(rendered.templateKey).toBe("workflow-update");
  });

  it("escapes workflow content and rejects off-origin or fragment-like paths", async () => {
    const rendered = await renderTransactionalEmail({
      deliveryId,
      messageKind: "WORKFLOW_UPDATE",
      locale: "en",
      recipientEmail: "person@example.test",
      recipientName: "Aisha Rahman",
      workflow: {
        title: "Request <script>alert(1)</script>",
        body: "First line\n<img src=x onerror=alert(1)>",
        actionPath: "/notifications",
      },
    });
    expect(rendered.html).toContain("Request &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(rendered.html).toContain("First line<br>&lt;img src=x onerror=alert(1)&gt;");
    expect(rendered.html).not.toContain("<script>");

    for (const actionPath of [
      "https://attacker.example/request",
      "//attacker.example/request",
      "/requests/one#leak",
    ]) {
      await expect(renderTransactionalEmail({
        deliveryId,
        messageKind: "WORKFLOW_UPDATE",
        locale: "en",
        recipientEmail: "person@example.test",
        recipientName: "Aisha Rahman",
        workflow: {
          title: "Request updated",
          body: "Open Axora to review the change.",
          actionPath,
        },
      })).rejects.toThrow(/action path/i);
    }
  });

  it("falls back to the authenticated notification inbox", async () => {
    const rendered = await renderTransactionalEmail({
      deliveryId,
      messageKind: "WORKFLOW_UPDATE",
      locale: "en",
      recipientEmail: "person@example.test",
      recipientName: "Aisha Rahman",
      workflow: {
        title: "Request updated",
        body: "Open Axora to review the change.",
      },
    });
    expect(rendered.html).toContain("https://axora.management/notifications");
  });
});
