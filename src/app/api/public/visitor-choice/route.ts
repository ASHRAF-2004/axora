import { isDemoMode } from "@/lib/db";
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
  return normalizedPublicNetworkIdentifier(request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]);
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
  response.cookies.set({ name: VISITOR_CLAIM_COOKIE, value, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: VISITOR_CLAIM_COOKIE_MAX_AGE, priority: "high" });
}
function unavailable() { return NextResponse.json({ error: "Visitor claiming is temporarily unavailable." }, { status: 503, headers: noStoreHeaders }); }

export async function GET(request: NextRequest) {
  if (isDemoMode()) return NextResponse.json({ totalCount: 0, earlyBirdCount: 0, nightOwlCount: 0 }, { headers: noStoreHeaders });
  try {
    const cookieValue = request.cookies.get(VISITOR_CLAIM_COOKIE)?.value;
    const snapshot = await getPublicVisitorSnapshot(buildVisitorIdentity({ cookieValue, remoteIp: remoteIp(request) }));
    const response = NextResponse.json(snapshot, { headers: noStoreHeaders });
    if (cookieValue && visitorTokenHashFromCookie(cookieValue)) setCookie(response, cookieValue);
    return response;
  } catch (error) {
    console.error("public visitor snapshot unavailable", { category: error instanceof Error ? error.name : "unknown" });
    return unavailable();
  }
}

export async function POST(request: NextRequest) {
  if (isDemoMode()) return unavailable();
  if (!sameOrigin(request)) return NextResponse.json({ error: "The visitor claim request was rejected." }, { status: 403, headers: noStoreHeaders });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "The visitor claim request is invalid." }, { status: 415, headers: noStoreHeaders });
  try {
    const parsed = claimSchema.parse(await request.json());
    const sourceIp = remoteIp(request);
    const existingCookie = request.cookies.get(VISITOR_CLAIM_COOKIE)?.value;
    const existingTokenHash = visitorTokenHashFromCookie(existingCookie);
    const cookie = existingCookie && existingTokenHash ? { value: existingCookie, tokenHash: existingTokenHash } : createVisitorClaimCookie();
    const preIdentity = buildVisitorIdentity({ cookieValue: cookie.value, remoteIp: sourceIp });
    await consumeVisitorClaimRateLimit(preIdentity);
    const verified = await verifyTurnstileVisitorChoice({ token: parsed.turnstileToken, remoteIp: sourceIp });
    const challengeAt = new Date(verified.challengeTimestamp);
    if (!Number.isFinite(challengeAt.getTime())) throw new TurnstileVerificationError();
    const snapshot = await claimPublicVisitor({
      identity: { ...buildVisitorIdentity({ cookieValue: cookie.value, remoteIp: sourceIp, ephemeralId: verified.ephemeralId }), tokenHash: cookie.tokenHash },
      choice: parsed.choice,
      locale: parsed.locale,
      turnstileChallengeAt: challengeAt,
      turnstileHostname: verified.hostname,
    });
    const response = NextResponse.json(snapshot, { headers: noStoreHeaders });
    setCookie(response, cookie.value);
    return response;
  } catch (error) {
    if (error instanceof VisitorClaimRateLimitError) return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429, headers: noStoreHeaders });
    if (error instanceof TurnstileVerificationError) return NextResponse.json({ error: "Verification failed. Please try again." }, { status: 403, headers: noStoreHeaders });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "The visitor claim request is invalid." }, { status: 400, headers: noStoreHeaders });
    console.error("public visitor claim unavailable", { category: error instanceof Error ? error.name : "unknown" });
    return unavailable();
  }
}
