"use server";

import { authenticate, setSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const user = await authenticate(email, password);
  if (!user) redirect("/login?error=1");
  await setSession(user);
  redirect("/dashboard");
}
