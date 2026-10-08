import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeEvent, ComponentProps, InputEvent, ReactElement, RefObject, SubmitEvent, SyntheticEvent } from "react";
import type { ProductActionState } from "@/app/(portal)/masters/actions";
import { collectFormDraft, restoreFormDraft } from "@/lib/form-draft-controls";
import { createStoredFormDraft, parseStoredFormDraft } from "@/lib/form-drafts";
import { DraftForm, DraftInput, DraftSelect, DraftTextarea } from "./helpers/form-draft-dom";

const hooks = vi.hoisted(() => ({
  effects: [] as (() => void)[], refs: [] as { current: unknown }[], cursor: 0,
  state: { status: "idle" } as ProductActionState, pending: false, push: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: (effect: () => void) => hooks.effects.push(effect),
  useRef: (initial: unknown) => hooks.refs[hooks.cursor++] ??= { current: initial },
  useActionState: () => [hooks.state, vi.fn(), hooks.pending],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: hooks.push }) }));

import { ProductActionForm } from "@/components/ProductActionForm";

describe("product creation error draft recovery", () => {
  let events: EventTarget;
  let name: DraftInput;
  let markup: DraftInput;
  let form: DraftForm;

  function render(draftId: string | null = "create-product") {
    hooks.cursor = 0;
    hooks.effects.length = 0;
    const view = ProductActionForm({
      action: vi.fn(), children: null, submitLabel: "Create product", draftId: draftId ?? undefined,
    }) as ReactElement<ComponentProps<"form">>;
    (view.props.ref as RefObject<HTMLFormElement | null>).current = form.asHTMLForm();
    return view;
  }

  function submit(view: ReturnType<typeof render>) {
    view.props.onSubmit?.({ currentTarget: form.asHTMLForm() } as SubmitEvent<HTMLFormElement>);
  }

  function reset(view: ReturnType<typeof render>) {
    view.props.onReset?.({ currentTarget: form.asHTMLForm() } as SyntheticEvent<HTMLFormElement>);
    form.reset();
  }

  function commitError() {
    hooks.state = { status: "error", message: "Controlled validation error" };
    hooks.pending = false;
    const view = render();
    reset(view); // React resets uncontrolled controls before passive effects.
    expect(name.value).toBe("");
    hooks.effects.forEach((effect) => effect());
    return view;
  }

  beforeEach(() => {
    hooks.effects.length = 0;
    hooks.refs.length = 0;
    hooks.cursor = 0;
    hooks.state = { status: "idle" };
    hooks.pending = false;
    hooks.push.mockClear();
    events = new EventTarget();
    vi.stubGlobal("window", events);
    vi.stubGlobal("HTMLInputElement", DraftInput);
    vi.stubGlobal("HTMLTextAreaElement", DraftTextarea);
    vi.stubGlobal("HTMLSelectElement", DraftSelect);
    name = new DraftInput("name", "Controlled draft");
    markup = new DraftInput("customerMarkupPercentage", "101", "10");
    form = new DraftForm([name, markup]);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("restores only its submitted form after an error and autosaves once after all values are restored", () => {
    const outcome = vi.fn();
    events.addEventListener("axora:form-action-outcome", outcome);
    const save = vi.fn(() => collectFormDraft(form.asHTMLForm()).fields);
    form.addEventListener("change", save);
    submit(render());
    commitError();
    expect(name.value).toBe("Controlled draft");
    expect(markup.value).toBe("101");
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.results[0].value).toEqual({ name: ["Controlled draft"], customerMarkupPercentage: ["101"] });
    expect((outcome.mock.calls[0][0] as CustomEvent).detail)
      .toEqual({ outcome: "error", formId: "create-product" });
    expect(hooks.push).not.toHaveBeenCalled();
  });

  it("captures the fresh values for successive failures instead of restoring an older submission", () => {
    submit(render());
    commitError();
    name.value = "Second controlled draft";
    markup.value = "102";
    submit(render());
    hooks.pending = true;
    reset(render());
    commitError();
    expect(name.value).toBe("Second controlled draft");
    expect(markup.value).toBe("102");
  });

  it("preserves newer safe edits to this form while its submitted action is pending", () => {
    submit(render());
    hooks.pending = true;
    const pendingView = render();
    name.value = "Controlled edit while pending";
    pendingView.props.onInput?.({ currentTarget: form.asHTMLForm() } as InputEvent<HTMLFormElement>);
    markup.value = "102";
    pendingView.props.onChange?.({ currentTarget: form.asHTMLForm() } as ChangeEvent<HTMLFormElement>);
    commitError();
    expect(name.value).toBe("Controlled edit while pending");
    expect(markup.value).toBe("102");
  });

  it("does not refresh a submitted snapshot outside pending or from a different form", () => {
    const view = render();
    submit(view);
    name.value = "Non-pending input";
    view.props.onInput?.({ currentTarget: form.asHTMLForm() } as InputEvent<HTMLFormElement>);
    hooks.pending = true;
    const other = new DraftForm([new DraftInput("name", "Another form")]);
    render().props.onChange?.({ currentTarget: other.asHTMLForm() } as ChangeEvent<HTMLFormElement>);
    commitError();
    expect(name.value).toBe("Controlled draft");
  });

  it.each(["idle", "handled error"])("does not restore a draft discarded by an explicit reset after %s", (phase) => {
    if (phase === "handled error") {
      submit(render());
      commitError();
      name.value = "Fresh controlled input";
    }
    const view = render();
    submit(view);
    reset(view);
    commitError();
    expect(name.value).toBe("");
    expect(markup.value).toBe("10");
  });

  it("does not retain controls for forms without an explicit opt-in draft identifier", () => {
    const view = render(null);
    expect(view.props.onSubmit).toBeUndefined();
    expect(view.props.onReset).toBeUndefined();
    expect(view.props.onInput).toBeUndefined();
    expect(view.props.onChange).toBeUndefined();
  });

  it("discards the transient snapshot after a local success rather than replaying it into a later error", () => {
    submit(render());
    hooks.state = { status: "success", redirectTo: "/products/30000000-0000-4000-8000-000000000099/edit" };
    render();
    hooks.effects.forEach((effect) => effect());
    expect(hooks.push).toHaveBeenCalledWith(hooks.state.redirectTo);
    commitError();
    expect(name.value).toBe("");
  });

  it("rejects oversized snapshots instead of bypassing the existing bounded draft validation", () => {
    name.value = "x".repeat(20_001);
    submit(render());
    commitError();
    expect(name.value).toBe("");
  });

  it("accepts a pending safe edit back within bounds after rejecting an oversized submitted value", () => {
    name.value = "x".repeat(20_001);
    submit(render());
    hooks.pending = true;
    name.value = "Controlled bounded replacement";
    render().props.onInput?.({ currentTarget: form.asHTMLForm() } as InputEvent<HTMLFormElement>);
    commitError();
    expect(name.value).toBe("Controlled bounded replacement");
  });

  it("never snapshots or restores excluded controls or file contents", () => {
    const excluded = new DraftInput("privateToken", "excluded-control-value");
    const file = new DraftInput("images");
    file.type = "file";
    file.files = [new File(["synthetic image"], "controlled.webp")];
    const disabled = new DraftInput("disabledName", "excluded-control-value");
    disabled.disabled = true;
    const ignored = new DraftInput("ignoredName", "excluded-control-value");
    ignored.dataset.draftIgnore = "true";
    form.elements.push(excluded, file, disabled, ignored);
    const content = collectFormDraft(form.asHTMLForm());
    expect(content.fields).toEqual({ name: ["Controlled draft"], customerMarkupPercentage: ["101"] });
    expect(content.fileFields).toEqual(["images"]);
    submit(render());
    commitError();
    expect(name.value).toBe("Controlled draft");
    expect(excluded.value).toBe("");
    expect(disabled.value).toBe("");
    expect(ignored.value).toBe("");
    expect(file.files).toEqual([]);
  });

  it("keeps the existing safe control handling for checkbox and multiple select restoration", () => {
    const checked = new DraftInput("active", "yes");
    checked.type = "checkbox";
    checked.checked = true;
    const select = new DraftSelect("groups");
    select.multiple = true;
    select.options = [{ value: "one", selected: true }, { value: "two", selected: false }];
    const textarea = new DraftTextarea("description", "Controlled description");
    form.elements.push(checked, select, textarea);
    const draft = parseStoredFormDraft(JSON.stringify(createStoredFormDraft(
      collectFormDraft(form.asHTMLForm()).fields, [], { submitted: true },
    )))!;
    checked.checked = false;
    select.options[0].selected = false;
    textarea.value = "";
    expect(restoreFormDraft(form.asHTMLForm(), draft, { notify: false })).toBe(true);
    expect(checked.checked).toBe(true);
    expect(select.selectedOptions.map((option) => option.value)).toEqual(["one"]);
    expect(textarea.value).toBe("Controlled description");
  });
});
