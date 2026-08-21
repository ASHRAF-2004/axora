import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { renderVersionedDocument } from "./document-renderer.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function password() {
  if (process.env.DB_PASSWORD_FILE) return readFile(process.env.DB_PASSWORD_FILE, "utf8").then((value) => value.trim());
  return Promise.resolve(process.env.DB_PASSWORD ?? "");
}

async function poolConfig() {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  return {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? "axora",
    user: process.env.DB_USER ?? "axora_app",
    password: await password(),
    max: Math.max(1, Math.min(4, Number(process.env.DOCUMENT_WORKER_POOL_SIZE ?? 3))),
    connectionTimeoutMillis: 10_000,
  };
}

function safeError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500)
    || "Document generation failed";
}

function storageRoot(override) {
  return path.resolve(override ?? process.env.AXORA_UPLOADS_CONTAINER_DIR ?? path.join(process.cwd(), "data", "uploads"));
}

function fileNameFor(job) {
  const reference = String(
    job.input_snapshot?.request?.reference
      ?? job.input_snapshot?.purchaseOrder?.reference
      ?? job.request_id,
  ).normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);
  const prefix = job.document_type === "APPROVED_REQUEST" ? "purchase-request"
    : job.document_type === "FINAL_FULFILMENT_DELIVERY" ? "final-delivery"
      : job.document_type === "FINAL_INVOICE" ? "Axora-Invoice"
        : "supplier-purchase-order";
  return `${prefix}-${reference || job.request_id}.pdf`;
}

export async function writeGeneratedDocument({ job, bytes, rootOverride }) {
  if (!UUID.test(job.company_id) || !UUID.test(job.request_id) || !UUID.test(job.job_id)) {
    throw new Error("The generated document storage scope is invalid");
  }
  if (!Buffer.isBuffer(bytes) || bytes.length < 100 || bytes.length > MAX_FILE_BYTES
    || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
    || !bytes.subarray(Math.max(0, bytes.length - 1024)).includes(Buffer.from("%%EOF"))) {
    throw new Error("The generated PDF is invalid");
  }
  const root = storageRoot(rootOverride);
  const directory = path.join(root, "generated-documents", job.company_id, job.request_id);
  await mkdir(directory, { recursive: true, mode: 0o750 });
  const relativePath = path.posix.join("generated-documents", job.company_id, job.request_id, `${job.job_id}.pdf`);
  const target = path.join(root, ...relativePath.split("/"));
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("The generated document path is invalid");
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o640 });
    await chmod(temporary, 0o640);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return {
    relativePath, fileName: fileNameFor(job), fileSize: bytes.length,
    checksum: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function workerQuery(pool, text, values = []) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('axora.system_identity','document-worker',true)");
    const result = await client.query(text, values);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function createDocumentJobStore(pool) {
  return {
    async claim(workerId, leaseSeconds, now) {
      const result = await workerQuery(pool,
        "SELECT * FROM public.axora_claim_document_generation_job($1,$2,$3)",
        [workerId, leaseSeconds, now]);
      return result.rows[0] ?? null;
    },
    async complete(job, output, pageCount, now) {
      const capability = job.document_type === "FINAL_INVOICE"
        ? "axora_complete_final_invoice_document_job"
        : "axora_complete_document_generation_job";
      const result = await workerQuery(pool,
        `SELECT public.${capability}($1,$2,$3,$4,$5,$6,$7,$8) AS value`,
        [job.job_id, job.lease_id, output.fileName, output.relativePath,
          output.checksum, pageCount, output.fileSize, now]);
      return result.rows[0]?.value;
    },
    async fail(job, message, now) {
      const result = await workerQuery(pool,
        "SELECT public.axora_fail_document_generation_job($1,$2,$3,$4) AS value",
        [job.job_id, job.lease_id, message, now]);
      return result.rows[0]?.value;
    },
    async ready() {
      await pool.query("SELECT 1");
      return true;
    },
  };
}

export async function processDocumentJob(job, dependencies = {}) {
  const render = dependencies.render ?? renderVersionedDocument;
  const storeFile = dependencies.storeFile ?? writeGeneratedDocument;
  const jobStore = dependencies.jobStore;
  if (!jobStore) throw new Error("A document job store is required");
  let output;
  try {
    const rendered = await render({
      snapshot: job.input_snapshot,
      companyLogo: job.company_logo_content,
      companyLogoContentType: job.company_logo_content_type,
    });
    output = await storeFile({ job, bytes: rendered.bytes, rootOverride: dependencies.rootOverride });
    await jobStore.complete(job, output, rendered.pageCount, new Date());
    return { status: "COMPLETED", jobId: job.job_id, pageCount: rendered.pageCount };
  } catch (error) {
    if (output?.relativePath) {
      await rm(path.join(storageRoot(dependencies.rootOverride), ...output.relativePath.split("/")), { force: true });
    }
    await jobStore.fail(job, safeError(error), new Date());
    return { status: "FAILED", jobId: job.job_id, error: safeError(error) };
  }
}

export async function pollDocumentJobsOnce(jobStore, options = {}) {
  const concurrency = Math.max(1, Math.min(4, options.concurrency ?? 2));
  const leaseSeconds = Math.max(30, Math.min(900, options.leaseSeconds ?? 180));
  const workerId = options.workerId ?? randomUUID();
  const jobs = [];
  for (let index = 0; index < concurrency; index += 1) {
    const job = await jobStore.claim(workerId, leaseSeconds, new Date());
    if (!job) break;
    jobs.push(job);
  }
  return Promise.all(jobs.map((job) => processDocumentJob(job, {
    ...options, jobStore,
  })));
}

export async function startDocumentWorker() {
  const pool = new Pool(await poolConfig());
  const jobStore = createDocumentJobStore(pool);
  const workerId = randomUUID();
  const intervalMs = Math.max(1_000, Number(process.env.DOCUMENT_WORKER_INTERVAL_MS ?? 15_000));
  const port = Number(process.env.DOCUMENT_WORKER_PORT ?? 3102);
  let stopping = false;
  let polling = false;
  let lastPollAt = new Date(0);

  async function poll() {
    if (stopping || polling) return;
    polling = true;
    try {
      const results = await pollDocumentJobsOnce(jobStore, { workerId });
      lastPollAt = new Date();
      for (const result of results) console.info(JSON.stringify({ event: "document_job_processed", status: result.status }));
    } catch (error) {
      console.error(JSON.stringify({ event: "document_worker_poll_failed", error: safeError(error) }));
    } finally {
      polling = false;
    }
  }

  const timer = setInterval(poll, intervalMs);
  timer.unref();
  await poll();
  const server = createServer(async (request, response) => {
    if (request.url === "/health/live") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "live" }));
      return;
    }
    if (request.url === "/health/ready") {
      try {
        await jobStore.ready();
        const fresh = Date.now() - lastPollAt.valueOf() < Math.max(intervalMs * 4, 60_000);
        response.writeHead(fresh ? 200 : 503, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: fresh ? "ready" : "starting" }));
      } catch {
        response.writeHead(503, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "unavailable" }));
      }
      return;
    }
    response.writeHead(404).end();
  });
  server.listen(port, "127.0.0.1");

  async function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
  return { stop, server, pool };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startDocumentWorker().catch((error) => {
    console.error(JSON.stringify({ event: "document_worker_start_failed", error: safeError(error) }));
    process.exit(1);
  });
}
