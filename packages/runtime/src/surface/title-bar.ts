/**
 * A window's title bar (ADR 0255): its heading (the icon and title of the tab it shows, which
 * `Surface.ts` draws), the pinned and floating marks, and three tools: the window menu, Pop out
 * where the window shows one plugin and nothing else (issue 235), and Close. What else a window's
 * tools did are rows of the window menu (`desktops/window-rows.ts`), which the tool opens under it
 * and a right-click on the bar opens where it was pressed (ADR 0117). 36 px high (`surface.css`), as
 * desk-wm lays it out (`host::TITLE`; `TITLE_END` keeps the room of the marks and the tools). Each
 * tool's hover title is its name and its command's key, which the compositor draws (ADR 0193); its
 * accessible name is its name alone.
 */
import { CLOSE } from "../arrange/commands";
import { POP_OUT, poppable } from "../arrange/out";
import { type DesktopsCopyKey, dt } from "../desktops/copy";
import { windowMenuOf } from "../desktops/ui";
import { reportFailure } from "../gesture";
import type { SurfacePlacement } from "../modes/types";
import type { ShellCtx } from "../shell/context";
import { h } from "../shell/dom";
import { icon } from "../shell/icons";
import { closeWindow } from "../shell/windows";
import { isFloating } from "./coordinates";

export interface TitleBar {
  /** The bar: the heading, then the marks and the tools at its end. */
  el: HTMLElement;
  /** Where the tab shown's icon and title go. */
  heading: HTMLElement;
  /**
   * The tools' names and keys, the marks and Pop out, from the window as it is: once it is laid out,
   * and again whenever the keymap, the language or the window changed.
   */
  relabel: () => void;
}

/** The window menu's "more": three dots, drawn like the shell's icons (24 viewBox, stroke 2). */
function more(size: number): SVGSVGElement {
  const svg = icon("more", size);
  svg.querySelector("path")?.setAttribute("d", "M5 12h.01M12 12h.01M19 12h.01");
  return svg;
}

export function mountTitleBar(ctx: ShellCtx, placement: () => SurfacePlacement): TitleBar {
  const id = () => placement().id;
  const say = (key: DesktopsCopyKey) => dt(ctx.store.get().lang, key);
  const tool = (kind: string, glyph: SVGSVGElement, run: () => void, props = {}) =>
    h(
      "button",
      {
        class: "icon-button tool",
        type: "button",
        "data-tool": kind,
        ...props,
        onClick: (e: Event) => {
          e.stopPropagation();
          run();
        },
      },
      glyph,
    );
  // A state, not a control: a press on it drags the window as one on the title does.
  const mark = (kind: "pinned" | "floating") =>
    h(
      "span",
      { class: "surface-mark", "data-mark": kind, role: "img", hidden: true },
      icon(kind === "pinned" ? "pin" : "floating", 16),
    );
  const pinned = mark("pinned");
  const floating = mark("floating");
  const menu = tool("menu", more(14), () => windowMenuOf(ctx.store).toggle(id(), menu), {
    "aria-haspopup": "menu",
    "aria-expanded": "false",
  });
  // Out of the canvas into an OS window of its own (issue 235).
  const out = tool("pop-out", icon("pop-out", 14), () => ctx.wm.run({ op: "pop-out" }, id()));
  // A save the person chose before the close can fail: the window stays, and the desk says why.
  const close = tool("close", icon("close", 14), () => {
    closeWindow(ctx, id()).catch((error) =>
      reportFailure(ctx.runtime.notify, ctx.tr("close"), error),
    );
  });
  const heading = h("span", { class: "surface-heading" });
  const el = h(
    "header",
    {
      class: "surface-title",
      title: ctx.tr("maximize"),
      onDblclick: (e: Event) => {
        if (!(e.target as Element).closest("button")) ctx.wm.run({ op: "maximize" }, id());
      },
    },
    heading,
    h("span", { class: "surface-tools" }, pinned, floating, menu, out, close),
  );

  /** A tool's name, and its hover title: the name, then its command's key when it has one. */
  const label = (button: HTMLElement, name: string, command?: string) => {
    const key = command ? ctx.keyOf(command) : undefined;
    button.setAttribute("aria-label", name);
    button.title = key ? `${name} (${key})` : name;
  };
  const relabel = () => {
    const p = placement();
    label(menu, say("windowTool"));
    label(out, ctx.tr("popOut"), POP_OUT);
    label(close, ctx.tr("close"), CLOSE);
    out.hidden = !poppable(ctx.store.get(), p.id);
    const marks = [
      [pinned, p.pinned, say("pinned")],
      [floating, isFloating(p), say("floating")],
    ] as const;
    for (const [shown, on, name] of marks) {
      shown.hidden = !on;
      shown.setAttribute("aria-label", name);
      shown.title = name;
    }
  };
  return { el, heading, relabel };
}
