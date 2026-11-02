/** Right status rail: seven icon buttons with a dot and a count, a tooltip on hover, a popover on click. */
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

function items(ctx: ShellCtx, s: DeskState): Item[] {
  const b = s.brain;
  const open = s.tasks.filter(isOpen);
  const running = open.filter((t) => t.status === "working").length;
  const waiting = open.length - running;
  const sees = [...s.sees.folders, s.sees.calendar, s.sees.mail, s.sees.mic].filter(Boolean).length;
  return [
    b.mode === "local"
      ? {
          id: "brain",
          icon: "brain",
          label: ctx.tr("brainLocal", { model: b.model }),
          dot: "success",
        }
      : b.mode === "cloud"
        ? { id: "brain", icon: "brain", label: ctx.tr("brainCloud", { n: b.credits }), dot: "info" }
        : { id: "brain", icon: "brain", label: ctx.tr("brainOffline"), dot: "warning" },
    { id: "sees", icon: "eye", label: `${ctx.tr("sees")} · ${sees}` },
    {
      id: "tasks",
      icon: "tasks",
      label: ctx.tr("tasks", { r: running, w: waiting }),
      count: open.length,
    },
    {
      id: "attention",
      icon: "bell",
      label: ctx.tr("attention", { n: s.attention.length }),
      count: s.attention.length,
      dot: s.attention.length ? "attention" : undefined,
    },
    {
      id: "desks",
      icon: "link",
      label: `${ctx.tr("desks")} · ${s.desks.length - 1}`,
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
  ];
}

const row = (...children: Child[]) => h("div", { class: "pop-row" }, ...children);
const muted = (text: string) => h("span", { class: "pop-muted" }, text);

function body(ctx: ShellCtx, id: RailId, s: DeskState): Child[] {
  const set = (patch: Partial<DeskState>) => ctx.store.set(patch);
  switch (id) {
    case "brain":
      return [
        h(
          "div",
          { class: "segmented", role: "radiogroup", "aria-label": ctx.tr("brain") },
          (["local", "cloud"] as const).map((mode) =>
            h(
              "button",
              {
                class: `segment${s.brain.mode === mode ? " is-selected" : ""}`,
                type: "button",
                role: "radio",
                "aria-checked": String(s.brain.mode === mode),
                "data-key": `brain-${mode}`,
                onClick: async () => set({ brain: await ctx.bridge.brain.use(mode) }),
              },
              ctx.tr(mode),
            ),
          ),
        ),
      ];
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
    case "attention":
      // An item with an action (the update's Restart to update) gets its button under its row, as
      // the other popovers place theirs.
      return s.attention.flatMap((a) => {
        const item = row(h("span", { class: "dot dot-attention" }), a.text);
        const action = a.action;
        if (!action) return [item];
        const run = () => void ctx.runtime.commands.run(action.command).catch(() => {});
        const button = h(
          "button",
          {
            class: "btn btn-outline pop-action",
            type: "button",
            "data-key": `attention-${a.id}`,
            onClick: run,
          },
          action.label,
        );
        return [item, button];
      });
    case "desks":
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
    tooltip.style.top = `${button.offsetTop + el.offsetTop + button.offsetHeight / 2}px`;
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
              if (item.id === "listen") return ctx.store.set({ listening: !s.listening });
              ctx.store.set({ popover: s.popover === item.id ? null : item.id });
            },
          },
          icon(item.icon, 20),
          item.dot ? h("span", { class: `dot dot-${item.dot} rail-dot` }) : null,
          item.count ? h("span", { class: "badge rail-badge" }, item.count) : null,
        ),
      ),
    );
    const open = list.find((i) => i.id === s.popover);
    render(pop, () =>
      open
        ? [
            h(
              "div",
              {
                class: "popover rail-popover",
                role: "dialog",
                "aria-label": open.label,
                "data-popover": open.id,
                style: { top: `${el.offsetTop}px` },
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
      ],
      draw,
    ),
    listen(el, "pointerover", (e) => showTip(target(e))),
    listen(el, "pointerleave", () => showTip(null)),
    listen(el, "focusin", (e) => showTip(target(e))),
    listen(el, "focusout", () => showTip(null)),
  ];
  return () => {
    for (const off of offs) off();
    el.remove();
    tooltip.remove();
    pop.remove();
  };
}
