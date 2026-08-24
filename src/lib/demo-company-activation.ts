export const DEMO_ACTIVATION_COMPANY_ID = "11111111-1111-4111-8111-111111111111";

export type DemoCompanyActivationState = {
  verificationStatus: "DRAFT" | "VERIFIED";
  verificationVersion: number;
  lifecycleStatus: "COMPANY_ADMINISTRATOR_ACTIVATED" | "ACTIVE";
  lifecycleVersion: number;
};

declare global {
  var __axoraDemoCompanyActivationStates:
    Map<string, DemoCompanyActivationState> | undefined;
}

function states() {
  if (!global.__axoraDemoCompanyActivationStates) {
    global.__axoraDemoCompanyActivationStates = new Map();
  }
  return global.__axoraDemoCompanyActivationStates;
}

export function demoCompanyActivationState(
  actorId: string,
  companyId: string,
): DemoCompanyActivationState | undefined {
  if (companyId !== DEMO_ACTIVATION_COMPANY_ID
    || (!actorId.startsWith("d1200000-") && !actorId.startsWith("e1200000-"))) {
    return undefined;
  }
  const key = `${actorId}:${companyId}`;
  const existing = states().get(key);
  if (existing) return existing;
  const initial: DemoCompanyActivationState = {
    verificationStatus: "DRAFT",
    verificationVersion: 1,
    lifecycleStatus: "COMPANY_ADMINISTRATOR_ACTIVATED",
    lifecycleVersion: 3,
  };
  states().set(key, initial);
  return initial;
}

export function approveDemoCompanyVerification(
  actorId: string,
  companyId: string,
  expectedVersion: number,
) {
  const state = demoCompanyActivationState(actorId, companyId);
  if (!state) return "UNAVAILABLE" as const;
  if (state.verificationStatus === "VERIFIED") return "ALREADY_VERIFIED" as const;
  if (state.verificationVersion !== expectedVersion) return "STALE" as const;
  state.verificationStatus = "VERIFIED";
  state.verificationVersion += 1;
  return "VERIFIED" as const;
}

export function activateDemoCompany(
  actorId: string,
  companyId: string,
  expectedVersion: number,
) {
  const state = demoCompanyActivationState(actorId, companyId);
  if (!state) return "UNAVAILABLE" as const;
  if (state.lifecycleStatus === "ACTIVE") return "ALREADY_ACTIVE" as const;
  if (state.lifecycleVersion !== expectedVersion) return "STALE" as const;
  if (state.verificationStatus !== "VERIFIED") return "BLOCKED" as const;
  state.lifecycleStatus = "ACTIVE";
  state.lifecycleVersion += 1;
  return "ACTIVATED" as const;
}
