// The bar above a universal view: what Eris is making while she drafts, the preview's Apply, Try
// again (with what to change) and Discard, and after Apply or a save the notice with its action
// (Undo, Edit). Controls are the design system's kit classes (ADR 0090). One bar per page.

/**
 * @typedef {{ choice: "apply" } | { choice: "retry", correction?: string } | { choice: "discard" }} Choice
 * @typedef {{ title: string, command: string, args?: unknown }} NoticeAction
 * @typedef {{ text: string, action?: NoticeAction }} Notice
 */

/**
 * @param {Document} doc
 * @param {(action: NoticeAction) => void} run What a notice's action does.
 */
export function createBar(doc, run) {
  /** @param {string} tag @param {Record<string, string>} attrs */
  const el = (tag, attrs) => {
    const node = doc.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
  };
  const bar = doc.createElement("div");
  bar.className = "bar";
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Eris's view");
  bar.hidden = true;
  const text = doc.createElement("span");
  text.className = "bar-text";
  text.setAttribute("role", "status");
  const buttons = doc.createElement("span");
  buttons.className = "bar-buttons";
  const change = /** @type {HTMLInputElement} */ (
    el("input", {
      class: "desk-field bar-change",
      type: "text",
      "aria-label": "What should change",
    })
  );
  change.placeholder = "What should change?";
  change.hidden = true;
  bar.append(text, change, buttons);
  /** @type {((choice: Choice) => void) | undefined} */
  let answer;

  /** @param {string} label @param {string} kind @param {() => void} onClick */
  const button = (label, kind, onClick) => {
    const b = /** @type {HTMLButtonElement} */ (
      el("button", { class: "desk-btn", type: "button" })
    );
    if (kind) b.setAttribute("class", `desk-btn desk-btn-${kind}`);
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  };
  /** @param {string} mode @param {string} said @param {HTMLElement[]} shown */
  const show = (mode, said, shown) => {
    bar.setAttribute("data-mode", mode);
    text.textContent = said;
    change.hidden = true;
    change.value = "";
    buttons.replaceChildren(...shown);
    bar.hidden = false;
  };
  /** @param {Choice} choice */
  const choose = (choice) => {
    const done = answer;
    answer = undefined;
    done?.(choice);
  };
  change.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      const correction = change.value.trim();
      choose(correction ? { choice: "retry", correction } : { choice: "retry" });
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      change.hidden = true;
    }
  });

  return {
    element: bar,
    /** Whether a preview waits for the person. */
    get waiting() {
      return answer !== undefined;
    },
    /** @param {string} note */
    drafting(note) {
      choose({ choice: "discard" });
      show("drafting", note, []);
    },
    /**
     * Show the preview's choices and wait for one.
     * @param {string} note
     * @returns {Promise<Choice>}
     */
    preview(note) {
      choose({ choice: "discard" });
      const apply = button("Apply", "primary", () => {
        apply.disabled = true;
        text.textContent = "Saving…";
        choose({ choice: "apply" });
      });
      const again = button("Try again", "", () => {
        if (change.hidden) {
          change.hidden = false;
          change.focus();
        } else {
          const correction = change.value.trim();
          choose(correction ? { choice: "retry", correction } : { choice: "retry" });
        }
      });
      const discard = button("Discard", "quiet", () => choose({ choice: "discard" }));
      show("preview", note, [apply, again, discard]);
      apply.focus();
      return new Promise((resolve) => {
        answer = resolve;
      });
    },
    /** @param {Notice} notice */
    notice(notice) {
      choose({ choice: "discard" });
      const action = notice.action;
      show("notice", notice.text, action ? [button(action.title, "", () => run(action))] : []);
    },
    /** Hide the bar; a waiting preview is discarded. */
    hide() {
      choose({ choice: "discard" });
      bar.hidden = true;
      bar.removeAttribute("data-mode");
    },
  };
}
