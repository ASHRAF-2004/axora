# Email and notification policy

Status: implemented (2026-08-28).

Channel selection occurs after resource authorization and recipient
deduplication. Company-bound CAM recipients require an active canonical company
assignment; holding the CAM role never makes a user a broadcast audience.

Email remains appropriate for account setup/invitations, password reset and
verification, current security notices, explicitly required finalized business
documents, and one internal notification for a durable public Contact enquiry.
The Contact recipient is private runtime configuration and is unrelated to CAM
ownership.

Routine operations stay in-app and on the Request/Delivery timeline. The final
database enqueue boundary rejects email for company creation and ordinary
delivery progress including assignment/claim, acceptance, shopping, items
acquired, out for delivery, arrival, delivery, completion, and tracking
pause/resume. The application applies the same policy before requesting an
enqueue. Historical sent-email evidence is retained unchanged.
