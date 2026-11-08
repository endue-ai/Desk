/**
 * Scripted brain answers for tests and fixture pages (never shipped): universal views as brain-echo
 * proposes them (examples/brain-echo/universal.mjs); the quiet night profile; Mod+Shift+T for the
 * terminal.
 */
import { proposeUniversalView } from "../../../../examples/brain-echo/universal.mjs";
import type { ScriptedAnswer } from "../bridge/scripted-brain";

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
 * What a brain would call `tool` with for `prompt`: brain-echo's universal view, the quiet night
 * profile, or Mod+Shift+T for the terminal; undefined to answer in words.
 */
export function proposalFor(prompt: string, tool: string): Record<string, unknown> | undefined {
  if (tool === "propose_universal_view") return proposeUniversalView(prompt);
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
