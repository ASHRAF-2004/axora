/**
 * The policy version required before an activated account may enter a normal
 * Axora workflow. This value is application-owned: browsers never choose the
 * version that is recorded as accepted.
 */
export const REQUIRED_POLICY_VERSION = "2026-08-02";

export interface RequiredProfileState {
  profileCompletedAt?: string | null;
  requiredPolicyVersion?: string | null;
  requiredPolicyAcceptedAt?: string | null;
}

export function hasCompletedRequiredProfile(state: RequiredProfileState) {
  return Boolean(
    state.profileCompletedAt
      && state.requiredPolicyAcceptedAt
      && state.requiredPolicyVersion === REQUIRED_POLICY_VERSION,
  );
}
