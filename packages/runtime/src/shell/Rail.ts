/**
 * Right status rail: six icon buttons with a dot and a count, a tooltip on hover, a popover on
 * click; and one more, Arrange windows, whose actions (Tile, Cascade, Spread, Restore) show as
 * soon as the pointer is on it (ADR 0220), stay while the pointer is on them, and go once it has
 * left both. A click or Enter keeps them open, as the other buttons' popovers are.
 */

import { arrangeText } from "../arrange/copy";
import { arrangeIcon } from "../arrange/icons";
import { arrangeActions, arrangeWatch, runArrange } from "../arrange/menu";
import type { BrainName } from "../bridge/types";
import { toggleListening } from "../eris/hey";
import { agentName, isOpen } from "../system/agents";
import { layoutOf } from "./actions";
import type { ShellCtx } from "./context";
import { type Child, h, listen, render } from "./dom";
import { icon } from "./icons";
import type { DeskState, RailId } from "./state";

interface Item {
  id: RailId;
  icon: string;
  label: string;
  dot?: "success" | "info" | "warning" | "active" | "attention";
  count?: number;
}

/** How long the pointer may be off both the Arrange button and its actions before they go: the
 * time to cross the gap between the rail and its popover, where the pointer is over a window. */
const LEAVE_MS = 350;

function items(ctx: ShellCtx, s: DeskState): Item[] {
  const b = s.brain;
  const open = s.tasks.filter(isOpen);
  const running = open.filter((t) => t.status === "working").length;
  const waiting = open.length - running;
  const sees = [...s.sees.folders, s.sees.calendar, s.sees.mail, s.sees.mic].filter(Boolean).length;
  // The desks besides this one: none while the desk knows no other (issue 158).
  const others = s.desks.filter((d) => !d.here).length;
  return [
    b.mode === "local"
      ? {
          id: "brain",
          icon: "brain",
          label: ctx.tr("brainLocal", { model: b.model }),
          dot: "success",
        }
      : b.mode === "cloud"
        ? {
            id: "brain",
            icon: "brain",
            // Claude Code counts no credits of the desk's: it is named instead (ADR 0109).
            label:
              b.brain === "claude" ? ctx.tr("brainClaude") : ctx.tr("brainCloud", { n: b.credits }),
            dot: "info",
          }
        : { id: "brain", icon: "brain", label: ctx.tr("brainOffline"), dot: "warning" },
    { id: "sees", icon: "eye", label: `${ctx.tr("sees")} · ${sees}` },
    {
      id: "tasks",
      icon: "tasks",
      label: ctx.tr("tasks", { r: running, w: waiting }),
      count: open.length,
    },
    {
      id: "desks",
      icon: "link",
      label: `${ctx.tr("desks")} · ${others}`,
      dot: s.desks.some((d) => d.here && d.busy) ? "active" : undefined,
    },
    s.vm === "on"
      ? { id: "vm", icon: "box", label: ctx.tr("vmOn"), dot: "success" }
      : s.vm === "none"
        ? { id: "vm", icon: "box", label: ctx.tr("vmNone"), dot: "warning" }
        : { id: "vm", icon: "box", label: ctx.tr("vmResting") },
    {
      id: "listen",
      icon: "mic",
      label: ctx.tr(s.listening ? "listenOn" : "listenOff"),
      dot: s.listening ? "active" : undefined,
    },
    { id: "arrange", icon: "arrange", label: arrangeText(s.lang, "strip") },
  ];
}

/** The brains the popover offers, in its order. */
const BRAINS: readonly BrainName[] = ["endue", "claude", "local", "echo"];

const row = (...children: Child[]) => h("div", { class: "pop-row" }, ...children);
const muted = (text: string) => h("span", { class: "pop-muted" }, text);

function body(ctx: ShellCtx, id: RailId, s: DeskState): Child[] {
  const set = (patch: Partial<DeskState>) => ctx.store.set(patch);
  switch (id) {
    case "brain": {
      // The brain the desk chose (ADR 0094); a host that cannot say is on endue or the local one.
      const chosen = s.brain.brain ?? (s.brain.mode === "local" ? "local" : "endue");
      return [
        h(
          "div",
          { class: "segmented", role: "radiogroup", "aria-label": ctx.tr("brain") },
          BRAINS.map((brain) =>
            h(
              "button",
              {
                class: `segment${chosen === brain ? " is-selected" : ""}`,
                type: "button",
                role: "radio",
                "aria-checked": String(chosen === brain),
                "data-key": `brain-${brain}`,
                onClick: async () => set({ brain: await ctx.bridge.brain.use(brain) }),
              },
              ctx.tr(brain),
            ),
          ),
        ),
        s.brain.mode === "local" && s.brain.fallback
          ? h("p", { class: "pop-muted brain-fallback" }, ctx.tr("brainFallback"))
          : null,
      ];
    }
    case "sees":
      return [
        ...s.sees.folders.map((f) => row(icon("file", 16), f)),
        row(
          icon("calendar", 16),
          ctx.tr("calendar"),
          muted(ctx.tr(s.sees.calendar ? "on" : "off")),
        ),
        row(icon("drawer", 16), ctx.tr("mail"), muted(ctx.tr(s.sees.mail ? "on" : "off"))),
        row(icon("mic", 16), ctx.tr("mic"), muted(ctx.tr(s.sees.mic ? "on" : "off"))),
        h(
          "button",
          {
            class: "btn btn-outline pop-action",
            type: "button",
            "data-key": "sees-change",
            onClick: async () => {
              if (await ctx.bridge.perm.request("mail"))
                set({ sees: { ...s.sees, mail: !s.sees.mail } });
            },
          },
          ctx.tr("change"),
        ),
      ];
    case "tasks":
      return s.tasks
        .filter(isOpen)
        .map((t) =>
          row(
            h("span", { class: `dot ${t.status === "working" ? "dot-active" : "dot-idle"}` }),
            h("span", { class: "pop-text" }, t.goal ?? agentName(s, t.targetAgentId)),
            muted(
              t.status === "working"
                ? t.progress === undefined
                  ? ctx.tr("statusWorking")
                  : `${Math.round(t.progress * 100)}%`
                : ctx.tr(t.status === "input_required" ? "statusInputRequired" : "statusSubmitted"),
            ),
          ),
        );
    case "desks":
      // Nothing to bring here: say so rather than offer a button that does nothing.
      if (!s.desks.some((d) => !d.here)) return [row(ctx.tr("empty"))];
      return [
        ...s.desks.map((d) =>
          row(
            h("span", { class: `dot ${d.busy ? "dot-active" : "dot-idle"}` }),
            d.name,
            muted(d.here ? ctx.tr("thisDesk") : ctx.tr(d.busy ? "busy" : "idle")),
          ),
        ),
        h(
          "button",
          {
            class: "btn btn-outline pop-action",
            type: "button",
            "data-key": "desks-bring",
            onClick: () => set({ desks: s.desks.map((d) => ({ ...d, busy: d.here })) }),
          },
          ctx.tr("bringHere"),
        ),
      ];
    case "vm":
      return (["resting", "on", "none"] as const).map((v) =>
        h(
          "button",
          {
            class: `menu-item${s.vm === v ? " is-selected" : ""}`,
            type: "button",
            "aria-pressed": String(s.vm === v),
            "data-key": `vm-${v}`,
            onClick: () => set({ vm: v }),
          },
          ctx.tr(v === "on" ? "vmOn" : v === "none" ? "vmNone" : "vmResting"),
        ),
      );
    case "arrange":
      return arrangeActions(ctx, s).flatMap((action) => [
        action.apart ? h("div", { class: "pop-divider", role: "separator" }) : null,
        h(
          "button",
          {
            class: "menu-item arrange-item",
            type: "button",
            "data-arrange": action.key,
            "aria-disabled": String(action.disabled),
            "aria-keyshortcuts": action.combo,
            onClick: () => {
              if (action.disabled) return;
              set({ popover: null });
              runArrange(ctx, action.command);
            },
          },
          arrangeIcon(action.key, 16),
          h("span", { class: "pop-text" }, action.label),
          action.shortcut ? muted(action.shortcut) : null,
        ),
      ]);
    default:
      return [];
  }
}

export function mountRail(root: HTMLElement, ctx: ShellCtx): () => void {
  const el = h("aside", { class: "rail float-bar", "aria-label": "Status" });
  const tooltip = h("div", { class: "tooltip", role: "tooltip", id: "rail-tooltip", hidden: true });
  const pop = h("div", { class: "rail-popover-slot" });
  root.append(el, tooltip, pop);
  let tipFor: RailId | null = null;
  /** The Arrange actions show because the pointer is on them: they go when it has left. */
  let hovered = false;
  let leaving: number | undefined;
  const stay = () => {
    window.clearTimeout(leaving);
    leaving = undefined;
  };
  /** The pointer came onto the Arrange button: its actions show, unless something else is open. */
  const hover = () => {
    stay();
    const open = ctx.store.get().popover;
    if (open !== null) return;
    hovered = true;
    ctx.store.set({ popover: "arrange" });
  };
  /** The pointer left the button or the actions: they go unless it comes back within `LEAVE_MS`. */
  const leave = () => {
    if (!hovered || leaving !== undefined) return;
    leaving = window.setTimeout(() => {
      leaving = undefined;
      if (hovered && ctx.store.get().popover === "arrange") ctx.store.set({ popover: null });
      hovered = false;
    }, LEAVE_MS);
  };

  const showTip = (button: HTMLElement | null) => {
    const s = ctx.store.get();
    const item = button ? items(ctx, s).find((i) => i.id === button.dataset.rail) : undefined;
    tipFor = item?.id ?? null;
    if (!button || !item || s.popover === item.id) {
      tooltip.hidden = true;
      return;
    }
    tooltip.textContent = item.label;
    tooltip.hidden = false;
    // Level with the button as drawn: the rail is centred by a transform that offsetTop leaves out.
    const at = button.getBoundingClientRect();
    tooltip.style.top = `${at.top + at.height / 2 - root.getBoundingClientRect().top}px`;
  };

  const draw = () => {
    const s = ctx.store.get();
    const visible = layoutOf(s).rail.visible;
    el.hidden = !visible;
    pop.hidden = !visible;
    if (!visible) tooltip.hidden = true;
    const list = items(ctx, s);
    render(el, () =>
      list.map((item) =>
        h(
          "button",
          {
            class: `icon-button rail-button${s.popover === item.id ? " is-open" : ""}`,
            type: "button",
            "data-key": `rail-${item.id}`,
            "data-rail": item.id,
            "aria-label": item.label,
            "aria-expanded": item.id === "listen" ? undefined : String(s.popover === item.id),
            "aria-pressed": item.id === "listen" ? String(s.listening) : undefined,
            onClick: () => {
              if (item.id === "listen") return void toggleListening(ctx);
              // A press on Arrange while its actions show under the pointer keeps them.
              if (item.id === "arrange" && hovered && s.popover === "arrange") {
                hovered = false;
                return stay();
              }
              hovered = false;
              ctx.store.set({ popover: s.popover === item.id ? null : item.id });
            },
          },
          item.id === "arrange" ? arrangeIcon("tile", 20) : icon(item.icon, 20),
          item.dot ? h("span", { class: `dot dot-${item.dot} rail-dot` }) : null,
          item.count ? h("span", { class: "badge rail-badge" }, item.count) : null,
        ),
      ),
    );
    const open = list.find((i) => i.id === s.popover);
    if (s.popover !== "arrange") hovered = false;
    // The Arrange actions lie level with their button, so the pointer goes straight across.
    const button = open?.id === "arrange" ? el.querySelector('[data-rail="arrange"]') : null;
    const top = button
      ? button.getBoundingClientRect().bottom - root.getBoundingClientRect().top
      : el.offsetTop;
    render(pop, () =>
      open
        ? [
            h(
              "div",
              {
                class: `popover rail-popover${button ? " is-arrange" : ""}`,
                role: "dialog",
                "aria-label": open.label,
                "data-popover": open.id,
                style: { top: `${top}px` },
              },
              h("div", { class: "pop-title" }, open.label),
              ...body(ctx, open.id, s),
            ),
          ]
        : [],
    );
    if (tipFor) showTip(el.querySelector(`[data-rail="${tipFor}"]`));
  };
  draw();
  const target = (e: Event) =>
    (e.target as Element | null)?.closest<HTMLElement>("[data-rail]") ?? null;
  const offs = [
    ctx.store.watch(
      (s) => [
        s.brain,
        s.tasks,
        s.attention,
        s.desks,
        s.vm,
        s.listening,
        s.sees,
        s.popover,
        s.lang,
        layoutOf(s).rail,
        arrangeWatch(s),
      ],
      draw,
    ),
    ctx.runtime.keymap.onChange(draw),
    listen(el, "pointerover", (e) => {
      const over = target(e);
      showTip(over);
      if (over?.dataset.rail === "arrange") hover();
      else leave();
    }),
    listen(el, "pointerleave", () => {
      showTip(null);
      leave();
    }),
    listen(pop, "pointerenter", stay),
    listen(pop, "pointerleave", leave),
    listen(el, "focusin", (e) => showTip(target(e))),
    listen(el, "focusout", () => showTip(null)),
  ];
  return () => {
    stay();
    for (const off of offs) off();
    el.remove();
    tooltip.remove();
    pop.remove();
  };
}
