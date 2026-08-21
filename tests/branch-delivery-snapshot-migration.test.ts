import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { buildDeliveryNavigationLinks } from "@/lib/delivery-navigation";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const ownerId = "d7000000-0000-4000-8000-000000000001";
const ownerAssignmentId = "d7000000-0000-4000-8000-000000000002";
const firstCommandId = "d7000000-0000-4000-8000-000000000003";
const secondCommandId = "d7000000-0000-4000-8000-000000000004";

async function installOwner(db: PGlite) {
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,account_kind,
      account_status,account_setup_completed_at,email_verified_at
    ) SELECT $1,'location-owner@fixture.invalid','Location fixture owner',
      'fixture-hash',id,true,'PLATFORM','ACTIVE',now(),now()
    FROM roles WHERE role_key='PLATFORM_OWNER'
  `, [ownerId]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,active,assigned_by,assigned_at
    ) SELECT $1,$2,id,'PLATFORM',true,$2,now()
    FROM roles WHERE role_key='PLATFORM_OWNER'
  `, [ownerAssignmentId, ownerId]);
}

describe("canonical branch location and immutable paid delivery snapshot", () => {
  it("authorizes a bounded save and keeps navigation on the paid-job snapshot after branch edits", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db);
      await applyDemoSeed(db);
      await installOwner(db);

      const fixture = (await db.query<{
        branch_id: string;
        payment_id: string;
        request_id: string;
      }>(`
        SELECT request.branch_id::text AS branch_id,
          payment.id::text AS payment_id,request.id::text AS request_id
        FROM payments payment
        JOIN invoices invoice ON invoice.id=payment.invoice_id
        JOIN requests request ON request.id=invoice.request_id
        ORDER BY payment.id LIMIT 1
      `)).rows[0];
      if (!fixture) throw new Error("A paid delivery fixture is required.");

      const readiness = (await db.query<{
        branch_active: boolean;
        branch_city: string;
        can_manage: boolean;
        snapshot_ready: boolean;
      }>(`
        SELECT branch.active AS branch_active,branch.city AS branch_city,
          snapshot IS NOT NULL AS snapshot_ready,
          axora_organization_permission_at(
            snapshot,'organization.delivery_location.manage',
            branch.company_id,branch.id,NULL
          ) AS can_manage
        FROM branches branch
        CROSS JOIN LATERAL (
          SELECT axora_live_authorization_snapshot($1,$2,now()) AS snapshot
        ) auth_snapshot
        WHERE branch.id=$3
      `, [ownerId, ownerAssignmentId, fixture.branch_id])).rows[0];
      expect(readiness).toMatchObject({
        branch_active: true,
        can_manage: true,
        snapshot_ready: true,
      });
      expect(readiness.branch_city.length).toBeGreaterThanOrEqual(2);

      const firstAddress = "Receiving bay 4, controlled fixture";
      const firstCoordinates = { latitude: 3.139, longitude: 101.6869 };
      const savedAt = new Date(Date.now() + 1_000);
      const saved = await db.query<{ value: {
        branchId: string;
        canManage: boolean;
        commandId: string;
        location: { addressLabel: string; latitude: string; longitude: string };
      } }>(`
        SELECT axora_save_branch_delivery_location(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
        ) AS value
      `, [
        ownerId,
        ownerAssignmentId,
        fixture.branch_id,
        firstAddress,
        firstCoordinates.latitude,
        firstCoordinates.longitude,
        "Use the guarded receiving entrance.",
        "Confirm canonical delivery point",
        firstCommandId,
        savedAt,
      ]);
      expect(saved.rows[0]?.value).toMatchObject({
        branchId: fixture.branch_id,
        canManage: true,
        commandId: firstCommandId,
        location: {
          addressLabel: firstAddress,
          latitude: "3.139000",
          longitude: "101.686900",
        },
      });

      const replayedAt = new Date(savedAt.getTime() + 500);
      const replayed = await db.query<{ value: {
        capturedAt: string; commandId: string;
        location: { addressLabel: string; latitude: string; longitude: string };
      } }>(`
        SELECT axora_save_branch_delivery_location(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
        ) AS value
      `, [
        ownerId,ownerAssignmentId,fixture.branch_id,firstAddress,
        firstCoordinates.latitude,firstCoordinates.longitude,
        "Use the guarded receiving entrance.",
        "Confirm canonical delivery point",firstCommandId,replayedAt,
      ]);
      expect(new Date(replayed.rows[0]!.value.capturedAt).toISOString())
        .toBe(replayedAt.toISOString());
      expect(replayed.rows[0]?.value).toMatchObject({
        commandId: firstCommandId,
        location: saved.rows[0]?.value.location,
      });
      const replayEvidence = await db.query<{ commands: number; history: number }>(`
        SELECT count(*)::int AS commands,
          (SELECT count(*)::int FROM organization_structure_history
            WHERE company_id=command.company_id
              AND node_type='DELIVERY_LOCATION') AS history
        FROM branch_delivery_location_commands command
        WHERE actor_user_id=$1 AND command_id=$2
        GROUP BY command.company_id
      `, [ownerId, firstCommandId]);
      expect(replayEvidence.rows[0]).toEqual({ commands: 1, history: 1 });
      await expect(db.query(`
        SELECT axora_save_branch_delivery_location(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,now()
        )
      `, [
        ownerId,ownerAssignmentId,fixture.branch_id,
        "Conflicting receiving gate",firstCoordinates.latitude,
        firstCoordinates.longitude,"Use the guarded receiving entrance.",
        "Confirm canonical delivery point",firstCommandId,
      ])).rejects.toThrow(/command is unavailable/i);

      await expect(db.query(`
        SELECT axora_save_branch_delivery_location(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,now()
        )
      `, [
        ownerId,
        ownerAssignmentId,
        fixture.branch_id,
        "Rejected impossible destination",
        90.000001,
        101.6869,
        "",
        "Reject impossible latitude",
        "d7000000-0000-4000-8000-000000000099",
      ])).rejects.toThrow(/invalid/i);
      await expect(db.query(`
        SELECT axora_save_branch_delivery_location(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,now()
        )
      `, [
        ownerId,
        ownerAssignmentId,
        fixture.branch_id,
        "Rejected incomplete destination",
        null,
        101.6869,
        "",
        "Reject incomplete coordinate pair",
        "d7000000-0000-4000-8000-000000000098",
      ])).rejects.toThrow(/invalid/i);
      await expect(db.query(`
        UPDATE delivery_locations SET longitude=NULL
        WHERE branch_id=$1 AND active AND is_primary
      `, [fixture.branch_id])).rejects.toThrow(/coordinate_pair|constraint/i);
      expect((await db.query<{ latitude: string; longitude: string }>(`
        SELECT latitude::text,longitude::text FROM delivery_locations
        WHERE branch_id=$1 AND active AND is_primary
      `, [fixture.branch_id])).rows[0]).toEqual({
        latitude: "3.139000",
        longitude: "101.686900",
      });

      await db.exec("SET session_replication_role=replica");
      await db.query(`
        UPDATE requests SET
          status_id=lookup_id('request_status','Preparing for Delivery'),
          completed_at=NULL
        WHERE id=$1
      `, [fixture.request_id]);
      await db.query(`
        UPDATE request_line_receipt_baselines SET
          legacy_accepted_quantity_snapshot=0,
          independent_accepted_quantity_snapshot=0,
          baseline_accepted_quantity=0
        WHERE request_line_id IN (
          SELECT id FROM request_lines WHERE request_id=$1
        )
      `, [fixture.request_id]);
      await db.exec("SET session_replication_role=origin");

      const createdAt = new Date(savedAt.getTime() + 1_000);
      const jobId = (await db.query<{ value: string | null }>(
        "SELECT axora_ensure_available_job_for_paid_payment($1,$2) AS value",
        [fixture.payment_id, createdAt],
      )).rows[0]?.value;
      expect(jobId).toMatch(/^[0-9a-f-]{36}$/);

      const secondAddress = "Receiving bay 8, updated branch setting";
      await db.query(`
        SELECT axora_save_branch_delivery_location(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
        )
      `, [
        ownerId,
        ownerAssignmentId,
        fixture.branch_id,
        secondAddress,
        4.2105,
        101.9758,
        "Use the new gate for future deliveries.",
        "Move future deliveries to receiving bay 8",
        secondCommandId,
        new Date(savedAt.getTime() + 2_000),
      ]);

      const snapshot = (await db.query<{
        address: string;
        latitude: string;
        longitude: string;
        live_address: string;
        live_latitude: string;
        live_longitude: string;
      }>(`
        SELECT job.delivery_address_snapshot AS address,
          job.destination_latitude::text AS latitude,
          job.destination_longitude::text AS longitude,
          location.address AS live_address,
          location.latitude::text AS live_latitude,
          location.longitude::text AS live_longitude
        FROM delivery_jobs job
        JOIN delivery_locations location ON location.id=job.destination_location_id
        WHERE job.id=$1
      `, [jobId])).rows[0];
      expect(snapshot).toEqual({
        address: firstAddress,
        latitude: "3.139000",
        longitude: "101.686900",
        live_address: secondAddress,
        live_latitude: "4.210500",
        live_longitude: "101.975800",
      });

      const navigation = buildDeliveryNavigationLinks({
        latitude: Number(snapshot.latitude),
        longitude: Number(snapshot.longitude),
      });
      expect(new URL(navigation.waze).searchParams.get("ll"))
        .toBe("3.139,101.6869");
      expect(new URL(navigation.googleMaps).searchParams.get("destination"))
        .toBe("3.139,101.6869");
      expect(navigation.googleMaps).not.toContain("4.2105");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("fails with the narrow location-required contract before creating a paid job", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      await applyDemoSeed(db);
      const fixture = (await db.query<{
        branchId: string;
        paymentId: string;
        requestId: string;
      }>(`
        SELECT request.branch_id::text AS "branchId",
          payment.id::text AS "paymentId",request.id::text AS "requestId"
        FROM payments payment
        JOIN invoices invoice ON invoice.id=payment.invoice_id
        JOIN requests request ON request.id=invoice.request_id
        ORDER BY payment.id LIMIT 1
      `)).rows[0];
      if (!fixture) throw new Error("A paid delivery fixture is required.");
      await db.exec("SET session_replication_role=replica");
      await db.query("DELETE FROM delivery_locations WHERE branch_id=$1", [fixture.branchId]);
      await db.query(`
        UPDATE requests SET
          status_id=lookup_id('request_status','Preparing for Delivery'),
          completed_at=NULL
        WHERE id=$1
      `, [fixture.requestId]);
      await db.query(`
        UPDATE request_line_receipt_baselines SET
          legacy_accepted_quantity_snapshot=0,
          independent_accepted_quantity_snapshot=0,
          baseline_accepted_quantity=0
        WHERE request_line_id IN (
          SELECT id FROM request_lines WHERE request_id=$1
        )
      `, [fixture.requestId]);
      await db.exec("SET session_replication_role=origin");

      let rejected: unknown;
      try {
        await db.query(
          "SELECT axora_ensure_available_job_for_paid_payment($1,now())",
          [fixture.paymentId],
        );
      } catch (error) {
        rejected = error;
      }
      expect(rejected).toMatchObject({ code: "P7301" });
      expect(String(rejected)).toContain("AXORA_BRANCH_DELIVERY_LOCATION_REQUIRED");
      expect((await db.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM delivery_jobs WHERE request_id=$1
      `, [fixture.requestId])).rows[0]?.count).toBe(0);
    } finally {
      await db.close();
    }
  }, 30_000);
});
