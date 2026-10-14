import type { FormEvent } from "react";

/** Keep React's generated action metadata, but complete through POST/303. */
export function submitNativeServerAction(event: FormEvent<HTMLFormElement>): boolean {
  const form = event.currentTarget;
  if (!form.querySelector('input[name^="$ACTION_ID_"],input[name^="$ACTION_REF_"]')) return false;
  event.preventDefault();
  event.stopPropagation();
  if (!form.reportValidity()) return false;
  form.method = "post";
  form.enctype = "multipart/form-data";
  form.action = window.location.href;
  HTMLFormElement.prototype.submit.call(form);
  return true;
}
