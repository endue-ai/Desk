/**
 * Eris's errands (ADR 0089, ADR 0271, ADR 0275): each hand-off of her agentic loop drawn on the
 * desk, so the person sees how she works a line. The talk line's line flies into her (`ask`): she
 * takes it in and reads it, her ring turning (`mind.ts`), and only then do her errands leave. On
 * `tool` a spark in her gold leaves her body, labelled with the plugin it goes to, and flies along
 * a thread to every window that shows that plugin (or, with no window on screen, to a place beside
 * her); each window glows in the star's colour from the moment its spark lands until the plugin
 * has answered (`visiting.ts`), her ring dim meanwhile. On `tool-result` the answer flies back
 * along the thread in the star's colour and she takes it in and reads it. A command of the desk's
 * own that names a window (its `window`, or the one its answer names) uses that window: the spark
 * flies on to it and it glows. A line that runs nothing lights no window. With reduced motion the
 * label shows beside her, the windows light up at once and nothing moves. All on the ticker.
 */
import type { BrainStep } from "../bridge/types";
import { cubicBezier } from "../ease";
import { windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { h } from "../shell/dom";
import { cloudTurns } from "./cloud-turns";
import { centre, erisAt, labelOf, type Target, targetsOf, windowCentre } from "./errand-targets";
import { arc, type Point, threadOf } from "./errand-thread";
import { setMind, takeIn } from "./mind";
import { USE, VISITING, visitingOf } from "./visiting";

export { centre, labelOf, nameOf, targetOf, windowOf } from "./errand-targets";

/** One leg of an errand, out or back. */
export const LEG_MS = 640;
/** How long she reads a line once it is in her before her first errand for it leaves. */
export const READ_MS = 480;
/** How long a spark stays at its window, lit, however soon the plugin answers. */
export const DWELL_MS = 520;
/** Where the spark waits beside Eris when the plugin has no window on screen. */
const BESIDE = { x: 150, y: -36 };
const legEase = cubicBezier(0.45, 0, 0.2, 1);
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
  /** Until it is home: away from her. */
  away: boolean;
}

interface Errand {
  command: string;
  provider: string;
  sparks: Spark[];
  /** The windows it lights, and what puts each out again. */
  windows: Set<string>;
  leaves: Array<() => void>;
  /** Its sparks are on their way: once the line is in her and read. */
  drawn: Promise<void>;
  /** The plugin answered and she left its windows: nothing lights for it any more. */
  left: boolean;
}

export interface Errands {
  /** Send one conversation turn through the selected brain, showing a signal for cloud turns. */
  say: ShellCtx["bridge"]["brain"]["say"];
  /**
   * A line is on its way into her, there once `arrived` resolves: she takes it in and reads it, and
   * her errands for it wait until she has.
   */
  ask(arrived: Promise<void>): void;
  step(step: BrainStep): void;
  /**
   * The turn is over: an errand whose plugin never answered comes back empty, and this resolves
   * once the line is in her and every errand's spark is home; her ring goes.
   */
  finish(): Promise<void>;
  dispose(): void;
}

/** Errands drawn on the element `shell` names when each starts (the shell, once it is mounted). */
export function mountErrands(shell: () => HTMLElement, ctx: ShellCtx): Errands {
  const cloud = cloudTurns(shell, ctx);
  const open = new Map<string, Errand>();
  /** Every errand not over yet: open, or on its way back. */
  const live = new Set<Errand>();
  /** Every spark not home yet, also those of errands on their way back. */
  const sparks = new Set<Spark>();
  const legs = new Set<Promise<void>>();
  const visiting = visitingOf(ctx);
  /** Until the line is in her and read; her errands wait for it. */
  let ready: Promise<void> = Promise.resolve();
  /** Whether she is at a line the talk line gave her, and how many of her sparks are out. */
  let reading = false;
  let away = 0;
  let gone = false;
  const mind = () => setMind(shell(), away > 0 ? "waiting" : reading ? "reading" : null);
  const wait = (ms: number) =>
    ctx.ticker.animate(
      ctx.reduced() ? 0 : ms,
      (t) => t,
      () => {},
    );
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
  /**
   * The spark's way out to `to`: there once this flight, and no later one, has landed. What it
   * carries lands (`landed`) when the flight is over, even if a later one took the spark on; the
   * way back waits `DWELL_MS` more, so a window a fast plugin answers for is still seen lit.
   */
  const out = (
    spark: Spark,
    to: Point,
    end: (t: number) => [number, number],
    landed?: () => void,
  ) => {
    const flown = fly(spark, to, end);
    const flight = spark.flight;
    spark.out = flown.then(() => {
      landed?.();
      if (spark.flight === flight) leg(spark, "there");
      return wait(DWELL_MS);
    });
  };
  /** A spark carrying `label` leaves her for `to`; `landed` runs as it gets there. */
  const send = (
    host: HTMLElement,
    to: Point,
    label: HTMLElement,
    data: Record<string, string>,
    landed?: () => void,
  ): Spark => {
    const el = h(
      "div",
      { class: "errand", role: "status", "data-leg": "out", ...data },
      h("span", { class: "errand-spark", "aria-hidden": "true" }),
      label,
    );
    host.append(el);
    const at = erisAt(host);
    const spark: Spark = {
      el,
      host,
      thread: null,
      at,
      out: Promise.resolve(),
      flight: 0,
      away: true,
    };
    away += 1;
    sparks.add(spark);
    place(spark, spark.at, 0.4, 0);
    out(spark, to, (t) => [0.4 + 0.6 * t, Math.min(1, t * 3)], landed);
    void takeIn(host, ctx, "out");
    return spark;
  };
  /**
   * The answer flies home in the spark, whole for most of the way so it is seen going back, and
   * sinks into her as she takes it in.
   */
  const home = (spark: Spark, ok: boolean) => {
    leg(spark, "back");
    spark.el.dataset.ok = String(ok);
    const sink = (t: number): [number, number] => [1 - 0.6 * t ** 3, 1 - t ** 6];
    return fly(spark, erisAt(spark.host), sink).then(() => {
      drop(spark);
      if (!gone) void takeIn(spark.host, ctx);
    });
  };
  const drop = (spark: Spark) => {
    spark.thread?.remove();
    spark.el.remove();
    sparks.delete(spark);
    if (!spark.away) return;
    spark.away = false;
    away -= 1;
    if (!gone) mind();
  };
  /** Light window `id` as one `errand` uses, unless its plugin has answered already. */
  const glow = (errand: Errand, id: string) => {
    if (!errand.left && !gone) errand.leaves.push(visiting.enter(id, USE));
  };
  /** Light what an errand goes to: its window's frame, or the element itself outside a window. */
  const light = (errand: Errand, { el, window }: Target) => {
    if (window) return glow(errand, window);
    if (!el || errand.left || gone) return;
    el.classList.add(VISITING);
    errand.leaves.push(() => el.classList.remove(VISITING));
  };
  /** She leaves the windows an errand went to: their glow goes. */
  const leave = (errand: Errand) => {
    errand.left = true;
    for (const off of errand.leaves.splice(0)) off();
  };
  /**
   * A command of the desk's that `errand` runs names window `id`: it glows as one she uses, once
   * the errand's spark, which had no window to go to, has flown on to its middle.
   */
  const reach = (errand: Errand, id: unknown) => {
    if (typeof id !== "string" || errand.left || errand.windows.has(id)) return;
    if (!windowsOf(ctx.store.get()).some((w) => w.id === id)) return;
    const first = errand.windows.size === 0;
    errand.windows.add(id);
    const [spark] = errand.sparks;
    const to = first && spark && !ctx.reduced() ? windowCentre(spark.host, id, ctx) : undefined;
    if (spark && to)
      out(
        spark,
        to,
        () => [1, 1],
        () => glow(errand, id),
      );
    else glow(errand, id);
  };
  // What the core asks the desk to run for her: the window it names is the one she uses.
  const offRuns = ctx.runtime?.commands?.watchRuns?.(({ id, args, caller }) => {
    const errand = caller === ERIS && [...open.values()].reverse().find((e) => e.command === id);
    if (!errand) return undefined;
    const named = (said: unknown) => (said as { window?: unknown } | null | undefined)?.window;
    void errand.drawn.then(() => reach(errand, named(args)));
    return (result) => void errand.drawn.then(() => reach(errand, named(result)));
  });

  /** Send `errand`'s sparks for `step`, now that she has read the line. */
  const draw = (errand: Errand, step: BrainStep) => {
    if (gone || errand.left) return;
    const host = shell();
    const from = erisAt(host);
    const targets = targetsOf(host, step, ctx);
    for (const t of targets) if (t.window) errand.windows.add(t.window);
    const beside = { x: from.x + BESIDE.x, y: from.y + BESIDE.y };
    const still = ctx.reduced() || targets.length === 0;
    if (still) for (const t of targets) light(errand, t);
    // To the window's middle where it is drawn: a place kept in the desk's page is not there.
    const middle = ({ el, window }: Target) =>
      (window ? windowCentre(host, window, ctx) : undefined) ??
      (el ? centre(el, host, ctx.pages) : undefined);
    const flights = still
      ? []
      : targets.flatMap((target) => {
          const to = middle(target);
          if (to) return [{ to, target }];
          // Nowhere on screen to fly to: lit at once.
          light(errand, target);
          return [];
        });
    const ends: Array<{ to: Point; target?: Target }> = flights.length ? flights : [{ to: beside }];
    errand.sparks = ends.map(({ to, target }) => {
      const label = h(
        "span",
        { class: "errand-label" },
        h("strong", {}, labelOf(step)),
        step.title ? h("small", {}, step.title) : null,
      );
      const data = { "data-provider": step.provider, "data-command": step.command };
      return send(host, to, label, data, target && (() => light(errand, target)));
    });
    mind();
  };

  const go = (step: BrainStep) => {
    if (open.has(step.callId)) return;
    const { command, provider } = step;
    const errand: Errand = {
      command,
      provider,
      sparks: [],
      windows: new Set(),
      leaves: [],
      drawn: Promise.resolve(),
      left: false,
    };
    open.set(step.callId, errand);
    live.add(errand);
    errand.drawn = ready.then(() => draw(errand, step));
    ctx.eris.setState("thinking");
  };

  const back = (step: BrainStep) => {
    const errand = open.get(step.callId);
    if (!errand) return;
    open.delete(step.callId);
    const ok = step.ok !== false;
    const way = errand.drawn
      .then(() => Promise.all(errand.sparks.map((spark) => spark.out)))
      .then(() => {
        leave(errand);
        return Promise.all(errand.sparks.map((spark) => home(spark, ok)));
      })
      // She has the answer and reads it; one that failed she shows.
      .then(() => ctx.eris.setState(ok ? "thinking" : "oops"));
    legs.add(way);
    void way.finally(() => {
      legs.delete(way);
      live.delete(errand);
    });
  };

  return {
    say: cloud.say,
    ask(arrived) {
      reading = false;
      ready = arrived.then(async () => {
        if (gone) return;
        reading = true;
        mind();
        void takeIn(shell(), ctx);
        await wait(READ_MS);
      });
    },
    step(step) {
      if (step.kind === "tool") go(step);
      else back(step);
    },
    async finish() {
      await ready;
      for (const [callId, { command, provider }] of [...open]) {
        back({ kind: "tool-result", callId, command, provider, ok: false });
      }
      while (legs.size) await Promise.all([...legs]);
      reading = false;
      if (!gone) mind();
    },
    dispose() {
      gone = true;
      cloud.dispose();
      offRuns?.();
      for (const errand of live) leave(errand);
      live.clear();
      open.clear();
      for (const spark of [...sparks]) drop(spark);
      setMind(shell(), null);
    },
  };
}
