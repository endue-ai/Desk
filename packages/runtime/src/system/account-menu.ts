/**
 * What the avatar's popover holds (issue 293, design issue 291). At first a menu of two rows, Inbox
 * with its count and Settings with its key, over what the account popover always held: the person,
 * endue ID, the profile and the space. Once Inbox is chosen, the inbox's list stands in the same
 * place. The arrows, Home and End walk the popover's buttons.
 */
import type { ShellCtx } from "../shell/context";
import { type Child, h } from "../shell/dom";
import { icon } from "../shell/icons";
import type { DeskState } from "../shell/state";
import type { AccountKey } from "./account-copy";
import type { EndueId } from "./endue-id";

/** The avatar's popover: its menu, or the inbox's list. */
export type AccountView = "account" | "attention";

export interface AccountMenu {
  ctx: ShellCtx;
  tr(key: AccountKey): string;
  /** Run a command; one that fails says why (gesture.ts). */
  run(command: string): void;
  /** The person's picture, initial or icon. */
  face(): HTMLElement;
  /** The person's name, or "Local user". */
  userName: string;
  endue: EndueId;
  /** Close the menu, give the focus back to the avatar and open Settings. */
  settings(): void;
  /** While anything captures the microphone: what the row says, and stopping every capture. */
  mic?: { label: string; stop(): void };
}

/** Which of the avatar's views `s` shows, if any. */
export const viewOf = (s: DeskState): AccountView | null =>
  s.popover === "account" || s.popover === "attention" ? s.popover : null;

/** A row of the menu: its icon, its words and, at the right, its count or its key. */
const row = (key: string, name: string, glyph: string, label: string, run: () => void, at: Child) =>
  h(
    "button",
    {
      class: "menu-item account-row",
      type: "button",
      role: "menuitem",
      "data-key": key,
      "aria-label": name,
      onClick: run,
    },
    icon(glyph, 16),
    h("span", { class: "pop-text" }, label),
    at,
  );

/** A line of the person's own: what it names, then its value. */
const line = (label: string, value: string | undefined): Child =>
  value ? h("div", { class: "pop-row" }, label, h("span", { class: "pop-muted" }, value)) : null;

/** The menu's two rows and a rule, then the person, endue ID, the profile and the space. */
function menu(view: AccountMenu, s: DeskState): Child[] {
  const { tr } = view;
  const count = s.attention.length;
  const key = view.ctx.keyOf("desk.settings.open");
  return [
    h(
      "div",
      { class: "account-menu", role: "menu", "aria-label": tr("controls") },
      // The microphone, first while it is on: the rail may be hidden or another plugin's (ADR 0245).
      view.mic
        ? row("account-mic", view.mic.label, "mic", view.mic.label, view.mic.stop, null)
        : null,
      // The name says the count at every number; the badge shows only while there is something.
      row(
        "account-inbox",
        `${tr("inbox")} · ${count}`,
        "inbox",
        tr("inbox"),
        () => view.run("desk.inbox.open"),
        count ? h("span", { class: "badge" }, count) : null,
      ),
      row(
        "account-settings",
        tr("settings"),
        "settings",
        tr("settings"),
        view.settings,
        key ? h("span", { class: "pop-muted" }, key) : null,
      ),
    ),
    h("div", { class: "pop-divider", role: "separator" }),
    h(
      "div",
      { class: "account-identity" },
      view.face(),
      h("div", {}, h("strong", {}, view.userName), h("small", {}, view.endue.where())),
    ),
    ...view.endue.rows(),
    line(tr("profile"), s.modes.find((mode) => mode.manifest.id === s.modeId)?.manifest.name),
    line(tr("space"), s.spaces.find((entry) => entry.id === s.spaceId)?.name),
  ];
}

/** The inbox's list: each thing that needs the person, with its button when it has one. */
function inbox(view: AccountMenu, s: DeskState): Child[] {
  return [
    h("div", { class: "pop-title" }, view.tr("inbox")),
    s.attention.length
      ? s.attention.map((item) =>
          h(
            "div",
            { class: "inbox-item" },
            h(
              "div",
              { class: "pop-row" },
              h("span", { class: "dot dot-attention" }),
              h("span", {}, item.text),
            ),
            item.action
              ? h(
                  "button",
                  {
                    class: "btn btn-outline pop-action",
                    type: "button",
                    "data-key": `attention-${item.id}`,
                    onClick: () => item.action && view.run(item.action.command),
                  },
                  item.action.label,
                )
              : null,
          ),
        )
      : h("p", { class: "account-empty" }, view.ctx.tr("empty")),
  ];
}

/** The avatar's popover showing `which`: a dialog that can hold the focus itself. */
export function accountPopover(view: AccountMenu, s: DeskState, which: AccountView): HTMLElement {
  return h(
    "section",
    {
      class: "popover account-popover",
      role: "dialog",
      "aria-label": view.tr(which === "attention" ? "inbox" : "account"),
      "data-popover": which,
      tabindex: "-1",
    },
    which === "attention" ? inbox(view, s) : menu(view, s),
  );
}

/**
 * Move the focus through `popover`'s buttons for `key`: the arrows step and wrap, Home and End go to
 * the first and the last. In document order: the menu's rows, then endue ID's buttons. Answers
 * whether the key was one of these.
 */
export function walkButtons(popover: HTMLElement, key: string): boolean {
  const buttons = [...popover.querySelectorAll<HTMLElement>("button:not(:disabled)")];
  if (buttons.length === 0) return false;
  const last = buttons.length - 1;
  // -1 while the popover itself has the focus: down goes to the first, up to the last.
  const at = buttons.indexOf(popover.ownerDocument.activeElement as HTMLElement);
  const to =
    key === "ArrowDown"
      ? (at + 1) % buttons.length
      : key === "ArrowUp"
        ? at <= 0
          ? last
          : at - 1
        : key === "Home"
          ? 0
          : key === "End"
            ? last
            : -1;
  buttons[to]?.focus();
  return to >= 0;
}
