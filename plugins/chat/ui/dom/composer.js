// The composers: one per conversation and thread, kept across redraws so the person's typing, the
// caret and an IME composition survive the index changing under them. Enter sends (Shift+Enter is
// a new line; with `enter-sends` off, Mod+Enter sends), never while an IME is composing (Korean,
// Japanese, Chinese input); ArrowUp in an empty composer edits the person's last message; Escape
// cancels an edit.
import { h } from "./h.js";

/**
 * @typedef {import("../present.js").ComposerModel} ComposerModel
 * @typedef {{
 *   type(target: string, text: string): void, send(target: string): void,
 *   editLast(target: string): void, cancelEdit(): boolean, leave(target: string): void,
 * }} Actions
 * @typedef {{ form: HTMLFormElement, box: HTMLTextAreaElement, banner: HTMLElement,
 *   send: HTMLButtonElement, hint: HTMLElement, rev: number }} Held
 */

const MAX_HEIGHT_LINES = 10;

/** @param {Document} doc @param {Actions} actions */
export function createComposers(doc, actions) {
  /** @type {Map<string, Held>} */
  const held = new Map();
  /** @type {Map<string, boolean>} */
  const sends = new Map();

  const grow = (/** @type {HTMLTextAreaElement} */ box) => {
    box.style.height = "auto";
    const line = Number.parseFloat(doc.defaultView?.getComputedStyle(box).lineHeight ?? "") || 20;
    box.style.height = `${Math.min(box.scrollHeight, line * MAX_HEIGHT_LINES)}px`;
  };

  const make = (/** @type {string} */ target) => {
    const box = h(doc, "textarea", {
      rows: 1,
      "aria-label": "Message",
      spellcheck: "true",
      "data-target": target,
    });
    const banner = h(
      doc,
      "div",
      { class: "editing-banner", hidden: true },
      h(doc, "span", { text: "Editing your message" }),
      h(doc, "button", { type: "button", "data-cancel": "", text: "Cancel (Escape)" }),
    );
    const hint = h(doc, "span", { class: "hint" });
    const send = h(doc, "button", { type: "submit", class: "send", text: "Send" });
    const form = h(
      doc,
      "form",
      { class: "composer", "data-target": target },
      banner,
      box,
      h(doc, "div", { class: "composer-tools" }, hint, send),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      actions.send(target);
    });
    banner.querySelector("[data-cancel]")?.addEventListener("click", () => actions.cancelEdit());
    box.addEventListener("input", () => {
      actions.type(target, box.value);
      grow(box);
    });
    box.addEventListener("keydown", (event) => {
      // An IME still composing owns Enter (keyCode 229 in WebKit).
      if (event.isComposing || event.keyCode === 229) return;
      const mod = event.metaKey || event.ctrlKey;
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.altKey &&
        (mod || sends.get(target) !== false)
      ) {
        event.preventDefault();
        actions.send(target);
      } else if (event.key === "ArrowUp" && box.value === "" && !mod && !event.shiftKey) {
        event.preventDefault();
        actions.editLast(target);
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (!actions.cancelEdit()) actions.leave(target);
      }
    });
    const entry = { form, box, banner, send, hint, rev: -1 };
    held.set(target, entry);
    return entry;
  };

  return {
    /** The composer of a model's target, brought up to date. @param {ComposerModel} model */
    get(model) {
      const entry = held.get(model.target) ?? make(model.target);
      sends.set(model.target, model.enterSends);
      if (entry.rev !== model.rev) {
        entry.box.value = model.text;
        entry.rev = model.rev;
        grow(entry.box);
        if (model.editing) entry.box.focus({ preventScroll: true });
      }
      entry.box.placeholder = model.disabled || model.placeholder;
      entry.box.disabled = model.disabled !== "";
      entry.send.disabled = model.disabled !== "";
      entry.send.title = model.disabled || (model.editing ? "Save the edit" : "Send");
      entry.send.textContent = model.editing ? "Save" : "Send";
      entry.banner.hidden = !model.editing;
      entry.form.classList.toggle("is-editing", model.editing);
      entry.hint.textContent = model.enterSends
        ? "Enter to send · Shift+Enter for a new line"
        : "Mod+Enter to send";
      return entry.form;
    },
    /** Put the caret in a composer. */
    focus(/** @type {string} */ target) {
      const entry = held.get(target);
      if (!entry) return false;
      entry.box.focus();
      const end = entry.box.value.length;
      entry.box.setSelectionRange(end, end);
      return true;
    },
    /** Forget the composers no pane shows any more (their drafts stay in the store). */
    keep(/** @type {Set<string>} */ targets) {
      for (const target of [...held.keys()]) if (!targets.has(target)) held.delete(target);
    },
  };
}
