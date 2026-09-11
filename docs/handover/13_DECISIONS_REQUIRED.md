# Decisions Required

These items should be answered by the appropriate business/technical owner. The next developer should not guess them.

| Decision | Why it matters | Suggested owner |
|---|---|---|
| Production payment provider/process | Determines settlement, reconciliation, failure and refund behavior | Business + Finance + Engineering |
| Delivery-fee accounting treatment | Affects revenue/profit reporting and invoice semantics | Finance |
| Customer budget policy by organization level | Determines branch/department authority and overspend behavior | Business + Finance |
| Final role catalogue for pilot | Avoids carrying unnecessary compatibility roles into new UI/workflows | Business + Engineering |
| General-availability map/routing provider | Cost, licensing, coverage and privacy implications | Operations + Engineering |
| Retention/purge policy | Operational evidence vs privacy/legal requirements | Management + Legal/Operations |
| MFA / phishing-resistant owner authentication | High-impact account protection | Management + Engineering |
| Off-machine backup destination and key escrow | Disaster-recovery readiness | Management + IT |
| When to retire legacy role/status compatibility | Reduces policy complexity without breaking historical records | Engineering |
| Which pilot steps stay manual | Prevents premature automation of unstable business rules | Business owner |
| Integration rollout order (Slack/Zapier/others) | Limits operational surface and support burden | Business + Engineering |
| Production cutover/decommission criteria | Prevents removing fallback before recovery is proved | Platform Owner + Operations |

## Decision-record rule

When one of these is resolved, record the decision in an ADR or a dated handover update, link the relevant implementation change, and add acceptance criteria before coding.
