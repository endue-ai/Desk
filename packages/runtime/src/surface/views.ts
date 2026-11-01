/**
 * Views: what a pane can show. Each has a title for the title bar and a body that may keep itself
 * up to date (the agent screen follows its A2A card and tasks; the shortcut list follows the keymap).
 */
import type { SurfacePlacement } from "../modes/types";
import type { ShellCtx } from "../shell/context";
import { h } from "../shell/dom";
import type { DeskState } from "../shell/state";
import { agentBody } from "./samples/agent";
import { calendarBody } from "./samples/calendar";
import { keysBody } from "./samples/keys";
import { launcherBody } from "./samples/launcher";
import { notesBody } from "./samples/notes";
import { tomorrowBody } from "./samples/tomorrow";

/** Where a view is shown: its surface and pane. */
export interface Where {
  surface: string;
  pane: string;
}

export interface Mounted {
  el: HTMLElement;
  off?: () => void;
}

export interface View {
  icon: string;
  title: string;
  sub: string;
  byEris: boolean;
  mount(where: Where): Mounted;
}

const still = (el: HTMLElement): Mounted => ({ el });

/**
 * The view a pane shows. A pane named after its surface whose plugin the runtime handed over shows
 * that plugin's surface, so a profile that places `endue.calendar` gets the plugin, not a sample.
 */
export function resolveView(
  s: DeskState,
  p: Pick<SurfacePlacement, "id" | "plugin">,
  view: string,
): string {
  if (view === p.id && s.adopted.some((a) => a.id === p.plugin)) return `plugin:${p.plugin}`;
  return view;
}

export function viewOf(ctx: ShellCtx, view: string): View {
  const s = ctx.store.get();
  if (view.startsWith("plugin:")) {
    const id = view.slice("plugin:".length);
    const adopted = s.adopted.find((a) => a.id === id);
    const name = adopted?.title ?? id;
    return {
      icon: "box",
      title: name,
      sub: "",
      byEris: false,
      mount: () =>
        still(
          ctx.windows.has(id)
            ? ctx.windows.body(id)
            : h("p", { class: "plugin-off" }, ctx.tr("pluginOff", { name })),
        ),
    };
  }
  switch (view) {
    case "calendar":
      return {
        icon: "calendar",
        title: ctx.tr("surfaceCalendar"),
        sub: ctx.tr("thisWeek"),
        byEris: false,
        mount: () => still(calendarBody(ctx)),
      };
    case "tomorrow":
      return {
        icon: "list",
        title: ctx.tr("surfaceTomorrow"),
        sub: ctx.tr("forTomorrow"),
        byEris: true,
        mount: () => still(tomorrowBody(ctx)),
      };
    case "notes":
      return {
        icon: "note",
        title: ctx.tr("surfaceNotes"),
        sub: ctx.tr("notesHint"),
        byEris: false,
        mount: () => still(notesBody(ctx)),
      };
    case "launcher":
      return {
        icon: "plus",
        title: ctx.tr("launcherTitle"),
        sub: ctx.tr("launcherHint"),
        byEris: false,
        mount: (where) => launcherBody(ctx, where),
      };
    case "keys":
      return {
        icon: "settings",
        title: ctx.tr("keysTitle"),
        sub: ctx.tr("keysHint"),
        byEris: false,
        mount: () => keysBody(ctx),
      };
  }
  if (view.startsWith("agent:")) {
    const id = view.slice(6);
    const name = s.agents.find((a) => a.id === id)?.name ?? id;
    const goal = s.tasks.find((t) => t.targetAgentId === id && t.status === "working")?.goal ?? "";
    return {
      icon: "user",
      title: ctx.tr("agentScreen", { name }),
      sub: goal,
      byEris: false,
      mount: () => agentBody(ctx, id),
    };
  }
  const name = view.replace(/^(file|recent):/, "");
  const item = s.drawer.find((d) => d.id === name);
  return {
    icon: view.startsWith("recent:") ? "sparkle" : "file",
    title: item?.name ?? name.replace(/^recent-/, ""),
    sub: view.startsWith("recent:") ? ctx.tr("recent") : ctx.tr("file"),
    byEris: view.startsWith("recent:"),
    mount: () => still(h("div", { class: "list-body" }, h("p", { class: "list-row" }, name))),
  };
}
