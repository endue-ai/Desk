/**
 * The right-edge strip (ADR 0116): Tile, Cascade and Spread, then Restore, in a column under the
 * status rail. Each button runs its desk.windows.* command, so a click lands on the desk's undo stack
 * as a key or the palette would. A toolbar: one Tab stop, the arrow keys move between its buttons,
 * and each button's tooltip names its key.
 */
import { windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { h, listen } from "../shell/dom";
import { type Arranger, arrangeable } from "./arranger";
import { CASCADE, RESTORE, SPREAD, TILE } from "./commands";
import { type ArrangeCopyKey, arrangeText } from "./copy";
import { type ArrangeIcon, arrangeIcon } from "./icons";

interface Item {
  key: ArrangeIcon;
  command: string;
  label: ArrangeCopyKey;
}

const ITEMS: Item[] = [
  { key: "tile", command: TILE, label: "tile" },
  { key: "cascade", command: CASCADE, label: "cascade" },
  { key: "spread", command: SPREAD, label: "spread" },
  { key: "restore", command: RESTORE, label: "restore" },
];

const MOVES: Record<string, (at: number, n: number) => number> = {
  ArrowDown: (at, n) => (at + 1) % n,
  ArrowRight: (at, n) => (at + 1) % n,
  ArrowUp: (at, n) => (at - 1 + n) % n,
  ArrowLeft: (at, n) => (at - 1 + n) % n,
  Home: () => 0,
  End: (_, n) => n - 1,
};

export function mountStrip(
  root: HTMLElement,
  ctx: ShellCtx,
  arranger: Arranger,
  run: (command: string) => void,
): () => void {
  const say = (key: ArrangeCopyKey) => arrangeText(ctx.store.get().lang, key);
  const el = h("aside", {
    class: "arrange-strip float-bar",
    role: "toolbar",
    "aria-orientation": "vertical",
    "data-arrange": "strip",
  });
  const tip = h("div", {
    class: "tooltip arrange-tip",
    role: "tooltip",
    id: "arrange-tip",
    hidden: true,
  });
  const buttons = ITEMS.map((item, i) => {
    const button = h(
      "button",
      {
        class: `icon-button arrange-button${item.key === "restore" ? " is-restore" : ""}`,
        type: "button",
        "data-arrange": item.key,
        tabindex: i === 0 ? "0" : "-1",
        onClick: () => {
          if (button.getAttribute("aria-disabled") !== "true") run(item.command);
        },
      },
      arrangeIcon(item.key),
    );
    return button;
  });
  el.append(...buttons.slice(0, 3), h("span", { class: "arrange-divider" }), ...buttons.slice(3));
  root.append(el, tip);

  const label = (item: Item) => {
    const key = ctx.keyOf(item.command);
    return key ? `${say(item.label)} (${key})` : say(item.label);
  };
  const draw = () => {
    const s = ctx.store.get();
    const some = arrangeable(s).length > 0;
    const off: Record<string, boolean> = {
      tile: !some,
      cascade: !some,
      spread: windowsOf(s).length === 0,
      restore: !arranger.canRestore(),
    };
    el.setAttribute("aria-label", say("strip"));
    const combos = ctx.runtime.keymap.bindings();
    ITEMS.forEach((item, i) => {
      const button = buttons[i];
      if (!button) return;
      button.setAttribute("aria-label", say(item.label));
      const combo = combos.find((b) => b.command === item.command)?.combo;
      if (combo) button.setAttribute("aria-keyshortcuts", combo);
      else button.removeAttribute("aria-keyshortcuts");
      button.setAttribute("aria-disabled", String(off[item.key] === true));
    });
    if (shown) showTip(shown);
  };

  let shown: HTMLButtonElement | null = null;
  const showTip = (button: HTMLButtonElement | null) => {
    if (shown && shown !== button) shown.removeAttribute("aria-describedby");
    shown = button;
    const item = ITEMS.find((i) => i.key === button?.dataset.arrange);
    if (!button || !item) {
      tip.hidden = true;
      return;
    }
    tip.textContent = label(item);
    tip.hidden = false;
    button.setAttribute("aria-describedby", tip.id);
    const r = button.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    // Beside the column; above the buttons when a short app lays the strip out as a row.
    const row = el.offsetWidth > el.offsetHeight;
    tip.classList.toggle("is-above", row);
    tip.style.top = `${(row ? r.top : r.top + r.height / 2) - box.top}px`;
    tip.style.right = `${box.right - (row ? r.left + r.width / 2 : r.left - 8)}px`;
  };
  const target = (e: Event) =>
    (e.target as Element | null)?.closest<HTMLButtonElement>("[data-arrange]") ?? null;

  draw();
  const offs = [
    ctx.store.watch(
      (s) => [s.lang, s.desktop, windowsOf(s).map((p) => [p.id, p.floating === true, p.pinned])],
      draw,
    ),
    arranger.onChange(draw),
    ctx.runtime.keymap.onChange(draw),
    listen(el, "pointerover", (e) => showTip(target(e))),
    listen(el, "pointerleave", () => showTip(null)),
    listen(el, "focusin", (e) => showTip(target(e))),
    listen(el, "focusout", () => showTip(null)),
    listen(el, "keydown", (e) => {
      const move = MOVES[e.key];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (!move || at < 0) return;
      e.preventDefault();
      const next = buttons[move(at, buttons.length)];
      for (const button of buttons) button.tabIndex = button === next ? 0 : -1;
      next?.focus();
    }),
  ];
  return () => {
    for (const off of offs) off();
    el.remove();
    tip.remove();
  };
}
