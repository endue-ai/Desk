/** Top right: desktops 1–4 of the current mode, each with a 2×2 map of where its surfaces sit. */

import { DESKTOPS, type DesktopIndex } from "../modes/types";
import { format } from "../system/keys";
import { desktopIsEmpty, layoutOf, setDesktop } from "./actions";
import { REFERENCE, type ShellCtx } from "./context";
import { h, render } from "./dom";
import { icon } from "./icons";

function quadrants(ctx: ShellCtx, d: DesktopIndex): boolean[] {
  const filled = [false, false, false, false];
  for (const p of layoutOf(ctx.store.get(), d).surfaces) {
    const col = p.x + p.w / 2 > REFERENCE.width / 2 ? 1 : 0;
    const row = p.y + p.h / 2 > REFERENCE.height / 2 ? 1 : 0;
    filled[row * 2 + col] = true;
  }
  return filled;
}

export function mountDesktops(root: HTMLElement, ctx: ShellCtx): () => void {
  const el = h("nav", { class: "desktops", "aria-label": ctx.tr("desktop", { n: "" }).trim() });
  root.append(el);
  const draw = () => {
    const s = ctx.store.get();
    const firstEmpty = DESKTOPS.find((d) => d !== s.desktop && desktopIsEmpty(s, d));
    render(el, () => [
      ...DESKTOPS.map((d) => {
        const empty = desktopIsEmpty(s, d);
        const key = ctx.keys.bindingsOf(`desktop.${d}`)[0];
        const label = `${ctx.tr(empty ? "desktopEmpty" : "desktop", { n: d })}${key ? ` (${format(key, ctx.platform)})` : ""}`;
        return h(
          "button",
          {
            class: `desktop-button${d === s.desktop ? " is-active" : ""}`,
            type: "button",
            "data-key": `desktop-${d}`,
            "data-desktop": d,
            "aria-pressed": String(d === s.desktop),
            "aria-label": label,
            title: label,
            onClick: () => setDesktop(ctx, d),
          },
          h("span", { class: "desktop-number" }, d),
          h(
            "span",
            { class: "mini-grid", "aria-hidden": "true" },
            quadrants(ctx, d).map((on) => h("span", { class: `mini-dot${on ? " is-on" : ""}` })),
          ),
        );
      }),
      h(
        "button",
        {
          class: "add-button desktop-add",
          type: "button",
          "data-key": "desktop-add",
          "aria-label": ctx.tr("addDesktop"),
          title: ctx.tr("addDesktop"),
          disabled: firstEmpty === undefined,
          onClick: () => firstEmpty && setDesktop(ctx, firstEmpty),
        },
        icon("plus", 16),
      ),
    ]);
  };
  draw();
  const offs = [
    ctx.store.watch((s) => [s.desktop, s.modeId, s.session, s.modes, s.lang], draw),
    ctx.keys.onChange(draw),
  ];
  return () => {
    for (const off of offs) off();
    el.remove();
  };
}
