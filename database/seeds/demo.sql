-- Sanitized Axora demonstration data.
--
-- This seed is intentionally deterministic and idempotent. It is designed for
-- an empty training database and contains no real email addresses, telephone
-- numbers, quotations, invoices, or company addresses.

BEGIN;

INSERT INTO companies (
  id, company_code, name, industry,
  main_contact_name, main_contact_email, main_contact_phone,
  billing_contact_name, billing_contact_email, billing_contact_phone,
  billing_address, payment_terms, billing_cycle, active
) VALUES
  ('10000000-0000-4000-8000-000000000001','C-001','YourUni','Education','Pilot coordinator','coordinator@youruni.example','012-000-1001','Finance desk','finance@youruni.example','012-000-1002','Kuala Lumpur demo address','Cash on delivery (COD)','Monthly',true),
  ('10000000-0000-4000-8000-000000000002','C-002','Excel Language Centre','Education','Operations coordinator','operations@excel.example','013-000-2001','Finance desk','finance@excel.example','013-000-2002','Petaling Jaya demo address','Cash on delivery (COD)','Monthly',true),
  ('10000000-0000-4000-8000-000000000003','C-003','Unibax','Business services','Office coordinator','office@unibax.example','014-000-3001','Finance desk','finance@unibax.example','014-000-3002','Shah Alam demo address','Cash on delivery (COD)','Monthly',true)
ON CONFLICT DO NOTHING;

INSERT INTO branches (
  id, branch_code_id, company_id, name, branch_code, delivery_address, city,
  contact_name, contact_phone, contact_email, delivery_instructions, active
) VALUES
  ('20000000-0000-4000-8000-000000000001','B-001','10000000-0000-4000-8000-000000000001','YourUni main campus','YU-MAIN','Kuala Lumpur demo delivery point','Kuala Lumpur','Campus reception','012-000-1100','reception@youruni.example','Call the demo reception before delivery.',true),
  ('20000000-0000-4000-8000-000000000002','B-002','10000000-0000-4000-8000-000000000002','Excel HQ','EX-HQ','Petaling Jaya demo delivery point','Petaling Jaya','HQ reception','013-000-2200','reception@excel.example',NULL,true),
  ('20000000-0000-4000-8000-000000000003','B-003','10000000-0000-4000-8000-000000000003','Unibax centre','UB-CEN','Shah Alam demo delivery point','Shah Alam','Centre reception','014-000-3300','reception@unibax.example',NULL,true)
ON CONFLICT DO NOTHING;

INSERT INTO suppliers (
  id, supplier_code, name, category, contact_name, phone, email, address,
  coverage_area, payment_terms, lead_time_days, minimum_order_quantity,
  main_products, active
) VALUES
  ('30000000-0000-4000-8000-000000000001','S-001','Office World','Office Basics','Sales desk','011-000-0001','sales1@supplier.example','Office World demo address','Klang Valley','Cash on delivery (COD)',1,1,'Paper, pens',true),
  ('30000000-0000-4000-8000-000000000002','S-002','Pantry Plus','Pantry / Hospitality','Sales desk','011-000-0002','sales2@supplier.example','Pantry Plus demo address','Klang Valley','Cash on delivery (COD)',1,1,'Beverages, cups',true),
  ('30000000-0000-4000-8000-000000000003','S-003','Stationery Hub','Office Basics','Sales desk','011-000-0003','sales3@supplier.example','Stationery Hub demo address','Klang Valley','Cash on delivery (COD)',2,1,'Folders, notebooks',true),
  ('30000000-0000-4000-8000-000000000004','S-004','CleanPro Supplies','Cleaning & Hygiene','Sales desk','011-000-0004','sales4@supplier.example','CleanPro demo address','Selangor','Cash on delivery (COD)',1,1,'Tissue, detergent',true),
  ('30000000-0000-4000-8000-000000000005','S-005','PrintMaster','Printing & Branding / Marketing','Sales desk','011-000-0005','sales5@supplier.example','PrintMaster demo address','Klang Valley','Cash on delivery (COD)',3,1,'Cards, banners',true),
  ('30000000-0000-4000-8000-000000000006','S-006','Hospitality Wholesalers','Pantry / Hospitality','Sales desk','011-000-0006','sales6@supplier.example','Hospitality Wholesalers demo address','Klang Valley','Cash on delivery (COD)',2,1,'Cutlery, napkins',true),
  ('30000000-0000-4000-8000-000000000007','S-007','Hygiene Masters','Cleaning & Hygiene','Sales desk','011-000-0007','sales7@supplier.example','Hygiene Masters demo address','Selangor','Cash on delivery (COD)',1,1,'Soap, sanitizer',true),
  ('30000000-0000-4000-8000-000000000008','S-008','Tech Office Supply','Office Basics','Sales desk','011-000-0008','sales8@supplier.example','Tech Office Supply demo address','Kuala Lumpur','Cash on delivery (COD)',3,1,'Computer accessories',true),
  ('30000000-0000-4000-8000-000000000009','S-009','QuickPrint','Printing & Branding / Marketing','Sales desk','011-000-0009','sales9@supplier.example','QuickPrint demo address','Petaling Jaya','Cash on delivery (COD)',2,1,'Labels, flyers',true),
  ('30000000-0000-4000-8000-000000000010','S-010','Beverage Source','Pantry / Hospitality','Sales desk','011-000-0010','sales10@supplier.example','Beverage Source demo address','Klang Valley','Cash on delivery (COD)',1,1,'Water, tea, coffee',true)
ON CONFLICT DO NOTHING;

INSERT INTO products (
  id, product_code, name, category, subcategory, unit_of_measure,
  default_buy_price, default_sell_price, minimum_order_quantity,
  delivery_sla_days, active, needs_review
) VALUES
  ('40000000-0000-4000-8000-000000000001','AX-CLN-001','Toilet tissue roll','Cleaning & Hygiene','Tissue','Roll',50,60,12,2,true,false),
  ('40000000-0000-4000-8000-000000000002','AX-CLN-002','Dishwashing liquid','Cleaning & Hygiene','Cleaning liquid','Bottle',10,15,3,2,true,false),
  ('40000000-0000-4000-8000-000000000003','AX-PAN-001','Paper cup - white','Pantry / Hospitality','Disposable cups','Pack',5,8,1,1,true,false),
  ('40000000-0000-4000-8000-000000000004','AX-OFF-001','A4 paper 70gsm','Office Basics','Paper','Ream',10,14,5,1,true,false),
  ('40000000-0000-4000-8000-000000000005','AX-PRN-001','Business cards 100s','Printing & Branding / Marketing','Cards','Box',25,40,1,3,true,false),
  ('40000000-0000-4000-8000-000000000006','AX-PAN-002','Mineral water carton','Pantry / Hospitality','Beverages','Carton',12,18,1,1,true,false),
  ('40000000-0000-4000-8000-000000000007','AX-PAN-003','Tea bags 100s','Pantry / Hospitality','Beverages','Box',15,22,1,1,true,false),
  ('40000000-0000-4000-8000-000000000008','AX-PAN-004','Instant coffee','Pantry / Hospitality','Beverages','Jar',18,27,1,1,true,false),
  ('40000000-0000-4000-8000-000000000009','AX-OFF-002','Blue ballpoint pens','Office Basics','Writing','Box',9,14,1,1,true,false),
  ('40000000-0000-4000-8000-000000000010','AX-OFF-003','Lever arch file','Office Basics','Filing','Piece',6,10,1,2,true,false),
  ('40000000-0000-4000-8000-000000000011','AX-OFF-004','Sticky notes','Office Basics','Desk supplies','Pack',4,7,1,1,true,false),
  ('40000000-0000-4000-8000-000000000012','AX-OFF-005','Whiteboard markers','Office Basics','Writing','Pack',12,18,1,1,true,false),
  ('40000000-0000-4000-8000-000000000013','AX-CLN-003','Hand wash','Cleaning & Hygiene','Hand hygiene','Bottle',8,13,2,1,true,false),
  ('40000000-0000-4000-8000-000000000014','AX-CLN-004','Surface sanitizer','Cleaning & Hygiene','Sanitizer','Bottle',14,21,2,1,true,false),
  ('40000000-0000-4000-8000-000000000015','AX-CLN-005','Microfiber cloth','Cleaning & Hygiene','Cloths','Pack',7,11,2,2,true,false),
  ('40000000-0000-4000-8000-000000000016','AX-PAN-005','Wooden stirrers','Pantry / Hospitality','Disposable','Pack',3,6,2,1,true,false),
  ('40000000-0000-4000-8000-000000000017','AX-PAN-006','Paper napkins','Pantry / Hospitality','Disposable','Pack',4,7,2,1,true,false),
  ('40000000-0000-4000-8000-000000000018','AX-PRN-002','A5 flyers','Printing & Branding / Marketing','Flyers','Pack',35,55,1,3,true,false),
  ('40000000-0000-4000-8000-000000000019','AX-PRN-003','Name labels','Printing & Branding / Marketing','Labels','Sheet',8,14,1,2,true,false),
  ('40000000-0000-4000-8000-000000000020','AX-OFF-006','USB keyboard','Office Basics','Computer accessories','Piece',35,49,1,3,true,false),
  ('40000000-0000-4000-8000-000000000021','AX-OFF-007','Wireless mouse','Office Basics','Computer accessories','Piece',28,42,1,3,true,false),
  ('40000000-0000-4000-8000-000000000022','AX-OFF-008','A4 envelopes','Office Basics','Mailing','Pack',10,16,1,1,true,false),
  ('40000000-0000-4000-8000-000000000023','AX-OFF-009','Highlighters 4s','Office Basics','Writing','Pack',8,13,1,1,true,false),
  ('40000000-0000-4000-8000-000000000024','AX-OFF-010','Desk organizer','Office Basics','Desk supplies','Piece',16,24,1,2,true,false),
  ('40000000-0000-4000-8000-000000000025','AX-OFF-011','Highlighters 4s','Office Basics','Writing','Pack',8,13,1,1,true,true)
ON CONFLICT DO NOTHING;

INSERT INTO product_suppliers (
  product_id, supplier_id, preferred, indicative_buy_price, supplier_moq,
  lead_time_days, active
) VALUES
  ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000004',true,50,12,2,true),
  ('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000004',true,10,3,2,true),
  ('40000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000002',true,5,1,1,true),
  ('40000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001',true,10,5,1,true),
  ('40000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000005',true,25,1,3,true),
  ('40000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000002',true,12,1,1,true),
  ('40000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000010',true,15,1,1,true),
  ('40000000-0000-4000-8000-000000000008','30000000-0000-4000-8000-000000000010',true,18,1,1,true),
  ('40000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000003',true,9,1,1,true),
  ('40000000-0000-4000-8000-000000000010','30000000-0000-4000-8000-000000000003',true,6,1,2,true),
  ('40000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000003',true,4,1,1,true),
  ('40000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000003',true,12,1,1,true),
  ('40000000-0000-4000-8000-000000000013','30000000-0000-4000-8000-000000000007',true,8,2,1,true),
  ('40000000-0000-4000-8000-000000000014','30000000-0000-4000-8000-000000000007',true,14,2,1,true),
  ('40000000-0000-4000-8000-000000000015','30000000-0000-4000-8000-000000000004',true,7,2,2,true),
  ('40000000-0000-4000-8000-000000000016','30000000-0000-4000-8000-000000000006',true,3,2,1,true),
  ('40000000-0000-4000-8000-000000000017','30000000-0000-4000-8000-000000000006',true,4,2,1,true),
  ('40000000-0000-4000-8000-000000000018','30000000-0000-4000-8000-000000000009',true,35,1,3,true),
  ('40000000-0000-4000-8000-000000000019','30000000-0000-4000-8000-000000000009',true,8,1,2,true),
  ('40000000-0000-4000-8000-000000000020','30000000-0000-4000-8000-000000000008',true,35,1,3,true),
  ('40000000-0000-4000-8000-000000000021','30000000-0000-4000-8000-000000000008',true,28,1,3,true),
  ('40000000-0000-4000-8000-000000000022','30000000-0000-4000-8000-000000000001',true,10,1,1,true),
  ('40000000-0000-4000-8000-000000000023','30000000-0000-4000-8000-000000000003',true,8,1,1,true),
  ('40000000-0000-4000-8000-000000000024','30000000-0000-4000-8000-000000000003',true,16,1,2,true),
  ('40000000-0000-4000-8000-000000000025','30000000-0000-4000-8000-000000000003',true,8,1,1,true)
ON CONFLICT DO NOTHING;

INSERT INTO requests (
  id, order_code, request_date, request_type_id, company_id, branch_id,
  department, requested_by, requester_contact, needed_by_date, urgency_id,
  status_id, notes, issue_reason, completed_at
) VALUES
  ('50000000-0000-4000-8000-000000000001','ORD-2026-001','2026-07-08',lookup_id('request_type','Standard'),'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Administration','Pilot user','012-000-0000','2026-07-25',lookup_id('urgency','Normal'),lookup_id('request_status','New Request'),NULL,NULL,NULL),
  ('50000000-0000-4000-8000-000000000002','ORD-2026-002','2026-07-09',lookup_id('request_type','Standard'),'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Student services','Pilot user','012-000-0000','2026-07-26',lookup_id('urgency','Normal'),lookup_id('request_status','Under Verification'),NULL,NULL,NULL),
  ('50000000-0000-4000-8000-000000000003','ORD-2026-003','2026-07-10',lookup_id('request_type','Ad-hoc'),'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Events','Pilot user','012-000-0000','2026-07-23',lookup_id('urgency','Urgent'),lookup_id('request_status','Waiting for Quotation'),NULL,NULL,NULL),
  ('50000000-0000-4000-8000-000000000004','ORD-2026-004','2026-07-11',lookup_id('request_type','Ad-hoc'),'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Marketing','Pilot user','012-000-0000','2026-07-30',lookup_id('urgency','High'),lookup_id('request_status','Waiting for Approval'),'New branded folder requested; specification review required.',NULL,NULL),
  ('50000000-0000-4000-8000-000000000005','ORD-2026-005','2026-07-12',lookup_id('request_type','Standard'),'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Finance','Pilot user','012-000-0000','2026-07-27',lookup_id('urgency','Normal'),lookup_id('request_status','Cancelled'),NULL,'Duplicate request submitted during the test.',NULL),
  ('50000000-0000-4000-8000-000000000006','ORD-2026-006','2026-07-13',lookup_id('request_type','Standard'),'10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','IT','Pilot user','013-000-0000','2026-07-28',lookup_id('urgency','High'),lookup_id('request_status','Supplier Assigned'),NULL,NULL,NULL),
  ('50000000-0000-4000-8000-000000000007','ORD-2026-007','2026-07-14',lookup_id('request_type','Ad-hoc'),'10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Facilities','Pilot user','013-000-0000','2026-07-29',lookup_id('urgency','Normal'),lookup_id('request_status','Waiting for Quotation'),'Testing a supplier not yet in the approved master.',NULL,NULL),
  ('50000000-0000-4000-8000-000000000008','ORD-2026-008','2026-07-15',lookup_id('request_type','Standard'),'10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Administration','Pilot user','013-000-0000','2026-07-21',lookup_id('urgency','Urgent'),lookup_id('request_status','Out for Delivery'),NULL,'Supplier vehicle delay.',NULL),
  ('50000000-0000-4000-8000-000000000009','ORD-2026-009','2026-07-16',lookup_id('request_type','Standard'),'10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Accounts','Pilot user','013-000-0000','2026-07-20',lookup_id('urgency','Normal'),lookup_id('request_status','Invoice Issued'),NULL,NULL,NULL),
  ('50000000-0000-4000-8000-000000000010','ORD-2026-010','2026-07-17',lookup_id('request_type','Standard'),'10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Teaching','Pilot user','013-000-0000','2026-07-31',lookup_id('urgency','Low'),lookup_id('request_status','On Hold'),NULL,'Duplicate product record must be reviewed.',NULL),
  ('50000000-0000-4000-8000-000000000011','ORD-2026-011','2026-07-18',lookup_id('request_type','Ad-hoc'),'10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','Operations','Pilot user','014-000-0000','2026-07-19',lookup_id('urgency','Normal'),lookup_id('request_status','Invoice Issued'),NULL,NULL,NULL),
  ('50000000-0000-4000-8000-000000000012','ORD-2026-012','2026-07-19',lookup_id('request_type','Standard'),'10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','Administration','Pilot user','014-000-0000','2026-07-22',lookup_id('urgency','High'),lookup_id('request_status','Invoice Issued'),NULL,NULL,NULL),
  ('50000000-0000-4000-8000-000000000013','ORD-2026-013','2026-07-20',lookup_id('request_type','Standard'),'10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','Facilities','Pilot user','014-000-0000','2026-07-24',lookup_id('urgency','Normal'),lookup_id('request_status','Preparing for Delivery'),NULL,NULL,NULL),
  ('50000000-0000-4000-8000-000000000014','ORD-2026-014','2026-07-21',lookup_id('request_type','Ad-hoc'),'10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','Marketing','Pilot user','014-000-0000','2026-08-02',lookup_id('urgency','Normal'),lookup_id('request_status','Waiting for Quotation'),NULL,NULL,NULL),
  ('50000000-0000-4000-8000-000000000015','ORD-2026-015','2026-07-22',lookup_id('request_type','Recurring'),'10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','Office','Pilot user','014-000-0000','2026-08-01',lookup_id('urgency','Low'),lookup_id('request_status','Approved'),NULL,NULL,NULL)
ON CONFLICT DO NOTHING;

INSERT INTO request_lines (
  id, request_line_code, request_id, product_id, product_name_snapshot,
  category_snapshot, subcategory_snapshot, specification, quantity,
  unit_of_measure, selected_supplier_id, quotation_reference,
  supplier_confirmation_status_id, unit_buy_price, unit_sell_price,
  delivery_charge
) VALUES
  ('60000000-0000-4000-8000-000000000001','REQ-2026-00001','50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004','A4 paper 70gsm','Office Basics','Paper',NULL,10,'Ream','30000000-0000-4000-8000-000000000001',NULL,lookup_id('supplier_confirmation','Confirmed'),10,14,5),
  ('60000000-0000-4000-8000-000000000002','REQ-2026-00002','50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000006','Mineral water carton','Pantry / Hospitality','Beverages',NULL,5,'Carton','30000000-0000-4000-8000-000000000002',NULL,lookup_id('supplier_confirmation','Confirmed'),12,18,5),
  ('60000000-0000-4000-8000-000000000003','REQ-2026-00003','50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000003','Paper cup - white','Pantry / Hospitality','Disposable cups',NULL,5,'Pack','30000000-0000-4000-8000-000000000002',NULL,lookup_id('supplier_confirmation','Confirmed'),5,8,5),
  ('60000000-0000-4000-8000-000000000004','REQ-2026-00004','50000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000018','A5 flyers','Printing & Branding / Marketing','Flyers','A5 full-colour demo print',2,'Pack','30000000-0000-4000-8000-000000000009',NULL,lookup_id('supplier_confirmation','Quotation Requested'),35,55,5),
  ('60000000-0000-4000-8000-000000000005','REQ-2026-00005','50000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000019','Name labels','Printing & Branding / Marketing','Labels','Demo branded labels',4,'Sheet','30000000-0000-4000-8000-000000000009','QT-DEMO-004',lookup_id('supplier_confirmation','Quotation Received'),8,14,5),
  ('60000000-0000-4000-8000-000000000006','REQ-2026-00006','50000000-0000-4000-8000-000000000005','40000000-0000-4000-8000-000000000022','A4 envelopes','Office Basics','Mailing',NULL,2,'Pack','30000000-0000-4000-8000-000000000001',NULL,lookup_id('supplier_confirmation','Confirmed'),10,16,5),
  ('60000000-0000-4000-8000-000000000007','REQ-2026-00007','50000000-0000-4000-8000-000000000006','40000000-0000-4000-8000-000000000020','USB keyboard','Office Basics','Computer accessories',NULL,4,'Piece','30000000-0000-4000-8000-000000000008',NULL,lookup_id('supplier_confirmation','Confirmed'),35,49,5),
  ('60000000-0000-4000-8000-000000000008','REQ-2026-00008','50000000-0000-4000-8000-000000000007','40000000-0000-4000-8000-000000000015','Microfiber cloth','Cleaning & Hygiene','Cloths','New supplier test',3,'Pack',NULL,NULL,lookup_id('supplier_confirmation','Quotation Requested'),7,11,5),
  ('60000000-0000-4000-8000-000000000009','REQ-2026-00009','50000000-0000-4000-8000-000000000008','40000000-0000-4000-8000-000000000001','Toilet tissue roll','Cleaning & Hygiene','Tissue',NULL,6,'Roll','30000000-0000-4000-8000-000000000004',NULL,lookup_id('supplier_confirmation','Confirmed'),50,60,5),
  ('60000000-0000-4000-8000-000000000010','REQ-2026-00010','50000000-0000-4000-8000-000000000009','40000000-0000-4000-8000-000000000010','Lever arch file','Office Basics','Filing',NULL,10,'Piece','30000000-0000-4000-8000-000000000003',NULL,lookup_id('supplier_confirmation','Confirmed'),6,10,5),
  ('60000000-0000-4000-8000-000000000011','REQ-2026-00011','50000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000025','Highlighters 4s','Office Basics','Writing','Intentional duplicate-control test',3,'Pack','30000000-0000-4000-8000-000000000003',NULL,lookup_id('supplier_confirmation','Pending'),8,13,5),
  ('60000000-0000-4000-8000-000000000012','REQ-2026-00012','50000000-0000-4000-8000-000000000011','40000000-0000-4000-8000-000000000005','Business cards 100s','Printing & Branding / Marketing','Cards','Demo business card specification',1,'Box','30000000-0000-4000-8000-000000000005',NULL,lookup_id('supplier_confirmation','Confirmed'),25,40,5),
  ('60000000-0000-4000-8000-000000000013','REQ-2026-00013','50000000-0000-4000-8000-000000000012','40000000-0000-4000-8000-000000000008','Instant coffee','Pantry / Hospitality','Beverages',NULL,3,'Jar','30000000-0000-4000-8000-000000000010',NULL,lookup_id('supplier_confirmation','Confirmed'),18,27,5),
  ('60000000-0000-4000-8000-000000000014','REQ-2026-00014','50000000-0000-4000-8000-000000000013','40000000-0000-4000-8000-000000000013','Hand wash','Cleaning & Hygiene','Hand hygiene',NULL,8,'Bottle','30000000-0000-4000-8000-000000000007',NULL,lookup_id('supplier_confirmation','Confirmed'),8,13,5),
  ('60000000-0000-4000-8000-000000000015','REQ-2026-00015','50000000-0000-4000-8000-000000000014','40000000-0000-4000-8000-000000000017','Paper napkins','Pantry / Hospitality','Disposable',NULL,10,'Pack','30000000-0000-4000-8000-000000000006','QT-DEMO-014',lookup_id('supplier_confirmation','Quotation Received'),4,7,5),
  ('60000000-0000-4000-8000-000000000016','REQ-2026-00016','50000000-0000-4000-8000-000000000015','40000000-0000-4000-8000-000000000007','Tea bags 100s','Pantry / Hospitality','Beverages',NULL,2,'Box','30000000-0000-4000-8000-000000000010',NULL,lookup_id('supplier_confirmation','Confirmed'),15,22,5),
  ('60000000-0000-4000-8000-000000000017','REQ-2026-00017','50000000-0000-4000-8000-000000000015','40000000-0000-4000-8000-000000000009','Blue ballpoint pens','Office Basics','Writing',NULL,2,'Box','30000000-0000-4000-8000-000000000003',NULL,lookup_id('supplier_confirmation','Confirmed'),9,14,5)
ON CONFLICT DO NOTHING;

INSERT INTO quotations (
  id, request_line_id, supplier_id, quotation_reference, quotation_date,
  unit_price, delivery_charge, minimum_order_quantity, lead_time_days,
  valid_until, status_id, selected, selection_reason
) VALUES
  ('a0000000-0000-4000-8000-000000000004','60000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000009','QT-DEMO-004','2026-07-11',8,5,1,2,'2026-08-10',lookup_id('quotation_status','Received'),false,NULL),
  ('a0000000-0000-4000-8000-000000000014','60000000-0000-4000-8000-000000000015','30000000-0000-4000-8000-000000000006','QT-DEMO-014','2026-07-21',4,5,2,1,'2026-08-20',lookup_id('quotation_status','Received'),false,NULL)
ON CONFLICT DO NOTHING;

INSERT INTO deliveries (
  id, request_line_id, expected_date, revised_date, actual_date, status_id,
  quantity_received, received_by, issue_reason
) VALUES
  ('70000000-0000-4000-8000-000000000008','60000000-0000-4000-8000-000000000009','2026-07-21','2026-07-23',NULL,lookup_id('delivery_status','Delayed'),0,NULL,'Supplier vehicle delay.'),
  ('70000000-0000-4000-8000-000000000009','60000000-0000-4000-8000-000000000010','2026-07-20',NULL,'2026-07-20',lookup_id('delivery_status','Delivered'),10,'Demo receiver',NULL),
  ('70000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000012','2026-07-19',NULL,'2026-07-19',lookup_id('delivery_status','Delivered'),1,'Demo receiver',NULL),
  ('70000000-0000-4000-8000-000000000012','60000000-0000-4000-8000-000000000013','2026-07-22',NULL,'2026-07-22',lookup_id('delivery_status','Delivered'),3,'Demo receiver',NULL),
  ('70000000-0000-4000-8000-000000000013','60000000-0000-4000-8000-000000000014','2026-07-24',NULL,'2026-07-22',lookup_id('delivery_status','Partially Delivered'),4,'Demo receiver',NULL)
ON CONFLICT DO NOTHING;

INSERT INTO approvals (
  id, request_id, approval_type, status, reason, decided_at
) VALUES
  ('b0000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000002','Company approval','Approved','Sanitized company approval','2026-06-30 10:00:00+08'),
  ('b0000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000003','Company approval','Approved','Sanitized company approval','2026-06-30 10:00:00+08'),
  ('b0000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000004','Company approval','Approved','Sanitized company approval','2026-06-30 10:00:00+08'),
  ('b0000000-0000-4000-8000-000000000006','50000000-0000-4000-8000-000000000006','Company approval','Approved','Sanitized company approval','2026-06-30 10:00:00+08'),
  ('b0000000-0000-4000-8000-000000000007','50000000-0000-4000-8000-000000000007','Company approval','Approved','Sanitized company approval','2026-06-30 10:00:00+08'),
  ('b0000000-0000-4000-8000-000000000008','50000000-0000-4000-8000-000000000008','Company approval','Approved','Sanitized company approval','2026-06-30 10:00:00+08'),
  ('b0000000-0000-4000-8000-000000000009','50000000-0000-4000-8000-000000000009','Company approval','Approved','Sanitized company approval','2026-06-30 10:00:00+08'),
  ('b0000000-0000-4000-8000-000000000010','50000000-0000-4000-8000-000000000010','Company approval','Approved','Sanitized company approval','2026-06-30 10:00:00+08'),
  ('b0000000-0000-4000-8000-000000000011','50000000-0000-4000-8000-000000000011','Company approval','Approved','Sanitized company approval','2026-06-30 10:00:00+08'),
  ('b0000000-0000-4000-8000-000000000012','50000000-0000-4000-8000-000000000012','Company approval','Approved','Sanitized company approval','2026-06-30 10:00:00+08'),
  ('b0000000-0000-4000-8000-000000000013','50000000-0000-4000-8000-000000000013','Company approval','Approved','Sanitized company approval','2026-06-30 10:00:00+08'),
  ('b0000000-0000-4000-8000-000000000014','50000000-0000-4000-8000-000000000014','Company approval','Approved','Sanitized company approval','2026-06-30 10:00:00+08'),
  ('b0000000-0000-4000-8000-000000000015','50000000-0000-4000-8000-000000000015','Company approval','Approved','Sanitized company approval','2026-06-30 10:00:00+08')
ON CONFLICT DO NOTHING;

INSERT INTO invoices (
  id, direction, request_id, company_id, supplier_id, invoice_number,
  invoice_date, due_date, amount, status_id, notes
) VALUES
  ('80000000-0000-4000-8000-000000000009','CUSTOMER','50000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000002',NULL,'CINV-DEMO-009','2026-07-20','2026-08-19',100,lookup_id('invoice_status','Issued'),NULL),
  ('80000000-0000-4000-8000-000000000011','CUSTOMER','50000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000003',NULL,'CINV-DEMO-011','2026-07-19','2026-08-18',40,lookup_id('invoice_status','Issued'),NULL),
  ('80000000-0000-4000-8000-000000000012','CUSTOMER','50000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000003',NULL,'CINV-DEMO-012','2026-07-22','2026-08-21',81,lookup_id('invoice_status','Issued'),NULL),
  ('80000000-0000-4000-8000-000000000109','SUPPLIER','50000000-0000-4000-8000-000000000009',NULL,'30000000-0000-4000-8000-000000000003','SINV-DEMO-009','2026-07-20','2026-08-19',60,lookup_id('invoice_status','Issued'),'Sanitized outstanding supplier-payment example.')
ON CONFLICT DO NOTHING;

INSERT INTO invoice_allocations (invoice_id, request_line_id, allocated_amount) VALUES
  ('80000000-0000-4000-8000-000000000009','60000000-0000-4000-8000-000000000010',100),
  ('80000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000012',40),
  ('80000000-0000-4000-8000-000000000012','60000000-0000-4000-8000-000000000013',81),
  ('80000000-0000-4000-8000-000000000109','60000000-0000-4000-8000-000000000010',60)
ON CONFLICT DO NOTHING;

INSERT INTO payments (
  id, invoice_id, payment_date, amount, method, reference, notes
) VALUES
  ('90000000-0000-4000-8000-000000000009','80000000-0000-4000-8000-000000000009','2026-07-20',100,'Cash on delivery (COD)','PAY-DEMO-009','Sanitized COD payment example.'),
  ('90000000-0000-4000-8000-000000000011','80000000-0000-4000-8000-000000000011','2026-07-19',40,'Cash on delivery (COD)','PAY-DEMO-011','Sanitized COD payment example.')
ON CONFLICT DO NOTHING;

UPDATE requests
SET status_id=lookup_id('request_status','Completed'),
    completed_at=CASE id
      WHEN '50000000-0000-4000-8000-000000000009'::uuid THEN '2026-07-20 16:00:00+08'::timestamptz
      WHEN '50000000-0000-4000-8000-000000000011'::uuid THEN '2026-07-19 15:00:00+08'::timestamptz
      ELSE completed_at
    END
WHERE id IN (
  '50000000-0000-4000-8000-000000000009',
  '50000000-0000-4000-8000-000000000011'
);

COMMIT;
