import { isDemoMode } from "@/lib/db";
import {
  claimPublicVisitorFallback,
  createVisitorFallbackCookie,
  verifyVisitorFallbackCookie,
  VISITOR_FALLBACK_COOKIE,
  VISITOR_FALLBACK_COOKIE_MAX_AGE,
} from "@/lib/public-visitor-fallback";
import {
  buildVisitorIdentity,
  claimPublicVisitor,
  consumeVisitorClaimRateLimit,
  createVisitorClaimCookie,
  getPublicVisitorSnapshot,
  normalizedPublicNetworkIdentifier,
  VISITOR_CLAIM_COOKIE,
  VISITOR_CLAIM_COOKIE_MAX_AGE,
  VisitorClaimRateLimitError,
  visitorChoiceSchema,
  visitorTokenHashFromCookie,
} from "@/lib/public-visitor-counter";
import {
  TurnstileVerificationError,
  verifyTurnstileVisitorChoice,
} from "@/lib/turnstile";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const claimSchema = z.object({
  choice: visitorChoiceSchema,
  locale: z.enum(["en", "ar", "ms"]),
  turnstileToken: z.string().min(1).max(2_048)
    .refine((value) => !/[\u0000-\u001F\u007F]/.test(value)),
  clientSignal: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).strict();

const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, X-Axora-Visitor-Signal",
};

function remoteIp(request: NextRequest) {
  return normalizedPublicNetworkIdentifier(
    request.headers.get("cf-connecting-ip"),
  );
}

function expectedOrigin() {
  try {
    return new URL(
      process.env.APP_BASE_URL ?? "https://axora.management",
    ).origin;
  } catch {
    return "https://axora.management";
  }
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    return new URL(origin).origin === expectedOrigin();
  } catch {
    return false;
  }
}

function secureCookie() {
  return process.env.NODE_ENV === "production";
}

function setVisitorCookie(response: NextResponse, value: string) {
  response.cookies.set({
    name: VISITOR_CLAIM_COOKIE,
    value,
    httpOnly: true,
    secure: secureCookie(),
    sameSite: "lax",
    path: "/",
    maxAge: VISITOR_CLAIM_COOKIE_MAX_AGE,
    priority: "high",
  });
}

function setFallbackCookie(
  response: NextResponse,
  networkHash: string,
) {
  response.cookies.set({
    name: VISITOR_FALLBACK_COOKIE,
    value: createVisitorFallbackCookie(networkHash),
    httpOnly: true,
    secure: secureCookie(),
    sameSite: "lax",
    path: "/",
    maxAge: VISITOR_FALLBACK_COOKIE_MAX_AGE,
    priority: "high",
  });
}

function clearFallbackCookie(response: NextResponse) {
  response.cookies.set({
    name: VISITOR_FALLBACK_COOKIE,
    value: "",
    httpOnly: true,
    secure: secureCookie(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    priority: "high",
  });
}

function unavailableResponse() {
  return NextResponse.json(
    { error: "Visitor claiming is temporarily unavailable." },
    { status: 503, headers: noStoreHeaders },
  );
}

export async function GET(request: NextRequest) {
  if (isDemoMode()) {
    return NextResponse.json(
      {
        totalCount: 0,
        earlyBirdCount: 0,
        nightOwlCount: 0,
      },
      { headers: noStoreHeaders },
    );
  }

  try {
    const clientSignal = request.headers.get(
      "x-axora-visitor-signal",
    ) ?? undefined;
    const cookieValue = request.cookies.get(VISITOR_CLAIM_COOKIE)?.value;
    const identity = buildVisitorIdentity({
      cookieValue,
      remoteIp: remoteIp(request),
      clientSignal,
    });
    const snapshot = await getPublicVisitorSnapshot(identity);
    const response = NextResponse.json(snapshot, {
      headers: noStoreHeaders,
    });
    if (cookieValue && visitorTokenHashFromCookie(cookieValue)) {
      setVisitorCookie(response, cookieValue);
    }
    if (!snapshot.choice && identity.networkHash) {
      setFallbackCookie(response, identity.networkHash);
    } else {
      clearFallbackCookie(response);
    }
    return response;
  } catch {
    return unavailableResponse();
  }
}

export async function POST(request: NextRequest) {
  if (isDemoMode()) return unavailableResponse();
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "The visitor claim request was rejected." },
      { status: 403, headers: noStoreHeaders },
    );
  }
  if (!request.headers.get("content-type")
    ?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json(
      { error: "The visitor claim request is invalid." },
      { status: 415, headers: noStoreHeaders },
    );
  }

  try {
    const parsed = claimSchema.parse(await request.json());
    const sourceIp = remoteIp(request);
    const existingCookie = request.cookies.get(VISITOR_CLAIM_COOKIE)?.value;
    const existingTokenHash = visitorTokenHashFromCookie(existingCookie);
    const usableCookie = existingCookie && existingTokenHash
      ? {
        value: existingCookie,
        tokenHash: existingTokenHash,
      }
      : createVisitorClaimCookie();

    const preVerificationIdentity = buildVisitorIdentity({
      cookieValue: usableCookie.value,
      remoteIp: sourceIp,
      clientSignal: parsed.clientSignal,
    });
    await consumeVisitorClaimRateLimit(preVerificationIdentity);

    let snapshot;
    try {
      const verified = await verifyTurnstileVisitorChoice({
        token: parsed.turnstileToken,
        remoteIp: sourceIp,
      });
      const challengeAt = new Date(verified.challengeTimestamp);
      if (!Number.isFinite(challengeAt.getTime())) {
        throw new TurnstileVerificationError();
      }

      const identity = buildVisitorIdentity({
        cookieValue: usableCookie.value,
        remoteIp: sourceIp,
        clientSignal: parsed.clientSignal,
        ephemeralId: verified.ephemeralId,
      });
      const tokenHash = identity.tokenHash ?? usableCookie.tokenHash;
      snapshot = await claimPublicVisitor({
        identity: {
          ...identity,
          tokenHash,
        },
        choice: parsed.choice,
        locale: parsed.locale,
        turnstileChallengeAt: challengeAt,
        turnstileHostname: verified.hostname,
      });
    } catch (error) {
      if (!(error instanceof TurnstileVerificationError)) throw error;

      const fallbackCookie = request.cookies.get(
        VISITOR_FALLBACK_COOKIE,
      )?.value;
      const tokenHash = preVerificationIdentity.tokenHash
        ?? usableCookie.tokenHash;
      const networkHash = preVerificationIdentity.networkHash;
      const networkDeviceHash = preVerificationIdentity.networkDeviceHash;
      const clientSignalHash = preVerificationIdentity.clientSignalHash;
      if (!networkHash || !networkDeviceHash || !clientSignalHash
        || !verifyVisitorFallbackCookie(
          fallbackCookie,
          networkHash,
        )) {
        throw error;
      }

      snapshot = await claimPublicVisitorFallback({
        identity: {
          ...preVerificationIdentity,
          tokenHash,
          networkHash,
          networkDeviceHash,
          clientSignalHash,
        },
        choice: parsed.choice,
        locale: parsed.locale,
      });
    }

    const response = NextResponse.json(snapshot, {
      headers: noStoreHeaders,
    });
    setVisitorCookie(response, usableCookie.value);
    clearFallbackCookie(response);
    return response;
  } catch (error) {
    if (error instanceof VisitorClaimRateLimitError) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: noStoreHeaders },
      );
    }
    if (error instanceof TurnstileVerificationError) {
      return NextResponse.json(
        { error: "Verification failed. Please try again." },
        { status: 403, headers: noStoreHeaders },
      );
    }
    if (error instanceof z.ZodError
      || error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "The visitor claim request is invalid." },
        { status: 400, headers: noStoreHeaders },
      );
    }
    return unavailableResponse();
  }
}
