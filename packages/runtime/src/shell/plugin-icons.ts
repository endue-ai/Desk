/**
 * A window's icon (ADR 0273): the one its title bar shows and the canvas map draws in it, which the
 * compositor draws itself from the path data the page reports (`view-icons.ts`). A built-in plugin's
 * surface shows the plugin's own; a plugin not named here, the box. The shell's own views keep
 * theirs: the samples', the launcher's, the agent screens' and the drawer's files'.
 */
import { ENDUE_AGENT_VIEW, ENDUE_SPACE_VIEW } from "../system/endue-ids";
import { isLocalAgent, LOCAL_VIEW } from "../system/local-ids";
import type { IconName } from "./icons";

const PLUGIN_ICONS: Record<string, IconName> = {
  "endue.agents": "brain",
  "endue.api-studio": "braces",
  "endue.archives": "archive",
  "endue.browser": "globe",
  "endue.calendar": "calendar",
  "endue.chat": "chat",
  "endue.computer": "monitor",
  "endue.data": "bars",
  "endue.database": "database",
  "endue.docker": "layers",
  "endue.docker-studio": "layers",
  "endue.docs": "file",
  "endue.eris": "sparkle",
  "endue.explorer": "folder",
  "endue.git": "branch",
  "endue.git-studio": "branch",
  "endue.images": "image",
  "desk.inspector": "eye",
  "endue.local-agents": "user",
  "endue.local-models": "brain",
  "endue.mail": "mail",
  "endue.memory": "bulb",
  "endue.network": "network",
  "endue.notes": "note",
  "endue.player": "play",
  "endue.projects": "grid",
  "endue.reader": "book",
  "endue.screens": "cast",
  "endue.sheets": "table",
  "endue.sidebar": "panel",
  "endue.slides": "slides",
  "endue.terminal": "terminal",
  "endue.toolbar": "list",
  "endue.web": "compass",
};

/** Plugin `id`'s icon: its own when it is built in, else the box. */
export function pluginIcon(id: string): IconName {
  return PLUGIN_ICONS[id] ?? "box";
}

const OWN: Record<string, IconName> = {
  calendar: "calendar",
  tomorrow: "list",
  notes: "note",
  launcher: "plus",
  keys: "settings",
};

/** The icon of `view`, as a pane resolves it (`plugin:<id>` for a plugin's surface). */
export function viewIcon(view: string): IconName {
  if (view.startsWith("plugin:")) return pluginIcon(view.slice("plugin:".length));
  const own = OWN[view];
  if (own) return own;
  if (view.startsWith(LOCAL_VIEW) && isLocalAgent(view.slice(LOCAL_VIEW.length))) return "user";
  if (view.startsWith(ENDUE_AGENT_VIEW) || view.startsWith("agent:")) return "user";
  if (view.startsWith(ENDUE_SPACE_VIEW)) return "target";
  return view.startsWith("recent:") ? "sparkle" : "file";
}
