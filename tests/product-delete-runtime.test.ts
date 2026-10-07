import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const dependencies = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  withAuditTransaction: dependencies.transaction,
}));

import { deleteProduct, ProductDeletionError } from "@/lib/product-delete";
import { productDeletionMessages } from "@/lib/product-deletion-i18n";

describe("product deletion runtime protection", () => {
  let db: PGlite;
  let branch: { id: string; company_id: string };
  const owner = {
    id: "ed000001-0000-4000-8000-000000000003",
    email: "product-delete-owner@example.test", name: "Isolated deletion owner",
    role: "PLATFORM_OWNER", isOwner: true, accountKind: "PLATFORM", scopeType: "PLATFORM",
    roleAssignmentId: "ed000001-0000-4000-8000-000000000004", authVersion: 1,
  } satisfies AuthenticatedSessionUser;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`CREATE ROLE axora_app NOLOGIN; CREATE ROLE axora_cleanup_worker NOLOGIN;
      CREATE ROLE axora_integration_worker NOLOGIN;
      CREATE TABLE schema_migrations(filename text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz DEFAULT now())`);
    await applyMigrations(db);
    await applyDemoSeed(db);
    // Replay the deployed policy, including its historical partial-schema
    // branch, twice so a later replay cannot restore raw DELETE privileges.
    const grants = (await readFile(new URL("../database/admin/apply-app-grants.sql", import.meta.url), "utf8"))
      .replace(/SELECT format\('GRANT CONNECT[\s\S]*?\\gexec/g, "")
      .replace(/^\\.*$/gm, "");
    await db.exec(grants);
    await db.exec(grants);
    await db.query(`INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,account_setup_completed_at,
      account_kind,account_status,active,auth_version
    ) SELECT $1,$2,$3,'not-a-real-hash',id,true,now(),'PLATFORM','ACTIVE',true,1
      FROM roles WHERE role_key='PLATFORM_OWNER'`, [owner.id,owner.email,owner.name]);
    await db.query(`INSERT INTO role_assignments(id,user_id,role_id,scope_type,active)
      SELECT $1,$2,id,'PLATFORM',true FROM roles WHERE role_key='PLATFORM_OWNER'`,
    [owner.roleAssignmentId,owner.id]);
    branch = (await db.query<{ id: string; company_id: string }>(
      "SELECT id::text,company_id::text FROM branches ORDER BY id LIMIT 1",
    )).rows[0];
    dependencies.transaction.mockImplementation(async (context, work) => {
      await db.exec("BEGIN; SET LOCAL ROLE axora_app");
      try {
        await db.query("SELECT set_config('axora.user_id',$1,true),set_config('axora.change_reason',$2,true),set_config('axora.role_assignment_id',$3,true)",
          [context.actor.id,"Isolated product deletion regression",context.actor.roleAssignmentId ?? ""]);
        const result = await work({ query: async (sql: string, values: unknown[]) => {
          const result = await db.query(sql, values);
          return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
        } });
        await db.exec("COMMIT");
        return result;
      } catch (error) {
        await db.exec("ROLLBACK");
        throw error;
      }
    });
  }, 30_000);

  beforeEach(() => {
    dependencies.transaction.mockClear();
  });

  afterAll(async () => { await db.close(); });

  async function productFixture() {
    const id = randomUUID();
    await db.query(`INSERT INTO products(id,product_code,name,category,unit_of_measure,
      default_buy_price,default_sell_price)
      VALUES ($1,$2,$3,'Office','unit',1,1)`, [id,`DEL-${id}`,`Disposable deletion ${id}`]);
    await db.query(`INSERT INTO product_images(product_id,file_name,content_type,image_content,
      width,height,sha256) VALUES ($1,'isolated.webp','image/webp',$2,1,1,$3)`,
    [id,new Uint8Array([1]),`deletion-image-${id}`]);
    await db.query(`INSERT INTO product_suppliers(product_id,supplier_id)
      SELECT $1,id FROM suppliers ORDER BY id LIMIT 1`, [id]);
    return id;
  }

  async function counts(id: string) {
    return (await db.query<{ products: number; images: number; suppliers: number }>(`SELECT
      (SELECT count(*)::int FROM products WHERE id=$1) AS products,
      (SELECT count(*)::int FROM product_images WHERE product_id=$1) AS images,
      (SELECT count(*)::int FROM product_suppliers WHERE product_id=$1) AS suppliers`, [id])).rows[0];
  }

  async function addCartReference(id: string) {
    const cartId = randomUUID();
    await db.query(`INSERT INTO procurement_carts(id,user_id,company_id,branch_id)
      VALUES ($1,$2,$3,$4)`, [cartId,owner.id,branch.company_id,branch.id]);
    await db.query(`INSERT INTO procurement_cart_items(cart_id,product_id,quantity,
      displayed_unit_price,displayed_price_rule_version,currency)
      VALUES ($1,$2,1,1,1,'MYR')`, [cartId,id]);
  }

  async function directCapability(actorId: string, assignmentId: string, productId: string, version = 1) {
    await db.exec("BEGIN; SET LOCAL ROLE axora_app");
    try {
      await db.query("SELECT set_config('axora.user_id',$1,true),set_config('axora.role_assignment_id',$2,true)", [actorId,assignmentId]);
      return (await db.query<{ result: string }>("SELECT axora_delete_product($1,$2,$3,$4) AS result", [actorId,assignmentId,version,productId])).rows[0].result;
    } finally {
      await db.exec("ROLLBACK");
    }
  }

  it("reproduces the omitted cart FK and returns a precise protected result after rollback", async () => {
    const id = await productFixture();
    await addCartReference(id);
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM request_lines WHERE product_id=$1", [id])).rows[0].count).toBe(0);
    await expect(deleteProduct(id, owner)).rejects.toMatchObject({ name: "ProductDeletionError", code: "CART" });
    expect(await counts(id)).toEqual({ products: 1, images: 1, suppliers: 1 });
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM procurement_cart_items WHERE product_id=$1", [id])).rows[0].count).toBe(1);
  });

  it("deletes only an eligible product and its database-owned images, preserves audit/history, and accepts response-loss replay", async () => {
    const id = await productFixture();
    const shared = await productFixture();
    const historyBefore = (await db.query<{ count: number }>("SELECT count(*)::int AS count FROM product_commercial_price_history WHERE product_id=$1", [id])).rows[0].count;
    await expect(deleteProduct(id, owner)).resolves.toBeUndefined();
    await expect(deleteProduct(id, owner)).resolves.toBeUndefined();
    expect(await counts(id)).toEqual({ products: 0, images: 0, suppliers: 0 });
    expect(await counts(shared)).toEqual({ products: 1, images: 1, suppliers: 1 });
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM product_commercial_price_history WHERE product_id=$1", [id])).rows[0].count).toBe(historyBefore);
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM audit_logs WHERE entity_type='products' AND record_id=$1 AND action='DELETE'", [id])).rows[0].count).toBe(1);
  });

  it("retains products referenced by purchase history", async () => {
    const id = (await db.query<{ product_id: string }>("SELECT product_id::text FROM request_lines WHERE product_id IS NOT NULL LIMIT 1")).rows[0].product_id;
    await expect(deleteProduct(id, owner)).rejects.toMatchObject({ code: "PURCHASE_HISTORY" });
    expect((await counts(id)).products).toBe(1);
  });

  it("retains integration draft references with their specific reason", async () => {
    const id = await productFixture();
    const draftId = randomUUID();
    await db.query(`INSERT INTO integration_request_drafts(id,draft_code,company_id,branch_id,
      request_type,department,needed_by_date,urgency,expires_at)
      VALUES ($1,$2,$3,$4,'Standard','Operations',CURRENT_DATE+7,'Normal',now()+interval '1 day')`,
    [draftId,`IDR-${draftId.replaceAll("-", "").toUpperCase()}`,branch.company_id,branch.id]);
    await db.query(`INSERT INTO integration_request_draft_items(draft_id,product_id,
      public_product_reference,product_name_snapshot,unit_of_measure_snapshot,quantity,sort_order)
      SELECT $1,id,public_reference,name,unit_of_measure,1,0 FROM products WHERE id=$2`, [draftId,id]);
    await expect(deleteProduct(id, owner)).rejects.toMatchObject({ code: "DRAFT" });
    expect(await counts(id)).toEqual({ products: 1, images: 1, suppliers: 1 });
  });

  it("rolls all database assets and supplier links back if image cleanup fails", async () => {
    const id = await productFixture();
    await db.exec(`CREATE FUNCTION isolated_product_image_delete_failure() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Isolated image cleanup failure'; END $$;
      CREATE TRIGGER isolated_product_image_delete_failure BEFORE DELETE ON product_images
      FOR EACH ROW EXECUTE FUNCTION isolated_product_image_delete_failure()`);
    try {
      await expect(deleteProduct(id, owner)).rejects.toThrow("Isolated image cleanup failure");
      expect(await counts(id)).toEqual({ products: 1, images: 1, suppliers: 1 });
    } finally {
      await db.exec("DROP TRIGGER isolated_product_image_delete_failure ON product_images; DROP FUNCTION isolated_product_image_delete_failure()");
    }
  });

  it.each(["CLIENT_ACCOUNT_MANAGER", "COMPANY_ADMIN", "PLATFORM_OPERATIONS"] as const)("denies direct lifecycle calls by %s before lookup", async (role) => {
    await expect(deleteProduct(randomUUID(), { ...owner, role, isOwner: false })).rejects.toBeInstanceOf(ProductDeletionError);
    expect(dependencies.transaction).not.toHaveBeenCalled();
  });

  it.each(["product.manage", "product.archive"] as const)("honors explicit DENY for %s, including an absent target", async (permission) => {
    const denyId = randomUUID();
    await db.query(`INSERT INTO user_permission_overrides(id,user_id,permission_id,effect,
      scope_type,starts_at,active,reason,changed_by) SELECT $1,$2,id,'DENY','PLATFORM',now(),true,
      'Isolated product lifecycle denial',$2 FROM permissions WHERE permission_code=$3`,
    [denyId,owner.id,permission]);
    try {
      await expect(deleteProduct(randomUUID(), owner)).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await db.query("DELETE FROM user_permission_overrides WHERE id=$1", [denyId]);
    }
  });

  it("closes direct database deletion and PUBLIC capability execution after grant replay", async () => {
    for (const table of ["products", "product_suppliers", "product_images"]) {
      expect((await db.query<{ allowed: boolean }>("SELECT has_table_privilege('axora_app',$1,'DELETE') AS allowed", [table])).rows[0].allowed).toBe(false);
    }
    expect((await db.query<{ allowed: boolean }>("SELECT has_function_privilege('public','public.axora_delete_product(uuid,uuid,integer,uuid)','EXECUTE') AS allowed")).rows[0].allowed).toBe(false);
    await db.exec("SET ROLE axora_app");
    try {
      for (const table of ["products", "product_suppliers", "product_images"]) {
        await expect(db.query(`DELETE FROM ${table} WHERE false`)).rejects.toMatchObject({ code: "42501" });
      }
    } finally {
      await db.exec("RESET ROLE");
    }
  });

  it("rejects forged or missing audit context and stale or absent selected assignment before lookup", async () => {
    await db.exec("SET ROLE axora_app");
    try {
      expect((await db.query<{ result: string }>("SELECT axora_delete_product($1,$2,1,$3) AS result", [owner.id,owner.roleAssignmentId,randomUUID()])).rows[0].result).toBe("FORBIDDEN");
    } finally {
      await db.exec("RESET ROLE");
    }
    await expect(deleteProduct(randomUUID(), { ...owner, roleAssignmentId: undefined })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteProduct(randomUUID(), { ...owner, roleAssignmentId: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteProduct(randomUUID(), { ...owner, authVersion: 9 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each(["CLIENT_ACCOUNT_MANAGER", "COMPANY_ADMIN", "PLATFORM_OPERATIONS"] as const)("rejects database calls by %s and cannot delete a foreign target", async (role) => {
    const actorId = randomUUID();
    const companyActor = role === "COMPANY_ADMIN";
    await db.query(`INSERT INTO users(id,email,display_name,password_hash,role_id,is_owner,
      account_setup_completed_at,account_kind,account_status,active,company_id,auth_version)
      SELECT $1,$2,'Unauthorized deletion fixture','not-a-real-hash',id,false,now(),$3,'ACTIVE',true,$4,1
      FROM roles WHERE role_key=$5`, [actorId,`${actorId}@example.test`,companyActor ? "COMPANY" : "PLATFORM",companyActor ? branch.company_id : null,role]);
    const target = await productFixture();
    expect(await directCapability(actorId, randomUUID(), target)).toBe("FORBIDDEN");
    expect(await counts(target)).toEqual({ products: 1, images: 1, suppliers: 1 });
    await expect(deleteProduct(target, { ...owner, id: actorId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("denies inactive and revoked Owner identities at the mutation boundary", async () => {
    const actorId = randomUUID();
    const assignmentId = randomUUID();
    await db.query(`INSERT INTO users(id,email,display_name,password_hash,role_id,is_owner,
      account_setup_completed_at,account_kind,account_status,active,auth_version)
      SELECT $1,$2,'Inactive deletion owner','not-a-real-hash',id,true,now(),'PLATFORM','ACTIVE',true,1
      FROM roles WHERE role_key='PLATFORM_OWNER'`, [actorId,`${actorId}@example.test`]);
    await db.query(`INSERT INTO role_assignments(id,user_id,role_id,scope_type,active)
      SELECT $1,$2,id,'PLATFORM',true FROM roles WHERE role_key='PLATFORM_OWNER'`, [assignmentId,actorId]);
    await db.query("UPDATE role_assignments SET active=false,revoked_at=now(),revoke_reason='Isolated lifecycle revocation' WHERE id=$1", [assignmentId]);
    expect(await directCapability(actorId, assignmentId, randomUUID())).toBe("FORBIDDEN");
    await db.query("UPDATE users SET active=false,account_status='DEACTIVATED' WHERE id=$1", [actorId]);
    expect(await directCapability(actorId, assignmentId, randomUUID())).toBe("FORBIDDEN");
  });

  it("preserves all assets when a newly introduced restrictive FK blocks deletion", async () => {
    const id = await productFixture();
    await db.exec("CREATE TABLE isolated_future_product_reference(product_id uuid REFERENCES products(id) ON DELETE RESTRICT)");
    try {
      await db.query("INSERT INTO isolated_future_product_reference VALUES ($1)", [id]);
      await expect(deleteProduct(id, owner)).rejects.toMatchObject({ code: "PROTECTED" });
      expect(await counts(id)).toEqual({ products: 1, images: 1, suppliers: 1 });
    } finally {
      await db.exec("DROP TABLE isolated_future_product_reference");
    }
  });

  it("provides localized safe error and permitted-alternative copy in every supported locale", () => {
    for (const locale of ["en", "ar", "ms"] as const) {
      const copy = productDeletionMessages(locale);
      for (const code of ["CART", "DRAFT", "PURCHASE_HISTORY", "PROTECTED", "FORBIDDEN", "UNAVAILABLE"] as const) {
        expect(copy.errors[code]).toBeTruthy();
        expect(copy.errors[code]).not.toContain("product_id_fkey");
      }
    }
  });
});
