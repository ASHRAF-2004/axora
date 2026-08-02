# Third-party notices

## Owner-supplied Axora artwork and email illustration

The Axora logo and the account-envelope illustration were supplied locally by
the Axora owner for this product. Production files are optimized local copies;
the application does not hotlink them. They are treated as owner-approved
project assets, not as public-domain or third-party community artwork. Their
use outside Axora requires a separate rights decision.

- Approved logo sources: retained as operator-controlled, Git-ignored generation
  inputs under `assets/brand/source/`; only the reviewed production derivatives
  are distributed in this repository
- Email illustration: `public/email/account-setup/account-envelope.png`,
  retained from the owner's supplied email-template package
- Production derivatives: `public/brand/` and
  `public/email/account-setup/account-envelope.png`
- Modification: format/size/transparency optimization only; no invented vector
  or reinterpreted mark

## Lucide icon assets and React library

The application interface uses icons from the `lucide-react` package. The
approved Axora logo is owner-supplied artwork and is not derived from Lucide.

- Project: https://lucide.dev/
- React package source: https://www.npmjs.com/package/lucide-react
- Licenses: ISC, with MIT terms for the Feather-derived icons listed in the
  complete license text
- Copyright: Copyright (c) 2026 Lucide Icons and Contributors
- Full license text: `licenses/LUCIDE-ISC.txt`

## Noto fonts embedded in the user manuals

The generated English and Arabic PDF manuals embed subsets of Noto Sans and
Noto Sans Arabic from the Ubuntu `fonts-noto-core` package. The font software
is used without renaming or modification and is not sold separately.

- Project: https://github.com/notofonts
- License: SIL Open Font License 1.1
- Copyright: 2010–2020 Google Inc. and Google LLC
- License text: https://openfontlicense.org/open-font-license-official-text/

## axe-core Playwright accessibility checks

Browser-level accessibility regression tests use the official
`@axe-core/playwright` integration from Deque. It is a development-only test
dependency and is not shipped in the production application image.

- Project: https://github.com/dequelabs/axe-core-npm
- Version: 4.12.1
- License: Mozilla Public License 2.0
- License text: https://www.mozilla.org/MPL/2.0/


## Tailscale client

The hybrid deployment image includes the Tailscale client and daemon to create
an authenticated private connection between the Render web service and the
Ubuntu PostgreSQL server.

- Project: https://github.com/tailscale/tailscale
- Version: 1.98.8
- License: BSD 3-Clause
- Copyright: Copyright (c) 2020 Tailscale Inc & contributors
- Full license text: `licenses/TAILSCALE-BSD-3-CLAUSE.txt`
