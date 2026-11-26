// The DOM for the permissions plugin, a page that covers the desk as an overlay: the prompt dialog and
// the approval card (ADR 0078) in front, and the list of grants and refusals when the person opens
// it. Native buttons, headings, alert dialogs and a status live region carry the keyboard and screen
// reader behaviour; the words come from the model. A card's keys answer nothing for a moment after it
// shows (arming.js), and it says `data-armed` once they do.

import { ARM_MS, createArming } from "./arming.js";

/**
 * @typedef {import("./model.js").GrantList} GrantList
 * @typedef {import("./model.js").GrantGroup} GrantGroup
 * @typedef {import("./model.js").GrantItem} GrantItem
 * @typedef {import("./model.js").PromptModel} PromptModel
 * @typedef {import("./approval.js").CardModel} CardModel
 * @typedef {import("./refusals.js").RefusalItem} RefusalItem
 * @typedef {import("./controller.js").Choice} Choice
 * @typedef {{ revoke(grantId: string): unknown, allow(key: string): unknown,
 *   answer(choice: Choice): unknown, key(key: string): boolean, close(): unknown,
 *   dismiss(): unknown }} Actions
 */

/**
 * @param {Document} doc
 * @param {Actions} actions
 * @param {{ now?(): number, setTimer?(fn: () => void, ms: number): unknown }} [options]
 */
export function createView(doc, actions, options = {}) {
  const arming = createArming(options.now ? { now: options.now } : {});
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  /** A new card: its keys wait, and it is marked armed once they answer. */
  const arm = (/** @type {HTMLElement} */ box) => {
    arming.start();
    box.removeAttribute("data-armed");
    setTimer(() => {
      if (arming.armed()) box.setAttribute("data-armed", "");
    }, ARM_MS);
  };
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const list = byId("grants");
  const listTitle = byId("grants-title");
  const summary = byId("grants-summary");
  const groups = byId("grants-groups");
  const agents = byId("agents");
  const agentGroups = byId("agents-groups");
  const refused = byId("refused");
  const refusedList = byId("refused-list");
  const dialog = byId("prompt");
  const status = byId("status");
  const choice = (/** @type {string} */ answer) =>
    /** @type {HTMLButtonElement} */ (dialog.querySelector(`[data-answer=${answer}]`));
  const refuse = choice("refuse");
  const parent = choice("parent");
  const always = choice("always");
  const session = choice("session");
  const once = choice("once");
  const card = byId("approval");
  const pick = (/** @type {string} */ selector) =>
    /** @type {HTMLElement} */ (card.querySelector(selector));

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

  /** The prompt and the card on screen, where focus was before the first one, whether the list is. */
  let shown = /** @type {string | null} */ (null);
  let shownCard = /** @type {string | null} */ (null);
  let returnTo = /** @type {Element | null} */ (null);
  let listOpen = false;

  for (const box of [dialog, card]) {
    box.addEventListener("click", (event) => {
      const button = /** @type {HTMLElement} */ (event.target).closest("button[data-answer]");
      if (!(button instanceof HTMLElement)) return;
      if (arming.ignores(event.detail)) return event.preventDefault();
      actions.answer(/** @type {Choice} */ (button.dataset.answer));
    });
  }

  byId("grants-close").addEventListener("click", () => actions.close());
  // A press beside the list closes it; beside a card nothing happens: the card waits for an answer.
  byId("scrim").addEventListener("click", () => actions.dismiss());

  const swallow = (/** @type {KeyboardEvent} */ event) => {
    const asking = !dialog.hidden || !card.hidden;
    if (!asking || !arming.swallows(/** @type {"keydown" | "keyup"} */ (event.type), event.key))
      return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  };
  doc.addEventListener("keyup", swallow, true);
  doc.addEventListener("keydown", (event) => {
    if (swallow(event)) return;
    const open = !dialog.hidden ? dialog : !card.hidden ? card : !list.hidden ? list : null;
    if (actions.key(event.key)) event.preventDefault();
    else if (event.key === "Tab" && open) keepFocusIn(event, open);
  });

  /** Tab and Shift+Tab cycle through the open panel's buttons (and a preview) while it is open. */
  const keepFocusIn = (/** @type {KeyboardEvent} */ event, /** @type {HTMLElement} */ box) => {
    const buttons = [...box.querySelectorAll("button, pre[tabindex]")].filter(
      (el) => !(/** @type {HTMLElement} */ (el).closest("[hidden]")),
    );
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const active = doc.activeElement;
    if (!first || !last) return;
    if (!box.contains(active) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault();
      /** @type {HTMLElement} */ (event.shiftKey ? last : first).focus();
    }
  };

  /** The list goes behind a dialog that opens, and comes back with focus when none is open. */
  const cover = () => {
    if (shown === null && shownCard === null) returnTo = doc.activeElement;
    list.hidden = true;
    list.inert = true;
  };
  const uncover = () => {
    if (shown !== null || shownCard !== null) return;
    list.hidden = !listOpen;
    list.inert = !listOpen;
    const back = returnTo instanceof HTMLElement && returnTo.isConnected ? returnTo : listTitle;
    returnTo = null;
    if (listOpen) back.focus();
  };

  /** A preview's lines, each marked added, removed or the like. */
  const previewLines = (/** @type {import("./approval.js").Preview} */ preview) =>
    preview.lines.flatMap((line, i) => [
      ...(i > 0 ? ["\n"] : []),
      el("span", { className: `line ${line.change}` }, line.text),
    ]);

  const row = (/** @type {GrantItem} */ item) => {
    const what = el(
      "p",
      { className: "what" },
      el("span", { className: "permission" }, item.permission),
    );
    if (item.scope) what.append(" ", el("code", { className: "scope" }, item.scope));
    const revoke = el("button", {
      type: "button",
      className: "desk-btn desk-btn-quiet revoke",
      textContent: "Revoke",
    });
    revoke.setAttribute("aria-label", item.revokeLabel);
    revoke.addEventListener("click", () => actions.revoke(item.grantId));
    const li = el("li", { className: "grant" }, what);
    li.append(el("p", { className: "duration" }, `Duration: ${item.duration}`));
    if (item.warning) li.append(warning(item.warning));
    li.append(revoke);
    return li;
  };

  /** A caller's grants under its heading: h2 for plugins and the desk, h3 under Agents. */
  const group = (/** @type {GrantGroup} */ entry, /** @type {number} */ index, level = "h2") => {
    const id = `caller-${level}-${index}`;
    const heading = el(
      level,
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

  /** A refusal of this session, with the button that takes it back. */
  const refusal = (/** @type {RefusalItem} */ item) => {
    const what = el(
      "p",
      { className: "what" },
      el("span", { className: "permission" }, item.permission),
    );
    if (item.scope) what.append(" ", el("code", { className: "scope" }, item.scope));
    const allow = el("button", {
      type: "button",
      className: "desk-btn desk-btn-quiet allow",
      textContent: "Allow",
    });
    allow.setAttribute("aria-label", item.allowLabel);
    allow.addEventListener("click", () => actions.allow(item.key));
    const who = el("p", { className: "who" }, item.caller.name, " ");
    who.append(el("span", { className: "kind" }, `${item.caller.kind} · ${item.caller.id}`));
    return el(
      "li",
      { className: "refusal" },
      who,
      what,
      el("p", { className: "duration" }, `Asked for: ${item.duration}`),
      allow,
    );
  };

  return {
    /** @param {boolean} open */
    sheet(open) {
      listOpen = open;
      if (shown !== null || shownCard !== null) return;
      list.hidden = !open;
      list.inert = !open;
      if (open) listTitle.focus();
    },

    /** @param {RefusalItem[]} items */
    refusals(items) {
      const before = [...refusedList.querySelectorAll("button")].indexOf(
        /** @type {HTMLButtonElement} */ (doc.activeElement),
      );
      refusedList.replaceChildren(...items.map(refusal));
      refused.hidden = items.length === 0;
      if (before < 0) return;
      const after = [...refusedList.querySelectorAll("button")];
      (after[Math.min(before, after.length - 1)] ?? listTitle).focus();
    },

    /** @param {GrantList} model */
    grants(model) {
      // A revoked row takes its button with it: keep focus at the same place in the list.
      const buttons = () => [...list.querySelectorAll(".caller button")];
      const before = buttons().indexOf(/** @type {HTMLButtonElement} */ (doc.activeElement));
      summary.textContent = model.summary;
      groups.replaceChildren(...model.groups.map((entry, i) => group(entry, i)));
      agentGroups.replaceChildren(...model.agents.map((entry, i) => group(entry, i, "h3")));
      agents.hidden = model.agents.length === 0;
      if (before < 0) return;
      const after = buttons();
      (after[Math.min(before, after.length - 1)] ?? listTitle).focus();
    },

    /** @param {PromptModel | null} model */
    prompt(model) {
      if (!model) {
        if (shown === null) return;
        shown = null;
        dialog.hidden = true;
        uncover();
        return;
      }
      cover();
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
      const effects = byId("prompt-effects");
      const agent = model.caller.kind === "Agent";
      const files = agent && model.permissionKind === "fs:write";
      const facts = agent && model.permissionKind === "memory:write";
      effects.hidden = !files && !facts;
      if (files) {
        effects.textContent =
          "Allow once permits one reversible write. Allow this session permits reversible writes in this scope until the session ends. Always allow lasts until you revoke it. Non-reversible writes still ask.";
      } else if (facts) {
        effects.textContent =
          "Allow once permits one fact to be saved. Allow this session permits saving facts until the session ends. Always allow lasts until you revoke it.";
      }
      byId("prompt-revoke").hidden = !model.preferPersistent;
      if (always.classList.contains("desk-btn-primary") !== model.preferPersistent) {
        const focused = doc.activeElement;
        always.classList.toggle("desk-btn-primary", model.preferPersistent);
        if (model.preferPersistent) once.before(always, session);
        else always.before(once, session);
        if (shown === model.promptId && focused instanceof HTMLButtonElement) focused.focus();
      }
      // The parent folder, when the core offers it, is a second way to allow.
      parent.hidden = !model.parent;
      parent.textContent = model.parent?.label ?? "";
      const more =
        model.waiting === 1 ? "1 more request waiting" : `${model.waiting} more requests waiting`;
      byId("prompt-waiting").textContent = model.waiting > 0 ? more : "";
      dialog.hidden = false;
      // The least destructive action takes focus, so a stray Enter never grants anything.
      if (model.promptId !== shown) {
        refuse.focus();
        arm(dialog);
      }
      shown = model.promptId;
    },

    /** @param {CardModel | null} model */
    approval(model) {
      if (!model) {
        if (shownCard === null) return;
        shownCard = null;
        card.hidden = true;
        uncover();
        return;
      }
      cover();
      pick("#approval-title").textContent = model.title;
      pick("#approval-who").textContent = `${model.caller.kind} · ${model.caller.id}`;
      const what = pick("#approval-what");
      what.replaceChildren(`${model.action}: `, el("code", {}, model.target));
      const { preview, size, task } = model;
      const pre = pick("#approval-preview");
      pre.hidden = !preview;
      pre.replaceChildren(...(preview ? previewLines(preview) : []));
      pick("#approval-more").hidden = !preview?.truncated;
      pick("#approval-size").textContent = size ? `Size: ${size}` : "";
      pick("#approval-task").textContent = task ?? "";
      pick("[data-answer=task]").hidden = !task;
      const more =
        model.waiting === 1 ? "1 more request waiting" : `${model.waiting} more requests waiting`;
      pick("#approval-waiting").textContent = model.waiting > 0 ? more : "";
      card.hidden = false;
      // Deny takes focus on a new card, so a stray Enter never allows anything.
      const key = `${model.kind}:${model.approvalId}`;
      if (key !== shownCard) {
        pick("[data-answer=deny]").focus();
        arm(card);
      }
      shownCard = key;
    },

    /** @param {string} text */
    status(text) {
      status.textContent = text;
    },
  };
}
