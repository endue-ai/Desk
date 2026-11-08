/**
 * desk.display: where a new surface goes (its area, grid span or edge size, and whether it takes the
 * focus), and the commands that move the focus between surfaces and bring one back.
 */
import type { SurfacePlacement } from "@endue-ai/bridge";
import { type DisplayDecision, decide } from "../display";
import type { SurfaceSpec } from "../surfaces";
import { type DeskContext, disposer, type Installed } from "./context";

export interface DisplayPolicy extends Installed {
  decide(spec: SurfaceSpec): DisplayDecision;
  /** Size an edge surface's bar as the decision says, once the surface sits on an edge. */
  sizeEdge(section: HTMLElement, decision: DisplayDecision): void;
}

/** What the runtime does for the display commands. */
export interface DisplayActions {
  focus(id: string): void;
  /** Surfaces that can take the focus now, in reading order. */
  visible(): string[];
  focused(): string | null;
}

export function installDisplay(ctx: DeskContext, actions: DisplayActions): DisplayPolicy {
  const { hub, surfaces, bridge } = ctx;
  const { commands } = hub;
  const offs = disposer();

  const cycle = (step: number) => {
    const ids = actions.visible();
    if (ids.length === 0) return null;
    const at = ids.indexOf(actions.focused() ?? "");
    const next = ids[(at + step + ids.length) % ids.length] ?? ids[0];
    if (next) actions.focus(next);
    return next ?? null;
  };
  const define = (id: string, title: string, run: (args: unknown) => unknown, keywords: string[]) =>
    offs.add(commands.define(id, { title, keywords, owner: "desk.display", run }));

  define("desk.display.focus-next", "Focus the next surface", () => cycle(1), ["other-window"]);
  define("desk.display.focus-previous", "Focus the previous surface", () => cycle(-1), ["window"]);
  define(
    "desk.display.show",
    "Show a plugin's surface",
    async (args) => {
      const plugin = (args as { plugin?: string } | undefined)?.plugin;
      if (!plugin) throw new Error("say which plugin: { plugin }");
      if (surfaces.get(plugin)) {
        surfaces.show(plugin, true);
        actions.focus(plugin);
        return "shown";
      }
      // Not running: turning it on mounts it where the rules say.
      await bridge.call("plugin.setEnabled", {
        plugin,
        enabled: true,
        scope: { permission: "plugin:manage" },
      });
      return "opening";
    },
    ["show", "open", "surface"],
  );

  return {
    decide: (spec) =>
      decide(hub.policy.display, {
        plugin: spec.id,
        surface: spec.surface ?? "main",
        placement: spec.placement as SurfacePlacement | undefined,
      }),
    sizeEdge: (section, decision) => {
      const bar = section.parentElement;
      if (decision.pixels === undefined || !bar?.classList.contains("desk-edge")) return;
      const side = decision.area === "bottom" ? "height" : "width";
      bar.style.setProperty(side, `${decision.pixels}px`);
    },
    dispose: offs.dispose,
  };
}
