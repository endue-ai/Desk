/**
 * The commands of what Eris knows (ADR 0124), each an agent command (ADR 0088): desk.windows.closed
 * lists the windows closed recently, desk.windows.reopen brings one back, and desk.capabilities
 * answers the catalogue of everything the person can do. The two that only read say so.
 */
import type { AgentSpec } from "../commands";
import type { ShellCtx } from "../shell/context";
import { closedForBrain } from "./brain";
import { type CatalogueQuery, catalogue, LIMIT, query, sourceOf } from "./capabilities";
import type { ClosedLog } from "./closed";
import { ec } from "./copy";
import { reopenWindow } from "./reopen";

const CLOSED: AgentSpec = {
  description:
    "The windows the person closed recently, the last closed first (at most 20): each with its id, the plugin and title of what it showed, where it was in CSS pixels as when its desktop is in front, the desktop it was on, and when it closed. desk.windows.reopen brings one back.",
  readOnly: true,
};

const REOPEN: AgentSpec = {
  description:
    "Reopen a window the person closed: it comes back where it was, on the desktop it was on, with its size and panes, starts the plugins it showed and is the window in use. Without id, the last one closed. Use it when the person asks to bring back, undo closing or reopen a window.",
  args: {
    type: "object",
    properties: {
      id: { type: "string", description: "The window's id, as desk.windows.closed lists it." },
    },
    additionalProperties: false,
  },
};

const CAPABILITIES: AgentSpec = {
  description:
    "Everything the person can do on the desk: every command it knows (the desk's own and each plugin's) with its title, owner (desk or a plugin id), the keys that run it and whether it can run now, and the plugins that are on with how many commands each has, whether its window is open and the views it opens. Use it to answer what the person can do here, or to find the command for a request; filter by owner, a word, or availability.",
  args: {
    type: "object",
    properties: {
      owner: {
        type: "string",
        description: "Only the commands of this owner: desk, or a plugin id.",
      },
      query: { type: "string", description: "Only the commands whose id or title has this word." },
      available: {
        type: "boolean",
        description: "Only those that can (true) or cannot (false) run now.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: LIMIT.most,
        description: "At most this many commands (200).",
      },
    },
    additionalProperties: false,
  },
  readOnly: true,
};

function queryOf(args: unknown): CatalogueQuery {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  return {
    ...(typeof a.owner === "string" ? { owner: a.owner } : {}),
    ...(typeof a.query === "string" ? { query: a.query } : {}),
    ...(typeof a.available === "boolean" ? { available: a.available } : {}),
    ...(typeof a.limit === "number" ? { limit: a.limit } : {}),
  };
}

export function defineContextCommands(ctx: ShellCtx, log: ClosedLog): () => void {
  const { commands } = ctx.runtime;
  const lang = ctx.store.get().lang;
  const offs = [
    commands.define("desk.windows.closed", {
      title: ec(lang, "cmdClosed"),
      keywords: ["closed", "windows", "recent", "history", "닫은", "창"],
      owner: "desk.display",
      run: () => ({ closed: closedForBrain(ctx.store.get(), log.list()) }),
      agent: CLOSED,
    }),
    commands.define("desk.windows.reopen", {
      title: ec(lang, "cmdReopen"),
      keywords: ["reopen", "undo close", "restore", "closed", "다시 열기", "닫은 창"],
      owner: "desk.display",
      run: (args) => {
        const id = (args as { id?: unknown } | undefined)?.id;
        return reopenWindow(ctx, log, typeof id === "string" ? id : undefined);
      },
      agent: REOPEN,
    }),
    commands.define("desk.capabilities", {
      title: ec(lang, "cmdCapabilities"),
      keywords: ["capabilities", "commands", "what can I do", "help", "할 수 있는 일", "명령"],
      owner: "desk",
      run: (args) => query(catalogue(sourceOf(ctx)), queryOf(args)),
      agent: CAPABILITIES,
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
