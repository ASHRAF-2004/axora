import { getAccountLifecycleSession } from "@/lib/auth";
import { isDemoMode } from "@/lib/db";
import {
  buildVisitorIdentity,
  buildVisitorRateLimitScope,
  claimPublicVisitor,
  consumeVisitorClaimRateLimit,
  createVisitorClaimCookie,
  getPublicVisitorSnapshot,
  normalizedPublicNetworkIdentifier,
  readVisitorClaimCookie,
  VISITOR_CLAIM_COOKIE,
  VISITOR_CLAIM_COOKIE_MAX_AGE,
  VisitorClaimRateLimitError,
  visitorChoiceSchema,
} from "@/lib/public-visitor-counter";
import { TurnstileVerificationError, verifyTurnstileVisitorChoice } from "@/lib/turnstile";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const claimSchema = z.object({
  choice: visitorChoiceSchema,
  locale: z.enum(["en", "ar", "ms"]),
  turnstileToken: z.string().min(1).max(2_048).refine((value) => !/[\u0000-\u001F\u007F]/.test(value)),
}).strict();
const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

function remoteIp(request: NextRequest) {
  return normalizedPublicNetworkIdentifier(
    request.headers.get("cf-connecting-ip")
      ?? request.headers.get("x-forwarded-for")?.split(",")[0],
  );
}
function expectedOrigin() {
  try { return new URL(process.env.APP_BASE_URL ?? "https://axora.management").origin; }
  catch { return "https://axora.management"; }
}
function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try { return new URL(origin).origin === expectedOrigin(); } catch { return false; }
}
function setCookie(response: NextResponse, value: string) {
  response.cookies.set({
    name: VISITOR_CLAIM_COOKIE,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: VISITOR_CLAIM_COOKIE_MAX_AGE,
    priority: "high",
  });
}
function unavailable() {
  return NextResponse.json(
    { error: "Visitor claiming is temporarily unavailable." },
    { status: 503, headers: noStoreHeaders },
  );
}
function privacyIneligible(request: NextRequest) {
  return request.headers.get("sec-gpc") === "1" || request.headers.get("dnt") === "1";
}
async function eligible(request: NextRequest) {
  if (privacyIneligible(request)) return false;
  return !(await getAccountLifecycleSession());
}

export async function GET(request: NextRequest) {
  if (!await eligible(request)) {
    return NextResponse.json({ eligible: false }, { headers: noStoreHeaders });
  }
  if (isDemoMode()) {
    return NextResponse.json({
      eligible: true,
      version: 0,
      totalCount: 0,
      earlyBirdCount: 0,
      nightOwlCount: 0,
    }, { headers: noStoreHeaders });
  }
  try {
    const verifiedCookie = readVisitorClaimCookie(
      request.cookies.get(VISITOR_CLAIM_COOKIE)?.value,
    );
    const snapshot = await getPublicVisitorSnapshot(buildVisitorIdentity({
      cookieValue: verifiedCookie?.value,
    }));
    const response = NextResponse.json(
      { ...snapshot, eligible: true },
      { headers: noStoreHeaders },
    );
    if (verifiedCookie?.needsRotation) setCookie(response, verifiedCookie.value);
    return response;
  } catch (error) {
    console.error("public visitor snapshot unavailable", {
      category: error instanceof Error ? error.name : "unknown",
    });
    return unavailable();
  }
}

export async function POST(request: NextRequest) {
  if (!await eligible(request)) {
    return NextResponse.json(
      { error: "This visitor is not eligible to claim a public choice." },
      { status: 403, headers: noStoreHeaders },
    );
  }
  if (isDemoMode()) return unavailable();
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { error: "The visitor claim request was rejected." },
      { status: 403, headers: noStoreHeaders },
    );
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json(
      { error: "The visitor claim request is invalid." },
      { status: 415, headers: noStoreHeaders },
    );
  }
  try {
    const parsed = claimSchema.parse(await request.json());
    const sourceIp = remoteIp(request);
    const existingCookie = readVisitorClaimCookie(
      request.cookies.get(VISITOR_CLAIM_COOKIE)?.value,
    );
    const cookie = existingCookie ?? createVisitorClaimCookie();
    const identity = buildVisitorIdentity({ cookieValue: cookie.value });
    if (!identity.tokenHash || identity.tokenHash !== cookie.tokenHash) {
      throw new Error("The visitor claim cookie is inconsistent.");
    }
    await consumeVisitorClaimRateLimit(buildVisitorRateLimitScope(sourceIp));
    const verified = await verifyTurnstileVisitorChoice({
      token: parsed.turnstileToken,
      remoteIp: sourceIp,
    });
    const challengeAt = new Date(verified.challengeTimestamp);
    if (!Number.isFinite(challengeAt.getTime())) throw new TurnstileVerificationError();
    const snapshot = await claimPublicVisitor({
      identity: { tokenHash: cookie.tokenHash },
      choice: parsed.choice,
      locale: parsed.locale,
      turnstileChallengeAt: challengeAt,
      turnstileHostname: verified.hostname,
    });
    const response = NextResponse.json(snapshot, { headers: noStoreHeaders });
    setCookie(response, cookie.value);
    return response;
  } catch (error) {
    if (error instanceof VisitorClaimRateLimitError) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { ...noStoreHeaders, "Retry-After": "60" } },
      );
    }
    if (error instanceof TurnstileVerificationError) {
      return NextResponse.json(
        { error: "Verification failed. Please try again." },
        { status: 403, headers: noStoreHeaders },
      );
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "The visitor claim request is invalid." },
        { status: 400, headers: noStoreHeaders },
      );
    }
    console.error("public visitor claim unavailable", {
      category: error instanceof Error ? error.name : "unknown",
    });
    return unavailable();
  }
}
