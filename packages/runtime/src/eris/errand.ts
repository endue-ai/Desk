/**
 * Eris's errands (ADR 0089, ADR 0271): each hand-off of her agentic loop drawn on the desk. On
 * `tool` a spark leaves her body, labelled with the plugin it goes to, and flies along a thread to
 * every window that shows that plugin (or, with no window on screen, to a place beside her); those
 * windows glow in the star's colour while the plugin works (`visiting.ts`). On `tool-result` the
 * sparks fly back along their threads with what they got and sink into her. As a line comes in
 * with the desk she looks at the window in use (`look`): it glows softly until she has answered,
 * and a bare spark goes there and back. A command of the desk's own that names a window (its
 * `window`, or the one its answer names) uses that window: it glows and the spark flies on to it.
 * With reduced motion the label shows beside her, the windows light up and nothing moves.
 * Everything runs on the ticker.
 */
import type { BrainDesk } from "@endue-ai/bridge";
import type { BrainStep } from "../bridge/types";
import { cubicBezier } from "../ease";
import { windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { h } from "../shell/dom";
import {
  centre,
  erisAt,
  labelOf,
  seenIn,
  type Target,
  targetsOf,
  windowCentre,
} from "./errand-targets";
import { arc, type Point, threadOf } from "./errand-thread";
import { LOOK, USE, VISITING, visitingOf } from "./visiting";

export { centre, labelOf, nameOf, targetOf, windowOf } from "./errand-targets";

/** One leg of an errand, out or back. */
export const LEG_MS = 640;
/** Where the spark waits beside Eris when the plugin has no window on screen. */
const BESIDE = { x: 150, y: -36 };
const legEase = cubicBezier(0.45, 0, 0.2, 1);
/** A spark that carries nothing: she only looks. */
const LOOKING = "errand--look";
/** Who runs a command of the desk's as Eris's tool call (`system/local-agent-commands.ts`). */
const ERIS = "agent:eris";

/** One spark of an errand, on its way to one place and back. */
interface Spark {
  el: HTMLElement;
  /** What the spark is drawn on. */
  host: HTMLElement;
  /** The thread it runs along now. */
  thread: SVGSVGElement | null;
  /** Where the spark is, in the host's coordinates. */
  at: Point;
  /** The outbound leg; the way back waits for it. */
  out: Promise<void>;
  /** Its flights so far: one sent somewhere else stops where it was going before. */
  flight: number;
  /** A look's own stay at its window, which ends with the spark. */
  leave?: () => void;
}

interface Errand {
  command: string;
  provider: string;
  sparks: Spark[];
  /** The windows it lights, and what puts each out again. */
  windows: Set<string>;
  leaves: Array<() => void>;
}

export interface Errands {
  step(step: BrainStep): void;
  /** A line comes in with `desk`: she looks at the window in use until the turn is over. */
  look(desk: BrainDesk): void;
  /**
   * The turn is over: an errand whose plugin never answered comes back empty, and this resolves
   * once every errand's spark is home; what she looked at goes dark once its own spark is back.
   */
  finish(): Promise<void>;
  dispose(): void;
}

/** Errands drawn on the element `shell` names when each starts (the shell, once it is mounted). */
export function mountErrands(shell: () => HTMLElement, ctx: ShellCtx): Errands {
  const open = new Map<string, Errand>();
  const legs = new Set<Promise<void>>();
  /** What she looks at this turn, and the sparks of her looks still on their way. */
  const looks: Array<() => void> = [];
  const glances = new Set<Spark>();
  const visiting = visitingOf(ctx);
  const place = (spark: Spark, p: Point, scale = 1, opacity = 1) => {
    spark.at = p;
    spark.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
    spark.el.style.opacity = opacity.toFixed(3);
  };
  /** The leg a spark is on, which its thread shows too. */
  const leg = (spark: Spark, name: "out" | "there" | "back") => {
    spark.el.dataset.leg = name;
    if (spark.thread) spark.thread.dataset.leg = name;
  };
  /** Lay the thread from `from` to `to` under the spark; with reduced motion there is none. */
  const lay = (spark: Spark, from: Point, to: Point) => {
    spark.thread?.remove();
    spark.thread = null;
    // A spark dropped meanwhile (the desk went) has nothing to run along.
    if (ctx.reduced() || spark.el.parentNode !== spark.host) return;
    spark.thread = threadOf(spark.host.ownerDocument, from, to);
    spark.thread.classList.toggle("errand-thread--look", spark.el.classList.contains(LOOKING));
    spark.thread.dataset.leg = spark.el.dataset.leg ?? "out";
    spark.host.insertBefore(spark.thread, spark.el);
  };
  const fly = (spark: Spark, to: Point, end: (t: number) => [number, number]) => {
    const flight = ++spark.flight;
    const from = spark.at;
    lay(spark, from, to);
    return ctx.ticker.animate(ctx.reduced() ? 0 : LEG_MS, legEase, (t) => {
      if (spark.flight !== flight) return;
      const [scale, opacity] = end(t);
      place(spark, arc(from, to, ctx.reduced() ? 1 : t), scale, opacity);
    });
  };
  /** The spark's way out to `to`: there once this flight, and no later one, has landed. */
  const out = (spark: Spark, to: Point, end: (t: number) => [number, number]) => {
    const flown = fly(spark, to, end);
    const flight = spark.flight;
    spark.out = flown.then(() => {
      if (spark.flight === flight) leg(spark, "there");
    });
  };
  /** A spark leaving her for `to`: it carries `label`, or nothing when she only looks. */
  const send = (
    host: HTMLElement,
    to: Point,
    label: HTMLElement | null,
    data: Record<string, string>,
  ): Spark => {
    const el = h(
      "div",
      { class: label ? "errand" : `errand ${LOOKING}`, "data-leg": "out", ...data },
      h("span", { class: "errand-spark", "aria-hidden": "true" }),
      label,
    );
    if (label) el.setAttribute("role", "status");
    else el.setAttribute("aria-hidden", "true");
    host.append(el);
    const at = erisAt(host);
    const spark: Spark = { el, host, thread: null, at, out: Promise.resolve(), flight: 0 };
    place(spark, spark.at, 0.4, 0);
    out(spark, to, (t) => [0.4 + 0.6 * t, Math.min(1, t * 3)]);
    return spark;
  };
  /** The spark flies home and is gone. */
  const home = (spark: Spark, ok: boolean) => {
    leg(spark, "back");
    spark.el.dataset.ok = String(ok);
    return fly(spark, erisAt(spark.host), (t) => [1 - 0.7 * t, 1 - t * t]).then(() => drop(spark));
  };
  const drop = (spark: Spark) => {
    spark.thread?.remove();
    spark.el.remove();
    spark.leave?.();
    glances.delete(spark);
  };
  /** Light what an errand goes to: its window's frame, or the element itself outside a window. */
  const light = ({ el, window }: Target) => {
    if (window) return visiting.enter(window, USE);
    el.classList.add(VISITING);
    return () => el.classList.remove(VISITING);
  };
  /** She leaves the windows an errand went to: their glow goes. */
  const leave = (errand: Errand) => {
    for (const off of errand.leaves.splice(0)) off();
  };
  /**
   * A command of the desk's that `errand` runs names window `id`: it glows as one she uses, and
   * the errand's spark, which had no window to go to, flies on to its middle.
   */
  const reach = (errand: Errand, id: unknown) => {
    if (typeof id !== "string" || errand.windows.has(id)) return;
    if (!windowsOf(ctx.store.get()).some((w) => w.id === id)) return;
    const first = errand.windows.size === 0;
    errand.windows.add(id);
    errand.leaves.push(visiting.enter(id, USE));
    const [spark] = errand.sparks;
    const to = first && spark && !ctx.reduced() ? windowCentre(spark.host, id, ctx) : undefined;
    if (spark && to) out(spark, to, () => [1, 1]);
  };
  // What the core asks the desk to run for her: the window it names is the one she uses.
  const offRuns = ctx.runtime?.commands?.watchRuns?.(({ id, args, caller }) => {
    const errand = caller === ERIS && [...open.values()].reverse().find((e) => e.command === id);
    if (!errand) return undefined;
    const named = (said: unknown) => (said as { window?: unknown } | null | undefined)?.window;
    reach(errand, named(args));
    return (result) => reach(errand, named(result));
  });

  const go = (step: BrainStep) => {
    if (open.has(step.callId)) return;
    const host = shell();
    const from = erisAt(host);
    const targets = targetsOf(host, step, ctx);
    const leaves = targets.map(light);
    const windows = new Set(targets.flatMap((t) => (t.window ? [t.window] : [])));
    const beside = { x: from.x + BESIDE.x, y: from.y + BESIDE.y };
    const still = ctx.reduced() || targets.length === 0;
    // To the window's middle where it is drawn: a place kept in the desk's page is not there.
    const middle = ({ el, window }: Target) =>
      (window ? windowCentre(host, window, ctx) : undefined) ?? centre(el, host, ctx.pages);
    const ends = still ? [beside] : targets.map(middle);
    const sparks = ends.map((to) => {
      const label = h(
        "span",
        { class: "errand-label" },
        h("strong", {}, labelOf(step)),
        step.title ? h("small", {}, step.title) : null,
      );
      const data = { "data-provider": step.provider, "data-command": step.command };
      return send(host, to, label, data);
    });
    const { command, provider } = step;
    open.set(step.callId, { command, provider, sparks, windows, leaves });
    ctx.eris.setState("thinking");
  };

  const back = (step: BrainStep) => {
    const errand = open.get(step.callId);
    if (!errand) return;
    open.delete(step.callId);
    const ok = step.ok !== false;
    const way = Promise.all(errand.sparks.map((spark) => spark.out))
      .then(() => {
        leave(errand);
        return Promise.all(errand.sparks.map((spark) => home(spark, ok)));
      })
      // She has what she went for; her answer follows.
      .then(() => ctx.eris.setState(ok ? "done" : "oops"));
    legs.add(way);
    void way.finally(() => legs.delete(way));
  };

  return {
    step(step) {
      if (step.kind === "tool") go(step);
      else back(step);
    },
    look(desk) {
      const host = shell();
      for (const id of seenIn(desk)) {
        looks.push(visiting.enter(id, LOOK));
        const to = ctx.reduced() ? undefined : windowCentre(host, id, ctx);
        if (!to) continue;
        const spark = send(host, to, null, { "data-window": id });
        // The window stays lit at least until the spark is back, however soon she answers.
        spark.leave = visiting.enter(id, LOOK);
        glances.add(spark);
        // There and straight back: the turn never waits for a look.
        void spark.out.then(() => (glances.has(spark) ? home(spark, true) : undefined));
      }
    },
    async finish() {
      for (const [callId, { command, provider }] of [...open]) {
        back({ kind: "tool-result", callId, command, provider, ok: false });
      }
      while (legs.size) await Promise.all([...legs]);
      for (const leave of looks.splice(0)) leave();
    },
    dispose() {
      offRuns?.();
      for (const errand of open.values()) {
        leave(errand);
        errand.sparks.forEach(drop);
      }
      open.clear();
      for (const spark of [...glances]) drop(spark);
      for (const leave of looks.splice(0)) leave();
    },
  };
}
