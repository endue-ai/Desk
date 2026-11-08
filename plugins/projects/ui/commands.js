// The plugin's commands (contributes.commands in plugin.json), answered by name: the palette, keys,
// Eris, agents and the plugin's own buttons all arrive here. A failure goes to the status line and
// ends the command with the same words, which the desk shows in its notice.
import { VIEWS } from "./model.js";
import { asArgs, asString } from "./state.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("./adapters/common.js").Work} Work
 * @typedef {{
 *   commands: PluginContext["commands"], surface: PluginContext["surface"],
 *   view: { focus(where: "body" | "detail" | "search"): void },
 *   say(text: string): void,
 *   app: {
 *     screen(): import("./present.js").Screen,
 *     open(key: string | null): string | null,
 *     named(args: Record<string, unknown>): Promise<Work>,
 *     refresh(): Promise<number>,
 *     setView(name: unknown): string, setGroup(by: unknown): string,
 *     setSearch(text: string): string, setSource(source: string | null): string | null,
 *     setShowDone(on: boolean | undefined): boolean, setZoom(zoom: unknown): string,
 *     go(to: string): string,
 *     pick(title: string, placeholder: string): Promise<string | undefined>,
 *     connect(): Promise<void>, openLink(url: string): Promise<void>,
 *     move(work: Work, status: string): Promise<string>,
 *     update(work: Work, fields: Record<string, unknown>): Promise<unknown>,
 *   },
 * }} Deps
 */

const NAME = "the projects plugin";

/** @param {Deps} deps */
export function registerCommands({ commands, surface, view, say, app }) {
  /** @type {Map<string, (args: Record<string, unknown>) => unknown>} */
  const own = new Map();

  /** Run one of the plugin's commands. @param {string} name @param {unknown} raw */
  const command = async (name, raw) => {
    const handler = own.get(name);
    if (!handler) throw new Error(`${NAME} has no command ${name}.`);
    try {
      return await handler(asArgs(raw));
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
  /** @type {(name: string, handler: (a: Record<string, unknown>) => unknown) => void} */
  const answer = (name, handler) => {
    own.set(name, handler);
    commands.on(name, (raw) => command(name, raw));
  };

  answer("endue.projects.open", () => {
    surface.show();
    view.focus("body");
    return app.screen().view;
  });
  answer("endue.projects.view", (a) => {
    // Without a view, the next one: a key can walk them all.
    const current = VIEWS.indexOf(app.screen().view);
    const name = asString(a.view) ?? VIEWS[(current + 1) % VIEWS.length];
    const shown = app.setView(name);
    surface.show();
    return shown;
  });
  answer("endue.projects.group", (a) => app.setGroup(asString(a.by) ?? "none"));
  answer("endue.projects.search", async (a) => {
    const text =
      typeof a.text === "string" ? a.text : await app.pick("Search tasks", "words to find");
    return text === undefined ? app.screen().search : app.setSearch(text);
  });
  answer("endue.projects.source", (a) => app.setSource(asString(a.source) ?? null));
  answer("endue.projects.show-done", (a) =>
    app.setShowDone(typeof a.on === "boolean" ? a.on : undefined),
  );
  answer("endue.projects.zoom", (a) => app.setZoom(asString(a.zoom) ?? "month"));
  answer("endue.projects.go", (a) => app.go(asString(a.to) ?? "today"));
  answer("endue.projects.refresh", () => app.refresh());
  answer("endue.projects.connect", () => app.connect());
  answer("endue.projects.show", async (a) => {
    const work = await app.named(a);
    surface.show();
    return app.open(work.key);
  });
  answer("endue.projects.move", async (a) => {
    const work = await app.named(a);
    const status =
      asString(a.status) ?? (await app.pick(`Move ${work.ref || work.title} to`, "a status"));
    if (status === undefined) return work.status;
    return app.move(work, status);
  });
  answer("endue.projects.update", async (a) => {
    const work = await app.named(a);
    const { source: _source, id: _id, ...fields } = a;
    return app.update(work, fields);
  });
  answer("endue.projects.open-original", async (a) => {
    const work = await app.named(a);
    if (!work.url) throw new Error(`${work.ref || work.title} has no link to its source.`);
    await app.openLink(work.url);
    return work.url;
  });

  return { command, ids: () => [...own.keys()] };
}
