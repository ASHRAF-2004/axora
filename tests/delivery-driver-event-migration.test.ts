import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

describe("delivery driver event evidence migration", () => {
  it("preserves legacy metadata and validates new structured evidence", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db, { through: "029_delivery_driver_event_evidence.sql" });
      const result = await db.query<{
        legacy_valid: boolean;
        empty_issue_invalid: boolean;
        partial_valid: boolean;
        partial_without_receiver_invalid: boolean;
      }>(`
        SELECT
          axora_delivery_event_metadata_is_valid(
            'ARRIVED','{"legacyContext":"preserved"}'::jsonb
          ) AS legacy_valid,
          NOT axora_delivery_event_metadata_is_valid(
            'ISSUE_REPORTED','{}'::jsonb
          ) AS empty_issue_invalid,
          axora_delivery_event_metadata_is_valid(
            'PARTIALLY_DELIVERED',jsonb_build_object(
              'receiverName','Branch security desk',
              'lineOutcomes',jsonb_build_array(jsonb_build_object(
                'deliveryJobLineId','10000000-0000-4000-8000-000000000001',
                'deliveredQuantity',8,'damagedQuantity',1,'missingQuantity',2
              ))
            )
          ) AS partial_valid,
          NOT axora_delivery_event_metadata_is_valid(
            'PARTIALLY_DELIVERED',jsonb_build_object(
              'lineOutcomes',jsonb_build_array(jsonb_build_object(
                'deliveryJobLineId','10000000-0000-4000-8000-000000000001',
                'deliveredQuantity',8,'damagedQuantity',1,'missingQuantity',2
              ))
            )
          ) AS partial_without_receiver_invalid
      `);
      expect(result.rows[0]).toEqual({
        legacy_valid: true,
        empty_issue_invalid: true,
        partial_valid: true,
        partial_without_receiver_invalid: true,
      });
      const receiptGuard = await db.query<{ definition: string }>(`
        SELECT pg_get_functiondef('validate_receipt()'::regprocedure) AS definition
      `);
      expect(receiptGuard.rows[0].definition).toContain("PARTIALLY_DELIVERED");
      expect(receiptGuard.rows[0].definition).toContain("assignment.status IN ('ASSIGNED','ACCEPTED','COMPLETED')");
      expect(receiptGuard.rows[0].definition).toContain("Driver evidence cannot serve as customer receipt confirmation");
      const eventGuard = await db.query<{ definition: string }>(`
        SELECT pg_get_functiondef('validate_delivery_job_event()'::regprocedure) AS definition
      `);
      expect(eventGuard.rows[0].definition).toContain("NEW.received_at := clock_timestamp()");
      const chronology = await db.query<{ constraint: string; index: string }>(`
        SELECT
          (SELECT pg_get_constraintdef(oid)
           FROM pg_constraint
           WHERE conrelid='delivery_job_events'::regclass
             AND pg_get_constraintdef(oid) LIKE '%client_recorded_at%received_at%') AS constraint,
          pg_get_indexdef('delivery_job_events_timeline_idx'::regclass) AS index
      `);
      expect(chronology.rows[0].constraint).toContain("'00:05:00'::interval");
      expect(chronology.rows[0].index).toContain("received_at, id");
    } finally {
      await db.close();
    }
  }, 30_000);
});
