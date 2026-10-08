import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), workspace: vi.fn(), slack: vi.fn(), zapier: vi.fn(), controls: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePagePermission: mocks.actor }));
vi.mock("@/lib/integrations/management", () => ({ getIntegrationWorkspace: mocks.workspace }));
vi.mock("@/lib/integrations/slack", () => ({ getSlackWorkspace: mocks.slack }));
vi.mock("@/lib/integrations/config", () => ({
  externalApiEnabled: () => true, integrationWebhooksEnabled: () => false,
  integrationFlagEnabled: mocks.zapier, INTEGRATION_FLAGS: { zapier: "AXORA_ZAPIER_ENABLED" },
  INTEGRATION_PROVIDER_APPLICATION_SLUGS: { zapier: "axora-zapier" },
}));
vi.mock("@/lib/integrations/webhooks", () => ({ getWebhookWorkspace: vi.fn() }));
vi.mock("@/app/(portal)/integrations/IntegrationForms", () => ({
  ApplicationControls: mocks.controls, ApplicationRegistrationForm: () => null, DisconnectControl: () => null,
}));
vi.mock("@/app/(portal)/integrations/SlackForms", () => ({
  ConnectSlackControl: () => null, SlackInstallationControls: () => null, SlackRetryControl: () => null,
}));
vi.mock("@/app/(portal)/integrations/WebhookForms", () => ({
  WebhookRetryControl: () => null, WebhookSubscriptionControls: () => null, WebhookSubscriptionForm: () => null,
}));

import IntegrationsPage from "@/app/(portal)/integrations/page";
import { integrationStatusMessages } from "@/lib/integrations/status-i18n";

const provider = { id: "provider-fixture", clientId: "public-registry-identifier", slug: "axora-slack", name: "Slack",
  description: "Provider adapter", status: "ACTIVE", clientType: "PUBLIC", authorizationMode: "PROVIDER_OAUTH",
  activeConnectionCount: 0, allowedScopes: ["webhooks:manage"], redirectUris: ["https://axora.management/api/integrations/slack/oauth/callback"] };

describe("integration status presentation", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.zapier.mockReturnValue(false);
    mocks.workspace.mockResolvedValue({ mode: "OWNER", applications: [provider], connections: [] });
    mocks.slack.mockResolvedValue({ mode: "OWNER", enabled: false, configured: false, installations: [], channels: [], deliveries: [] });
    mocks.controls.mockImplementation(() => createElement("button", null, "Generic OAuth control"));
  });

  it.each(["en", "ar", "ms"] as const)("distinguishes adapter availability from provider connection and Zapier enablement in %s", async (locale) => {
    mocks.actor.mockResolvedValue({ preferredLocale: locale, role: "OWNER" });
    const html = renderToStaticMarkup(await IntegrationsPage({ searchParams: Promise.resolve({}) }));
    const copy = integrationStatusMessages(locale);
    for (const key of ["providerOAuth", "adapterAvailable", "providerHelp", "capabilityHelp", "zapierDisabled"] as const) expect(html).toContain(copy[key]);
    expect(mocks.controls).not.toHaveBeenCalled();
    expect(html).not.toContain("Generic OAuth control");
    expect(html).not.toContain("webhooks:manage");
  });

  it.each([false, true])("labels enabled Zapier requires-setup versus available, without claiming connected (%s)", async (registered) => {
    mocks.actor.mockResolvedValue({ preferredLocale: "en", role: "OWNER" }); mocks.zapier.mockReturnValue(true);
    mocks.workspace.mockResolvedValue({ mode: "OWNER", applications: registered ? [{ ...provider,
      id: "zapier-fixture", name: "Zapier", slug: "axora-zapier", authorizationMode: "AXORA_OAUTH" }] : [], connections: [] });
    const html = renderToStaticMarkup(await IntegrationsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(registered ? "Zapier available" : "Zapier requires setup");
    expect(html).toContain("No apps are connected yet.");
    expect(mocks.controls).toHaveBeenCalledTimes(registered ? 1 : 0);
  });
});
