# Axora reviewed transactional emails

`account-setup.html` is a static, email-client-safe template. Application and
tenant values are inserted only by `server-tools/account-setup-email.mjs`,
which HTML-escapes text and restricts every application link to the configured
Axora HTTPS origin. Help and privacy links use the invitation locale.

The email intentionally contains a one-time setup link, not a temporary
password. PostgreSQL stores the token's SHA-256 hash, expiry, revocation and
consumption state. The raw setup token exists only in memory for one atomic
`PENDING` to `SENDING` claim and one authenticated synchronous send; there is
no account-setup ciphertext, outbox, lease poller, or automatic replay. A
failed or uncertain attempt requires an explicit resend, which revokes the old
invitation and creates a new token. Password-reset and email-verification use a
separate durable outbox whose bearer payload is temporarily protected with
purpose-bound AES-256-GCM and purged at its terminal lifecycle state.
The link carries the bearer value only in `#token=...`. A browser does not send
that fragment in its HTTP request target, and the setup page clears it before
its first network action. The later server-action body is still sensitive, so
request-body logging must remain disabled.

The renderer supports validated English, Arabic, and Malay copy. The template contains
the following validated placeholders:

- `EMAIL_LANG`
- `EMAIL_DIR`
- `EMAIL_TITLE`
- `PREHEADER`
- `GREETING`
- `ACCOUNT_READY`
- `CREATE_PASSWORD`
- `PRIVATE_LINK_PREFIX`
- `SIGN_IN_AS`
- `AFTER_CHOOSING_PASSWORD`
- `ACCOUNT_LABEL`
- `REPLY_LABEL`
- `WELCOME_TITLE`
- `PRODUCT_SUMMARY`
- `HELP_LABEL`
- `LOGIN_LABEL`
- `PRIVACY_LABEL`
- `INVITATION_CREATED_FOR`
- `USER_DISPLAY_NAME`
- `USER_EMAIL`
- `COMPANY_NAME`
- `ROLE_NAME`
- `BRANCH_NAME_BLOCK`
- `SETUP_URL`
- `EXPIRES_AT`
- `SUPPORT_EMAIL`
- `HELP_URL`
- `LOGIN_URL`
- `PRIVACY_URL`
- `CURRENT_YEAR`

Do not add raw executable JavaScript, remote fonts, forms, video, or arbitrary
URLs. Keep essential email styling inline and retain the Outlook VML fallback.

`transactional.html` is the reviewed shared shell for contact notifications,
password reset, and email verification. Only
`server-tools/transactional-email.mjs` may populate it. That renderer validates
message kind, locale, addresses, lengths, dates, and same-origin security URLs;
it HTML-escapes every user-controlled value and produces an equivalent
plain-text part. It supports English, Arabic, and Malay.

Security action URLs are restricted to the canonical Axora HTTPS origin and to
one exact route for their purpose. The 256-bit bearer token must appear only in
the URL fragment. Contact notifications have no action URL and use the
validated sender as `Reply-To`; the private monitored destination is supplied
only by server configuration.

The transactional template accepts only these placeholders:

- `EMAIL_LANG`
- `EMAIL_DIR`
- `TEXT_ALIGN`
- `PREHEADER`
- `EYEBROW`
- `EMAIL_TITLE`
- `INTRO`
- `DETAILS_BLOCK`
- `MESSAGE_BLOCK`
- `ACTION_BLOCK`
- `SECURITY_NOTE`
- `HELP_TEXT`
- `CURRENT_YEAR`
- `FOOTER_TEXT`

Do not add executable script, form controls, remote assets, arbitrary URLs, or
unvalidated raw HTML. Security and contact notifications embed only the local
Axora logo and remain readable when images are blocked.

## Assets

The message embeds local copies with content IDs, so it makes no third-party
image requests:

| File | Use | Provenance |
| --- | --- | --- |
| `public/brand/axora-email.png` | Axora logo | Approved Axora email-safe horizontal derivative |
| `public/email/account-setup/account-envelope.png` | Decorative envelope | Supplied in the owner's original email export; stored locally instead of hotlinked |

Both images are optimized PNG assets. They are attached with Content IDs `axora-logo` and
`account-envelope`; the template uses only the corresponding `cid:` URLs. The
production template plus both images is under 32 KiB before email transport
encoding, and opening the message makes no third-party asset request.

## Local captured preview

Mailpit is available only through an explicit development profile. Its web UI
is bound to host loopback, SMTP is not published, messages are ephemeral, and
the preview command refuses to run with `NODE_ENV=production`. Compose pins the
reviewed official Mailpit image by version and digest; do not replace it with
an unreviewed floating image tag.

```bash
docker compose --profile email-preview up -d mailpit
curl --fail --silent --show-error --retry 10 --retry-all-errors \
  --retry-delay 1 http://127.0.0.1:8025/api/v1/info >/dev/null
npm run email:preview -- --template account-setup --locale en
npm run email:preview -- --template password-reset --locale ar
npm run email:preview -- --template email-verification --locale ms
npm run email:preview -- --template contact-notification --locale en
npm run email:preview -- --template workflow-update --locale ar
```

Open `http://127.0.0.1:8025`. The utility uses fixed `.test` sample identities
and never reads a provider credential or a real invitation token. Do not enter
production addresses or confidential content into the preview catcher. Stop
the development service when review is complete:

```bash
docker compose --profile email-preview stop mailpit
```

This path renders and captures reviewed messages directly through Mailpit's
loopback HTTP API. It deliberately bypasses the production `email-sender`,
Cloudflare REST API, DNS, Queue subscription, and recipient inbox. Passing this
preview is therefore local template evidence only, not a successful provider
test.

Official local-catcher references:

- [Mailpit Docker image guidance](https://mailpit.axllent.org/docs/install/docker/)
- [Mailpit HTTP send API](https://mailpit.axllent.org/docs/usage/sending-messages/)
