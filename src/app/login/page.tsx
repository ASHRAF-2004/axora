import { Brand } from "@/components/Brand";
import { getSession } from "@/lib/auth";
import { isDemoMode } from "@/lib/db";
import { Boxes, CheckCircle2, LockKeyhole } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loginAction } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSession()) redirect("/dashboard");
  const { error } = await searchParams;
  const demo = isDemoMode();
  return (
    <main className="login-shell">
      <section className="login-story">
        <div className="login-brand"><Brand /></div>
        <div>
          <span className="pilot-chip"><Boxes size={15} /> Multi-company operations</span>
          <h1>One clear place for every request.</h1>
          <p>Track products, suppliers, deliveries, invoices and payments without rebuilding the spreadsheet every day.</p>
          <ul className="feature-list">
            <li><CheckCircle2 /> Stable IDs and duplicate controls</li>
            <li><CheckCircle2 /> Quantity-correct sales and margin totals</li>
            <li><CheckCircle2 /> Secure, isolated company workspaces</li>
          </ul>
        </div>
        <small>Axora operations · Secure procurement management</small>
      </section>
      <section className="login-panel">
        <form action={loginAction} className="login-card">
          <div className="login-icon"><LockKeyhole size={24} /></div>
          <p className="eyebrow">Welcome back</p>
          <h2>Sign in to Axora</h2>
          <p className="muted">Use your assigned company account.</p>
          {error ? <div className="form-alert">The email or password is incorrect.</div> : null}
          <label>Email<input name="email" type="email" defaultValue={demo ? process.env.DEMO_EMAIL : ""} autoComplete="username" required /></label>
          <label>Password<input name="password" type="password" defaultValue={demo ? process.env.DEMO_PASSWORD : ""} autoComplete="current-password" required /></label>
          <button className="button button-primary button-full" type="submit">Sign in</button>
          {demo ? <p className="demo-note"><strong>Local demo only:</strong> the filled credentials are disabled when the server is deployed.</p> : null}
        </form>
      </section>
    </main>
  );
}
