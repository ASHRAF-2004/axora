import { Brand } from "@/components/Brand";
import { LoginForm } from "@/components/LoginForm";
import { getSession } from "@/lib/auth";
import { isDemoMode } from "@/lib/db";
import { Boxes, CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await getSession();
  if (user) redirect(!user.isOwner && user.role === "IT_SUPPORT" ? "/settings" : "/dashboard");
  const { error } = await searchParams;
  const demo = isDemoMode();
  return (
    <main className="login-shell">
      <section className="login-story">
        <div className="login-brand"><Brand /></div>
        <div>
          <span className="pilot-chip"><Boxes size={15} /> Multi-company operations</span>
          <h1>One clear place for every request.</h1>
          <p>Request catalog items, approve branch spending, and follow Axora fulfilment from delivery through customer invoice.</p>
          <ul className="feature-list">
            <li><CheckCircle2 /> Clear requester and approver roles</li>
            <li><CheckCircle2 /> Monthly budgets for every branch</li>
            <li><CheckCircle2 /> Secure, isolated company workspaces</li>
          </ul>
        </div>
        <small>Axora operations · Secure procurement management</small>
      </section>
      <section className="login-panel">
        <LoginForm
          error={Boolean(error)}
          demo={demo}
          demoEmail={process.env.DEMO_EMAIL}
          demoPassword={process.env.DEMO_PASSWORD}
        />
      </section>
    </main>
  );
}
