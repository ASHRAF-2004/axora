\set ON_ERROR_STOP on

-- Production-mode tutorial data for screenshot generation only.
-- Run against a disposable database with five bcrypt hashes supplied as psql
-- variables: owner_hash, admin_hash, branch_admin_hash, requester_hash, approver_hash.

BEGIN;

INSERT INTO companies (
  id, company_code, name, industry,
  main_contact_name, main_contact_email, main_contact_phone,
  billing_contact_name, billing_contact_email, billing_contact_phone,
  billing_address, payment_terms, billing_cycle, active
) VALUES
  ('10000000-0000-4000-8000-000000000001','C-001','YourUni','Education','Aisha Rahman','aisha@youruni.example','03-2100 1100','Finance Office','finance@youruni.example','03-2100 1199','Kuala Lumpur, Malaysia','Cash on delivery (COD)','Monthly',true),
  ('10000000-0000-4000-8000-000000000002','C-002','Excel Language Centre','Education','Operations Office','operations@excel.example','03-2200 2100','Finance Office','finance@excel.example','03-2200 2199','Petaling Jaya, Malaysia','Cash on delivery (COD)','Monthly',true),
  ('10000000-0000-4000-8000-000000000003','C-003','Unibax','Business services','Office Management','office@unibax.example','03-2300 3100','Finance Office','finance@unibax.example','03-2300 3199','Shah Alam, Malaysia','Cash on delivery (COD)','Monthly',true)
ON CONFLICT DO NOTHING;

INSERT INTO branches (
  id, branch_code_id, company_id, name, branch_code, delivery_address, city,
  contact_name, contact_phone, contact_email, delivery_instructions,
  monthly_budget, budget_updated_at, active
) VALUES
  ('20000000-0000-4000-8000-000000000001','B-001','10000000-0000-4000-8000-000000000001','Main Campus','YU-MAIN','Jalan Tun Razak, Kuala Lumpur','Kuala Lumpur','Campus Reception','03-2100 1111','reception@youruni.example','Call reception 20 minutes before arrival.',3000,now(),true),
  ('20000000-0000-4000-8000-000000000002','B-002','10000000-0000-4000-8000-000000000001','City Learning Centre','YU-CITY','Bukit Bintang, Kuala Lumpur','Kuala Lumpur','Centre Reception','03-2100 1222','city@youruni.example','Deliver at the ground-floor service entrance.',1800,now(),true),
  ('20000000-0000-4000-8000-000000000003','B-003','10000000-0000-4000-8000-000000000002','Excel HQ','EX-HQ','Petaling Jaya, Selangor','Petaling Jaya','HQ Reception','03-2200 2111','reception@excel.example',NULL,NULL,NULL,true),
  ('20000000-0000-4000-8000-000000000004','B-004','10000000-0000-4000-8000-000000000003','Unibax Centre','UB-CEN','Shah Alam, Selangor','Shah Alam','Centre Reception','03-2300 3111','reception@unibax.example',NULL,NULL,NULL,true)
ON CONFLICT DO NOTHING;

INSERT INTO users (
  id, email, display_name, password_hash, role_id, company_id, branch_id,
  is_owner, active
) VALUES
  ('01000000-0000-4000-8000-000000000001','ashraf.tutorial@axora.local','Ashraf',:'owner_hash',(SELECT id FROM roles WHERE role_key='ADMIN'),NULL,NULL,true,true),
  ('01000000-0000-4000-8000-000000000002','aisha@youruni.example','Aisha Rahman',:'admin_hash',(SELECT id FROM roles WHERE role_key='ADMIN'),'10000000-0000-4000-8000-000000000001',NULL,false,true),
  ('01000000-0000-4000-8000-000000000003','farah@youruni.example','Farah Ahmad',:'branch_admin_hash',(SELECT id FROM roles WHERE role_key='BRANCH_ADMIN'),'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',false,true),
  ('01000000-0000-4000-8000-000000000004','daniel@youruni.example','Daniel Lee',:'requester_hash',(SELECT id FROM roles WHERE role_key='REQUESTER'),'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',false,true),
  ('01000000-0000-4000-8000-000000000005','imani@youruni.example','Nur Imani',:'approver_hash',(SELECT id FROM roles WHERE role_key='APPROVER'),'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',false,true),
  ('01000000-0000-4000-8000-000000000006','admin@excel.example','Excel Administrator',:'admin_hash',(SELECT id FROM roles WHERE role_key='ADMIN'),'10000000-0000-4000-8000-000000000002',NULL,false,true),
  ('01000000-0000-4000-8000-000000000007','admin@unibax.example','Unibax Administrator',:'admin_hash',(SELECT id FROM roles WHERE role_key='ADMIN'),'10000000-0000-4000-8000-000000000003',NULL,false,true)
ON CONFLICT DO NOTHING;

INSERT INTO suppliers (
  id, supplier_code, name, category, contact_name, phone, email, address,
  coverage_area, payment_terms, lead_time_days, minimum_order_quantity,
  main_products, company_id, active
) VALUES
  ('30000000-0000-4000-8000-000000000001','S-001','Metro Office Supply','Office Basics','Sales Desk','03-3100 1001','sales@metro-office.example','Kuala Lumpur','Klang Valley','Cash on delivery (COD)',1,1,'Paper, pens, filing',NULL,true),
  ('30000000-0000-4000-8000-000000000002','S-002','Klang Pantry Wholesale','Pantry / Hospitality','Sales Desk','03-3100 1002','sales@klang-pantry.example','Selangor','Klang Valley','Cash on delivery (COD)',2,1,'Cups, water, pantry items',NULL,true),
  ('30000000-0000-4000-8000-000000000003','S-003','Hygiene Source Malaysia','Cleaning & Hygiene','Sales Desk','03-3100 1003','sales@hygiene-source.example','Selangor','Klang Valley','Cash on delivery (COD)',1,1,'Hand wash and cleaning products',NULL,true)
ON CONFLICT DO NOTHING;

INSERT INTO products (
  id, product_code, name, category, subcategory, brand, product_size,
  unit_of_measure, packaging, description, default_buy_price,
  default_sell_price, minimum_order_quantity, delivery_sla_days,
  company_id, active, needs_review
) VALUES
  ('40000000-0000-4000-8000-000000000001','AX-OFF-001','Premium A4 Copy Paper 80gsm','Office Basics','Paper',NULL,'A4 80gsm','Ream','500 sheets','Bright white multipurpose copy paper for everyday office printing.',11,15,5,1,NULL,true,false),
  ('40000000-0000-4000-8000-000000000002','AX-PAN-001','White Paper Cups 8oz','Pantry / Hospitality','Disposable cups',NULL,'8oz','Pack','50 cups','Food-safe white paper cups for meetings and staff pantry use.',6,9,2,2,NULL,true,false),
  ('40000000-0000-4000-8000-000000000003','AX-CLN-001','Gentle Hand Wash 500ml','Cleaning & Hygiene','Hand hygiene',NULL,'500ml','Bottle','Pump bottle','Mild liquid hand wash supplied in a practical pump bottle.',9,14,2,1,NULL,true,false),
  ('40000000-0000-4000-8000-000000000004','AX-OFF-002','Blue Ballpoint Pens','Office Basics','Writing',NULL,'0.7mm','Box','12 pens','Smooth-writing blue ballpoint pens for classrooms and offices.',10,16,1,1,NULL,true,false),
  ('40000000-0000-4000-8000-000000000005','AX-PAN-002','Mineral Water 500ml','Pantry / Hospitality','Beverages',NULL,'24 × 500ml','Carton','24 bottles','Sealed drinking water cartons for meetings, events, and staff areas.',13,19,1,2,NULL,true,false)
ON CONFLICT DO NOTHING;

INSERT INTO product_suppliers (
  product_id, supplier_id, preferred, indicative_buy_price, supplier_moq,
  lead_time_days, active
) VALUES
  ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',true,11,5,1,true),
  ('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002',true,6,2,2,true),
  ('40000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003',true,9,2,1,true),
  ('40000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001',true,10,1,1,true),
  ('40000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000002',true,13,1,2,true)
ON CONFLICT DO NOTHING;

INSERT INTO requests (
  id, order_code, request_date, request_type_id, company_id, branch_id,
  department, requested_by, requester_contact, needed_by_date, urgency_id,
  status_id, notes, created_by
) VALUES
  ('50000000-0000-4000-8000-000000000001','ORD-2026-0100',CURRENT_DATE,lookup_id('request_type','Standard'),'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Student Services','Daniel Lee','daniel@youruni.example',CURRENT_DATE + 5,lookup_id('urgency','Normal'),lookup_id('request_status','New Request'),'Restock printing and meeting supplies.','01000000-0000-4000-8000-000000000004'),
  ('50000000-0000-4000-8000-000000000002','ORD-2026-0101',CURRENT_DATE - 1,lookup_id('request_type','Standard'),'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Facilities','Daniel Lee','daniel@youruni.example',CURRENT_DATE + 3,lookup_id('urgency','High'),lookup_id('request_status','Under Verification'),'Hand wash for washrooms and pantry sinks.','01000000-0000-4000-8000-000000000004'),
  ('50000000-0000-4000-8000-000000000003','ORD-2026-0102',CURRENT_DATE - 2,lookup_id('request_type','Standard'),'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Administration','Daniel Lee','daniel@youruni.example',CURRENT_DATE + 4,lookup_id('urgency','Normal'),lookup_id('request_status','Waiting for Quotation'),'Monthly stationery replenishment.','01000000-0000-4000-8000-000000000004'),
  ('50000000-0000-4000-8000-000000000004','ORD-2026-0103',CURRENT_DATE - 4,lookup_id('request_type','Standard'),'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Events','Daniel Lee','daniel@youruni.example',CURRENT_DATE + 1,lookup_id('urgency','Urgent'),lookup_id('request_status','Out for Delivery'),'Water and cups for the orientation event.','01000000-0000-4000-8000-000000000004'),
  ('50000000-0000-4000-8000-000000000005','ORD-2026-0104',CURRENT_DATE - 8,lookup_id('request_type','Standard'),'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','Academic Office','Aisha Rahman','aisha@youruni.example',CURRENT_DATE - 3,lookup_id('urgency','Normal'),lookup_id('request_status','Completed'),'Printer paper replenishment.','01000000-0000-4000-8000-000000000002')
ON CONFLICT DO NOTHING;

INSERT INTO request_lines (
  id, request_line_code, request_id, product_id, product_name_snapshot,
  category_snapshot, subcategory_snapshot, quantity, unit_of_measure,
  selected_supplier_id, quotation_reference, supplier_confirmation_status_id,
  unit_buy_price, unit_sell_price, delivery_charge
) VALUES
  ('60000000-0000-4000-8000-000000000001','REQ-2026-01001','50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','Premium A4 Copy Paper 80gsm','Office Basics','Paper',10,'Ream',NULL,NULL,lookup_id('supplier_confirmation','Pending'),11,15,0),
  ('60000000-0000-4000-8000-000000000002','REQ-2026-01002','50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','White Paper Cups 8oz','Pantry / Hospitality','Disposable cups',5,'Pack',NULL,NULL,lookup_id('supplier_confirmation','Pending'),6,9,0),
  ('60000000-0000-4000-8000-000000000003','REQ-2026-01003','50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000003','Gentle Hand Wash 500ml','Cleaning & Hygiene','Hand hygiene',10,'Bottle',NULL,NULL,lookup_id('supplier_confirmation','Pending'),9,14,0),
  ('60000000-0000-4000-8000-000000000004','REQ-2026-01004','50000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000004','Blue Ballpoint Pens','Office Basics','Writing',4,'Box',NULL,NULL,lookup_id('supplier_confirmation','Quotation Requested'),10,16,0),
  ('60000000-0000-4000-8000-000000000005','REQ-2026-01005','50000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000005','Mineral Water 500ml','Pantry / Hospitality','Beverages',8,'Carton','30000000-0000-4000-8000-000000000002','QT-2026-041',lookup_id('supplier_confirmation','Confirmed'),13,19,12),
  ('60000000-0000-4000-8000-000000000006','REQ-2026-01006','50000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000002','White Paper Cups 8oz','Pantry / Hospitality','Disposable cups',6,'Pack','30000000-0000-4000-8000-000000000002','QT-2026-042',lookup_id('supplier_confirmation','Confirmed'),6,9,5),
  ('60000000-0000-4000-8000-000000000007','REQ-2026-01007','50000000-0000-4000-8000-000000000005','40000000-0000-4000-8000-000000000001','Premium A4 Copy Paper 80gsm','Office Basics','Paper',6,'Ream','30000000-0000-4000-8000-000000000001','QT-2026-038',lookup_id('supplier_confirmation','Confirmed'),11,15,8)
ON CONFLICT DO NOTHING;

INSERT INTO approvals (
  id, request_id, approval_type, status, reviewer_id, reason, decided_at
) VALUES
  ('70000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','Company approval','Approved','01000000-0000-4000-8000-000000000005','Essential hygiene restock within branch budget.',now() - interval '1 day'),
  ('70000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003','Company approval','Approved','01000000-0000-4000-8000-000000000005','Approved monthly stationery requirement.',now() - interval '2 days'),
  ('70000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000004','Company approval','Approved','01000000-0000-4000-8000-000000000005','Orientation supplies approved within budget.',now() - interval '4 days'),
  ('70000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000005','Company approval','Approved','01000000-0000-4000-8000-000000000003','Approved for the City Learning Centre.',now() - interval '8 days')
ON CONFLICT DO NOTHING;

INSERT INTO quotations (
  id, request_line_id, supplier_id, quotation_reference, quotation_date,
  unit_price, delivery_charge, minimum_order_quantity, lead_time_days,
  valid_until, status_id, selected, selection_reason
) VALUES
  ('80000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001','QT-2026-051',CURRENT_DATE,10,6,1,1,CURRENT_DATE + 30,lookup_id('quotation_status','Received'),false,NULL),
  ('80000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000002','QT-2026-052',CURRENT_DATE,11,4,1,2,CURRENT_DATE + 30,lookup_id('quotation_status','Received'),false,NULL)
ON CONFLICT DO NOTHING;

INSERT INTO deliveries (
  id, request_line_id, expected_date, revised_date, actual_date, status_id,
  quantity_received, received_by, issue_reason
) VALUES
  ('90000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000005',CURRENT_DATE,CURRENT_DATE + 1,NULL,lookup_id('delivery_status','Delayed'),0,NULL,'Vehicle delay; delivery rescheduled for tomorrow.'),
  ('90000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000006',CURRENT_DATE,NULL,NULL,lookup_id('delivery_status','Out for Delivery'),0,NULL,NULL),
  ('90000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000007',CURRENT_DATE - 4,NULL,CURRENT_DATE - 4,lookup_id('delivery_status','Delivered'),6,'City Centre Reception',NULL)
ON CONFLICT DO NOTHING;

INSERT INTO invoices (
  id, direction, request_id, company_id, supplier_id, invoice_number,
  invoice_date, due_date, amount, status_id
) VALUES
  ('a0000000-0000-4000-8000-000000000001','CUSTOMER','50000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001',NULL,'AX-CINV-2026-014',CURRENT_DATE - 4,CURRENT_DATE - 4,90,lookup_id('invoice_status','Issued')),
  ('a0000000-0000-4000-8000-000000000002','SUPPLIER','50000000-0000-4000-8000-000000000005',NULL,'30000000-0000-4000-8000-000000000001','SUP-INV-8841',CURRENT_DATE - 4,CURRENT_DATE - 4,66,lookup_id('invoice_status','Issued'))
ON CONFLICT DO NOTHING;

INSERT INTO payments (
  id, invoice_id, payment_date, amount, method, reference, recorded_by
) VALUES
  ('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',CURRENT_DATE - 4,90,'Cash on delivery (COD)','COD-RECEIPT-014','01000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002',CURRENT_DATE - 4,66,'Cash on delivery (COD)','SUP-COD-8841','01000000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;

COMMIT;
