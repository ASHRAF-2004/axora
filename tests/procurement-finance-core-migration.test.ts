import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const ids = {
  company: "10000000-0000-4000-8000-000000000001",
  branch: "20000000-0000-4000-8000-000000000001",
  otherBranch: "20000000-0000-4000-8000-000000000002",
  admin: "f8000000-0000-4000-8000-000000000001",
  adminAssignment: "f8000000-0000-4000-8000-000000000002",
  branchAdmin: "f8000000-0000-4000-8000-000000000003",
  branchAdminAssignment: "f8000000-0000-4000-8000-000000000004",
};

describe("Prompt 8 procurement finance core", () => {
  let db: PGlite;

  async function asApp<T>(operation: () => Promise<T>) {
    await db.exec("SET ROLE axora_app");
    try { return await operation(); } finally { await db.exec("RESET ROLE"); }
  }

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN");
    await applyMigrations(db);
    await applyDemoSeed(db);
    await db.query(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,branch_id,
        is_owner,account_setup_completed_at,account_kind,account_status,active,auth_version
      ) SELECT $1,'prompt8-admin@example.test','Prompt 8 administrator','not-a-real-hash',
        role.id,$2,NULL,false,now(),'COMPANY','ACTIVE',true,1
      FROM roles role WHERE role.role_key='COMPANY_ADMIN'
    `, [ids.admin, ids.company]);
    await db.query(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,branch_id,
        is_owner,account_setup_completed_at,account_kind,account_status,active,auth_version
      ) SELECT $1,'prompt8-branch@example.test','Prompt 8 branch administrator','not-a-real-hash',
        role.id,$2,$3,false,now(),'COMPANY','ACTIVE',true,1
      FROM roles role WHERE role.role_key='BRANCH_ADMIN'
    `, [ids.branchAdmin, ids.company, ids.branch]);
    await db.query(`
      INSERT INTO company_memberships(user_id,company_id,status,is_primary,joined_at)
      VALUES ($1,$3,'ACTIVE',true,now()),($2,$3,'ACTIVE',true,now())
    `, [ids.admin, ids.branchAdmin, ids.company]);
    await db.query(`
      INSERT INTO branch_assignments(user_id,company_id,branch_id,status,is_primary)
      VALUES ($1,$3,$4,'ACTIVE',true),($2,$3,$4,'ACTIVE',true)
    `, [ids.admin, ids.branchAdmin, ids.company, ids.branch]);
    await db.query(`
      INSERT INTO role_assignments(id,user_id,role_id,scope_type,company_id,branch_id,active)
      SELECT $2,$1,role.id,'COMPANY',$3,NULL,true FROM roles role WHERE role.role_key='COMPANY_ADMIN'
    `, [ids.admin, ids.adminAssignment, ids.company]);
    await db.query(`
      INSERT INTO role_assignments(id,user_id,role_id,scope_type,company_id,branch_id,active)
      SELECT $2,$1,role.id,'BRANCH',$3,$4,true FROM roles role WHERE role.role_key='BRANCH_ADMIN'
    `, [ids.branchAdmin, ids.branchAdminAssignment, ids.company, ids.branch]);
    await db.query(`
      INSERT INTO role_permissions(role_id,permission_id)
      SELECT role.id,permission.id FROM roles role CROSS JOIN permissions permission
      WHERE (role.role_key='BRANCH_ADMIN'
          AND permission.permission_code='procurement.category_policy.manage')
        OR (role.role_key='COMPANY_ADMIN'
          AND permission.permission_code IN ('request.create','product.view'))
      ON CONFLICT DO NOTHING
    `);
  }, 45_000);

  afterAll(async () => { await db.close(); });

  it("uses an exact 10 percent decimal markup without exposing internal cost in cart JSON", async () => {
    const decimals = await db.query<{ whole: number; line: number; rounded: number }>(`
      SELECT axora_round_commercial_price(100.00,10,2)::float8 AS whole,
        (3*axora_round_commercial_price(100.00,10,2))::float8 AS line,
        axora_round_commercial_price(12.34,10,2)::float8 AS rounded
    `);
    expect(decimals.rows[0]).toEqual({ whole: 110, line: 330, rounded: 13.57 });
    expect((await db.query<{ valid: boolean }>(`
      SELECT axora_customer_quantity_is_valid(1,100) AS valid
    `)).rows[0].valid).toBe(true);
    const product = await db.query<{ publicRef: string }>(`
      SELECT public_reference AS "publicRef" FROM products
      WHERE category='Office Basics' AND default_buy_price=10 ORDER BY id LIMIT 1
    `);
    const read = await asApp(() => db.query<{ cart: { id: string; version: number } }>(`
      SELECT axora_procurement_cart_command(
        $1,$2,$3,'READ',NULL,NULL,'',NULL,$4,now()
      ) AS cart
    `, [ids.admin, ids.adminAssignment, ids.branch, randomUUID()]));
    const commandId = randomUUID();
    const added = await asApp(() => db.query<{ cart: Record<string, unknown> & { items: Array<Record<string, unknown>> } }>(`
      SELECT axora_procurement_cart_command(
        $1,$2,$3,'ADD',$4,3,'',$5,$6,now()
      ) AS cart
    `, [ids.admin, ids.adminAssignment, ids.branch, product.rows[0].publicRef,
      read.rows[0].cart.version, commandId]));
    const replay = await asApp(() => db.query<{ cart: Record<string, unknown> }>(`
      SELECT axora_procurement_cart_command(
        $1,$2,$3,'ADD',$4,3,'',$5,$6,now()
      ) AS cart
    `, [ids.admin, ids.adminAssignment, ids.branch, product.rows[0].publicRef,
      read.rows[0].cart.version, commandId]));
    expect(replay.rows[0].cart).toEqual(added.rows[0].cart);
    expect(added.rows[0].cart.items[0]).toMatchObject({
      unitPrice: "11.00", lineTotal: "33.00", quantity: 3,
    });
    expect(JSON.stringify(added.rows[0].cart)).not.toMatch(/baseCost|margin|supplier/i);
  });

  it("enforces inherited category policy server-side and prevents a child from broadening it", async () => {
    const companyPolicyCommand = randomUUID();
    await asApp(() => db.query(`
      SELECT axora_set_category_policy(
        $1,$2,'COMPANY',$3,NULL,NULL,true,ARRAY['Office Basics'],0,
        'Limit the company to approved office categories',$4,now()
      )
    `, [ids.admin, ids.adminAssignment, ids.company, companyPolicyCommand]));
    await expect(asApp(() => db.query(`
      SELECT axora_set_category_policy(
        $1,$2,'COMPANY',$3,NULL,NULL,false,ARRAY['Office Basics'],0,
        'Limit the company to approved office categories',$4,now()
      )
    `, [ids.admin, ids.adminAssignment, ids.company, companyPolicyCommand])))
      .rejects.toThrow(/unavailable/i);
    const cleaning = await db.query<{ publicRef: string }>(`
      SELECT public_reference AS "publicRef" FROM products
      WHERE category='Cleaning & Hygiene' ORDER BY id LIMIT 1
    `);
    const cart = await asApp(() => db.query<{ cart: { version: number } }>(`
      SELECT axora_procurement_cart_command(
        $1,$2,$3,'READ',NULL,NULL,'',NULL,$4,now()
      ) AS cart
    `, [ids.branchAdmin, ids.branchAdminAssignment, ids.branch, randomUUID()]));
    await expect(asApp(() => db.query(`
      SELECT axora_procurement_cart_command(
        $1,$2,$3,'ADD',$4,1,'',$5,$6,now()
      )
    `, [ids.branchAdmin, ids.branchAdminAssignment, ids.branch,
      cleaning.rows[0].publicRef, cart.rows[0].cart.version, randomUUID()])))
      .rejects.toMatchObject({ code: "P8204" });
    await expect(asApp(() => db.query(`
      SELECT axora_set_category_policy(
        $1,$2,'BRANCH',$3,$4,NULL,true,ARRAY['Cleaning & Hygiene'],0,
        'Attempt to broaden the company restriction',$5,now()
      )
    `, [ids.branchAdmin, ids.branchAdminAssignment, ids.company, ids.branch,
      randomUUID()])))
      .rejects.toMatchObject({ code: "P8210" });
    await expect(asApp(() => db.query(`
      SELECT axora_set_category_policy(
        $1,$2,'BRANCH',$3,$4,NULL,false,ARRAY['Cleaning & Hygiene'],0,
        'Disable the child rule and inherit its parent restriction',$5,now()
      )
    `, [ids.branchAdmin, ids.branchAdminAssignment, ids.company, ids.branch,
      randomUUID()]))).resolves.toBeDefined();
    const allowed = await db.query<{ value: boolean }>(`
      SELECT axora_category_allowed_for_scope($1,$2,NULL,'Office Basics') AS value
    `, [ids.company, ids.branch]);
    expect(allowed.rows[0].value).toBe(true);
  });

  it("keeps canonical cart and policy tables private behind scoped commands", async () => {
    const privileges = await db.query<{ carts: boolean; items: boolean; policies: boolean; command: boolean }>(`
      SELECT has_table_privilege('axora_app','procurement_carts','SELECT') AS carts,
        has_table_privilege('axora_app','procurement_cart_items','SELECT') AS items,
        has_table_privilege('axora_app','procurement_category_policies','SELECT') AS policies,
        has_function_privilege('axora_app',
          'axora_procurement_cart_command(uuid,uuid,uuid,text,text,integer,text,integer,uuid,timestamptz)',
          'EXECUTE') AS command
    `);
    expect(privileges.rows[0]).toEqual({ carts: false, items: false, policies: false, command: true });
    await expect(asApp(() => db.query(`
      SELECT axora_procurement_cart_command(
        $1,$2,$3,'READ',NULL,NULL,'',NULL,$4,now()
      )
    `, [ids.admin, ids.adminAssignment, ids.otherBranch, randomUUID()])))
      .rejects.toMatchObject({ code: "42501" });
  });
});
