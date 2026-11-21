/**
 * The notification centre's panel (#307): a dialog named Notifications under the status line. Its
 * header holds the title, how many notices it holds (a polite live region), the do-not-disturb
 * switch and Clear all; its body the history as lists, Today and Earlier, whose rows the arrows walk
 * (Home and End to the ends). Escape is the centre's to close it, never the desk's quit key.
 */
import type { Language } from "@endue-ai/bridge";
import type { Notice, Notifications } from "../notify";
import { h } from "../shell/dom";
import { centreText } from "./copy";
import { groupsOf, type RowContext, rowOf } from "./rows";

export interface PanelDeps extends Omit<RowContext, "lang" | "now"> {
  notifications: Notifications;
  language(): Language;
  /** The wall clock: what today is. */
  now(): number;
  dnd(): boolean;
  toggleDnd(): void;
  /** Escape was pressed in it. */
  escape(): void;
}

export interface Panel {
  readonly element: HTMLElement;
  /** Draw it again as the history and the settings stand, the focus kept where it was. */
  render(): void;
  /** Give the focus to its first row, or to the panel when it has none. */
  focusFirst(): void;
}

const ROW = ".desk-notify-row";

export function createPanel(deps: PanelDeps): Panel {
  const { notifications } = deps;
  const tr = (key: Parameters<typeof centreText>[1], params?: Record<string, number>) =>
    centreText(deps.language(), key, params);
  const title = h("h2", { class: "desk-notify-title" });
  const live = h("p", { class: "desk-notify-live", "aria-live": "polite" });
  const switchLabel = h("span", { class: "desk-notify-dnd-label" });
  const dnd = h(
    "button",
    {
      type: "button",
      class: "btn btn-xs desk-notify-dnd",
      role: "switch",
      onClick: () => deps.toggleDnd(),
    },
    h("span", { class: "desk-notify-switch", "aria-hidden": "true" }),
    switchLabel,
  );
  const clear = h("button", {
    type: "button",
    class: "btn btn-xs desk-notify-clear",
    onClick: () => {
      notifications.clear();
      element.focus();
    },
  });
  const body = h("div", { class: "desk-notify-body" });
  const element = h(
    "section",
    { class: "popover desk-notify-centre", role: "dialog", tabindex: "-1" },
    h(
      "header",
      { class: "desk-notify-head" },
      h("div", { class: "desk-notify-heading" }, title, live),
      dnd,
      clear,
    ),
    body,
  );

  const rows = () => [...element.querySelectorAll<HTMLElement>(ROW)];
  const rowOfId = (id: string | null) => rows().find((row) => row.dataset.id === id);
  const focusRow = (row: HTMLElement | undefined) => {
    if (!row) return;
    for (const other of rows()) other.tabIndex = other === row ? 0 : -1;
    row.focus();
  };

  const dismiss = (notice: Notice) => {
    const all = rows();
    const at = all.findIndex((row) => row.dataset.id === notice.id);
    const next = all[at + 1] ?? all[at - 1];
    const id = next?.dataset.id ?? null;
    deps.dismiss(notice);
    const row = rowOfId(id);
    if (row) focusRow(row);
    else element.focus();
  };

  const render = () => {
    const lang = deps.language();
    const history = notifications.history();
    element.setAttribute("aria-label", tr("title"));
    title.textContent = tr("title");
    const said = history.length ? tr("count", { count: history.length }) : tr("none");
    if (live.textContent !== said) live.textContent = said;
    dnd.setAttribute("aria-checked", String(deps.dnd()));
    switchLabel.textContent = tr("dnd");
    clear.textContent = tr("clear");
    clear.disabled = history.length === 0;

    // The focus stays on what had it: the same control, else the same row.
    const active = element.ownerDocument.activeElement;
    const inside = active instanceof HTMLElement && body.contains(active) ? active : null;
    const key = inside?.dataset.key;
    const id = inside?.closest<HTMLElement>(ROW)?.dataset.id ?? null;
    const now = deps.now();
    const ctx: RowContext = { ...deps, lang, now, dismiss };
    body.replaceChildren(
      ...groupsOf(history, now).map((group) => {
        const name = tr(group.key);
        return h(
          "section",
          { class: "desk-notify-group" },
          h("h3", { class: "desk-notify-group-title", "aria-hidden": "true" }, name),
          h(
            "ul",
            { class: "desk-notify-list", role: "list", "aria-label": name },
            group.notices.map((notice) => rowOf(notice, group.key, ctx)),
          ),
        );
      }),
    );
    if (history.length === 0) {
      body.append(
        h(
          "div",
          { class: "desk-notify-empty" },
          h("p", { class: "desk-notify-empty-title" }, tr("none")),
          h("p", {}, tr("empty")),
        ),
      );
    }
    if (!inside) return;
    const keyed = [...body.querySelectorAll<HTMLElement>("[data-key]")];
    const same = key ? keyed.find((el) => el.dataset.key === key) : undefined;
    if (same) same.focus();
    else if (rowOfId(id)) focusRow(rowOfId(id));
  };

  element.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      deps.escape();
      return;
    }
    const all = rows();
    if (all.length === 0 || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const current = (event.target as Element | null)?.closest<HTMLElement>(ROW);
    const at = current ? all.indexOf(current) : -1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? all.length - 1
          : event.key === "ArrowDown"
            ? Math.min(at + 1, all.length - 1)
            : at === -1
              ? all.length - 1
              : Math.max(at - 1, 0);
    event.preventDefault();
    focusRow(all[next]);
  });

  render();
  return {
    element,
    render,
    focusFirst: () => {
      const first = rows()[0];
      if (first) focusRow(first);
      else element.focus();
    },
  };
}
