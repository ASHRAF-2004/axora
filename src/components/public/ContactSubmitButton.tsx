"use client";

import { LoaderCircle, Send } from "lucide-react";
import { useFormStatus } from "react-dom";

export function ContactSubmitButton({ submit, sending, unavailable = false }: { submit: string; sending: string; unavailable?: boolean }) {
  const { pending } = useFormStatus();
  return <button className="button button-primary" type="submit" disabled={pending || unavailable} aria-busy={pending}>{pending ? <><LoaderCircle aria-hidden="true" className="ux-spin" size={17} />{sending}</> : <><Send aria-hidden="true" size={17} />{submit}</>}</button>;
}
