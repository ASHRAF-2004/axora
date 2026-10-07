import { randomUUID } from "node:crypto";
import { Client, type ClientConfig } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const nativeDescribe = process.env.AXORA_NATIVE_POSTGRES_INTEGRATION === "true" ? describe : describe.skip;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for native PostgreSQL verification.`);
  return value;
}

nativeDescribe.sequential("Owner product deletion native concurrency", () => {
  let admin: Client;
  let adminConfig: ClientConfig;
  let appConfig: ClientConfig;
  const ownerId = randomUUID();
  const assignmentId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();

  async function client(config: ClientConfig) {
    const connection = new Client(config);
    await connection.connect();
    await connection.query("SET statement_timeout='15s'; SET lock_timeout='10s'");
    return connection;
  }

  async function deletionTransaction() {
    const connection = await client(appConfig);
    await connection.query("BEGIN");
    await connection.query(`SELECT set_config('axora.user_id',$1,true),
      set_config('axora.role_assignment_id',$2,true),
      set_config('axora.change_reason','Native isolated product deletion',true)`, [ownerId,assignmentId]);
    return connection;
  }

  async function deleteViaCapability(connection: Client, productId: string) {
    return (await connection.query<{ result: string }>(
      "SELECT public.axora_delete_product($1,$2,1,$3) AS result", [ownerId,assignmentId,productId],
    )).rows[0].result;
  }

  async function fixture() {
    const productId = randomUUID();
    const cartId = randomUUID();
    await admin.query(`INSERT INTO products(id,product_code,name,category,unit_of_measure,
      default_buy_price,default_sell_price) VALUES ($1,$2,$3,'Office','unit',1,1)`,
    [productId,`ND-${productId}`,`Native disposable product ${productId}`]);
    await admin.query(`INSERT INTO product_images(product_id,file_name,content_type,image_content,
      width,height,sha256) VALUES ($1,'native.webp','image/webp',$2,1,1,$3)`,
    [productId,Buffer.from([1]),`native-delete-${productId}`]);
    await admin.query(`INSERT INTO procurement_carts(id,user_id,company_id,branch_id,status)
      VALUES ($1,$2,$3,$4,'ABANDONED')`, [cartId,ownerId,companyId,branchId]);
    return { productId,cartId };
  }

  async function insertReference(connection: Client, cartId: string, productId: string) {
    await connection.query(`INSERT INTO procurement_cart_items(cart_id,product_id,quantity,
      displayed_unit_price,displayed_price_rule_version,currency) VALUES ($1,$2,1,1,1,'MYR')`,
    [cartId,productId]);
  }

  async function connectionPids(blocked: Client, blocker: Client) {
    const blockedPid = (await blocked.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const blockerPid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    return { blockedPid,blockerPid };
  }

  async function observeBlock(blockedPid: number, blockerPid: number) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if ((await admin.query<{ blocked: boolean }>("SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS blocked", [blockedPid,blockerPid])).rows[0].blocked) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("The expected product lifecycle lock wait was not observed.");
  }

  beforeAll(async () => {
    const database = required("AXORA_NATIVE_POSTGRES_DATABASE");
    if (database !== "axora_native_ci") throw new Error("Product deletion races require the isolated native CI database.");
    const base = { host: required("AXORA_NATIVE_POSTGRES_HOST"), port: Number(required("AXORA_NATIVE_POSTGRES_PORT")), database, ssl: false } satisfies ClientConfig;
    adminConfig = { ...base,user: required("AXORA_NATIVE_POSTGRES_ADMIN_USER"),password: required("AXORA_NATIVE_POSTGRES_ADMIN_PASSWORD") };
    appConfig = { ...base,user: required("DB_USER"),password: required("DB_PASSWORD") };
    admin = await client(adminConfig);
    await admin.query(`INSERT INTO users(id,email,display_name,password_hash,role_id,is_owner,
      account_kind,account_status,active,auth_version,account_setup_completed_at)
      SELECT $1,$2,'Native lifecycle owner','not-a-real-hash',id,true,'PLATFORM','ACTIVE',true,1,now()
      FROM roles WHERE role_key='PLATFORM_OWNER'`, [ownerId,`${ownerId}@example.test`]);
    await admin.query(`INSERT INTO role_assignments(id,user_id,role_id,scope_type,active)
      SELECT $1,$2,id,'PLATFORM',true FROM roles WHERE role_key='PLATFORM_OWNER'`, [assignmentId,ownerId]);
    await admin.query("INSERT INTO companies(id,company_code,name,active) VALUES ($1,$2,$3,true)", [companyId,`NDEL-${companyId}`,`Native deletion company ${companyId}`]);
    await admin.query(`INSERT INTO branches(id,branch_code_id,company_id,name,branch_code,delivery_address,city,timezone,active)
      VALUES ($1,$2,$3,'Native deletion branch','NDEL','Isolated destination','Kuala Lumpur','Asia/Kuala_Lumpur',true)`,
    [branchId,`NDEL-${branchId}`,companyId]);
  }, 30_000);

  afterAll(async () => { await admin?.end(); });

  it("rejects a reference created behind a successful deletion without orphaning it", async () => {
    const { productId,cartId } = await fixture();
    const deleting = await deletionTransaction();
    const referencing = await client(adminConfig);
    try {
      const pids = await connectionPids(referencing, deleting);
      expect(await deleteViaCapability(deleting, productId)).toBe("DELETED");
      const reference = insertReference(referencing, cartId, productId).then(() => "INSERTED", (error: { code?: string }) => error.code);
      await observeBlock(pids.blockedPid, pids.blockerPid);
      await deleting.query("COMMIT");
      expect(["23503", "23001"]).toContain(await reference);
      expect((await admin.query<{ count: number }>("SELECT count(*)::int AS count FROM procurement_cart_items WHERE product_id=$1", [productId])).rows[0].count).toBe(0);
    } finally {
      await deleting.query("ROLLBACK");
      await deleting.end();
      await referencing.end();
    }
  });

  it("retains a concurrently committed reference and all product images", async () => {
    const { productId,cartId } = await fixture();
    const deleting = await deletionTransaction();
    const referencing = await client(adminConfig);
    try {
      const pids = await connectionPids(deleting, referencing);
      await referencing.query("BEGIN");
      await insertReference(referencing, cartId, productId);
      const deletion = deleteViaCapability(deleting, productId);
      await observeBlock(pids.blockedPid, pids.blockerPid);
      await referencing.query("COMMIT");
      expect(await deletion).toBe("CART");
      await deleting.query("COMMIT");
      expect((await admin.query<{ count: number }>("SELECT count(*)::int AS count FROM product_images WHERE product_id=$1", [productId])).rows[0].count).toBe(1);
    } finally {
      await referencing.query("ROLLBACK");
      await deleting.query("ROLLBACK");
      await deleting.end();
      await referencing.end();
    }
  });

  it("uses current time after an authority lock wait so a newly committed DENY remains effective", async () => {
    const { productId } = await fixture();
    const deleting = await deletionTransaction();
    const permissionWriter = await client(adminConfig);
    const denyId = randomUUID();
    try {
      const pids = await connectionPids(deleting, permissionWriter);
      await permissionWriter.query("BEGIN");
      await permissionWriter.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [ownerId]);
      await permissionWriter.query(`INSERT INTO user_permission_overrides(id,user_id,permission_id,effect,
        scope_type,starts_at,active,reason,changed_by)
        SELECT $1,$2,id,'DENY','PLATFORM',clock_timestamp(),true,'Native concurrent lifecycle DENY',$2
        FROM permissions WHERE permission_code='product.archive'`, [denyId,ownerId]);
      const deletion = deleteViaCapability(deleting, productId);
      await observeBlock(pids.blockedPid, pids.blockerPid);
      await permissionWriter.query("COMMIT");
      expect(await deletion).toBe("FORBIDDEN");
      await deleting.query("COMMIT");
      expect((await admin.query<{ count: number }>("SELECT count(*)::int AS count FROM products WHERE id=$1", [productId])).rows[0].count).toBe(1);
    } finally {
      await permissionWriter.query("ROLLBACK");
      await deleting.query("ROLLBACK");
      await deleting.end();
      await permissionWriter.end();
      await admin.query("DELETE FROM user_permission_overrides WHERE id=$1", [denyId]);
    }
  });
});
