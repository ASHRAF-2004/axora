# Email Status redesign evidence

Controlled demo fixtures produced these screenshots at the protected base and
feature worktree. They contain no real recipient, credential, API key, message
content, or production quota value.

- `before-email-status.png`: protected base `0483ed1c2cff5ad72c3f50beeba08d242e3dc1c3`, English Light desktop.
- `after-en-light-desktop.png`: redesigned English Light desktop.
- `after-en-dark-desktop.png`: redesigned English Dark desktop.
- `after-ar-dark-mobile.png`: redesigned Arabic RTL Dark Pixel 7.
- `after-ms-light-desktop.png`: redesigned Malay Light desktop.

The dynamic `8 / 3,000` and `0 / 100` values in the after screenshots are
explicit demo fixtures used by the automated page tests. Production usage is
never initialized from these values; it comes only from validated Resend quota
response headers persisted by migration 108.
