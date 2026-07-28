import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationUrls = [
  "001_initial.sql",
  "002_cod_only_payments.sql",
  "003_protect_owner_account.sql",
  "004_company_tenant_membership.sql",
  "005_persistent_files_and_tenant_audit.sql",
  "006_multiple_platform_owners.sql",
  "007_customer_procurement_workflow.sql",
  "008_attachment_visibility.sql",
  "009_workflow_safety_and_local_budget.sql",
  "010_finance_and_delivery_integrity.sql",
  "011_product_editing_and_gallery.sql",
].map((filename) => new URL(`../database/migrations/${filename}`, import.meta.url));

const demoSeedUrl = new URL("../database/seeds/demo.sql", import.meta.url);

describe("product image gallery migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    for (const url of migrationUrls) await db.exec(await readFile(url, "utf8"));
    await db.exec(await readFile(demoSeedUrl, "utf8"));
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("creates the gallery table", async () => {
    const result = await db.query<{ exists: boolean }>(
      "SELECT to_regclass('public.product_images') IS NOT NULL AS exists",
    );
    expect(result.rows[0].exists).toBe(true);
  });

  it("allows several images but only one active primary image per product", async () => {
    const product = await db.query<{ id: string }>("SELECT id::text FROM products ORDER BY name LIMIT 1");
    const productId = product.rows[0].id;

    await db.query(
      `INSERT INTO product_images
        (product_id,file_name,content_type,image_content,alt_text,width,height,sha256,sort_order,is_primary)
       VALUES ($1,'front.webp','image/webp',$2,'Front view',100,100,'gallery-front',0,true)`,
      [productId, new Uint8Array([1])],
    );
    await db.query(
      `INSERT INTO product_images
        (product_id,file_name,content_type,image_content,alt_text,width,height,sha256,sort_order,is_primary)
       VALUES ($1,'side.webp','image/webp',$2,'Side view',100,100,'gallery-side',1,false)`,
      [productId, new Uint8Array([2])],
    );

    await expect(db.query(
      `INSERT INTO product_images
        (product_id,file_name,content_type,image_content,alt_text,width,height,sha256,sort_order,is_primary)
       VALUES ($1,'back.webp','image/webp',$2,'Back view',100,100,'gallery-back',2,true)`,
      [productId, new Uint8Array([3])],
    )).rejects.toThrow();

    const count = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM product_images WHERE product_id=$1 AND active=true",
      [productId],
    );
    expect(Number(count.rows[0].count)).toBe(2);
  });
});
