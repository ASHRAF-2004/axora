import { z } from "zod";
import type { PoolClient, QueryResultRow } from "pg";
import { insertContactEmailOutbox, type SupportedEmailLocale } from "./transactional-email";

const mutationSchema = z.object({ created: z.boolean(), submissionId: z.string().uuid() }).strict();
interface SnapshotRow extends QueryResultRow { snapshot: unknown }

export async function recordPublicContactSubmission(
  client: PoolClient,
  payload: Record<string, unknown>,
  locale: SupportedEmailLocale,
  capturedAt: Date,
) {
  const result = await client.query<SnapshotRow>(
    "SELECT public.axora_record_public_contact_submission($1,$2) AS snapshot",
    [payload, capturedAt],
  );
  const mutation = mutationSchema.parse(result.rows[0]?.snapshot);
  if (mutation.created) await insertContactEmailOutbox(client, mutation.submissionId, locale);
  return mutation;
}
