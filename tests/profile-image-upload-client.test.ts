import { describe, expect, it, vi } from "vitest";
import {
  ProfileImageRequestError,
  startProfileImageRequest,
} from "@/lib/profile-image-upload-client";

class FakeXhr {
  upload: {
    onprogress: ((event: ProgressEvent) => void) | null;
    onload: (() => void) | null;
  } = { onprogress: null, onload: null };
  status = 0;
  responseText = "";
  timeout = 0;
  withCredentials = false;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.onabort?.());

  progress(loaded: number, total: number) {
    this.upload.onprogress?.({
      lengthComputable: true, loaded, total,
    } as ProgressEvent);
  }

  respond(status: number, body: Record<string, unknown>) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

function request(fake: FakeXhr, callbacks: {
  onUploadProgress?: (value: number) => void;
  onProcessing?: () => void;
} = {}) {
  return startProfileImageRequest({
    method: "POST",
    body: new FormData(),
    requestFactory: () => fake as unknown as XMLHttpRequest,
    ...callbacks,
  });
}

describe("real profile image request status", () => {
  it("reports actual transmitted bytes, then processing, and completes only on the server response", async () => {
    const fake = new FakeXhr();
    const progress: number[] = [];
    const processing = vi.fn();
    const active = request(fake, { onUploadProgress: (value) => progress.push(value), onProcessing: processing });
    let completed = false;
    void active.promise.then(() => { completed = true; });

    fake.progress(25, 100);
    fake.progress(100, 100);
    expect(progress).toEqual([25]);
    expect(progress).not.toContain(100);
    expect(processing).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(completed).toBe(false);

    fake.respond(200, {
      ok: true,
      status: "ACTIVATED",
      versionId: "11111111-1111-4111-8111-111111111111",
      referenceId: "22222222-2222-4222-8222-222222222222",
    });
    await expect(active.promise).resolves.toMatchObject({ status: "ACTIVATED" });
  });

  it("surfaces a confirmed server failure with its reference and permits retry", async () => {
    const fake = new FakeXhr();
    const active = request(fake);
    fake.respond(422, {
      ok: false, code: "type", referenceId: "33333333-3333-4333-8333-333333333333",
    });
    await expect(active.promise).rejects.toMatchObject({
      code: "type",
      uncertain: false,
      referenceId: "33333333-3333-4333-8333-333333333333",
    } satisfies Partial<ProfileImageRequestError>);
  });

  it("labels timeout and a cancellation after upload as uncertain lost responses", async () => {
    const timedOut = new FakeXhr();
    const timeoutRequest = request(timedOut);
    timedOut.ontimeout?.();
    await expect(timeoutRequest.promise).rejects.toMatchObject({
      code: "interrupted", uncertain: true,
    });

    const processing = new FakeXhr();
    const processingRequest = request(processing);
    processing.upload.onload?.();
    processingRequest.cancel();
    await expect(processingRequest.promise).rejects.toMatchObject({
      code: "interrupted", uncertain: true, cancelled: true,
    });
  });

  it("cancels safely before all bytes leave the browser", async () => {
    const fake = new FakeXhr();
    const active = request(fake);
    active.cancel();
    await expect(active.promise).rejects.toMatchObject({
      code: "cancelled", uncertain: false, cancelled: true,
    });
  });
});
