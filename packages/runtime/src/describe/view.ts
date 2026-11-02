/**
 * The describe surface: a dialog the runtime draws over the desk, so it needs no plugin. The answer's
 * summary heads it and each fact is a `Label: value` row; "Open file" reveals the file behind the
 * answer, "Copy" copies its text, Escape and Close dismiss it and give the focus back.
 */
import type { Description } from "./words";

export interface DescribeActions {
  /** Show the file in the file manager (shell.open); rejects with why it could not. */
  reveal(file: string): Promise<void>;
  /** Put the text on the clipboard; false when the clipboard refused. */
  copy(text: string): Promise<boolean>;
}

export interface DescribeView {
  show(description: Description): void;
  close(): void;
  /** The answer shown now. */
  shown(): Description | undefined;
}

export function describeView(root: HTMLElement, actions: DescribeActions): DescribeView {
  const doc = root.ownerDocument;
  let current: { description: Description; dialog: HTMLElement; back: Element | null } | undefined;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const close = () => {
    if (!current) return;
    const { dialog, back } = current;
    current = undefined;
    dialog.remove();
    if (back instanceof HTMLElement && back.isConnected) back.focus();
  };

  const show = (description: Description) => {
    const back = current?.back ?? doc.activeElement;
    current?.dialog.remove();
    const dialog = el("div", "desk-describe");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "desk-describe-title");
    dialog.dataset.kind = description.kind;
    const panel = el("section", "desk-describe-panel");
    panel.tabIndex = -1;
    const title = el("h2", "desk-describe-title", description.summary);
    title.id = "desk-describe-title";
    const facts = el("dl", "desk-describe-facts");
    for (const fact of description.lines) {
      const row = el("div", "desk-describe-fact");
      // The space keeps "Label: value" whole in the text people select and screen readers read.
      row.append(el("dt", "", `${fact.label}:`), " ", el("dd", "", fact.value));
      facts.append(row);
    }
    const status = el("p", "desk-describe-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    // The status tells how the last action went: an earlier one that ends later says nothing.
    let latest = 0;
    const say = (text: string, outcome: Promise<string>) => {
      const mine = ++latest;
      status.textContent = text;
      void outcome.then((done) => {
        if (mine === latest) status.textContent = done;
      });
    };
    const button = (label: string, run: () => void) => {
      const b = el("button", "desk-describe-button", label);
      b.type = "button";
      b.addEventListener("click", run);
      return b;
    };
    const buttons = el("div", "desk-describe-actions");
    const { file, text } = description;
    if (file) {
      buttons.append(
        button("Open file", () => {
          const shown = actions.reveal(file).then(
            () => `Shown in the file manager: ${file}`,
            (error) => `Could not show ${file}: ${error instanceof Error ? error.message : error}`,
          );
          say(`Showing ${file}…`, shown);
        }),
      );
    }
    buttons.append(
      button("Copy", () => {
        const copied = actions
          .copy(text)
          .then((ok) => (ok ? "Copied" : "The clipboard refused: select the text and copy it."));
        say("", copied);
      }),
      button("Close", close),
    );
    panel.append(title, facts, status, buttons);
    dialog.append(panel);
    dialog.addEventListener("mousedown", (event) => {
      if (event.target === dialog) close();
    });
    dialog.addEventListener("keydown", (event) => {
      // The desk's keymap does not see what the dialog handles, nor the keys typed in it.
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Tab") {
        const controls = [...buttons.querySelectorAll("button")];
        const at = controls.indexOf(doc.activeElement as HTMLButtonElement);
        const next = (at + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
        event.preventDefault();
        controls[at < 0 && event.shiftKey ? controls.length - 1 : next]?.focus();
      }
    });
    root.append(dialog);
    current = { description, dialog, back };
    panel.focus();
  };

  return { show, close, shown: () => current?.description };
}
