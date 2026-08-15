import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PermanentCleanupError,
  companyDeletionCleanupDatabaseConfig,
  createCompanyDeletionCleanupAdapters,
  pollCompanyDeletionCleanupOnce,
  processCompanyDeletionCleanupTask,
  removeOwnedFile,
} from "../server-tools/company-deletion-cleanup-worker.mjs";

const roots = [];
const task = {
  task_id: "11111111-1111-4111-8111-111111111111",
  command_id: "22222222-2222-4222-8222-222222222222",
  task_kind: "FILE",
  locator: "generated-documents/tenant/request/invoice.pdf",
  lease_id: "33333333-3333-4333-8333-333333333333",
};

async function root() {
  const value = await mkdtemp(path.join(os.tmpdir(), "axora-company-cleanup-"));
  roots.push(value);
  return value;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe("company deletion external cleanup worker", () => {
  it("requires the dedicated cleanup database role and rejects connection URLs", () => {
    expect(companyDeletionCleanupDatabaseConfig({
      DB_HOST: "db", DB_NAME: "axora", DB_USER: "axora_cleanup_worker", DB_PASSWORD: "fixture-only",
    })).toMatchObject({ host: "db", database: "axora", user: "axora_cleanup_worker" });
    expect(() => companyDeletionCleanupDatabaseConfig({
      DB_HOST: "db", DB_NAME: "axora", DB_USER: "axora_app", DB_PASSWORD: "fixture-only",
    })).toThrow(/incomplete/i);
    expect(() => companyDeletionCleanupDatabaseConfig({
      DATABASE_URL: "postgres://axora_app:fixture@db/axora",
    })).toThrow(/incomplete/i);
  });

  it("removes an owned file idempotently and never escapes the configured root", async () => {
    const uploads = await root();
    const target = path.join(uploads, ...task.locator.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "disposable fixture");
    await expect(removeOwnedFile(uploads, task.locator)).resolves.toEqual({
      removed: true, alreadyAbsent: false,
    });
    await expect(stat(target)).rejects.toThrow();
    await expect(removeOwnedFile(uploads, task.locator)).resolves.toEqual({
      removed: false, alreadyAbsent: true,
    });
    await expect(removeOwnedFile(uploads, "../outside.txt"))
      .rejects.toBeInstanceOf(PermanentCleanupError);
  });

  it("completes real file cleanup and reports permanent adapter errors without retry", async () => {
    const uploads = await root();
    const target = path.join(uploads, ...task.locator.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "fixture");
    const store = { complete: vi.fn(), fail: vi.fn() };
    const adapters = createCompanyDeletionCleanupAdapters({ uploadsRoot: uploads });
    await expect(processCompanyDeletionCleanupTask(task, {
      adapters, store, workerId: "cleanup-test",
    })).resolves.toMatchObject({ status: "COMPLETE" });
    expect(store.complete).toHaveBeenCalledOnce();
    expect(store.fail).not.toHaveBeenCalled();

    const unsafe = { ...task, locator: "../../outside", task_id: "44444444-4444-4444-8444-444444444444" };
    store.fail.mockResolvedValue({ cleanupStatus: "FAILED" });
    await expect(processCompanyDeletionCleanupTask(unsafe, {
      adapters, store, workerId: "cleanup-test",
    })).resolves.toMatchObject({ status: "TERMINAL_FAILED" });
    expect(store.fail).toHaveBeenLastCalledWith(
      unsafe, expect.stringMatching(/unsafe|escape/i), false, "cleanup-test", expect.any(Date),
    );
  });

  it("claims a bounded batch and leaves retry timing to the leased database queue", async () => {
    const uploads = await root();
    const first = { ...task };
    const second = { ...task, task_id: "55555555-5555-4555-8555-555555555555", locator: "files/second.pdf" };
    for (const item of [first, second]) {
      const target = path.join(uploads, ...item.locator.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, "fixture");
    }
    const claim = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const complete = vi.fn();
    const store = { claim, complete, fail: vi.fn() };
    const results = await pollCompanyDeletionCleanupOnce({
      store,
      adapters: createCompanyDeletionCleanupAdapters({ uploadsRoot: uploads }),
      workerId: "cleanup-test",
      concurrency: 2,
      leaseSeconds: 90,
    });
    expect(claim).toHaveBeenCalledTimes(2);
    expect(claim).toHaveBeenNthCalledWith(1, "cleanup-test", 90, expect.any(Date));
    expect(complete).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
  });

  it("classifies transient adapter failures as retryable without exposing locator data", async () => {
    const store = {
      complete: vi.fn(),
      fail: vi.fn().mockResolvedValue({ cleanupStatus: "PENDING" }),
    };
    const adapters = {
      FILE: vi.fn().mockRejectedValue(new Error("temporary filesystem failure")),
    };
    await expect(processCompanyDeletionCleanupTask(task, {
      adapters, store, workerId: "cleanup-test",
    })).resolves.toEqual({ status: "RETRY_WAIT", taskId: task.task_id });
    expect(store.complete).not.toHaveBeenCalled();
    expect(store.fail).toHaveBeenCalledWith(
      task, "temporary filesystem failure", true, "cleanup-test", expect.any(Date),
    );
  });

  it("does not treat unconfigured cache or search stores as successful cleanup", async () => {
    const uploads = await root();
    const adapters = createCompanyDeletionCleanupAdapters({ uploadsRoot: uploads });
    await expect(adapters.CACHE({ locator: "company:11111111-1111-4111-8111-111111111111" }))
      .rejects.toThrow(/not configured/i);
    await expect(adapters.SEARCH_INDEX({ locator: "company:11111111-1111-4111-8111-111111111111" }))
      .rejects.toThrow(/not configured/i);
    expect(await readFile(new URL("../server-tools/company-deletion-cleanup-worker.mjs", import.meta.url), "utf8"))
      .not.toMatch(/session_replication_role/);
  });
});
