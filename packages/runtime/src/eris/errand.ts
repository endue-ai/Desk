/**
 * Eris's errands (ADR 0089): each hand-off of her agentic loop drawn on the desk. On `tool` a spark
 * leaves her body, labelled with the plugin it goes to, and flies to that plugin's window (or, with
 * no window on screen, to a place beside her); the window glows while the plugin works. On
 * `tool-result` the spark flies back with what it got and sinks into her. With reduced motion the
 * label shows beside her and nothing moves. Everything runs on the ticker.
 */
import type { BrainStep } from "../bridge/types";
import { cubicBezier } from "../ease";
import type { ShellCtx } from "../shell/context";
import { h } from "../shell/dom";

/** One leg of an errand, out or back. */
export const LEG_MS = 640;
/** Where the spark waits beside Eris when the plugin has no window on screen. */
const BESIDE = { x: 150, y: -36 };
const legEase = cubicBezier(0.45, 0, 0.2, 1);

interface Point {
  x: number;
  y: number;
}

interface Errand {
  el: HTMLElement;
  /** What the errand is drawn on. */
  host: HTMLElement;
  /** The plugin's window glowing while it works. */
  window: HTMLElement | null;
  /** Where the spark is, in the host's coordinates. */
  at: Point;
  /** The outbound leg; the way back waits for it. */
  out: Promise<void>;
}

export interface Errands {
  step(step: BrainStep): void;
  /**
   * The turn is over: an errand whose plugin never answered comes back empty, and this resolves
   * once every spark is home.
   */
  finish(): Promise<void>;
  dispose(): void;
}

/** The centre of `el` in `host`'s coordinates. */
function centre(el: Element, host: HTMLElement): Point {
  const r = el.getBoundingClientRect();
  const f = host.getBoundingClientRect();
  return { x: r.left + r.width / 2 - f.left, y: r.top + r.height / 2 - f.top };
}

/** The plugin's window on screen: its main surface, or another of its surfaces. */
export function windowOf(host: ParentNode, provider: string): HTMLElement | null {
  const candidates = host.querySelectorAll<HTMLElement>("[data-surface]");
  for (const el of candidates) {
    const id = el.dataset.surface ?? "";
    const own = id === provider || id.startsWith(`${provider}/`) || id.startsWith(`${provider}:`);
    const shown = !el.hidden && el.getClientRects().length > 0;
    if (own && shown) return el;
  }
  return null;
}

/** The desk's commands for the agent programs on this computer (ADR 0110). */
const LOCAL_AGENTS = "desk.agents.";

/**
 * Where a step's errand goes: the plugin's window, or for the desk's local agent tools a local
 * agent's screen, else their group in the agent bar.
 */
export function targetOf(host: ParentNode, step: Pick<BrainStep, "provider" | "command">) {
  if (!step.command.startsWith(LOCAL_AGENTS)) return windowOf(host, step.provider);
  const screen = windowOf(host, "local");
  if (screen) return screen;
  const group = host.querySelector<HTMLElement>("[data-local-agents]");
  return group && group.getClientRects().length > 0 ? group : null;
}

/** Who a step goes to, as people read it: `endue.mail` is Mail, the local agent tools Agents. */
export function labelOf(step: Pick<BrainStep, "provider" | "command">): string {
  return step.command.startsWith(LOCAL_AGENTS) ? "Agents" : nameOf(step.provider);
}

/** The plugin's name as people read it: `endue.mail` is Mail, `desk` is Desk. */
export function nameOf(provider: string): string {
  const last = provider.split(".").pop() ?? provider;
  return last
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Where Eris is: her body's centre, else the top middle of the desk. */
function erisAt(host: HTMLElement): Point {
  const eris = host.querySelector(".eris-body") ?? host.querySelector(".eris");
  if (eris) return centre(eris, host);
  return { x: host.clientWidth / 2, y: 100 };
}

/** Errands drawn on the element `shell` names when each starts (the shell, once it is mounted). */
export function mountErrands(shell: () => HTMLElement, ctx: ShellCtx): Errands {
  const open = new Map<string, Errand>();
  const legs = new Set<Promise<void>>();
  const place = (errand: Errand, p: Point, scale = 1, opacity = 1) => {
    errand.at = p;
    errand.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
    errand.el.style.opacity = opacity.toFixed(3);
  };
  const fly = (errand: Errand, from: Point, to: Point, end: (t: number) => [number, number]) => {
    const leg = ctx.ticker
      .animate(ctx.reduced() ? 0 : LEG_MS, legEase, (t) => {
        const move = ctx.reduced() ? 1 : t;
        // A shallow arc, so the spark reads as thrown rather than slid.
        const lift = Math.sin(Math.PI * move) * Math.min(60, Math.abs(to.x - from.x) / 4);
        const p = { x: from.x + (to.x - from.x) * move, y: from.y + (to.y - from.y) * move - lift };
        const [scale, opacity] = end(t);
        place(errand, p, scale, opacity);
      })
      .finally(() => legs.delete(leg));
    legs.add(leg);
    return leg;
  };

  const go = (step: BrainStep) => {
    if (open.has(step.callId)) return;
    const host = shell();
    const label = h(
      "span",
      { class: "errand-label" },
      h("strong", {}, labelOf(step)),
      step.title ? h("small", {}, step.title) : null,
    );
    const el = h(
      "div",
      {
        class: "errand",
        role: "status",
        "data-provider": step.provider,
        "data-command": step.command,
        "data-leg": "out",
      },
      h("span", { class: "errand-spark", "aria-hidden": "true" }),
      label,
    );
    host.append(el);
    const from = erisAt(host);
    const window = targetOf(host, step);
    const to = ctx.reduced()
      ? { x: from.x + BESIDE.x, y: from.y + BESIDE.y }
      : window
        ? centre(window, host)
        : { x: from.x + BESIDE.x, y: from.y + BESIDE.y };
    const errand: Errand = { el, host, window, at: from, out: Promise.resolve() };
    open.set(step.callId, errand);
    place(errand, from, 0.4, 0);
    window?.classList.add("is-eris-visiting");
    ctx.eris.setState("thinking");
    errand.out = fly(errand, from, to, (t) => [0.4 + 0.6 * t, Math.min(1, t * 3)]).then(() => {
      el.dataset.leg = "there";
    });
  };

  const back = (step: BrainStep) => {
    const errand = open.get(step.callId);
    if (!errand) return;
    open.delete(step.callId);
    const leg = errand.out.then(() => {
      errand.window?.classList.remove("is-eris-visiting");
      errand.el.dataset.leg = "back";
      errand.el.dataset.ok = String(step.ok !== false);
      const home = erisAt(errand.host);
      return fly(errand, errand.at, home, (t) => [1 - 0.7 * t, 1 - t * t]).then(() => {
        errand.el.remove();
        // She has what she went for; her answer follows.
        ctx.eris.setState(step.ok === false ? "oops" : "done");
      });
    });
    legs.add(leg);
    void leg.finally(() => legs.delete(leg));
  };

  return {
    step(step) {
      if (step.kind === "tool") go(step);
      else back(step);
    },
    async finish() {
      for (const [callId, errand] of [...open]) {
        const command = errand.el.dataset.command ?? "";
        const provider = errand.el.dataset.provider ?? "";
        back({ kind: "tool-result", callId, command, provider, ok: false });
      }
      while (legs.size) await Promise.all([...legs]);
    },
    dispose() {
      for (const errand of open.values()) {
        errand.window?.classList.remove("is-eris-visiting");
        errand.el.remove();
      }
      open.clear();
    },
  };
}
