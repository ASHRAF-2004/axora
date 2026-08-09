export type ProfileImageMutationResult = {
  ok: true;
  status: "ACTIVATED" | "UNCHANGED" | "REMOVED";
  versionId?: string;
  referenceId: string;
};

type ProfileImageMutationFailure = {
  ok: false;
  code?: string;
  referenceId?: string;
};

export class ProfileImageRequestError extends Error {
  constructor(
    public readonly code: string,
    public readonly referenceId: string,
    public readonly uncertain: boolean,
    public readonly cancelled = false,
  ) {
    super(code);
    this.name = "ProfileImageRequestError";
  }
}

export interface ProfileImageRequestOptions {
  method: "POST" | "DELETE";
  body?: FormData;
  timeoutMs?: number;
  onUploadProgress?: (percentage: number) => void;
  onProcessing?: () => void;
  requestFactory?: () => XMLHttpRequest;
}

export interface ActiveProfileImageRequest {
  promise: Promise<ProfileImageMutationResult>;
  cancel: () => void;
}

function parseResponse(value: string): ProfileImageMutationResult | ProfileImageMutationFailure {
  try {
    return JSON.parse(value) as ProfileImageMutationResult | ProfileImageMutationFailure;
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export function startProfileImageRequest(
  options: ProfileImageRequestOptions,
): ActiveProfileImageRequest {
  const xhr = options.requestFactory?.() ?? new XMLHttpRequest();
  const clientReference = crypto.randomUUID();
  let processing = false;
  let settled = false;

  const promise = new Promise<ProfileImageMutationResult>((resolve, reject) => {
    const fail = (
      code: string,
      reference: string,
      uncertain: boolean,
      cancelled = false,
    ) => {
      if (settled) return;
      settled = true;
      reject(new ProfileImageRequestError(code, reference, uncertain, cancelled));
    };
    const beginProcessing = () => {
      if (processing || settled) return;
      processing = true;
      options.onProcessing?.();
    };

    xhr.open(options.method, "/api/profile/avatar", true);
    xhr.withCredentials = true;
    xhr.timeout = options.timeoutMs ?? 45_000;
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("X-Axora-Request-ID", clientReference);

    if (options.method === "POST") {
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || event.total <= 0 || settled) return;
        if (event.loaded >= event.total) {
          beginProcessing();
          return;
        }
        const percentage = Math.max(
          1,
          Math.min(99, Math.floor((event.loaded / event.total) * 100)),
        );
        options.onUploadProgress?.(percentage);
      };
      xhr.upload.onload = beginProcessing;
    }

    xhr.onload = () => {
      if (settled) return;
      const payload = parseResponse(xhr.responseText);
      const responseReference = payload.referenceId || clientReference;
      if (xhr.status >= 200 && xhr.status < 300 && payload.ok === true) {
        settled = true;
        resolve(payload);
        return;
      }
      fail(
        payload.ok === false ? payload.code ?? "unavailable" : "unavailable",
        responseReference,
        false,
      );
    };
    xhr.onerror = () => fail("interrupted", clientReference, true);
    xhr.ontimeout = () => fail("interrupted", clientReference, true);
    xhr.onabort = () => fail(
      processing ? "interrupted" : "cancelled",
      clientReference,
      processing,
      true,
    );
    xhr.send(options.body ?? null);
  });

  return {
    promise,
    cancel: () => {
      if (!settled) xhr.abort();
    },
  };
}
