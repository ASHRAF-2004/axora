# Axora Key Page Dependency Trees

## Trace conventions

- These trees cover the ten highest-value portal pages for design work: dashboard, settings, users, companies, the three request views, the two product views, and approvals.
- Each tree begins with the implicit Next.js root and portal layouts, followed by the page entry. This makes every route tree self-contained.
- All local static imports, re-exports, and dynamic imports are traced recursively. Package and Node.js built-in imports are intentionally omitted.
- `[already expanded]` means that the same local file and all of its descendants were expanded earlier in that page's tree; it is not a missing dependency.
- Server actions and data modules remain in the trees because the pages import them, but a Superdesign call should normally prioritize the visual page/component files and compact theme context under the payload budget.

## /dashboard

Entry: `src/app/(portal)/dashboard/page.tsx`

Summary: Role-aware landing page with a header action, eight KPI cards, an attention table, two compact bar-chart panels, top-product activity, and a financial/budget rule callout.

Dependencies:

- src/app/layout.tsx (implicit layout)
  - src/components/UxFeedbackProvider.tsx
  - src/app/globals.css
- src/app/(portal)/layout.tsx (implicit layout)
  - src/app/actions.ts
    - src/lib/auth.ts
      - src/lib/db.ts
      - src/lib/permissions.ts
        - src/lib/types.ts
      - src/lib/types.ts [already expanded]
  - src/components/NavigationNotice.tsx
    - src/components/UxFeedbackProvider.tsx [already expanded]
    - src/lib/request-cart.ts
      - src/lib/types.ts [already expanded]
  - src/components/Sidebar.tsx
    - src/components/Brand.tsx
    - src/lib/permissions.ts [already expanded]
    - src/lib/auth.ts [already expanded]
  - src/lib/auth.ts [already expanded]
  - src/lib/db.ts [already expanded]
- src/app/(portal)/dashboard/page.tsx
  - src/components/MetricCard.tsx
  - src/components/PageHeader.tsx
  - src/components/StatusBadge.tsx
    - src/lib/domain.ts
      - src/lib/types.ts [already expanded]
  - src/lib/auth.ts [already expanded]
  - src/lib/domain.ts [already expanded]
  - src/lib/permissions.ts [already expanded]
  - src/lib/repository.ts
    - src/lib/domain.ts [already expanded]
    - src/lib/demo-data.ts
      - src/lib/types.ts [already expanded]
      - src/lib/domain.ts [already expanded]
    - src/lib/demo-operations.ts
      - src/lib/domain.ts [already expanded]
      - src/lib/demo-data.ts [already expanded]
      - src/lib/types.ts [already expanded]
    - src/lib/db.ts [already expanded]
    - src/lib/auth.ts [already expanded]
    - src/lib/permissions.ts [already expanded]
    - src/lib/types.ts [already expanded]
    - src/lib/workflow.ts
      - src/lib/types.ts [already expanded]

## /settings

Entry: `src/app/(portal)/settings/page.tsx`

Summary: Security and workspace configuration page with two readiness panels, per-company pricing cards, bounded number inputs, save actions, and production/sample-mode disclosure.

Dependencies:

- src/app/layout.tsx (implicit layout)
  - src/components/UxFeedbackProvider.tsx
  - src/app/globals.css
- src/app/(portal)/layout.tsx (implicit layout)
  - src/app/actions.ts
    - src/lib/auth.ts
      - src/lib/db.ts
      - src/lib/permissions.ts
        - src/lib/types.ts
      - src/lib/types.ts [already expanded]
  - src/components/NavigationNotice.tsx
    - src/components/UxFeedbackProvider.tsx [already expanded]
    - src/lib/request-cart.ts
      - src/lib/types.ts [already expanded]
  - src/components/Sidebar.tsx
    - src/components/Brand.tsx
    - src/lib/permissions.ts [already expanded]
    - src/lib/auth.ts [already expanded]
  - src/lib/auth.ts [already expanded]
  - src/lib/db.ts [already expanded]
- src/app/(portal)/settings/page.tsx
  - src/components/PageHeader.tsx
  - src/lib/auth.ts [already expanded]
  - src/lib/db.ts [already expanded]
  - src/lib/repository.ts
    - src/lib/domain.ts
      - src/lib/types.ts [already expanded]
    - src/lib/demo-data.ts
      - src/lib/types.ts [already expanded]
      - src/lib/domain.ts [already expanded]
    - src/lib/demo-operations.ts
      - src/lib/domain.ts [already expanded]
      - src/lib/demo-data.ts [already expanded]
      - src/lib/types.ts [already expanded]
    - src/lib/db.ts [already expanded]
    - src/lib/auth.ts [already expanded]
    - src/lib/permissions.ts [already expanded]
    - src/lib/types.ts [already expanded]
    - src/lib/workflow.ts
      - src/lib/types.ts [already expanded]
  - src/lib/types.ts [already expanded]
  - src/app/(portal)/settings/actions.ts
    - src/lib/auth.ts [already expanded]
    - src/lib/repository.ts [already expanded]
    - src/lib/validation.ts
      - src/lib/types.ts [already expanded]

## /users

Entry: `src/app/(portal)/users/page.tsx`

Summary: Two-column people-and-access workspace with an adaptive user-creation form, role guidance, and a complete account table with tenant scope, protected-account explanations, activation, and deletion.

Dependencies:

- src/app/layout.tsx (implicit layout)
  - src/components/UxFeedbackProvider.tsx
  - src/app/globals.css
- src/app/(portal)/layout.tsx (implicit layout)
  - src/app/actions.ts
    - src/lib/auth.ts
      - src/lib/db.ts
      - src/lib/permissions.ts
        - src/lib/types.ts
      - src/lib/types.ts [already expanded]
  - src/components/NavigationNotice.tsx
    - src/components/UxFeedbackProvider.tsx [already expanded]
    - src/lib/request-cart.ts
      - src/lib/types.ts [already expanded]
  - src/components/Sidebar.tsx
    - src/components/Brand.tsx
    - src/lib/permissions.ts [already expanded]
    - src/lib/auth.ts [already expanded]
  - src/lib/auth.ts [already expanded]
  - src/lib/db.ts [already expanded]
- src/app/(portal)/users/page.tsx
  - src/components/PageHeader.tsx
  - src/components/StatusBadge.tsx
    - src/lib/domain.ts
      - src/lib/types.ts [already expanded]
  - src/components/UserCreateForm.tsx
    - src/app/(portal)/users/actions.ts
      - src/lib/auth.ts [already expanded]
      - src/lib/users.ts
        - src/lib/db.ts [already expanded]
        - src/lib/auth.ts [already expanded]
        - src/lib/types.ts [already expanded]
      - src/lib/validation.ts
        - src/lib/types.ts [already expanded]
    - src/lib/types.ts [already expanded]
  - src/lib/auth.ts [already expanded]
  - src/lib/domain.ts [already expanded]
  - src/lib/repository.ts
    - src/lib/domain.ts [already expanded]
    - src/lib/demo-data.ts
      - src/lib/types.ts [already expanded]
      - src/lib/domain.ts [already expanded]
    - src/lib/demo-operations.ts
      - src/lib/domain.ts [already expanded]
      - src/lib/demo-data.ts [already expanded]
      - src/lib/types.ts [already expanded]
    - src/lib/db.ts [already expanded]
    - src/lib/auth.ts [already expanded]
    - src/lib/permissions.ts [already expanded]
    - src/lib/types.ts [already expanded]
    - src/lib/workflow.ts
      - src/lib/types.ts [already expanded]
  - src/lib/types.ts [already expanded]
  - src/lib/users.ts [already expanded]
  - src/app/(portal)/users/actions.ts [already expanded]

## /companies

Entry: `src/app/(portal)/companies/page.tsx`

Summary: Owner-only split layout with the customer-company register on the left and a dense company onboarding form on the right, including contacts, billing, payment, status, and activation controls.

Dependencies:

- src/app/layout.tsx (implicit layout)
  - src/components/UxFeedbackProvider.tsx
  - src/app/globals.css
- src/app/(portal)/layout.tsx (implicit layout)
  - src/app/actions.ts
    - src/lib/auth.ts
      - src/lib/db.ts
      - src/lib/permissions.ts
        - src/lib/types.ts
      - src/lib/types.ts [already expanded]
  - src/components/NavigationNotice.tsx
    - src/components/UxFeedbackProvider.tsx [already expanded]
    - src/lib/request-cart.ts
      - src/lib/types.ts [already expanded]
  - src/components/Sidebar.tsx
    - src/components/Brand.tsx
    - src/lib/permissions.ts [already expanded]
    - src/lib/auth.ts [already expanded]
  - src/lib/auth.ts [already expanded]
  - src/lib/db.ts [already expanded]
- src/app/(portal)/companies/page.tsx
  - src/components/PageHeader.tsx
  - src/components/StatusBadge.tsx
    - src/lib/domain.ts
      - src/lib/types.ts [already expanded]
  - src/lib/auth.ts [already expanded]
  - src/lib/repository.ts
    - src/lib/domain.ts [already expanded]
    - src/lib/demo-data.ts
      - src/lib/types.ts [already expanded]
      - src/lib/domain.ts [already expanded]
    - src/lib/demo-operations.ts
      - src/lib/domain.ts [already expanded]
      - src/lib/demo-data.ts [already expanded]
      - src/lib/types.ts [already expanded]
    - src/lib/db.ts [already expanded]
    - src/lib/auth.ts [already expanded]
    - src/lib/permissions.ts [already expanded]
    - src/lib/types.ts [already expanded]
    - src/lib/workflow.ts
      - src/lib/types.ts [already expanded]
  - src/lib/types.ts [already expanded]
  - src/app/(portal)/masters/actions.ts
    - src/lib/auth.ts [already expanded]
    - src/lib/product-admin.ts
      - src/lib/auth.ts [already expanded]
      - src/lib/db.ts [already expanded]
      - src/lib/demo-data.ts [already expanded]
      - src/lib/types.ts [already expanded]
    - src/lib/product-delete.ts
      - src/lib/auth.ts [already expanded]
      - src/lib/demo-data.ts [already expanded]
      - src/lib/db.ts [already expanded]
    - src/lib/product-images.ts
      - src/lib/auth.ts [already expanded]
      - src/lib/db.ts [already expanded]
      - src/lib/demo-data.ts [already expanded]
      - src/lib/types.ts [already expanded]
    - src/lib/repository.ts [already expanded]
    - src/lib/validation.ts
      - src/lib/types.ts [already expanded]

## /requests

Entry: `src/app/(portal)/requests/page.tsx`

Summary: Purchase-request index with keyword search, status filtering, CSV export, conditional create action, and a responsive data table for tenant, items, dates, approval, fulfilment, value, delivery, and payment.

Dependencies:

- src/app/layout.tsx (implicit layout)
  - src/components/UxFeedbackProvider.tsx
  - src/app/globals.css
- src/app/(portal)/layout.tsx (implicit layout)
  - src/app/actions.ts
    - src/lib/auth.ts
      - src/lib/db.ts
      - src/lib/permissions.ts
        - src/lib/types.ts
      - src/lib/types.ts [already expanded]
  - src/components/NavigationNotice.tsx
    - src/components/UxFeedbackProvider.tsx [already expanded]
    - src/lib/request-cart.ts
      - src/lib/types.ts [already expanded]
  - src/components/Sidebar.tsx
    - src/components/Brand.tsx
    - src/lib/permissions.ts [already expanded]
    - src/lib/auth.ts [already expanded]
  - src/lib/auth.ts [already expanded]
  - src/lib/db.ts [already expanded]
- src/app/(portal)/requests/page.tsx
  - src/components/PageHeader.tsx
  - src/components/StatusBadge.tsx
    - src/lib/domain.ts
      - src/lib/types.ts [already expanded]
  - src/lib/auth.ts [already expanded]
  - src/lib/domain.ts [already expanded]
  - src/lib/permissions.ts [already expanded]
  - src/lib/repository.ts
    - src/lib/domain.ts [already expanded]
    - src/lib/demo-data.ts
      - src/lib/types.ts [already expanded]
      - src/lib/domain.ts [already expanded]
    - src/lib/demo-operations.ts
      - src/lib/domain.ts [already expanded]
      - src/lib/demo-data.ts [already expanded]
      - src/lib/types.ts [already expanded]
    - src/lib/db.ts [already expanded]
    - src/lib/auth.ts [already expanded]
    - src/lib/permissions.ts [already expanded]
    - src/lib/types.ts [already expanded]
    - src/lib/workflow.ts
      - src/lib/types.ts [already expanded]

## /requests/new

Entry: `src/app/(portal)/requests/new/page.tsx`

Summary: Cart-backed request composer with company/branch scope, editable line quantities, urgency and need-by inputs, live pricing, budget guidance, client-side feedback, and a submit-for-approval action.

Dependencies:

- src/app/layout.tsx (implicit layout)
  - src/components/UxFeedbackProvider.tsx
  - src/app/globals.css
- src/app/(portal)/layout.tsx (implicit layout)
  - src/app/actions.ts
    - src/lib/auth.ts
      - src/lib/db.ts
      - src/lib/permissions.ts
        - src/lib/types.ts
      - src/lib/types.ts [already expanded]
  - src/components/NavigationNotice.tsx
    - src/components/UxFeedbackProvider.tsx [already expanded]
    - src/lib/request-cart.ts
      - src/lib/types.ts [already expanded]
  - src/components/Sidebar.tsx
    - src/components/Brand.tsx
    - src/lib/permissions.ts [already expanded]
    - src/lib/auth.ts [already expanded]
  - src/lib/auth.ts [already expanded]
  - src/lib/db.ts [already expanded]
- src/app/(portal)/requests/new/page.tsx
  - src/components/PageHeader.tsx
  - src/components/RequestForm.tsx
    - src/app/(portal)/requests/actions.ts
      - src/lib/repository.ts
        - src/lib/domain.ts
          - src/lib/types.ts [already expanded]
        - src/lib/demo-data.ts
          - src/lib/types.ts [already expanded]
          - src/lib/domain.ts [already expanded]
        - src/lib/demo-operations.ts
          - src/lib/domain.ts [already expanded]
          - src/lib/demo-data.ts [already expanded]
          - src/lib/types.ts [already expanded]
        - src/lib/db.ts [already expanded]
        - src/lib/auth.ts [already expanded]
        - src/lib/permissions.ts [already expanded]
        - src/lib/types.ts [already expanded]
        - src/lib/workflow.ts
          - src/lib/types.ts [already expanded]
      - src/lib/auth.ts [already expanded]
      - src/lib/domain.ts [already expanded]
      - src/lib/validation.ts
        - src/lib/types.ts [already expanded]
      - src/lib/types.ts [already expanded]
    - src/components/UxFeedbackProvider.tsx [already expanded]
    - src/lib/request-cart.ts [already expanded]
    - src/lib/auth.ts [already expanded]
    - src/lib/domain.ts [already expanded]
    - src/lib/types.ts [already expanded]
  - src/lib/auth.ts [already expanded]
  - src/lib/catalog.ts
    - src/lib/auth.ts [already expanded]
    - src/lib/db.ts [already expanded]
    - src/lib/demo-data.ts [already expanded]
    - src/lib/permissions.ts [already expanded]
    - src/lib/types.ts [already expanded]
  - src/lib/repository.ts [already expanded]

## /requests/[id]

Entry: `src/app/(portal)/requests/[id]/page.tsx`

Summary: Dense request detail with role-aware metadata, line-item pricing, budget impact, approval history, fulfilment/payment indicators, and workflow actions constrained by the current state and actor permissions.

Dependencies:

- src/app/layout.tsx (implicit layout)
  - src/components/UxFeedbackProvider.tsx
  - src/app/globals.css
- src/app/(portal)/layout.tsx (implicit layout)
  - src/app/actions.ts
    - src/lib/auth.ts
      - src/lib/db.ts
      - src/lib/permissions.ts
        - src/lib/types.ts
      - src/lib/types.ts [already expanded]
  - src/components/NavigationNotice.tsx
    - src/components/UxFeedbackProvider.tsx [already expanded]
    - src/lib/request-cart.ts
      - src/lib/types.ts [already expanded]
  - src/components/Sidebar.tsx
    - src/components/Brand.tsx
    - src/lib/permissions.ts [already expanded]
    - src/lib/auth.ts [already expanded]
  - src/lib/auth.ts [already expanded]
  - src/lib/db.ts [already expanded]
- src/app/(portal)/requests/[id]/page.tsx
  - src/components/PageHeader.tsx
  - src/components/RequestPricingSummary.tsx
    - src/lib/domain.ts
      - src/lib/types.ts [already expanded]
  - src/components/StatusBadge.tsx
    - src/lib/domain.ts [already expanded]
  - src/lib/auth.ts [already expanded]
  - src/lib/domain.ts [already expanded]
  - src/lib/permissions.ts [already expanded]
  - src/lib/repository.ts
    - src/lib/domain.ts [already expanded]
    - src/lib/demo-data.ts
      - src/lib/types.ts [already expanded]
      - src/lib/domain.ts [already expanded]
    - src/lib/demo-operations.ts
      - src/lib/domain.ts [already expanded]
      - src/lib/demo-data.ts [already expanded]
      - src/lib/types.ts [already expanded]
    - src/lib/db.ts [already expanded]
    - src/lib/auth.ts [already expanded]
    - src/lib/permissions.ts [already expanded]
    - src/lib/types.ts [already expanded]
    - src/lib/workflow.ts
      - src/lib/types.ts [already expanded]
  - src/lib/workflow.ts [already expanded]
  - src/app/(portal)/requests/actions.ts
    - src/lib/repository.ts [already expanded]
    - src/lib/auth.ts [already expanded]
    - src/lib/domain.ts [already expanded]
    - src/lib/validation.ts
      - src/lib/types.ts [already expanded]
    - src/lib/types.ts [already expanded]

## /products

Entry: `src/app/(portal)/products/page.tsx`

Summary: Dual-purpose route: customer users receive a visual, searchable department/category Shop with cart interactions, while the platform owner receives global product administration with image, pricing, supplier, status, edit, delete, and creation controls.

Dependencies:

- src/app/layout.tsx (implicit layout)
  - src/components/UxFeedbackProvider.tsx
  - src/app/globals.css
- src/app/(portal)/layout.tsx (implicit layout)
  - src/app/actions.ts
    - src/lib/auth.ts
      - src/lib/db.ts
      - src/lib/permissions.ts
        - src/lib/types.ts
      - src/lib/types.ts [already expanded]
  - src/components/NavigationNotice.tsx
    - src/components/UxFeedbackProvider.tsx [already expanded]
    - src/lib/request-cart.ts
      - src/lib/types.ts [already expanded]
  - src/components/Sidebar.tsx
    - src/components/Brand.tsx
    - src/lib/permissions.ts [already expanded]
    - src/lib/auth.ts [already expanded]
  - src/lib/auth.ts [already expanded]
  - src/lib/db.ts [already expanded]
- src/app/(portal)/products/page.tsx
  - src/components/DeleteProductButton.tsx
    - src/app/(portal)/masters/actions.ts
      - src/lib/auth.ts [already expanded]
      - src/lib/product-admin.ts
        - src/lib/auth.ts [already expanded]
        - src/lib/db.ts [already expanded]
        - src/lib/demo-data.ts
          - src/lib/types.ts [already expanded]
          - src/lib/domain.ts
            - src/lib/types.ts [already expanded]
        - src/lib/types.ts [already expanded]
      - src/lib/product-delete.ts
        - src/lib/auth.ts [already expanded]
        - src/lib/demo-data.ts [already expanded]
        - src/lib/db.ts [already expanded]
      - src/lib/product-images.ts
        - src/lib/auth.ts [already expanded]
        - src/lib/db.ts [already expanded]
        - src/lib/demo-data.ts [already expanded]
        - src/lib/types.ts [already expanded]
      - src/lib/repository.ts
        - src/lib/domain.ts [already expanded]
        - src/lib/demo-data.ts [already expanded]
        - src/lib/demo-operations.ts
          - src/lib/domain.ts [already expanded]
          - src/lib/demo-data.ts [already expanded]
          - src/lib/types.ts [already expanded]
        - src/lib/db.ts [already expanded]
        - src/lib/auth.ts [already expanded]
        - src/lib/permissions.ts [already expanded]
        - src/lib/types.ts [already expanded]
        - src/lib/workflow.ts
          - src/lib/types.ts [already expanded]
      - src/lib/validation.ts
        - src/lib/types.ts [already expanded]
    - src/components/UxFeedbackProvider.tsx [already expanded]
  - src/components/PageHeader.tsx
  - src/components/ShopCategoryHub.tsx
    - src/lib/catalog.ts
      - src/lib/auth.ts [already expanded]
      - src/lib/db.ts [already expanded]
      - src/lib/demo-data.ts [already expanded]
      - src/lib/permissions.ts [already expanded]
      - src/lib/types.ts [already expanded]
    - src/lib/domain.ts [already expanded]
    - src/lib/request-cart.ts [already expanded]
    - src/lib/types.ts [already expanded]
    - src/components/ProductImage.tsx
      - src/lib/types.ts [already expanded]
    - src/components/UxFeedbackProvider.tsx [already expanded]
  - src/components/ProductImage.tsx [already expanded]
  - src/components/StatusBadge.tsx
    - src/lib/domain.ts [already expanded]
  - src/lib/auth.ts [already expanded]
  - src/lib/domain.ts [already expanded]
  - src/lib/permissions.ts [already expanded]
  - src/lib/product-options.ts
  - src/lib/repository.ts [already expanded]
  - src/lib/catalog.ts [already expanded]
  - src/app/(portal)/masters/actions.ts [already expanded]

## /products/[id]/edit

Entry: `src/app/(portal)/products/[id]/edit/page.tsx`

Summary: Owner product editor with catalog metadata fields and a visual image-management workspace for upload, primary selection, status, thumbnails, and deletion.

Dependencies:

- src/app/layout.tsx (implicit layout)
  - src/components/UxFeedbackProvider.tsx
  - src/app/globals.css
- src/app/(portal)/layout.tsx (implicit layout)
  - src/app/actions.ts
    - src/lib/auth.ts
      - src/lib/db.ts
      - src/lib/permissions.ts
        - src/lib/types.ts
      - src/lib/types.ts [already expanded]
  - src/components/NavigationNotice.tsx
    - src/components/UxFeedbackProvider.tsx [already expanded]
    - src/lib/request-cart.ts
      - src/lib/types.ts [already expanded]
  - src/components/Sidebar.tsx
    - src/components/Brand.tsx
    - src/lib/permissions.ts [already expanded]
    - src/lib/auth.ts [already expanded]
  - src/lib/auth.ts [already expanded]
  - src/lib/db.ts [already expanded]
- src/app/(portal)/products/[id]/edit/page.tsx
  - src/components/PageHeader.tsx
  - src/components/StatusBadge.tsx
    - src/lib/domain.ts
      - src/lib/types.ts [already expanded]
  - src/lib/auth.ts [already expanded]
  - src/lib/product-images.ts
    - src/lib/auth.ts [already expanded]
    - src/lib/db.ts [already expanded]
    - src/lib/demo-data.ts
      - src/lib/types.ts [already expanded]
      - src/lib/domain.ts [already expanded]
    - src/lib/types.ts [already expanded]
  - src/lib/product-options.ts
  - src/lib/repository.ts
    - src/lib/domain.ts [already expanded]
    - src/lib/demo-data.ts [already expanded]
    - src/lib/demo-operations.ts
      - src/lib/domain.ts [already expanded]
      - src/lib/demo-data.ts [already expanded]
      - src/lib/types.ts [already expanded]
    - src/lib/db.ts [already expanded]
    - src/lib/auth.ts [already expanded]
    - src/lib/permissions.ts [already expanded]
    - src/lib/types.ts [already expanded]
    - src/lib/workflow.ts
      - src/lib/types.ts [already expanded]
  - src/app/(portal)/masters/actions.ts
    - src/lib/auth.ts [already expanded]
    - src/lib/product-admin.ts
      - src/lib/auth.ts [already expanded]
      - src/lib/db.ts [already expanded]
      - src/lib/demo-data.ts [already expanded]
      - src/lib/types.ts [already expanded]
    - src/lib/product-delete.ts
      - src/lib/auth.ts [already expanded]
      - src/lib/demo-data.ts [already expanded]
      - src/lib/db.ts [already expanded]
    - src/lib/product-images.ts [already expanded]
    - src/lib/repository.ts [already expanded]
    - src/lib/validation.ts
      - src/lib/types.ts [already expanded]

## /approvals

Entry: `src/app/(portal)/approvals/page.tsx`

Summary: Approval queue that pairs request and pricing information with branch-budget context, approval history, eligibility messaging, and a focused approve/reject decision form.

Dependencies:

- src/app/layout.tsx (implicit layout)
  - src/components/UxFeedbackProvider.tsx
  - src/app/globals.css
- src/app/(portal)/layout.tsx (implicit layout)
  - src/app/actions.ts
    - src/lib/auth.ts
      - src/lib/db.ts
      - src/lib/permissions.ts
        - src/lib/types.ts
      - src/lib/types.ts [already expanded]
  - src/components/NavigationNotice.tsx
    - src/components/UxFeedbackProvider.tsx [already expanded]
    - src/lib/request-cart.ts
      - src/lib/types.ts [already expanded]
  - src/components/Sidebar.tsx
    - src/components/Brand.tsx
    - src/lib/permissions.ts [already expanded]
    - src/lib/auth.ts [already expanded]
  - src/lib/auth.ts [already expanded]
  - src/lib/db.ts [already expanded]
- src/app/(portal)/approvals/page.tsx
  - src/components/ApprovalDecisionForm.tsx
    - src/app/(portal)/operations/actions.ts
      - src/lib/auth.ts [already expanded]
      - src/lib/operations.ts
        - src/lib/demo-data.ts
          - src/lib/types.ts [already expanded]
          - src/lib/domain.ts
            - src/lib/types.ts [already expanded]
        - src/lib/demo-operations.ts
          - src/lib/domain.ts [already expanded]
          - src/lib/demo-data.ts [already expanded]
          - src/lib/types.ts [already expanded]
        - src/lib/db.ts [already expanded]
        - src/lib/auth.ts [already expanded]
        - src/lib/permissions.ts [already expanded]
        - src/lib/types.ts [already expanded]
        - src/lib/domain.ts [already expanded]
      - src/lib/types.ts [already expanded]
      - src/lib/validation.ts
        - src/lib/types.ts [already expanded]
    - src/components/UxFeedbackProvider.tsx [already expanded]
  - src/components/PageHeader.tsx
  - src/components/RequestPricingSummary.tsx
    - src/lib/domain.ts [already expanded]
  - src/components/StatusBadge.tsx
    - src/lib/domain.ts [already expanded]
  - src/lib/auth.ts [already expanded]
  - src/lib/domain.ts [already expanded]
  - src/lib/permissions.ts [already expanded]
  - src/lib/operations.ts [already expanded]
  - src/lib/repository.ts
    - src/lib/domain.ts [already expanded]
    - src/lib/demo-data.ts [already expanded]
    - src/lib/demo-operations.ts [already expanded]
    - src/lib/db.ts [already expanded]
    - src/lib/auth.ts [already expanded]
    - src/lib/permissions.ts [already expanded]
    - src/lib/types.ts [already expanded]
    - src/lib/workflow.ts
      - src/lib/types.ts [already expanded]
