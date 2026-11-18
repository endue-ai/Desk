/**
 * The shortcut bar (ADR 0274): a floating bar of the bars' one shape, hung under the profile
 * switcher above the agent bar, fixed in every desktop and mode. It holds the person's shortcuts
 * top to bottom, each a button that opens a plugin or runs a command (Search first on a fresh desk),
 * then a "+" that lists what may go on it (shortcut-picker.ts). A right-click on a shortcut, or
 * Shift+F10 while it has the focus, opens its menu: move it, or take it off (shortcut-menu.ts).
 * The list is the core setting `desk.shell.shortcuts`, kept with the person's preferences;
 * `desk.shortcuts.add` and `desk.shortcuts.remove` change it from the palette, a plugin or an agent.
 * The bar tells its layer how many buttons it has (`--shortcuts-count`): the agent bar keeps clear
 * of it (system.css).
 */
import { CommandError } from "../commands";
import { runGesture } from "../gesture";
import { mountBarTip, withTip } from "../shell/bar-tip";
import type { ShellCtx } from "../shell/context";
import { h, render } from "../shell/dom";
import { icon } from "../shell/icons";
import { deskName, shortcutText } from "./shortcut-copy";
import { asksForMenu, shortcutMenu } from "./shortcut-menu";
import { glyphOf, type Picker, shortcutPicker } from "./shortcut-picker";
import {
  added,
  choices,
  holds,
  type Known,
  keyOf,
  labelOf,
  MAX,
  moved,
  removed,
  SHORTCUTS,
  type Shortcut,
  shortcutOf,
  shortcutsOf,
} from "./shortcuts";

/** The "+" and the data-key of each shortcut's button. */
const ADD = "shortcuts-add";
const buttonKey = (shortcut: Shortcut) => `shortcut-${keyOf(shortcut)}`;

/** Whether a command was run with nothing to say what (the palette, a key): it opens the "+". */
const bare = (args: unknown) =>
  args === undefined ||
  args === null ||
  (typeof args === "object" && Object.keys(args as object).length === 0);

export function mountShortcutBar(root: HTMLElement, ctx: ShellCtx): () => void {
  const { settings, commands } = ctx.runtime;
  const lang = () => ctx.store.get().lang;
  const tr = (key: Parameters<typeof shortcutText>[1], params?: Record<string, string | number>) =>
    shortcutText(lang(), key, params);
  const bar = h("nav", { class: "shortcuts float-bar" });
  const slot = h("div", { class: "shortcuts-popover-slot" });
  root.append(bar, slot);
  const tip = mountBarTip(root, bar, { id: "shortcuts-tooltip", edge: "left", controls: "button" });

  const list = () => shortcutsOf(settings.get(SHORTCUTS));
  const save = (next: Shortcut[]) => settings.set(SHORTCUTS, next);
  const known = (): Known => ({
    plugins: ctx.runtime.plugins?.listed?.() ?? [],
    commands: commands.list(),
    named: (id) => deskName(lang(), id),
  });

  let picker: Picker | null = null;
  /** The shortcut whose menu is open, by its key, and what had the focus before a popover opened. */
  let menuFor: string | null = null;
  let opener: string | null = null;

  const focusKey = (key: string | null) =>
    key && bar.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
  /** Close what is open and give the focus back to what opened it. */
  const close = () => {
    const back = opener;
    ctx.store.set({ popover: null });
    focusKey(back);
  };
  const open = (popover: "shortcuts" | "shortcut-menu", from: string) => {
    opener = from;
    // Another shortcut's menu while one is open: the store's popover is the same, so draw here.
    if (ctx.store.get().popover === popover) draw();
    else ctx.store.set({ popover });
  };

  const run = (shortcut: Shortcut) => {
    ctx.store.set({ popover: null });
    if ("plugin" in shortcut)
      void runGesture(ctx.runtime, "desk.plugins.open", { plugin: shortcut.plugin });
    else void runGesture(ctx.runtime, shortcut.command);
  };
  const toggle = (shortcut: Shortcut) =>
    save(holds(list(), shortcut) ? removed(list(), shortcut) : added(list(), shortcut));

  const button = (shortcut: Shortcut, k: Known) => {
    const { name, missing } = labelOf(shortcut, k);
    const key = buttonKey(shortcut);
    return withTip(
      h(
        "button",
        {
          class: "icon-button shortcut",
          type: "button",
          "data-key": key,
          "data-shortcut": keyOf(shortcut),
          "data-missing": missing ? "" : undefined,
          "aria-label": missing ? `${name} · ${tr("missing")}` : name,
          "aria-haspopup": "menu",
          "aria-expanded": menuFor === keyOf(shortcut) ? "true" : undefined,
          onClick: () => run(shortcut),
          onContextmenu: (event: MouseEvent) => {
            event.preventDefault();
            menuFor = keyOf(shortcut);
            open("shortcut-menu", key);
          },
          onKeydown: (event: KeyboardEvent) => {
            if (!asksForMenu(event)) return;
            event.preventDefault();
            menuFor = keyOf(shortcut);
            open("shortcut-menu", key);
          },
        },
        glyphOf(shortcut, name),
      ),
      // Its menu open beside it names it: no tooltip over the menu's rows.
      () => (menuFor === keyOf(shortcut) ? [] : missing ? [name, tr("missing")] : [name]),
    );
  };

  const menu = (k: Known) => {
    const items = list();
    const at = items.findIndex((s) => keyOf(s) === menuFor);
    const shortcut = items[at];
    const control = shortcut
      ? bar.querySelector<HTMLElement>(`[data-key="${CSS.escape(buttonKey(shortcut))}"]`)
      : null;
    if (!shortcut || !control) return null;
    const top = control.getBoundingClientRect().top - root.getBoundingClientRect().top;
    return shortcutMenu({
      lang: lang(),
      name: labelOf(shortcut, k).name,
      first: at === 0,
      last: at === items.length - 1,
      top,
      move: (by) => {
        save(moved(list(), shortcut, by));
        close();
      },
      remove: () => {
        const next = list()[at + 1] ?? list()[at - 1];
        save(removed(list(), shortcut));
        opener = next ? buttonKey(next) : ADD;
        close();
      },
      close,
    });
  };

  const draw = () => {
    const s = ctx.store.get();
    const items = list();
    const k = known();
    const active = root.ownerDocument.activeElement as HTMLElement | null;
    const held = slot.contains(active);
    if (s.popover !== "shortcut-menu") menuFor = null;
    bar.setAttribute("aria-label", tr("bar"));
    render(bar, () => [
      items.map((shortcut) => button(shortcut, k)),
      withTip(
        h(
          "button",
          {
            class: "icon-button shortcuts-add",
            type: "button",
            "data-key": ADD,
            "aria-label": tr("add"),
            "aria-haspopup": "dialog",
            "aria-expanded": String(s.popover === "shortcuts"),
            onClick: () =>
              s.popover === "shortcuts" ? ctx.store.set({ popover: null }) : open("shortcuts", ADD),
          },
          icon("plus"),
        ),
        () => (ctx.store.get().popover === "shortcuts" ? [] : [tr("add")]),
      ),
    ]);
    // The agent bar keeps clear of the bar's buttons (system.css).
    root.style.setProperty("--shortcuts-count", String(items.length + 1));

    if (s.popover === "shortcuts") {
      if (!picker) {
        picker = shortcutPicker({
          lang,
          on: list,
          choices: () => choices(known()),
          toggle,
          close,
        });
        slot.replaceChildren(picker.el);
        picker.focus();
      } else picker.refresh();
    } else {
      picker = null;
      const shown = s.popover === "shortcut-menu" ? menu(k) : null;
      slot.replaceChildren(...(shown ? [shown] : []));
      // Opened, its first row has the focus; drawn again, the row that had it keeps it.
      const again = held && active?.dataset.key;
      const row = again
        ? shown?.querySelector<HTMLElement>(`[data-key="${CSS.escape(again)}"]`)
        : shown?.querySelector<HTMLElement>("button:not(:disabled)");
      (row ?? (held ? shown : null))?.focus();
    }
    // Closed with the focus inside and nothing else opened: what opened it has the focus back.
    if (!slot.firstChild && held && s.popover === null) focusKey(opener);
    tip.refresh();
  };

  const commandsOff = [
    commands.define("desk.shortcuts.add", {
      title: () => tr("add"),
      keywords: ["shortcut", "shortcuts", "pin", "favorite", "bar", "바로가기", "즐겨찾기", "고정"],
      owner: "desk",
      run: (args) => {
        if (bare(args)) return void open("shortcuts", ADD);
        const shortcut = shortcutOf(args);
        if (!shortcut)
          throw new CommandError("failed", "Name a plugin ({ plugin }) or a command ({ command })");
        if (!holds(list(), shortcut) && list().length >= MAX)
          throw new CommandError("failed", shortcutText("en", "full", { n: MAX }));
        save(added(list(), shortcut));
        return { shortcuts: list() };
      },
    }),
    commands.define("desk.shortcuts.remove", {
      title: () => tr("removeOne"),
      keywords: ["shortcut", "shortcuts", "unpin", "remove", "바로가기", "빼기"],
      owner: "desk",
      run: (args) => {
        if (bare(args)) return void open("shortcuts", ADD);
        const shortcut = shortcutOf(args);
        if (!shortcut)
          throw new CommandError("failed", "Name a plugin ({ plugin }) or a command ({ command })");
        save(removed(list(), shortcut));
        return { shortcuts: list() };
      },
    }),
  ];

  draw();
  const offs = [
    ctx.store.watch((s) => [s.popover, s.lang], draw),
    settings.onChange((keys) => keys.includes(SHORTCUTS) && draw()),
    commands.onChange(draw),
    ctx.runtime.plugins?.onListed?.(draw) ?? (() => {}),
  ];
  return () => {
    for (const off of offs) off();
    for (const off of commandsOff) off();
    tip.dispose();
    root.style.removeProperty("--shortcuts-count");
    bar.remove();
    slot.remove();
  };
}
