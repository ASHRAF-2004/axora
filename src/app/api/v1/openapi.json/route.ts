import { externalApiEnabled } from "@/lib/integrations/config";
import { externalRequestId } from "@/lib/integrations/http";
import { buildAxoraOpenApiDocument } from "@/lib/integrations/openapi";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!externalApiEnabled()) return new NextResponse(null,{status:404});
  const requestId = externalRequestId(request);
  return NextResponse.json(buildAxoraOpenApiDocument(),{
    headers:{
      "Axora-Request-Id":requestId,
      "Cache-Control":"public, max-age=300",
      "X-Content-Type-Options":"nosniff",
    },
  });
}
