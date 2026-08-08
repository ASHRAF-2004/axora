import type { ReactNode } from "react";
import { requirePagePermission } from "@/lib/auth";
import { GeneratedDocumentsPanel } from "@/components/GeneratedDocumentsPanel";

export default async function DocumentsLayout({ children }: { children: ReactNode }) {
  const actor = await requirePagePermission("view_documents");
  return <>{children}<GeneratedDocumentsPanel actor={actor} mode="documents" /></>;
}
