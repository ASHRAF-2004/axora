"use client";

import { loginAction } from "@/app/login/actions";
import { LoaderCircle, LockKeyhole } from "lucide-react";
import { useFormStatus } from "react-dom";

function LoginButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="button button-primary button-full"
      type="submit"
      disabled={pending}
      aria-busy={pending}
      data-feedback-label="Signing in to Axora…"
    >
      {pending ? (
        <>
          <LoaderCircle className="ux-spin" size={18} />
          Connecting to Axora…
        </>
      ) : (
        "Sign in"
      )}
    </button>
  );
}

export function LoginForm({
  error,
  demo,
  demoEmail,
  demoPassword,
}: {
  error: boolean;
  demo: boolean;
  demoEmail?: string;
  demoPassword?: string;
}) {
  return (
    <form
      action={loginAction}
      className="login-card"
      data-feedback-label="Signing in to Axora…"
    >
      <div className="login-icon">
        <LockKeyhole size={24} />
      </div>
      <p className="eyebrow">Welcome back</p>
      <h2>Sign in to Axora</h2>
      <p className="muted">Use your assigned company account.</p>

      {error ? (
        <div className="form-alert">
          The email or password is incorrect.
        </div>
      ) : null}

      <label>
        Email
        <input
          name="email"
          type="email"
          defaultValue={demo ? demoEmail : ""}
          autoComplete="username"
          required
        />
      </label>

      <label>
        Password
        <input
          name="password"
          type="password"
          defaultValue={demo ? demoPassword : ""}
          autoComplete="current-password"
          required
        />
      </label>

      <LoginButton />

      {demo ? (
        <p className="demo-note">
          <strong>Local demo only:</strong> the filled credentials are
          disabled when the server is deployed.
        </p>
      ) : null}
    </form>
  );
}
