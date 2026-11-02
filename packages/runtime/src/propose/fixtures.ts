/**
 * Scripted brain answers for tests and fixture pages (never shipped): views a brain would propose for
 * "show my events this week as a board" over the stub's fixture events, without the parts the desk
 * writes itself (id, version, provenance); the quiet night profile; Mod+Shift+T for the terminal.
 */
import type { ScriptedAnswer } from "../bridge/scripted-brain";

const agenda = (title: string, calendar: string, empty: string) => ({
  type: "agenda",
  title,
  range: "week",
  binding: {
    kinds: ["event"],
    sources: ["$calendar"],
    where: [{ field: "calendar", op: "eq", value: calendar }],
    sort: [{ field: "start", dir: "asc" }],
  },
  fields: [{ value: "{start|time} {title}" }, { value: "{location}" }],
  empty,
});

/** This week's events as a board: one column per calendar, and how many there are. */
export const BOARD = {
  title: "Events this week",
  description: "This week's events, one column per calendar.",
  requires: { calendar: { kinds: ["event"], title: "A calendar" } },
  layout: {
    type: "stack",
    children: [
      {
        type: "stat",
        title: "Coming up",
        binding: {
          kinds: ["event"],
          sources: ["$calendar"],
          where: [{ field: "start", op: "gte", value: "{today}" }],
        },
      },
      {
        type: "grid",
        columns: 2,
        children: [
          agenda("Work", "Work", "No work events this week."),
          agenda("Personal", "Personal", "Nothing personal this week."),
        ],
      },
    ],
  },
};

/** The same board after "only the work calendar". */
export const BOARD_WORK = {
  title: "Work this week",
  description: "This week's work events.",
  requires: BOARD.requires,
  layout: agenda("Work", "Work", "No work events this week."),
};

/**
 * The view a brain would propose for a prompt: only work after a correction that says so, the board
 * for a sentence about a board, and none otherwise.
 */
function viewFor(prompt: string): Record<string, unknown> | undefined {
  if (/only the work calendar/i.test(prompt)) return BOARD_WORK;
  if (/as a board/i.test(prompt)) return BOARD;
  return undefined;
}

/** The profile sentence of the tests and the live check. */
export const QUIET = "make a quiet night profile with only notes and terminal";
/** The key binding sentence. */
export const BIND = "bind Mod+Shift+T to open the terminal";
const KEPT = ["endue.notes", "endue.terminal"];

/**
 * The quiet night profile over the plugins the desk listed (`id: "Name, kind, on|off"`): notes and
 * the terminal on, every other app that is on (a ui plugin not the desk's own) off, do not disturb,
 * and the two side by side on desktop 1.
 */
export function quietNight(plugins: Record<string, string> = {}) {
  const others = Object.entries(plugins)
    .filter(([id, what]) => !id.startsWith("desk.") && !KEPT.includes(id) && /, ui, on$/.test(what))
    .map(([id]) => id);
  return {
    name: "Quiet night",
    description: "Notes and a terminal, and nothing that interrupts.",
    plugins: { enabled: KEPT, disabled: others },
    settings: {
      "desk.notify.dnd": true,
      "desk.shell.mode": {
        icon: "moon",
        desktops: {
          "1": {
            surfaces: [
              { id: "notes", plugin: "endue.notes", x: 120, y: 200, w: 520, h: 480, pinned: false },
              {
                id: "terminal",
                plugin: "endue.terminal",
                x: 680,
                y: 200,
                w: 640,
                h: 480,
                pinned: false,
              },
            ],
          },
        },
      },
    },
  };
}

/** Mod+Shift+T shows the terminal. */
export const TERMINAL_KEYS = {
  bindings: [{ key: "Mod+Shift+T", command: "endue.terminal.focus" }],
};

/** The plugins in a prompt's context (`The desk: {...}`), when it carries them. */
function pluginsIn(prompt: string): Record<string, string> {
  const line = prompt.split("\n").find((l) => l.startsWith("The desk: "));
  try {
    const desk = JSON.parse(line?.slice("The desk: ".length) ?? "{}") as { plugins?: unknown };
    return typeof desk.plugins === "object" && desk.plugins !== null
      ? (desk.plugins as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

/**
 * What a brain would call `tool` with for `prompt`: viewFor's view, the quiet night profile, or
 * Mod+Shift+T for the terminal; undefined to answer in words.
 */
export function proposalFor(prompt: string, tool: string): Record<string, unknown> | undefined {
  if (tool === "propose_view") return viewFor(prompt);
  if (tool === "propose_profile")
    return /quiet night/i.test(prompt) ? quietNight(pluginsIn(prompt)) : undefined;
  if (tool === "propose_key_bindings")
    return /Mod\+Shift\+T/.test(prompt) ? TERMINAL_KEYS : undefined;
  return undefined;
}

/**
 * A scripted brain for tests and fixture pages: it calls the tool with proposalFor's arguments, and
 * answers in words, calling nothing, when there are none.
 */
export function scriptedDesk(prompt: string, tool: { name: string }): ScriptedAnswer {
  const args = proposalFor(prompt, tool.name);
  return args ? { text: "Here it is.", structured: args } : `I heard: ${prompt.slice(0, 200)}`;
}
