# Current-to-Target Traceability

**Current evidence baseline:** `49ccf0e3413504e1f5a753b491dc1770533a6e80`.

| Target requirement | Current evidence | Status / next action |
|---|---|---|
| Multi-company tenant separation | `src/lib/permissions.ts`, memberships/scope migrations, denial tests | **Preserve**, continue negative testing |
| Canonical organization setup | `docs/MVP_OPERATING_MODEL.md`, migrations 102-115 | **Preserve**, refine setup UX |
| Canonical request workspace | migration 124 and request workflow/services | **Preserve** |
| Budget authority and shopping visibility | migrations 113-115, 133-135, recent Week 8 fixes | **Preserve**, keep wallet/budget concepts distinct |
| Provider-neutral payment boundary | `PAYMENT_AND_INVOICE_OPERATING_RULES.md`, migration 076 onward | **Preserve boundary**, replace pilot adapter when approved |
| Permanent invoice/document evidence | paid checkout/document/email flows | **Preserve** |
| Delivery execution and self-claim | migrations 106, 116-118; `docs/driver-live-operations.md` | **Preserve**, monitor operational UX |
| Independent receiving | receiving roles/types and delivery documentation | **Preserve** |
| Commercial confidentiality | `permissions.ts`, migration 122, latest CAM markup fix | **Preserve** |
| Immutable/forward migration history | `database/migrations/`, `tests/full-migration-chain.test.ts` | **Preserve** |
| Exact-artifact CI/CD | `.github/workflows/ci.yml`, production docs | **Preserve principles**, verify external environment |
| Off-machine recovery | docs/security/DR guidance | **Not yet repository-provable**; verify operationally |
| Broad role/status cleanup | legacy compatibility remains | **Rebuild/retire later** |
| Full production payment settlement | provider-neutral pilot only | **Business Decision Required** |
| GA map/routing coverage | controlled pilot model | **Business Decision Required** |
| Automation beyond stable rules | CI/retry-safe operations already automated | **Stage by maturity**, do not automate uncertain policy |

## Traceability maintenance

Update this file whenever a target requirement changes disposition or when implementation evidence moves. Use commit/PR references rather than screenshots as primary technical evidence.
