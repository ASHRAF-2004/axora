from pathlib import Path

path = Path("src/lib/customer-matching-isolation.ts")
source = path.read_text()
old = '''function requireReviewer(actor: AuthenticatedSessionUser) {
  if (!canAccess(actor, "review_three_way_matches")
    || !actor.roleAssignmentId) {
    throw new CustomerMatchAccessUnavailableError();
  }
  return actor.roleAssignmentId;
}
'''
new = '''function requireReviewer(actor: AuthenticatedSessionUser) {
  if (!canAccess(actor, "review_three_way_matches")
    || (!isDemoMode() && !actor.roleAssignmentId)) {
    throw new CustomerMatchAccessUnavailableError();
  }
  return actor.roleAssignmentId;
}
'''
if new not in source:
    if source.count(old) != 1:
        raise RuntimeError(
            f"Expected one reviewer guard, found {source.count(old)}"
        )
    path.write_text(source.replace(old, new, 1))
