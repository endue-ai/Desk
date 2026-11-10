/**
 * Forms in plugin frames. A frame is sandboxed without `allow-forms` (ADR 0012), and Chromium then
 * runs no form submission at all: no `submit` event, so a plugin's `submit` handler never hears its
 * own form. The sandbox stays as it is; instead, from the moment the SDK loads, a submit button's
 * click and Enter in a form field fire `submit` themselves when the engine fired none, after the
 * form's own constraint validation, exactly once. The event cannot navigate anywhere: it is not the
 * engine's submission, and the plugin CSP's `form-action 'none'` refuses any that is.
 */

type FormDocument = Pick<Document, "addEventListener" | "removeEventListener">;

/** The submit button a click is on, when it is one. */
function submitterOf(target: EventTarget | null): HTMLButtonElement | HTMLInputElement | null {
  const element = (target as Element | null)?.closest?.("button, input");
  if (!element) return null;
  if (element instanceof HTMLButtonElement) return element.type === "submit" ? element : null;
  if (element instanceof HTMLInputElement)
    return element.type === "submit" || element.type === "image" ? element : null;
  return null;
}

/** The fields Enter submits from (implicit submission): one-line inputs, never a textarea. */
const IMPLICIT = new Set([
  "text",
  "search",
  "url",
  "tel",
  "email",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);

/** Make `doc`'s forms fire `submit` when the engine fires none; returns the function that stops. */
export function shimForms(doc: FormDocument): () => void {
  /** Forms that heard `submit` (the engine's or this shim's) since their last click or Enter began. */
  const fired = new WeakSet<HTMLFormElement>();
  const onSubmit = (event: Event) => {
    if (event.target instanceof HTMLFormElement) fired.add(event.target);
  };
  /** Fire `submit` on `form` unless something did, after its validation. */
  const fill = (form: HTMLFormElement, submitter: HTMLElement | null) => {
    if (fired.has(form) || !form.isConnected) return;
    const skip = form.noValidate || (submitter as HTMLButtonElement | null)?.formNoValidate;
    if (!skip && !form.reportValidity()) return;
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter }));
  };
  /** The form and submit button a click or an Enter would submit, if any. */
  const aimed = (event: Event): [HTMLFormElement, HTMLElement | null] | undefined => {
    if (event.type === "click") {
      const submitter = submitterOf(event.target);
      return submitter?.form && !submitter.disabled ? [submitter.form, submitter] : undefined;
    }
    const key = event as KeyboardEvent;
    if (key.key !== "Enter" || key.isComposing) return undefined;
    const field = key.target;
    if (!(field instanceof HTMLInputElement) || !field.form || !IMPLICIT.has(field.type)) return;
    const submitter = [...field.form.elements].find((el) => submitterOf(el) !== null) ?? null;
    if ((submitter as HTMLButtonElement | null)?.disabled) return undefined;
    return [field.form, submitter as HTMLElement | null];
  };
  // Before any of the plugin's own listeners: this click or Enter starts afresh.
  const begin = (event: Event) => {
    const aim = aimed(event);
    if (aim) fired.delete(aim[0]);
  };
  // After them, and after the engine's own submission had its chance.
  const end = (event: Event) => {
    const aim = aimed(event);
    if (!aim || event.defaultPrevented) return;
    setTimeout(() => fill(...aim), 0);
  };
  // form.requestSubmit() is the engine's submission too: fill in when it fired nothing.
  const proto = (doc as Document).defaultView?.HTMLFormElement?.prototype;
  const original = proto?.requestSubmit;
  if (proto && original) {
    proto.requestSubmit = function (this: HTMLFormElement, submitter?: HTMLElement | null) {
      fired.delete(this);
      original.call(this, submitter);
      fill(this, submitter ?? null);
    };
  }
  doc.addEventListener("submit", onSubmit, true);
  for (const type of ["click", "keydown"]) {
    doc.addEventListener(type, begin, true);
    doc.addEventListener(type, end);
  }
  return () => {
    if (proto && original) proto.requestSubmit = original;
    doc.removeEventListener("submit", onSubmit, true);
    for (const type of ["click", "keydown"]) {
      doc.removeEventListener(type, begin, true);
      doc.removeEventListener(type, end);
    }
  };
}

/** Shim this frame's forms, when the SDK runs in a frame (never in a worker or a top window). */
export function frameForms(): (() => void) | undefined {
  if (typeof document === "undefined" || typeof window === "undefined") return undefined;
  if (!window.parent || window.parent === window) return undefined;
  return shimForms(document);
}
