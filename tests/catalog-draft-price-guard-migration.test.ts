import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrations } from "./helpers/pglite";

describe("catalog draft price guard migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await applyMigrations(db);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("permits a non-purchasable CAM draft without fabricating a customer price", async () => {
    await expect(db.query(`INSERT INTO products
      (product_code,name,category,subcategory,unit_of_measure,default_buy_price,default_sell_price,active)
      VALUES ('AX-DRAFT-PRICE','CAM price-pending draft','Office Basics','Test','Piece',0,0,false)`))
      .resolves.toBeDefined();

    await expect(db.query(`INSERT INTO products
      (product_code,name,category,subcategory,unit_of_measure,default_buy_price,default_sell_price,active)
      VALUES ('AX-ACTIVE-PRICE','Invalid active product','Office Basics','Test','Piece',0,0,true)`))
      .rejects.toThrow(/products_sell_price_positive_check/);
  });
});
