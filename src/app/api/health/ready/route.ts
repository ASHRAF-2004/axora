import { isDemoMode, query } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (isDemoMode()) return NextResponse.json({ status: "ready", mode: "demo" });
  try {
    await query("SELECT 1");
    return NextResponse.json({ status: "ready" });
  } catch {
    return NextResponse.json({ status: "not_ready" }, { status: 503 });
  }
}
