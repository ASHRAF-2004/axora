import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

describe("supplier quantity and commercial pricing migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN");
    await applyMigrations(db);
    await applyDemoSeed(db);
    await db.exec(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,is_owner,
        account_setup_completed_at,account_kind,account_status,active,auth_version
      ) SELECT
        'f6000000-0000-4000-8000-000000000001',
        'commercial-owner-060@example.test','Commercial owner 060',
        'not-a-real-hash',role.id,NULL,true,now(),'PLATFORM','ACTIVE',true,1
      FROM roles role WHERE role.role_key='PLATFORM_OWNER';
      INSERT INTO role_assignments(
        id,user_id,role_id,scope_type,active
      ) SELECT
        'f6000000-0000-4000-8000-000000000002',
        'f6000000-0000-4000-8000-000000000001',role.id,'PLATFORM',true
      FROM roles role WHERE role.role_key='PLATFORM_OWNER';
    `);
  }, 40_000);

  afterAll(async () => {
    await db.close();
  });

  it("publishes only deterministic selling prices and safe supplier quantity terms", async () => {
    const result = await db.query<{
      base_cost: number;
      raw_price: number;
      selling_price: number;
      markup: number;
      currency: string;
      minimum: number;
      increment: number;
      pack_size: number;
    }>(`
      SELECT offer.base_cost::float8,
        offer.selling_price_raw::float8 AS raw_price,
        safe.default_sell_price::float8 AS selling_price,
        offer.markup_percentage::float8 AS markup,
        safe.price_currency AS currency,
        safe.minimum_order_quantity::float8 AS minimum,
        safe.order_increment::float8 AS increment,
        safe.pack_size::float8 AS pack_size
      FROM products product
      JOIN v_customer_catalog_products safe ON safe.id=product.id
      CROSS JOIN LATERAL axora_current_product_offer_internal(product.id,now()) offer
      ORDER BY product.product_code LIMIT 1
    `);
    const row = result.rows[0];
    expect(row.markup).toBe(10);
    expect(row.currency).toBe("MYR");
    expect(row.raw_price).toBeCloseTo(row.base_cost * 1.1, 5);
    expect(row.selling_price).toBe(Math.round(row.raw_price * 100) / 100);
    expect(row.minimum).toBeGreaterThanOrEqual(1);
    expect(row.increment).toBeGreaterThanOrEqual(1);
    expect(row.pack_size).toBeGreaterThanOrEqual(1);
  });

  it("enforces boundaries and records versioned supplier-product rule history", async () => {
    expect((await db.query<{ valid: boolean }>(`
      SELECT axora_quantity_is_valid(5,5,20,5) AS valid
    `)).rows[0].valid).toBe(true);
    for (const quantity of [4, 6, 21, 5.5]) {
      expect((await db.query<{ valid: boolean }>(`
        SELECT axora_quantity_is_valid($1,5,20,5) AS valid
      `, [quantity])).rows[0].valid).toBe(false);
    }

    const relation = await db.query<{ id: string; version: number }>(`
      SELECT id::text,quantity_rule_version AS version
      FROM product_suppliers ORDER BY created_at LIMIT 1
    `);
    await db.query(`
      UPDATE product_suppliers SET supplier_moq=5,maximum_order_quantity=20,
        order_increment=5,pack_size=10,pack_unit='pieces',
        quantity_rule_reason='Supplier carton rule confirmed for testing'
      WHERE id=$1
    `, [relation.rows[0].id]);
    const history = await db.query<{ version: number; minimum: number; maximum: number }>(`
      SELECT version,minimum_quantity::float8 AS minimum,
        maximum_quantity::float8 AS maximum
      FROM product_supplier_quantity_rule_history
      WHERE product_supplier_id=$1 ORDER BY version DESC LIMIT 1
    `, [relation.rows[0].id]);
    expect(history.rows[0]).toEqual({
      version: relation.rows[0].version + 1,
      minimum: 5,
      maximum: 20,
    });
    await expect(db.query(`
      UPDATE product_supplier_quantity_rule_history SET reason='rewritten'
      WHERE product_supplier_id=$1
    `, [relation.rows[0].id])).rejects.toThrow("append-only");
  });

  it("keeps different supplier rules independent for the same product", async () => {
    const source = await db.query<{
      product_id: string;
      supplier_id: string;
      alternate_supplier_id: string;
      buy_price: number;
    }>(`
      SELECT relation.product_id::text,relation.supplier_id::text,
        alternate.id::text AS alternate_supplier_id,
        relation.indicative_buy_price::float8 AS buy_price
      FROM product_suppliers relation
      CROSS JOIN LATERAL (
        SELECT supplier.id FROM suppliers supplier
        WHERE supplier.active AND supplier.company_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM product_suppliers existing
            WHERE existing.product_id=relation.product_id
              AND existing.supplier_id=supplier.id
          )
        ORDER BY supplier.id LIMIT 1
      ) alternate
      WHERE relation.preferred AND relation.active
      ORDER BY relation.created_at LIMIT 1
    `);
    const row = source.rows[0];
    const alternate = await db.query<{
      id: string;
      minimum: number;
      maximum: number;
      increment: number;
      pack_size: number;
    }>(`
      INSERT INTO product_suppliers(
        product_id,supplier_id,preferred,indicative_buy_price,supplier_moq,
        maximum_order_quantity,order_increment,pack_size,pack_unit,
        quantity_rule_reason,lead_time_days,active
      ) VALUES ($1,$2,false,$3,7,19,3,12,'pieces',
        'Alternate supplier case-pack rule',2,true)
      RETURNING id::text,supplier_moq::float8 AS minimum,
        maximum_order_quantity::float8 AS maximum,
        order_increment::float8 AS increment,pack_size::float8
    `, [row.product_id, row.alternate_supplier_id, row.buy_price]);
    expect(alternate.rows[0]).toMatchObject({
      minimum: 7,
      maximum: 19,
      increment: 3,
      pack_size: 12,
    });
    const rules = await db.query<{ supplier_id: string; minimum: number }>(`
      SELECT supplier_id::text,supplier_moq::float8 AS minimum
      FROM product_suppliers WHERE product_id=$1 AND active
      ORDER BY supplier_id
    `, [row.product_id]);
    expect(rules.rows).toHaveLength(2);
    expect(rules.rows.find((rule) => rule.supplier_id === row.supplier_id)?.minimum)
      .not.toBe(7);
  });

  it("records immutable commercial history and exposes it only through an audited capability", async () => {
    const source = await db.query<{ product_id: string; relation_id: string; base_cost: number }>(`
      SELECT product_id::text,relation.id::text AS relation_id,
        indicative_buy_price::float8 AS base_cost
      FROM product_suppliers relation
      WHERE preferred AND active ORDER BY created_at LIMIT 1
    `);
    const row = source.rows[0];
    await db.query("SELECT set_config('axora.change_reason',$1,false)", [
      "Supplier price list revision for commercial history test",
    ]);
    await db.query(`
      UPDATE product_suppliers SET indicative_buy_price=$2 WHERE id=$1
    `, [row.relation_id, row.base_cost + 1]);
    const history = await db.query<{
      id: string;
      base_cost: number;
      raw_price: number;
      selling_price: number;
      markup: number;
      reason: string;
    }>(`
      SELECT id::text,base_cost::float8,
        raw_selling_price::float8 AS raw_price,
        selling_price::float8,markup_percentage::float8 AS markup,reason
      FROM product_commercial_price_history
      WHERE product_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT 1
    `, [row.product_id]);
    expect(history.rows[0].base_cost).toBe(row.base_cost + 1);
    expect(history.rows[0].raw_price).toBeCloseTo((row.base_cost + 1) * 1.1, 5);
    expect(history.rows[0].selling_price)
      .toBe(Math.round(history.rows[0].raw_price * 100) / 100);
    expect(history.rows[0].markup).toBe(10);
    expect(history.rows[0].reason).toContain("Supplier price list revision");
    await expect(db.query(`
      DELETE FROM product_commercial_price_history WHERE id=$1
    `, [history.rows[0].id])).rejects.toThrow("append-only");

    const actor = await db.query<{ id: string; assignment_id: string }>(`
      SELECT assignment.user_id::text AS id,assignment.id::text AS assignment_id
      FROM role_assignments assignment
      WHERE axora_snapshot_has_permission(
        axora_live_authorization_snapshot(
          assignment.user_id,assignment.id,now()
        ),
        'commercial.cost.view','PLATFORM',NULL,NULL,NULL,NULL
      )
      ORDER BY assignment.id LIMIT 1
    `);
    const payload = await db.query<{ history: Array<{ baseCost: number }> }>(`
      SELECT axora_product_commercial_history($1,$2,$3,$4) AS history
    `, [actor.rows[0].id, actor.rows[0].assignment_id, row.product_id, new Date()]);
    expect(payload.rows[0].history[0].baseCost).toBe(row.base_cost + 1);
    const audit = await db.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM audit_logs
      WHERE actor_id=$1 AND record_id=$2 AND action='VIEW'
    `, [actor.rows[0].id, row.product_id]);
    expect(audit.rows[0].count).toBe(1);
  });

  it("freezes submission prices and quantity rules while rechecking supplier selection and PO creation", async () => {
    const context = await db.query<{
      request_id: string;
      product_id: string;
      supplier_id: string;
      minimum: number;
    }>(`
      SELECT request.id::text AS request_id,product.id::text AS product_id,
        supplier_product.supplier_id::text AS supplier_id,
        safe.minimum_order_quantity::float8 AS minimum
      FROM requests request
      CROSS JOIN LATERAL (
        SELECT product.* FROM products product
        JOIN product_suppliers supplier_product ON supplier_product.product_id=product.id
          AND supplier_product.preferred AND supplier_product.active
        ORDER BY product.product_code LIMIT 1
      ) product
      JOIN product_suppliers supplier_product ON supplier_product.product_id=product.id
        AND supplier_product.preferred AND supplier_product.active
      JOIN v_customer_catalog_products safe ON safe.id=product.id
      ORDER BY request.created_at LIMIT 1
    `);
    const source = context.rows[0];
    const created = await db.query<{ id: string }>(`
      INSERT INTO requests(
        order_code,request_date,request_type_id,company_id,branch_id,
        department_id,department,requested_by,requester_contact,needed_by_date,
        urgency_id,status_id,created_by,estimated_delivery_fee,tax_rate,
        budget_account_id,budget_period_id,currency,approval_policy_id
      ) SELECT next_order_code(),current_date,request_type_id,company_id,branch_id,
        department_id,department,requested_by,requester_contact,current_date+7,
        urgency_id,lookup_id('request_status','New Request'),created_by,
        estimated_delivery_fee,tax_rate,budget_account_id,budget_period_id,
        currency,approval_policy_id
      FROM requests WHERE id=$1 RETURNING id::text
    `, [source.request_id]);
    const requestId = created.rows[0].id;
    const line = await db.query<{
      id: string;
      minimum: number;
      base_cost: number;
      raw_price: number;
      sell_price: number;
      markup: number;
      currency: string;
      tax_rate: number;
      tax_treatment: string;
      delivery_treatment: string;
      increment: number;
      pack_size: number;
      pack_unit: string;
    }>(`
      INSERT INTO request_lines(
        request_line_code,request_id,product_id,product_name_snapshot,
        category_snapshot,subcategory_snapshot,quantity,unit_of_measure,
        supplier_confirmation_status_id,unit_buy_price,unit_sell_price
      ) SELECT next_request_line_code(),$1,product.id,product.name,
        product.category,product.subcategory,$3,product.unit_of_measure,
        lookup_id('supplier_confirmation','Pending'),0,0
      FROM products product WHERE product.id=$2
      RETURNING id::text,submitted_minimum_quantity::float8 AS minimum,
        commercial_base_cost_snapshot::float8 AS base_cost,
        commercial_raw_selling_price_snapshot::float8 AS raw_price,
        unit_sell_price::float8 AS sell_price,
        commercial_markup_percentage_snapshot::float8 AS markup,
        commercial_currency_snapshot AS currency,
        commercial_tax_rate_snapshot::float8 AS tax_rate,
        commercial_tax_treatment_snapshot AS tax_treatment,
        commercial_delivery_treatment_snapshot AS delivery_treatment,
        submitted_order_increment::float8 AS increment,
        submitted_pack_size::float8 AS pack_size,
        submitted_pack_unit AS pack_unit
    `, [requestId, source.product_id, source.minimum]);
    const snapshot = line.rows[0];
    expect(snapshot.minimum).toBe(source.minimum);
    expect(snapshot.raw_price).toBeCloseTo(snapshot.base_cost * 1.1, 5);
    expect(snapshot.sell_price).toBe(Math.round(snapshot.raw_price * 100) / 100);
    expect(snapshot.markup).toBe(10);
    expect(snapshot.currency).toBe("MYR");
    expect(snapshot.tax_treatment).toBe("EXCLUDED");
    expect(snapshot.delivery_treatment).toBe("EXCLUDED");
    expect(snapshot.increment).toBeGreaterThanOrEqual(1);
    expect(snapshot.pack_size).toBeGreaterThanOrEqual(1);
    expect(snapshot.pack_unit.length).toBeGreaterThan(0);

    const approvalPayload = await db.query<{ payload: Record<string, unknown> }>(`
      SELECT axora_request_snapshot_payload_internal($1,1,$2,'MYR') AS payload
    `, [requestId, snapshot.sell_price * source.minimum]);
    const serialized = JSON.stringify(approvalPayload.rows[0].payload);
    expect(serialized).toContain("unit_sell_price");
    expect(serialized).not.toContain("commercial_base_cost_snapshot");
    expect(serialized).not.toContain("commercial_markup_percentage_snapshot");

    await db.query(`
      UPDATE product_suppliers SET supplier_moq=$2+1,order_increment=1,
        maximum_order_quantity=NULL,
        quantity_rule_reason='Supplier minimum changed after request submission'
      WHERE product_id=$1 AND supplier_id=$3
    `, [source.product_id, source.minimum, source.supplier_id]);
    await expect(db.query("SELECT axora_validate_request_commercial_snapshots($1)", [requestId]))
      .resolves.not.toThrow();

    const quotation = await db.query<{ id: string }>(`
      INSERT INTO quotations(
        request_line_id,supplier_id,quotation_reference,quotation_date,
        unit_price,delivery_charge,minimum_order_quantity,status_id,selected
      ) VALUES ($1,$2,'P1-RULE-TEST',current_date,$3,0,$4,
        lookup_id('quotation_status','Selected'),true)
      RETURNING id::text
    `, [line.rows[0].id, source.supplier_id, snapshot.base_cost, source.minimum + 1]);
    expect(quotation.rows[0].id).toBeTruthy();
    await expect(db.query(`
      UPDATE request_lines SET selected_supplier_id=$2 WHERE id=$1
    `, [line.rows[0].id, source.supplier_id])).rejects.toThrow("selected supplier rule");

    await db.query(`
      UPDATE product_suppliers SET supplier_moq=$2,order_increment=1,
        quantity_rule_reason='Supplier minimum restored for purchase order'
      WHERE product_id=$1 AND supplier_id=$3
    `, [source.product_id, source.minimum, source.supplier_id]);
    await db.query(`
      UPDATE quotations SET minimum_order_quantity=$2 WHERE id=$1
    `, [quotation.rows[0].id, source.minimum]);
    await db.query(`
      UPDATE request_lines SET selected_supplier_id=$2 WHERE id=$1
    `, [line.rows[0].id, source.supplier_id]);
    await db.query(`
      UPDATE requests SET status_id=lookup_id('request_status','Ordered') WHERE id=$1
    `, [requestId]);
    const evidence = await db.query<{ evidence_type: string }>(`
      SELECT evidence_type FROM request_line_supplier_rule_snapshots
      WHERE request_id=$1 ORDER BY captured_at,id
    `, [requestId]);
    expect(evidence.rows.map((row) => row.evidence_type)).toEqual([
      "SUPPLIER_SELECTION",
      "PURCHASE_ORDER",
    ]);
  });

  it("keeps cost, rule history, and internal calculations unavailable to the app role", async () => {
    await db.exec("SET ROLE axora_app");
    try {
      await expect(db.query("SELECT * FROM commercial_pricing_rules"))
        .rejects.toThrow();
      await expect(db.query("SELECT * FROM product_commercial_price_history"))
        .rejects.toThrow();
      await expect(db.query("SELECT default_buy_price FROM products LIMIT 1"))
        .rejects.toThrow();
      await expect(db.query("SELECT * FROM product_suppliers LIMIT 1"))
        .rejects.toThrow();
      await expect(db.query(`
        SELECT * FROM axora_current_product_offer_internal(
          (SELECT id FROM v_customer_catalog_products LIMIT 1),now()
        )
      `)).rejects.toThrow();
      await expect(db.query("SELECT default_sell_price FROM v_customer_catalog_products LIMIT 1"))
        .resolves.not.toThrow();
    } finally {
      await db.exec("RESET ROLE");
    }
  });
});
