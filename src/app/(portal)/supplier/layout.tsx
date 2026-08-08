import type { ReactNode } from "react";
import { requirePagePermission } from "@/lib/auth";
import { GeneratedDocumentsPanel } from "@/components/GeneratedDocumentsPanel";

export default async function SupplierLayout({ children }: { children: ReactNode }) {
  const actor = await requirePagePermission("view_supplier_portal");
  return <>{children}<GeneratedDocumentsPanel actor={actor} mode="supplier" /></>;
}
