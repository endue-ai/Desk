/** A new surface's first pane: pick what to show in it. */

import type { ShellCtx } from "../../shell/context";
import { h } from "../../shell/dom";
import { icon } from "../../shell/icons";
import { showInPane } from "../../shell/windows";
import { spaceAgents } from "../../system/agents";
import type { Mounted, Where } from "../views";

export function launcherBody(ctx: ShellCtx, where: Where): Mounted {
  const s = ctx.store.get();
  const choices: [string, string, string][] = [
    ["calendar", "calendar", ctx.tr("surfaceCalendar")],
    ["tomorrow", "list", ctx.tr("surfaceTomorrow")],
    ["notes", "note", ctx.tr("surfaceNotes")],
    ["keys", "settings", ctx.tr("keysTitle")],
    ...spaceAgents(s).map((a): [string, string, string] => [
      `agent:${a.id}`,
      "user",
      ctx.tr("agentScreen", { name: a.name }),
    ]),
  ];
  const el = h(
    "div",
    { class: "launcher" },
    h("p", { class: "launcher-hint" }, ctx.tr("launcherHint")),
    h(
      "div",
      { class: "launcher-grid", role: "list" },
      choices.map(([view, glyph, label]) =>
        h(
          "button",
          {
            class: "launcher-item",
            type: "button",
            role: "listitem",
            "data-view": view,
            onClick: () => showInPane(ctx, where.surface, where.pane, view),
          },
          icon(glyph, 16),
          h("span", {}, label),
        ),
      ),
    ),
  );
  return { el };
}
