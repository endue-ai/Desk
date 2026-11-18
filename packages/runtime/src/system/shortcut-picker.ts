/**
 * The shortcut bar's "+" (ADR 0274): a field over the list of what may go on the bar, the desk's
 * actions and the plugins that open on the desk, and every command as the person types. A press on
 * a row puts it on the bar, or takes it off when it is there; the list stays open for the next one.
 * Built once while it is open: typing draws the list again, never the field, so the field keeps
 * its caret and an input method's composition. Enter on the field takes the first row; the arrows
 * walk the rows, up from the first back to the field; Escape closes it.
 */
import type { Lang } from "../shell/copy";
import { type Child, h, render } from "../shell/dom";
import { icon } from "../shell/icons";
import { walkButtons } from "./account-menu";
import { shortcutText } from "./shortcut-copy";
import {
  type Choice,
  type Group,
  holds,
  iconOf,
  initialOf,
  MAX,
  matching,
  type Shortcut,
} from "./shortcuts";

/** A shortcut's face: its icon, or its name's first letter in a square drawn like the icons. */
export function glyphOf(shortcut: Shortcut, name: string, size = 20): Child {
  const named = iconOf(shortcut);
  if (named) return icon(named, size);
  return h("span", { class: "shortcut-letter", "aria-hidden": "true" }, initialOf(name));
}

export interface PickerDeps {
  lang(): Lang;
  /** What the bar holds now. */
  on(): readonly Shortcut[];
  /** Everything that may go on the bar (shortcuts.ts `choices`). */
  choices(): Choice[];
  toggle(shortcut: Shortcut): void;
  /** Close the list; the focus goes back to the "+". */
  close(): void;
}

export interface Picker {
  el: HTMLElement;
  /** Draw the list again: the bar or what may go on it changed. */
  refresh(): void;
  /** Give the field the focus, as when the list opens. */
  focus(): void;
}

const GROUPS: readonly Group[] = ["desk", "plugins", "commands"];

export function shortcutPicker(deps: PickerDeps): Picker {
  const tr = (key: Parameters<typeof shortcutText>[1], params?: Record<string, string | number>) =>
    shortcutText(deps.lang(), key, params);
  let typed = "";
  let shown: Choice[] = [];
  const list = h("div", { class: "shortcuts-choices" });
  const field = h("input", {
    class: "input shortcuts-filter",
    // Text, not search: Escape closes the list instead of emptying the field first.
    type: "text",
    role: "searchbox",
    "data-key": "shortcuts-filter",
    autocomplete: "off",
    spellcheck: "false",
    onInput: () => {
      typed = field.value;
      refresh();
    },
  });
  const rows = () => [...list.querySelectorAll<HTMLElement>("button:not(:disabled)")];

  const onKeydown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const inField = event.target === field;
    if (event.key === "Escape") deps.close();
    else if (inField && event.key === "Enter") {
      const first = shown.find((c) => !rowDisabled(c));
      if (!first) return;
      deps.toggle(first.shortcut);
    } else if (inField && event.key === "ArrowDown") rows()[0]?.focus();
    else if (inField && event.key === "ArrowUp") rows().at(-1)?.focus();
    else if (!inField && event.key === "ArrowUp" && rows()[0] === event.target) field.focus();
    else if (!inField && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      if (!walkButtons(list, event.key)) return;
    } else if (!inField && event.key.length === 1 && !event.isComposing) {
      // Typing on a row goes on in the field.
      field.focus();
      return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const el = h(
    "div",
    { class: "popover shortcuts-popover", role: "dialog", tabindex: "-1", onKeydown },
    field,
    list,
  );

  const rowDisabled = (c: Choice) => !holds(deps.on(), c.shortcut) && deps.on().length >= MAX;

  const row = (c: Choice, on: readonly Shortcut[]) => {
    const pressed = holds(on, c.shortcut);
    return h(
      "button",
      {
        class: "menu-item shortcuts-choice",
        type: "button",
        "data-key": `choice-${c.key}`,
        "data-choice": c.key,
        "aria-pressed": String(pressed),
        disabled: rowDisabled(c),
        onClick: () => deps.toggle(c.shortcut),
      },
      h("span", { class: "shortcuts-choice-face" }, glyphOf(c.shortcut, c.name, 16)),
      h("span", { class: "pop-text" }, c.name),
      pressed ? icon("check", 16) : null,
    );
  };

  const refresh = () => {
    const on = deps.on();
    el.setAttribute("aria-label", tr("add"));
    field.placeholder = tr("find");
    field.setAttribute("aria-label", tr("find"));
    shown = matching(deps.choices(), typed, on);
    render(list, () => {
      if (shown.length === 0)
        return [h("p", { class: "shortcuts-note" }, tr("none", { typed: typed.trim() }))];
      return [
        GROUPS.map((group) => {
          const mine = shown.filter((c) => c.group === group);
          if (mine.length === 0) return null;
          const id = `shortcuts-group-${group}`;
          return h(
            "div",
            { class: "shortcuts-group", role: "group", "aria-labelledby": id },
            h("div", { class: "pop-title", id }, tr(group)),
            mine.map((c) => row(c, on)),
          );
        }),
        on.length >= MAX ? h("p", { class: "shortcuts-note" }, tr("full", { n: MAX })) : null,
      ];
    });
  };
  refresh();
  return { el, refresh, focus: () => field.focus() };
}
