# ADR-001: Treat the Current MVP as a Reference Implementation

- **Status:** Accepted for handover
- **Date:** 2026-09-11

## Context

Axora has accumulated validated workflows, migrations, tests and operational safeguards during the internship. Some implementation choices are temporary, compatibility-oriented or optimized for the current pilot.

## Decision

Future development will preserve validated business contracts and acceptance evidence without treating every current technical choice as permanent architecture.

## Consequences

- Refactoring is allowed when behavior is traceable and tested.
- Existing migration history and audit evidence remain preserved.
- Rebuild decisions require migration/acceptance plans rather than a blind rewrite.
- Documentation must distinguish current behavior from target recommendations.
