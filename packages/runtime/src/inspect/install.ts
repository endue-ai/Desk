/**
 * desk.inspect.open, the runtime's side of the inspector (#334): what only the runtime knows, for
 * the desk.inspector plugin and `desk inspect`. `{ section: "tree" }` answers the render tree of
 * `#desk` (ADR 0011's serializer), `surfaces` the surfaces with their plugin, the host's views and
 * the buffer list, `settings` every setting with the layer that won. It answers the person and the
 * callers that hold perm:manage themselves, as desk.describe shows grants (ADR 0075). Without args
 * it opens the inspector (the palette's "Inspect the desk").
 */
import type { Buffers } from "../buffers";
import { type DeskContext, disposer, type Installed } from "../policies/context";
import type { HostViews } from "../views";
import { settingsSection, surfacesSection } from "./sections";
import { renderTree } from "./tree";

export interface InspectDeps {
  /** The buffer list (desk.buffers). */
  buffers: Pick<Buffers, "list">;
  /** The views a host draws (the shell's panes). */
  views?: Pick<HostViews, "ids" | "title" | "focused">;
}

const ID = "desk.inspect.open";
const INSPECTOR = "desk.inspector";
const SECTIONS = ["tree", "surfaces", "settings"] as const;
type Section = (typeof SECTIONS)[number];
const MANAGE = { permission: "perm:manage" } as const;

const isSection = (value: unknown): value is Section => SECTIONS.includes(value as Section);

export function installInspect(ctx: DeskContext, deps: InspectDeps): Installed {
  const { hub, bridge, root, surfaces, shortcuts } = ctx;
  const { commands, settings } = hub;
  const offs = disposer();

  /** The person may inspect, and a caller that holds perm:manage itself. */
  const may = async (caller: string | undefined) => {
    if (caller === undefined) return true;
    const grants = await bridge.call("perm.list", { caller, scope: MANAGE }).then(
      (listed) => listed.grants,
      () => [],
    );
    return grants.some((g) => g.grant.permission.permission === "perm:manage");
  };

  const answer = (section: Section) => {
    switch (section) {
      case "tree":
        return renderTree(root.ownerDocument.getElementById("desk") ?? root);
      case "surfaces":
        return surfacesSection({
          host: surfaces,
          focused: shortcuts.focused,
          plugins: hub.plugins,
          views: deps.views,
          buffers: deps.buffers.list(),
        });
      case "settings":
        return settingsSection({
          declared: hub.policy.settings,
          layers: {
            init: settings.layer("init"),
            profile: settings.layer("profile"),
            session: settings.layer("session"),
          },
        });
    }
  };

  offs.add(
    commands.define(ID, {
      title: "Inspect the desk",
      keywords: ["inspector", "inspect", "devtools", "render tree", "debug"],
      owner: "desk",
      run: async (args, from) => {
        const section = (args as { section?: unknown } | undefined)?.section;
        if (section === undefined) {
          if (!commands.has("desk.plugins.open"))
            throw new Error("No inspector to open: this desk mounts no plugins");
          await commands.run("desk.plugins.open", { plugin: INSPECTOR });
          return;
        }
        if (!isSection(section))
          throw new Error("Name a section the runtime answers: tree, surfaces or settings");
        if (!(await may(from.caller)))
          throw new Error(`${from.caller} may not inspect the desk: it holds no perm:manage grant`);
        return answer(section);
      },
    }),
  );

  return { dispose: offs.dispose };
}
