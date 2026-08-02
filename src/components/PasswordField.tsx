"use client";

import {
  MAX_PASSWORD_CODE_POINTS,
  MIN_PASSWORD_CODE_POINTS,
  passwordCodePointLength,
} from "@/lib/password-policy-shared";
import { Eye, EyeOff } from "lucide-react";
import { useState, type ChangeEvent } from "react";

interface PasswordFieldProps {
  id: string;
  name: string;
  label: string;
  showLabel: string;
  hideLabel: string;
  autoComplete: "current-password" | "new-password";
  describedBy?: string;
  disabled?: boolean;
  enforceNewPasswordPolicy?: boolean;
  tooShortMessage?: string;
  tooLongMessage?: string;
}

/**
 * Password field with an explicit, accessible visibility control. It never
 * intercepts paste or truncates input; the server remains the policy boundary.
 */
export function PasswordField({
  id,
  name,
  label,
  showLabel,
  hideLabel,
  autoComplete,
  describedBy,
  disabled = false,
  enforceNewPasswordPolicy = false,
  tooShortMessage,
  tooLongMessage,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const [invalid, setInvalid] = useState(false);

  function validateCodePointLength(event: ChangeEvent<HTMLInputElement>) {
    if (!enforceNewPasswordPolicy) return;
    const count = passwordCodePointLength(event.currentTarget.value);
    const message = count > 0 && count < MIN_PASSWORD_CODE_POINTS
      ? (tooShortMessage ?? `Use at least ${MIN_PASSWORD_CODE_POINTS} characters.`)
      : count > MAX_PASSWORD_CODE_POINTS
        ? (tooLongMessage ?? `Use at most ${MAX_PASSWORD_CODE_POINTS} characters.`)
        : "";
    event.currentTarget.setCustomValidity(message);
    setInvalid(Boolean(message));
  }

  return (
    <div className="field-control">
      <label htmlFor={id}>{label}</label>
      <span className="password-input-wrap">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required
          disabled={disabled}
          onChange={validateCodePointLength}
        />
        <button
          type="button"
          className="password-visibility"
          aria-label={visible ? hideLabel : showLabel}
          aria-pressed={visible}
          aria-controls={id}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
    </div>
  );
}
