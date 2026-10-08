/** Safe synthetic controls only; these fixtures never model an auth session. */
export class DraftInput extends EventTarget {
  type = "text";
  disabled = false;
  dataset: Record<string, string> = {};
  checked = false;
  defaultChecked = false;
  files: File[] | null = null;
  constructor(public name: string, public value = "", public defaultValue = "") { super(); }
}

export class DraftTextarea extends EventTarget {
  disabled = false;
  dataset: Record<string, string> = {};
  constructor(public name: string, public value = "", public defaultValue = "") { super(); }
}

export class DraftSelect extends EventTarget {
  disabled = false;
  dataset: Record<string, string> = {};
  multiple = false;
  options: { value: string; selected: boolean }[] = [];
  constructor(public name: string, public value = "", public defaultValue = "") { super(); }
  get selectedOptions() { return this.options.filter((option) => option.selected); }
}

export class DraftForm extends EventTarget {
  dataset: Record<string, string> = {};
  method = "post";
  id = "";
  constructor(public elements: (DraftInput | DraftTextarea | DraftSelect)[]) { super(); }
  querySelectorAll(selector: string) {
    return selector === 'input[type="file"]'
      ? this.elements.filter((control) => control instanceof DraftInput && control.type === "file") : [];
  }
  reset() {
    this.dispatchEvent(new Event("reset"));
    for (const control of this.elements) {
      control.value = control.defaultValue;
      if (control instanceof DraftInput) {
        control.checked = control.defaultChecked;
        if (control.type === "file") control.files = [];
      }
    }
  }
  asHTMLForm() { return this as unknown as HTMLFormElement; }
}
