# Axora operating-model simplification

Migration 080 adds Human Resources Management and Delivery Guy role templates,
retires new sourcing authority, and preserves all historical supplier,
quotation, invoice and audit evidence.

New leads are visible to the Platform Owner and HR Management. HR alone assigns
or reassigns them to eligible Client Account Managers. An Agent sees only an
assigned lead, creates its company, and becomes that company's accountable
primary manager through the existing company-assignment relationship. The
Platform Owner retains global visibility and recovery authority without
operational assignment controls.

New work follows:

`Request -> company approval -> Pay -> finalized invoice -> Delivery Guy buys
items -> delivery -> proof of receipt -> completed`

Customer budget approval remains company-scoped. Axora employees never approve
customer spending. Delivery jobs require a paid, finalized invoice. Cost,
revenue, profit and margin remain server-filtered by explicit financial
permissions.

Legacy supplier, quotation, purchase-document and sourcing tables remain
read-only historical evidence. Deployed migrations are not rewritten.
