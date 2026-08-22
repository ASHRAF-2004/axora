# Internal MVP operating model

Axora's initial internal workflow is deliberately compact:

1. Public enquiries are delivered to Axora support through the durable email outbox. They do not create leads, companies, users, assignments, or onboarding records.
2. The Platform Owner or a Client Account Manager with `company.create` creates a company directly from a short form. A logo is optional; fallback branding is used until reviewed logo processing is completed.
3. Authorized Client Account Managers can work across companies without portfolio-assignment records. Explicit permission denial still wins. Company accounts remain limited to their own company, branch, and department scope.
4. Company setup continues through separate workspace destinations for setup, users, branches and delivery locations, wallet and budgets, and documents.
5. `product.manage` authorizes routine product and base-cost maintenance. Selling price remains the system-calculated base cost plus 10%; pricing rules, margin, profit, and commercial history remain separately protected.
6. Routine forms do not ask for a typed audit reason. Server actions supply deterministic reason codes while immutable backend audit and financial records remain unchanged.
7. Help, user manuals, user-facing diagnostics, Reports, Audit History, Company Leads, company assignment, and previous-period comparison are not MVP product surfaces. Retired routes redirect safely.
8. Email Status is Owner-only and exposes service readiness, current-month usage, queue totals, masked recent failures, and retry-safe retry actions only.

Settings redirects to Profile, which remains the single place for personal language, timezone, appearance, notification, and account preferences.

The former Settings failure `AX-2011662386` was caused by the profile-image policy loader requiring a role-assignment ID even for a Platform Owner session. Settings no longer loads that unrelated policy workspace, so its first request redirects directly to the authorized Profile route.
