/**
 * desk.customize.* (ADR 0398): the person's changes to any plugin's page, for the palette, people
 * and agents alike. A style is reversible and one step on the undo stack; a script runs inside the
 * plugin's page with the plugin's own permissions, so an agent's script waits for the person's
 * approval (irreversible, ADR 0078) and undo never brings one back.
 */
import type { AgentSpec, Commands } from "../commands";
import { CommandError } from "../commands";
import { bytes, type Custom, type CustomChange, isPluginId, MAX_BYTES } from "./customize-store";

/** What the commands need of the policy: the set in force, the installed pages, and publishing. */
export interface CustomizeHost {
  owner(): string;
  entries(): Map<string, Custom>;
  get(plugin: string): Custom | undefined;
  /** Change, keep and send one plugin's entry; rejects when the store could not keep it. */
  put(plugin: string, change: CustomChange): Promise<Custom | undefined>;
  /** The installed plugin with a page, by id: its entry page, or undefined when there is none. */
  page(plugin: string): Promise<{ entry: string } | undefined>;
  /** The live page's elements, when the plugin is open and answers in time. */
  outline(plugin: string): Promise<string | undefined>;
  enabled(): boolean;
}

const UNDO = "desk.customize.restore-style";
/** A broken script here would take away the way back to every other command. */
const NO_SCRIPT = new Set(["desk.palette"]);
const PLUGIN = { type: "string", description: "The plugin's id, e.g. endue.notes." };
const NOTE = { type: "string", description: "In the person's words, what the change is for." };
const ENTRY = {
  type: "object",
  properties: {
    plugin: PLUGIN,
    css: { type: "string" },
    js: { type: "string" },
    note: { type: "string" },
    updated: { type: "string" },
  },
  required: ["plugin"],
};
const STYLE_RESULT = {
  type: "object",
  description: "The plugin, and its style before the change: undo puts it back.",
  properties: { plugin: PLUGIN, before: { type: "string" } },
  required: ["plugin"],
};

const field = (args: unknown, name: string) =>
  (args as Record<string, unknown> | undefined)?.[name];
const fail = (message: string) => new CommandError("failed", message);

function code(args: unknown, name: "css" | "js"): string {
  const value = field(args, name);
  if (typeof value !== "string") throw fail(`${name} must be a string (empty removes it)`);
  if (bytes(value) > MAX_BYTES) throw fail(`${name} is over ${MAX_BYTES / 1024} KB`);
  return value;
}

function note(args: unknown): string | undefined {
  const value = field(args, "note");
  return typeof value === "string" ? value : undefined;
}

export function customizeCommands(commands: Commands, host: CustomizeHost): () => void {
  const plugin = async (args: unknown): Promise<string> => {
    const id = field(args, "plugin");
    if (!isPluginId(id)) throw fail("Name the plugin by its id, e.g. endue.notes");
    if (!(await host.page(id))) throw fail(`${id} is not an installed plugin with a page`);
    return id;
  };
  const shown = (id: string, entry: Custom | undefined) => ({ plugin: id, ...entry });
  const define = (
    id: string,
    title: string,
    run: (args: unknown) => unknown,
    agent: AgentSpec,
    more: { undo?: string; irreversible?: boolean } = {},
  ) =>
    commands.define(id, {
      title,
      keywords: ["customize", "custom", "css", "style", "look", "page", "사용자 정의"],
      owner: "desk.customize",
      run,
      agent,
      ...more,
    });
  const offs = [
    define(
      "desk.customize.list",
      "List customized plugins",
      () => ({
        account: host.owner() === "local" ? "this computer" : "endue account",
        enabled: host.enabled(),
        plugins: [...host.entries()].map(([id, entry]) => ({
          plugin: id,
          style: entry.css !== undefined,
          script: entry.js !== undefined,
          ...(entry.note ? { note: entry.note } : {}),
          updated: entry.updated,
        })),
      }),
      {
        description:
          "Which plugins' pages the person changed, under the endue account signed in (or this computer while nobody is): whether each has a style, a script, the person's note and when it changed. The changes come back at every start and sign-in.",
        result: { type: "object" },
        readOnly: true,
      },
    ),
    define(
      "desk.customize.get",
      "Show a plugin's customization",
      async (args) => {
        const id = await plugin(args);
        const [page, outline] = await Promise.all([host.page(id), host.outline(id)]);
        return { ...shown(id, host.get(id)), page: page?.entry, ...(outline ? { outline } : {}) };
      },
      {
        description:
          "One plugin's style and script as they are now, the path of its entry page in the plugin's folder, and, while the plugin is open, `outline`: its page's elements as tag#id.class [role] lines, indented by depth (no text). Read it before writing a style so the selectors match. Pages draw with the theme's --desk-* custom properties: prefer them to literal colours.",
        args: { type: "object", properties: { plugin: PLUGIN }, required: ["plugin"] },
        result: ENTRY,
        readOnly: true,
      },
    ),
    define(
      "desk.customize.style",
      "Change a plugin's style",
      async (args) => {
        const id = await plugin(args);
        const before = host.get(id)?.css;
        await host.put(id, { css: code(args, "css"), note: note(args) });
        return { plugin: id, ...(before ? { before } : {}) };
      },
      {
        description:
          "Replace the person's CSS for one plugin's page: it layers after the page's own sheets in every window of the plugin at once, and is kept for the endue account signed in, so it comes back at every start and sign-in. Send the whole style each time (it replaces the last one; empty removes it). One undoable step.",
        args: {
          type: "object",
          properties: { plugin: PLUGIN, css: { type: "string" }, note: NOTE },
          required: ["plugin", "css"],
        },
        result: STYLE_RESULT,
      },
      { undo: UNDO },
    ),
    define(
      "desk.customize.script",
      "Change a plugin's script",
      async (args) => {
        const id = await plugin(args);
        if (NO_SCRIPT.has(id)) throw fail(`${id} takes no script: it is the way back to the rest`);
        const entry = await host.put(id, { js: code(args, "js"), note: note(args) });
        return shown(id, entry);
      },
      {
        description:
          "Replace the person's JavaScript for one plugin's page. It runs once per page load after the plugin mounted, inside the plugin's page with that plugin's permissions; open windows of the plugin reload for it. Kept for the endue account signed in. Waits for the person's approval. Empty removes it. Prefer desk.customize.style when CSS can do it.",
        args: {
          type: "object",
          properties: { plugin: PLUGIN, js: { type: "string" }, note: NOTE },
          required: ["plugin", "js"],
        },
        result: ENTRY,
        irreversible: true,
      },
      { irreversible: true },
    ),
    define(
      "desk.customize.clear",
      "Reset a plugin's page",
      async (args) => {
        const id = await plugin(args);
        const before = host.get(id)?.css;
        await host.put(id, { css: null, js: null, note: null });
        return { plugin: id, ...(before ? { before } : {}) };
      },
      {
        description:
          "Remove the person's style and script from one plugin's page: it looks as the plugin draws it. Undo brings the style back, never the script.",
        args: { type: "object", properties: { plugin: PLUGIN }, required: ["plugin"] },
        result: STYLE_RESULT,
      },
      { undo: UNDO },
    ),
    define(
      UNDO,
      "Restore a plugin's style",
      async (args) => {
        const result = field(args, "result");
        const id = field(result, "plugin");
        if (!isPluginId(id)) throw fail("Nothing to restore");
        const before = field(result, "before");
        return shown(id, await host.put(id, { css: typeof before === "string" ? before : null }));
      },
      {
        description:
          "Undo of desk.customize.style and desk.customize.clear: puts back the style the result names.",
        args: {
          type: "object",
          properties: { args: { type: "object" }, result: STYLE_RESULT },
          required: ["result"],
        },
        result: ENTRY,
      },
    ),
  ];
  return () => {
    for (const off of offs) off();
  };
}
