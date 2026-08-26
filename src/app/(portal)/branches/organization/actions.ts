"use server";

import { requirePermission } from "@/lib/auth";
import { permanentRedirect } from "next/navigation";

/**
 * Fail closed for stale browser tabs that still hold an action reference from
 * the retired organization hierarchy. Historical rows remain untouched.
 */
export async function saveOrganizationNodeAction() {
  await requirePermission("view_branches");
  permanentRedirect("/branches");
}

export async function setOrganizationNodeActiveAction() {
  await requirePermission("view_branches");
  permanentRedirect("/branches");
}
