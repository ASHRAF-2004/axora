import { isSafeDraftField, type StoredFormDraft } from "@/lib/form-drafts";

type DraftableControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export function draftableControls(form: HTMLFormElement) {
  return Array.from(form.elements).filter((element): element is DraftableControl => {
    if (!(element instanceof HTMLInputElement
      || element instanceof HTMLTextAreaElement
      || element instanceof HTMLSelectElement)) return false;
    const type = element instanceof HTMLInputElement ? element.type : "text";
    return !element.disabled && isSafeDraftField(element.name, type)
      && element.dataset.draftIgnore !== "true";
  });
}

export function collectFormDraft(form: HTMLFormElement) {
  const fields: Record<string, string[]> = {};
  for (const control of draftableControls(form)) {
    if (control instanceof HTMLInputElement
      && (control.type === "checkbox" || control.type === "radio")) {
      if (control.checked) (fields[control.name] ??= []).push(control.value);
    } else if (control instanceof HTMLSelectElement && control.multiple) {
      fields[control.name] = Array.from(control.selectedOptions).map((option) => option.value);
    } else {
      fields[control.name] = [control.value];
    }
  }
  const fileFields = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    .filter((input) => input.files?.length && input.name && !/(password|token|secret|key)/i.test(input.name))
    .map((input) => input.name)
    .slice(0, 20);
  return { fields, fileFields };
}

function setValue(control: DraftableControl, values: string[], notify: boolean) {
  if (control instanceof HTMLInputElement
    && (control.type === "checkbox" || control.type === "radio")) {
    control.checked = values.includes(control.value);
  } else if (control instanceof HTMLSelectElement && control.multiple) {
    for (const option of control.options) option.selected = values.includes(option.value);
  } else {
    control.value = values[0] ?? "";
  }
  if (notify) {
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

export function restoreFormDraft(
  form: HTMLFormElement,
  draft: StoredFormDraft,
  { notify = true }: { notify?: boolean } = {},
) {
  let restored = false;
  for (const control of draftableControls(form)) {
    const values = draft.fields[control.name];
    if (!values) continue;
    setValue(control, values, notify);
    restored = true;
  }
  return restored;
}
