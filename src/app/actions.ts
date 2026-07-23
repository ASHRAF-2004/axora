"use server";

import { clearSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}
