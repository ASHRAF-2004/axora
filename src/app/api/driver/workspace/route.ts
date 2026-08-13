import { getSession } from "@/lib/auth";
import { getDeliveryExecutionWorkspace } from "@/lib/delivery-execution";
import { canAccess } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "view_delivery_portal")) {
    return Response.json({ error: "Delivery workspace unavailable" }, { status: 403 });
  }
  try {
    const workspace = await getDeliveryExecutionWorkspace(actor);
    const { products: _products, suppliers: _suppliers, ...customerSafeWorkspace } = workspace;
    void _products;
    void _suppliers;
    return Response.json(customerSafeWorkspace, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "Delivery workspace unavailable" }, { status: 404 });
  }
}
