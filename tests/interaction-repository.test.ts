import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    demo: false,
    client,
    query: vi.fn(),
    withAuditTransaction: vi.fn(
      async (_context: unknown, work: (dbClient: typeof client) => unknown) =>
        work(client),
    ),
  };
});

vi.mock("@/lib/db", () => ({
  isDemoMode: () => database.demo,
  query: database.query,
  withAuditTransaction: database.withAuditTransaction,
}));

import type { SessionUser } from "@/lib/auth";
import { DEFAULT_MASCOT_CONFIG } from "@/lib/interactions/catalog";
import {
  InteractionConfigSchema,
  type InteractionConfig,
  type InteractionRecommendation,
  type OwnerInteractionChoice,
} from "@/lib/interactions/schema";
import {
  ensureCompanyInteractionProfile,
  listCompanyInteractionAssets,
  loadCompanyInteractionProfile,
  publishCompanyInteraction,
  regenerateCompanyInteractionRecommendation,
  registerCompanyInteractionAsset,
  resolveInteractionCompanyId,
  saveCompanyInteractionOverride,
} from "@/lib/interactions/repository";

const companyA = "10000000-0000-4000-8000-000000000001";
const companyB = "10000000-0000-4000-8000-000000000002";
const owner: SessionUser = {
  id: "90000000-0000-4000-8000-000000000001",
  email: "owner@example.test",
  name: "Owner",
  role: "ADMIN",
  isOwner: true,
};
const companyAdmin: SessionUser = {
  id: "90000000-0000-4000-8000-000000000002",
  email: "admin@example.test",
  name: "Company admin",
  role: "ADMIN",
  companyId: companyA,
  isOwner: false,
};

const disabledConfig = InteractionConfigSchema.parse({
  schemaVersion: 1,
  enabled: false,
  interactionType: "none",
  assetId: "none",
  scale: 1,
  initialPlacement: "hero-right",
  permittedRegion: "hero",
  desktopBehavior: "hidden",
  mobileBehavior: "hidden",
  reducedMotionBehavior: "hidden",
  performanceTier: "low",
  semanticRole: "decorative",
  accessibleLabel: null,
  colorTreatment: "brand",
  allowVisitorPause: true,
  allowVisitorDismiss: true,
  protectedZones: ["primary-navigation", "forms", "calls-to-action"],
  intensity: "none",
  dragEnabled: false,
  automaticMovement: false,
  reactionsEnabled: false,
  walkingSpeed: 0,
  idleFrequencySeconds: 0,
  resumeDelayMs: 0,
  fallback: { kind: "hidden", assetId: "none" },
  approvedStates: [],
  interactionTriggers: [],
});

const recommendation: InteractionRecommendation = {
  schemaVersion: 1,
  recommendationId: "rec_repository_test",
  policyVersion: "axora-rules-v1",
  config: disabledConfig,
  rationale: "A restrained company profile does not need persistent motion.",
  confidence: "high",
  metrics: { toneFit: 95, accessibilityFit: 100, performanceFit: 100 },
  alternativeAssetIds: [],
};

const ownerChoice: OwnerInteractionChoice = {
  schemaVersion: 1,
  recommendationId: recommendation.recommendationId,
  decision: "disabled",
  config: disabledConfig,
  savedAt: "2026-08-01T08:00:00+00:00",
};

function workspaceRow(options: {
  companyId?: string;
  companyName?: string;
  recommendation?: unknown;
  ownerChoice?: unknown;
  publishedConfig?: unknown;
} = {}) {
  return {
    companyId: options.companyId ?? companyA,
    companyName: options.companyName ?? "Company A",
    recommendation: options.recommendation ?? null,
    ownerChoice: options.ownerChoice ?? null,
    publishedConfig: options.publishedConfig ?? null,
    recommendedAt: null,
    ownerChoiceSavedAt: null,
    publishedAt: null,
    updatedAt: new Date("2026-08-01T08:00:00Z"),
  };
}

describe("interaction repository authorization and validation", () => {
  beforeEach(() => {
    database.demo = false;
    database.query.mockReset();
    database.client.query.mockReset();
    database.withAuditTransaction.mockClear();
  });

  it("allows only platform owners and company administrators", () => {
    expect(resolveInteractionCompanyId(owner, companyB)).toBe(companyB);
    expect(resolveInteractionCompanyId(companyAdmin)).toBe(companyA);

    expect(() => resolveInteractionCompanyId({
      ...companyAdmin,
      role: "IT_SUPPORT",
    })).toThrow(/cannot manage interactive experiences/i);
    expect(() => resolveInteractionCompanyId({
      ...companyAdmin,
      role: "BRANCH_ADMIN",
      branchId: "20000000-0000-4000-8000-000000000001",
    })).toThrow(/cannot manage interactive experiences/i);
  });

  it("never lets a company administrator select another tenant", async () => {
    await expect(
      loadCompanyInteractionProfile(companyB, companyAdmin),
    ).rejects.toThrow(/cannot manage another company/i);
    expect(database.query).not.toHaveBeenCalled();
  });

  it("provides a read-only fallback only for known demo companies", async () => {
    database.demo = true;
    const demoOwner = { ...owner, id: "demo-owner" };
    await expect(
      loadCompanyInteractionProfile("co-youruni", demoOwner),
    ).resolves.toMatchObject({
      companyId: "co-youruni",
      companyName: "YourUni",
      recommendation: null,
      ownerChoice: null,
    });
    await expect(
      loadCompanyInteractionProfile("co-does-not-exist", demoOwner),
    ).rejects.toThrow(/select a company/i);
    await expect(
      loadCompanyInteractionProfile("co-excel", {
        ...companyAdmin,
        companyId: "co-youruni",
      }),
    ).rejects.toThrow(/another company/i);
    expect(database.query).not.toHaveBeenCalled();
  });

  it("scopes profile initialization to the selected active company", async () => {
    database.client.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [workspaceRow({ companyId: companyB, companyName: "Company B" })],
      });

    await expect(
      ensureCompanyInteractionProfile(companyB, owner),
    ).resolves.toMatchObject({ companyId: companyB });

    expect(database.client.query.mock.calls[0][1]).toEqual([companyB]);
    expect(database.client.query.mock.calls[0][0]).toContain(
      "FROM companies WHERE id=$1 AND active=true",
    );
  });

  it("regenerates only AI fields so a stored owner choice survives", async () => {
    database.client.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [workspaceRow({ recommendation, ownerChoice })],
      });

    const result = await regenerateCompanyInteractionRecommendation(
      undefined,
      recommendation,
      companyAdmin,
    );

    const sql = String(database.client.query.mock.calls[0][0]);
    const updateClause = sql.split("DO UPDATE SET")[1];
    expect(updateClause).not.toContain("owner_override");
    expect(database.client.query.mock.calls[0][1][0]).toBe(companyA);
    expect(result.ownerChoice).toEqual(ownerChoice);
  });

  it("saves owner choices without replacing the AI recommendation", async () => {
    database.client.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [workspaceRow({ recommendation, ownerChoice })],
      });

    const result = await saveCompanyInteractionOverride(
      companyA,
      ownerChoice,
      companyAdmin,
    );

    const sql = String(database.client.query.mock.calls[0][0]);
    const updateClause = sql.split("DO UPDATE SET")[1];
    expect(updateClause).not.toContain("ai_recommendation");
    expect(result.recommendation).toEqual(recommendation);
  });

  it("rejects invalid persisted configuration instead of executing it", async () => {
    database.query.mockResolvedValue({
      rowCount: 1,
      rows: [workspaceRow({ publishedConfig: { enabled: true, javascript: "alert(1)" } })],
    });

    await expect(
      loadCompanyInteractionProfile(companyA, companyAdmin),
    ).rejects.toThrow();
  });

  it("always scopes asset reads by the resolved company", async () => {
    database.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await listCompanyInteractionAssets(undefined, companyAdmin);
    expect(database.query.mock.calls[0][1]).toEqual([companyA]);
    expect(String(database.query.mock.calls[0][0])).toContain(
      "WHERE asset.company_id=$1",
    );
  });

  it("rejects unapproved licenses before touching the database", async () => {
    await expect(registerCompanyInteractionAsset(companyA, {
      assetKey: "unapproved",
      displayName: "Unapproved asset",
      assetType: "SVG",
      contentType: "image/svg+xml",
      storagePath: "interactions/unapproved.svg",
      byteSize: 100,
      sha256: "a".repeat(64),
      sourceUrl: "https://assets.example.test/source",
      licenseName: "Unknown",
      licenseReference: "No verified commercial grant",
      commercialUseApproved: false as true,
      attributionRequired: false,
    }, companyAdmin)).rejects.toThrow();
    expect(database.withAuditTransaction).not.toHaveBeenCalled();
  });

  it("accepts only schema-validated publication values", () => {
    const executable = {
      ...disabledConfig,
      onClick: "javascript:alert(1)",
    } as unknown as InteractionConfig;
    expect(() => InteractionConfigSchema.parse(executable)).toThrow();
  });

  it("rejects schema-valid but unsafe publication values at the server boundary", async () => {
    const missingPauseControl = InteractionConfigSchema.parse({
      ...DEFAULT_MASCOT_CONFIG,
      allowVisitorPause: false,
    });

    await expect(
      publishCompanyInteraction(companyA, missingPauseControl, companyAdmin),
    ).rejects.toThrow(/pause control/i);
    expect(database.withAuditTransaction).not.toHaveBeenCalled();
  });
});
