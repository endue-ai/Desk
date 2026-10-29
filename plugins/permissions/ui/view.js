// The DOM for the permissions plugin: the grant list and the prompt dialog. Native buttons, headings,
// an alert dialog and a status live region carry the keyboard and screen reader behaviour; the words
// come from the model.

/**
 * @typedef {import("./model.js").GrantList} GrantList
 * @typedef {import("./model.js").GrantGroup} GrantGroup
 * @typedef {import("./model.js").GrantItem} GrantItem
 * @typedef {import("./model.js").PromptModel} PromptModel
 * @typedef {import("./controller.js").Choice} Choice
 * @typedef {{ revoke(grantId: string): unknown, answer(choice: Choice): unknown,
 *   key(key: string): boolean }} Actions
 */

/**
 * @param {Document} doc
 * @param {Actions} actions
 */
export function createView(doc, actions) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const list = byId("grants");
  const listTitle = byId("grants-title");
  const summary = byId("grants-summary");
  const groups = byId("grants-groups");
  const dialog = byId("prompt");
  const status = byId("status");
  const refuse = /** @type {HTMLButtonElement} */ (dialog.querySelector("[data-answer=refuse]"));

  /**
   * @param {string} tag
   * @param {Record<string, unknown>} [props]
   * @param {Array<Node | string>} children
   */
  const el = (tag, props = {}, ...children) => {
    const node = doc.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
  };
  const warning = (/** @type {string} */ text) =>
    el("p", { className: "warning" }, el("strong", {}, "Broad access."), ` ${text}`);

  /** The prompt on screen, and where focus was before the first one opened. */
  let shown = /** @type {string | null} */ (null);
  let returnTo = /** @type {Element | null} */ (null);

  dialog.addEventListener("click", (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest("button[data-answer]");
    if (!(button instanceof HTMLElement)) return;
    actions.answer(/** @type {Choice} */ (button.dataset.answer));
  });

  doc.addEventListener("keydown", (event) => {
    if (actions.key(event.key)) event.preventDefault();
    else if (event.key === "Tab" && !dialog.hidden) keepFocusIn(event);
  });

  /** Tab and Shift+Tab cycle through the dialog's buttons while it is open. */
  const keepFocusIn = (/** @type {KeyboardEvent} */ event) => {
    const buttons = [...dialog.querySelectorAll("button")];
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const active = doc.activeElement;
    if (!first || !last) return;
    if (!dialog.contains(active) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  };

  const row = (/** @type {GrantItem} */ item) => {
    const what = el(
      "p",
      { className: "what" },
      el("span", { className: "permission" }, item.permission),
    );
    if (item.scope) what.append(" ", el("code", { className: "scope" }, item.scope));
    const revoke = el("button", { type: "button", className: "revoke", textContent: "Revoke" });
    revoke.setAttribute("aria-label", item.revokeLabel);
    revoke.addEventListener("click", () => actions.revoke(item.grantId));
    const li = el("li", { className: "grant" }, what);
    li.append(el("p", { className: "duration" }, `Duration: ${item.duration}`));
    if (item.warning) li.append(warning(item.warning));
    li.append(revoke);
    return li;
  };

  const group = (/** @type {GrantGroup} */ entry, /** @type {number} */ index) => {
    const id = `caller-${index}`;
    const heading = el(
      "h2",
      { id },
      entry.caller.name,
      " ",
      el("span", { className: "kind" }, `${entry.caller.kind} · ${entry.caller.id}`),
    );
    const section = el(
      "section",
      { className: "caller" },
      heading,
      el("ul", {}, ...entry.grants.map(row)),
    );
    section.setAttribute("aria-labelledby", id);
    return section;
  };

  return {
    /** @param {GrantList} model */
    grants(model) {
      // A revoked row takes its button with it: keep focus at the same place in the list.
      const before = [...groups.querySelectorAll("button")].indexOf(
        /** @type {HTMLButtonElement} */ (doc.activeElement),
      );
      summary.textContent = model.summary;
      groups.replaceChildren(...model.groups.map(group));
      if (before < 0) return;
      const after = [...groups.querySelectorAll("button")];
      (after[Math.min(before, after.length - 1)] ?? listTitle).focus();
    },

    /** @param {PromptModel | null} model */
    prompt(model) {
      if (!model) {
        if (shown === null) return;
        shown = null;
        dialog.hidden = true;
        list.hidden = false;
        list.inert = false;
        const back = returnTo instanceof HTMLElement && returnTo.isConnected ? returnTo : listTitle;
        returnTo = null;
        back.focus();
        return;
      }
      if (shown === null) returnTo = doc.activeElement;
      byId("prompt-title").textContent = model.title;
      byId("prompt-who").textContent = `${model.caller.kind} · ${model.caller.id}`;
      const what = byId("prompt-what");
      what.replaceChildren("Wants to: ", el("strong", {}, model.permission));
      if (model.scope) what.append(" ", el("code", { className: "scope" }, model.scope));
      byId("prompt-warning").replaceChildren(...(model.warning ? [warning(model.warning)] : []));
      byId("prompt-why").replaceChildren(
        "Reason: ",
        model.reason ? el("q", {}, model.reason) : "none given",
      );
      byId("prompt-asked").textContent = `Asked for: ${model.duration}`;
      const more =
        model.waiting === 1 ? "1 more request waiting" : `${model.waiting} more requests waiting`;
      byId("prompt-waiting").textContent = model.waiting > 0 ? more : "";
      list.hidden = true;
      list.inert = true;
      dialog.hidden = false;
      // The least destructive action takes focus, so a stray Enter never grants anything.
      if (model.promptId !== shown) refuse.focus();
      shown = model.promptId;
    },

    /** @param {string} text */
    status(text) {
      status.textContent = text;
    },
  };
}
