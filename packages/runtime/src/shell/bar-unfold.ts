/**
 * The agent bar unfolds into its list of names (issue 294, design 291): once the pointer has
 * rested on it for `UNFOLD_MS`, or at once from the unfold control, the bar's first control, which
 * is in sight only while the keyboard's focus is on it (chrome.css). It folds `FOLD_MS` after
 * neither the pointer nor the keyboard's focus is in it and its list of the rest is closed, or
 * when the control is pressed again. Pinned (`DeskState.agentsPinned`, kept with the session,
 * link.ts) it stays unfolded. Unfolded is the bar's own state and no popover: Escape and a press
 * outside leave it, and it closes nothing.
 * Both waits run on the injected clock through the ticker, which is asked for frames only while
 * one of them is out (ADR 0164). How the bar changes its width is the stylesheet's, so reduced
 * motion, which zeroes the time, unfolds it at once.
 */
import { withTip } from "./bar-tip";
import type { ShellCtx } from "./context";
import { type Child, h, listen } from "./dom";
import { icon } from "./icons";
import { IDLE } from "./ticker";

/** How long the pointer rests on the bar before it unfolds: longer than a pass across it. */
export const UNFOLD_MS = 300;
/** How long nothing holds the unfolded bar before it folds: as the chrome's `LEAVE_MS` (away.ts). */
export const FOLD_MS = 400;

export interface BarUnfold {
  /** Whether the bar shows its list. */
  unfolded(): boolean;
  /** The bar's first controls: the unfold control, and the pin while the bar is unfolded. */
  controls(): Child[];
  /** The bar has been drawn anew: see again whether something still holds it unfolded. */
  settle(): void;
  dispose(): void;
}

/** Unfold `bar` on the pointer's rest and from its control; `draw` draws the bar in its form. */
export function mountBarUnfold(bar: HTMLElement, ctx: ShellCtx, draw: () => void): BarUnfold {
  const pinned = () => ctx.store.get().agentsPinned;
  let open = pinned();
  /** The pointer is on the bar; the keyboard's focus is in it. */
  let pointer = false;
  let focus = false;
  /** The focus in the bar came by the pointer's press. An engine gives a pressed button the
   * focus, which must not hold the bar unfolded once the pointer has left; a key pressed in the
   * bar makes that focus the keyboard's. */
  let pressed = false;
  /** When the pointer's rest unfolds the bar and when it folds, on the ticker's clock. */
  let unfoldAt: number | null = null;
  let foldAt: number | null = null;

  const show = () => {
    bar.classList.toggle("is-unfolded", open);
    draw();
  };
  const set = (next: boolean) => {
    unfoldAt = null;
    foldAt = null;
    if (open === next) return;
    open = next;
    show();
  };
  const within = () => bar.contains(bar.ownerDocument.activeElement);
  /** Start the wait to fold once nothing holds the bar unfolded, and end it when something does. */
  const settle = () => {
    // Its list of the rest stands past the unfolded bar: open, it holds the bar too.
    const held = pinned() || pointer || focus || ctx.store.get().popover === "agents-more";
    if (!open || held) foldAt = null;
    else if (foldAt === null) {
      foldAt = ctx.ticker.now() + FOLD_MS;
      ctx.ticker.wake();
    }
  };
  bar.classList.toggle("is-unfolded", open);

  const offs = [
    listen(bar, "pointerenter", () => {
      pointer = true;
      if (!open && unfoldAt === null) {
        unfoldAt = ctx.ticker.now() + UNFOLD_MS;
        ctx.ticker.wake();
      }
      settle();
    }),
    listen(bar, "pointerleave", () => {
      pointer = false;
      unfoldAt = null;
      settle();
    }),
    listen(bar, "pointerdown", () => {
      pressed = true;
      focus = false;
      settle();
    }),
    // An engine that gives a pressed button no focus leaves nothing to tell apart.
    listen(bar, "pointerup", () => {
      if (!within()) pressed = false;
    }),
    listen(bar, "keydown", () => {
      pressed = false;
      focus = within();
      settle();
    }),
    listen(bar, "focusin", () => {
      focus = !pressed;
      settle();
    }),
    listen(bar, "focusout", (event) => {
      // To another of the bar's controls, the focus has not left it: its `focusin` says the rest.
      if (!bar.contains(event.relatedTarget as Node | null)) focus = false;
      settle();
    }),
    ctx.ticker.add((now) => {
      if (unfoldAt !== null && now >= unfoldAt) set(true);
      else if (foldAt !== null && now >= foldAt) set(false);
      return unfoldAt === null && foldAt === null ? IDLE : undefined;
    }),
    // The pin is the store's: the person's press here, or the session that came back (link.ts).
    ctx.store.watch(
      (s) => s.agentsPinned,
      (pin) => {
        if (pin) {
          unfoldAt = null;
          open = true;
        }
        // Drawn anew, the bar sees for itself whether something still holds it (`settle`).
        show();
      },
    ),
  ];

  const controls = (): Child[] => {
    const name = ctx.tr(open ? "hideNames" : "showNames");
    const keep = ctx.tr("keepOpen");
    return [
      withTip(
        h(
          "button",
          {
            class: "icon-button bar-unfold",
            type: "button",
            "data-key": "agents-unfold",
            "aria-label": name,
            "aria-expanded": String(open),
            onClick: () => {
              // Hidden by hand, it is not kept open either.
              if (open && pinned()) ctx.store.set({ agentsPinned: false });
              set(!open);
            },
          },
          icon("panel", 18),
        ),
        () => [name],
      ),
      open
        ? withTip(
            h(
              "button",
              {
                class: `icon-button bar-pin${pinned() ? " is-on" : ""}`,
                type: "button",
                "data-key": "agents-pin",
                "aria-label": keep,
                "aria-pressed": String(pinned()),
                onClick: () => ctx.store.set({ agentsPinned: !pinned() }),
              },
              icon("pin", 16),
            ),
            () => [keep],
          )
        : null,
    ];
  };

  return {
    unfolded: () => open,
    controls,
    settle: () => {
      // A redraw may have taken the focused control away without a word.
      if (focus && !within()) focus = false;
      settle();
    },
    dispose: () => {
      for (const off of offs) off();
      bar.classList.remove("is-unfolded");
    },
  };
}
