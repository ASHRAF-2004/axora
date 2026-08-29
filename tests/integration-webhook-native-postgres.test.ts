import { randomUUID } from "node:crypto";
import { Client, type ClientConfig } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const nativeDescribe = process.env.AXORA_NATIVE_POSTGRES_INTEGRATION === "true"
  ? describe
  : describe.skip;

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for native PostgreSQL integration.`);
  return value;
}

nativeDescribe.sequential("integration delivery native concurrency and grants", () => {
  let admin: Client;
  let app: Client;
  let workerOne: Client;
  let workerTwo: Client;

  beforeAll(async () => {
    const port = Number(requiredEnvironment("AXORA_NATIVE_POSTGRES_PORT"));
    if (!Number.isSafeInteger(port)) throw new Error("Native PostgreSQL port is invalid.");
    const shared = {
      host: requiredEnvironment("AXORA_NATIVE_POSTGRES_HOST"),
      port,
      database: requiredEnvironment("AXORA_NATIVE_POSTGRES_DATABASE"),
      ssl: false,
    } satisfies Partial<ClientConfig>;
    admin = new Client({
      ...shared,
      user: requiredEnvironment("AXORA_NATIVE_POSTGRES_ADMIN_USER"),
      password: requiredEnvironment("AXORA_NATIVE_POSTGRES_ADMIN_PASSWORD"),
    });
    app = new Client({
      ...shared,
      user: "axora_app",
      password: requiredEnvironment("DB_PASSWORD"),
    });
    const workerConfig: ClientConfig = {
      ...shared,
      user: "axora_integration_worker",
      password: requiredEnvironment("AXORA_NATIVE_POSTGRES_INTEGRATION_WORKER_PASSWORD"),
    };
    workerOne = new Client(workerConfig);
    workerTwo = new Client(workerConfig);
    await Promise.all([
      admin.connect(), app.connect(), workerOne.connect(), workerTwo.connect(),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      admin?.end(), app?.end(), workerOne?.end(), workerTwo?.end(),
    ]);
  });

  it("gives the worker no direct public table or sequence capability", async () => {
    const boundary = await admin.query<{
      readableTables: string[] | null;
      writableTables: string[] | null;
      usableSequences: string[] | null;
    }>(`
      SELECT
        (SELECT array_agg(relation.oid::regclass::text ORDER BY relation.oid::regclass::text)
          FROM pg_class relation
          WHERE relation.relnamespace='public'::regnamespace
            AND relation.relkind IN ('r','p','v','m','f')
            AND has_table_privilege(
              'axora_integration_worker',relation.oid,'SELECT'
            )) AS "readableTables",
        (SELECT array_agg(relation.oid::regclass::text ORDER BY relation.oid::regclass::text)
          FROM pg_class relation
          WHERE relation.relnamespace='public'::regnamespace
            AND relation.relkind IN ('r','p','v','m','f')
            AND (
              has_table_privilege('axora_integration_worker',relation.oid,'INSERT')
              OR has_table_privilege('axora_integration_worker',relation.oid,'UPDATE')
              OR has_table_privilege('axora_integration_worker',relation.oid,'DELETE')
              OR has_table_privilege('axora_integration_worker',relation.oid,'TRUNCATE')
            )) AS "writableTables",
        (SELECT array_agg(relation.oid::regclass::text ORDER BY relation.oid::regclass::text)
          FROM pg_class relation
          WHERE relation.relnamespace='public'::regnamespace
            AND CASE WHEN relation.relkind='S' THEN has_sequence_privilege(
              'axora_integration_worker',relation.oid,'USAGE'
            ) ELSE false END) AS "usableSequences"
    `);
    expect(boundary.rows[0]).toEqual({
      readableTables: null,
      writableTables: null,
      usableSequences: null,
    });
    await expect(workerOne.query("SELECT count(*) FROM public.users"))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("exposes only the bounded webhook and Slack worker capabilities", async () => {
    const grants = await admin.query<{ capability: string }>(`
      SELECT routine.oid::regprocedure::text AS capability
      FROM pg_proc routine
      JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace
      JOIN aclexplode(COALESCE(routine.proacl,acldefault('f',routine.proowner))) access
        ON true
      JOIN pg_roles grantee ON grantee.oid=access.grantee
      WHERE namespace.nspname='public'
        AND grantee.rolname='axora_integration_worker'
        AND access.privilege_type='EXECUTE'
      ORDER BY capability
    `);
    const allowedCapabilities=[
      "axora_claim_integration_webhook_deliveries(text,integer,integer,timestamp with time zone)",
      "axora_claim_integration_slack_deliveries(text,integer,integer,timestamp with time zone)",
      "axora_claimed_webhook_delivery_is_authorized(text,uuid,uuid,timestamp with time zone)",
      "axora_claimed_slack_delivery_is_authorized(text,uuid,uuid,timestamp with time zone)",
      "axora_cleanup_integration_runtime(timestamp with time zone)",
      "axora_cleanup_slack_runtime(timestamp with time zone)",
      "axora_complete_integration_webhook_delivery(text,uuid,uuid,text,integer,text,integer,integer,integer,timestamp with time zone)",
      "axora_complete_integration_slack_delivery(text,uuid,uuid,text,integer,text,integer,integer,integer,timestamp with time zone)",
      "axora_claim_slack_revocations(text,integer,integer,timestamp with time zone)",
      "axora_complete_slack_revocation(text,uuid,uuid,boolean,text,integer,timestamp with time zone)",
      "axora_project_integration_events_with_capabilities(integer,timestamp with time zone,boolean,boolean)",
      "axora_rotate_claimed_slack_token(text,uuid,uuid,integer,jsonb,jsonb,timestamp with time zone,timestamp with time zone)",
    ].sort();
    expect(grants.rows.map((row) => row.capability)).toEqual(allowedCapabilities);
    const effective=await admin.query<{ capability:string }>(`
      SELECT routine.oid::regprocedure::text AS capability
      FROM pg_proc routine
      WHERE routine.pronamespace='public'::regnamespace
        AND has_function_privilege(
          'axora_integration_worker',routine.oid,'EXECUTE'
        )
      ORDER BY capability
    `);
    expect(effective.rows.map((row)=>row.capability)).toEqual(allowedCapabilities);
    await expect(app.query(
      "SELECT public.axora_project_integration_events(1,now())",
    )).rejects.toMatchObject({ code: "42501" });
    await expect(workerOne.query(
      "SELECT public.axora_cleanup_integration_runtime(now()+interval '1 day')",
    )).rejects.toMatchObject({ code: "22023" });
    await expect(workerOne.query(
      "SELECT public.axora_project_integration_events_with_capabilities(1,now()-interval '1 day',true,false)",
    )).rejects.toMatchObject({ code: "22023" });
  });

  it("serializes two projectors and creates one stable event per canonical row", async () => {
    const companyIds = [randomUUID(), randomUUID()];
    await admin.query(`
      UPDATE public.integration_projection_checkpoints
      SET cursor_at=now()+interval '1 day',
        cursor_id='ffffffff-ffff-4fff-bfff-ffffffffffff'::uuid
    `);
    await admin.query(`
      UPDATE public.integration_projection_checkpoints
      SET cursor_at=clock_timestamp(),
        cursor_id='00000000-0000-0000-0000-000000000000'::uuid
      WHERE source_name='COMPANIES'
    `);
    await admin.query(`
      INSERT INTO public.companies(
        id,company_code,name,active,contractual_ceiling
      ) VALUES
        ($1,$3,$4,true,0),
        ($2,$5,$6,true,0)
    `, [
      companyIds[0], companyIds[1],
      `WHN-${companyIds[0]!.slice(0, 8)}`, "Native webhook company A",
      `WHN-${companyIds[1]!.slice(0, 8)}`, "Native webhook company B",
    ]);

    const results = await Promise.all([
      workerOne.query<{ result: { scanned: number; projected: number } }>(
        "SELECT public.axora_project_integration_events_with_capabilities(100,now(),true,false) AS result",
      ),
      workerTwo.query<{ result: { scanned: number; projected: number } }>(
        "SELECT public.axora_project_integration_events_with_capabilities(100,now(),true,false) AS result",
      ),
    ]);
    expect(results.reduce(
      (total, result) => total + result.rows[0]!.result.scanned,
      0,
    )).toBe(2);
    expect(results.reduce(
      (total, result) => total + result.rows[0]!.result.projected,
      0,
    )).toBe(2);
    const evidence = await admin.query<{
      events: number; distinctSources: number; deliveries: number;
    }>(`
      SELECT
        count(*)::int AS events,
        count(DISTINCT source_id)::int AS "distinctSources",
        (SELECT count(*)::int
          FROM public.integration_webhook_deliveries delivery
          JOIN public.integration_events event ON event.id=delivery.event_id
          WHERE event.source_id=ANY($1::uuid[])) AS deliveries
      FROM public.integration_events
      WHERE source_name='COMPANIES' AND source_id=ANY($1::uuid[])
    `, [companyIds]);
    expect(evidence.rows[0]).toEqual({
      events: 2,
      distinctSources: 2,
      deliveries: 0,
    });
  });
});
