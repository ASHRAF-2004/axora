BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '300s';

-- A root traversal must locate each successor without rescanning the complete
-- audit table per link. This non-unique index changes neither row hashes nor
-- the existing write/authorization contract; malformed forks remain detectable.
CREATE INDEX audit_logs_integrity_predecessor_idx
  ON public.audit_logs(integrity_partition, previous_integrity_hash);

-- Event timestamps are captured before the partition-head lock in migration
-- 059. They describe event time, not the serialized order of integrity links.
-- Keep its temporal verifier, every historical row/hash and the write trigger
-- unchanged. This private verifier checks the complete linked chain instead.
CREATE FUNCTION public.axora_verify_audit_append_integrity(
  p_partition text DEFAULT NULL
)
RETURNS TABLE (
  partition_key text,
  event_count bigint,
  invalid_hash_count bigint,
  invalid_partition_count bigint,
  duplicate_hash_count bigint,
  root_count bigint,
  missing_predecessor_count bigint,
  fork_count bigint,
  reachable_count bigint,
  terminal_count bigint,
  head_matches boolean,
  is_valid boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH RECURSIVE events AS MATERIALIZED (
    SELECT audit.id,
      audit.integrity_partition AS partition_key,
      audit.integrity_hash,
      audit.previous_integrity_hash,
      COALESCE(audit.company_id::text, 'PLATFORM') AS expected_partition,
      public.axora_audit_hash(audit) AS expected_hash
    FROM public.audit_logs audit
    WHERE p_partition IS NULL OR audit.integrity_partition = p_partition
  ), heads AS MATERIALIZED (
    SELECT head.partition_key, head.latest_event_id, head.latest_hash
    FROM public.audit_integrity_heads head
    WHERE p_partition IS NULL OR head.partition_key = p_partition
  ), partitions AS (
    SELECT event.partition_key FROM events event
    UNION
    SELECT head.partition_key FROM heads head
  ), hash_counts AS MATERIALIZED (
    SELECT event.partition_key, event.integrity_hash, count(*) AS event_count
    FROM events event GROUP BY event.partition_key, event.integrity_hash
  ), predecessor_counts AS MATERIALIZED (
    SELECT event.partition_key, event.previous_integrity_hash, count(*) AS successor_count
    FROM events event WHERE event.previous_integrity_hash IS NOT NULL
    GROUP BY event.partition_key, event.previous_integrity_hash
  ), counts AS (
    SELECT event.partition_key,
      count(*) AS event_count,
      count(*) FILTER (WHERE NOT COALESCE(
        event.integrity_hash ~ '^[0-9a-f]{64}$'
          AND event.integrity_hash = event.expected_hash,
        false
      )) AS invalid_hash_count,
      count(*) FILTER (WHERE event.partition_key IS DISTINCT FROM event.expected_partition)
        AS invalid_partition_count,
      count(*) FILTER (WHERE event.previous_integrity_hash IS NULL) AS root_count,
      count(*) FILTER (WHERE event.previous_integrity_hash IS NOT NULL
        AND predecessor.event_count IS NULL) AS missing_predecessor_count
    FROM events event
    LEFT JOIN hash_counts predecessor
      ON predecessor.partition_key = event.partition_key
      AND predecessor.integrity_hash = event.previous_integrity_hash
    GROUP BY event.partition_key
  ), duplicate_hashes AS (
    SELECT duplicate.partition_key, count(*) AS duplicate_hash_count
    FROM hash_counts duplicate WHERE duplicate.event_count > 1
    GROUP BY duplicate.partition_key
  ), forks AS (
    SELECT fork.partition_key, count(*) AS fork_count
    FROM predecessor_counts fork WHERE fork.successor_count > 1
    GROUP BY fork.partition_key
  ), reachable(partition_key, id, integrity_hash) AS (
    SELECT event.partition_key, event.id, event.integrity_hash
    FROM events event WHERE event.previous_integrity_hash IS NULL
    UNION
    -- No depth/path column: UNION bounds traversal to one tuple per event,
    -- including malformed graphs. Disconnected cycles remain unreachable.
    SELECT child.integrity_partition, child.id, child.integrity_hash
    FROM reachable predecessor
    JOIN public.audit_logs child
      ON child.integrity_partition = predecessor.partition_key
      AND child.previous_integrity_hash = predecessor.integrity_hash
  ), reachability AS (
    SELECT reachable.partition_key, count(*) AS reachable_count
    FROM reachable GROUP BY reachable.partition_key
  ), terminals AS MATERIALIZED (
    SELECT event.partition_key, event.id, event.integrity_hash
    FROM events event
    LEFT JOIN predecessor_counts successor
      ON successor.partition_key = event.partition_key
      AND successor.previous_integrity_hash = event.integrity_hash
    WHERE successor.successor_count IS NULL
  ), terminal_counts AS (
    SELECT terminal.partition_key, count(*) AS terminal_count
    FROM terminals terminal GROUP BY terminal.partition_key
  ), evidence AS (
    SELECT partition.partition_key,
      COALESCE(counts.event_count, 0) AS event_count,
      COALESCE(counts.invalid_hash_count, 0) AS invalid_hash_count,
      COALESCE(counts.invalid_partition_count, 0) AS invalid_partition_count,
      COALESCE(duplicate_hashes.duplicate_hash_count, 0) AS duplicate_hash_count,
      COALESCE(counts.root_count, 0) AS root_count,
      COALESCE(counts.missing_predecessor_count, 0) AS missing_predecessor_count,
      COALESCE(forks.fork_count, 0) AS fork_count,
      COALESCE(reachability.reachable_count, 0) AS reachable_count,
      COALESCE(terminal_counts.terminal_count, 0) AS terminal_count,
      EXISTS (
        SELECT 1 FROM heads head JOIN terminals terminal
          ON terminal.partition_key = head.partition_key
          AND terminal.id = head.latest_event_id
          AND terminal.integrity_hash = head.latest_hash
        WHERE head.partition_key = partition.partition_key
      ) AS head_matches
    FROM partitions partition
    LEFT JOIN counts ON counts.partition_key IS NOT DISTINCT FROM partition.partition_key
    LEFT JOIN duplicate_hashes ON duplicate_hashes.partition_key IS NOT DISTINCT FROM partition.partition_key
    LEFT JOIN forks ON forks.partition_key IS NOT DISTINCT FROM partition.partition_key
    LEFT JOIN reachability ON reachability.partition_key IS NOT DISTINCT FROM partition.partition_key
    LEFT JOIN terminal_counts ON terminal_counts.partition_key IS NOT DISTINCT FROM partition.partition_key
  )
  SELECT evidence.*,
    evidence.event_count > 0
      AND evidence.invalid_hash_count = 0
      AND evidence.invalid_partition_count = 0
      AND evidence.duplicate_hash_count = 0
      AND evidence.root_count = 1
      AND evidence.missing_predecessor_count = 0
      AND evidence.fork_count = 0
      AND evidence.reachable_count = evidence.event_count
      AND evidence.terminal_count = 1
      AND evidence.head_matches AS is_valid
  FROM evidence
  ORDER BY evidence.partition_key;
$$;

REVOKE ALL ON FUNCTION public.axora_verify_audit_append_integrity(text) FROM PUBLIC;
DO $$
DECLARE runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['axora_app', 'axora_cleanup_worker', 'axora_integration_worker']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.axora_verify_audit_append_integrity(text) FROM %I',
        runtime_role
      );
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.axora_verify_audit_append_integrity(text) IS
  'Private strict whole-chain verifier using serialized hash links and exact heads; migration 059 timestamp ordering remains separate temporal diagnostics. Empty databases return no partitions, while head-only partitions fail.';

COMMIT;
