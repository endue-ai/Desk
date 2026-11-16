/**
 * endue:// links (#310, ADR 0244), as the shell queues them among the opened files: the canonical
 * form of a link the v1 grammar reads (`crates/desk-link`), or `endue:refused?why=…` for one it
 * refused. Anyone can write a link, so none acts unasked: a file link (one the shell found on disk)
 * opens only once the person says yes, and even then grants its opener nothing (`grant: false`: the
 * opener asks for its read as for any file it was not handed), a command link runs only on yes,
 * and a plugin link brings up a plugin that is on, never turning one on. Each question offers "no"
 * first, so a link that lands while the person types is not answered by their next Enter. Anything
 * else is said in a plain notice, in the desk's words, and run never.
 */

/** The queue's mark for a link the shell refused, followed by the percent-encoded reason. */
export const REFUSED = "endue:refused?why=";
/** How long a link that started the desk waits for what it needs (the palette, its command). */
export const WAIT_MS = 15_000;

export interface LinksHost {
  commands: {
    run(id: string, args?: unknown): Promise<unknown>;
    has(id: string): boolean;
    list(): Array<{ id: string; title: string }>;
    onChange(listener: () => void): () => void;
  };
  /** Whether plugin `id` is installed and on: undefined when it is not installed. */
  pluginOn(id: string): Promise<boolean | undefined>;
  notify(input: { caller: string; title: string; body?: string; level?: "info" | "warning" }): void;
  /** How long to wait for a command to appear; WAIT_MS unless a test says otherwise. */
  waitMs?: number;
}

export type Link =
  | { kind: "open"; path: string }
  | { kind: "plugin"; id: string; surface?: string }
  | { kind: "command"; id: string };

/** Text from a link fit for a notice: no control or invisible format characters, at most 120, the end (a file's name) kept. */
export function shown(text: string): string {
  const clean = [...text]
    .filter((c) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(c))
    .join("")
    .trim();
  // Cut from the middle: a long path keeps where it starts and the file's own name.
  if (clean.length <= 120) return clean;
  const tail = clean.slice(clean.lastIndexOf("/") + 1).slice(-70);
  return `${clean.slice(0, 119 - tail.length)}…${tail}`;
}

const NOT_ONE = "This link is not one the desk opens.";

/** A canonical link as the shell queued it, or the sentence that says why it is not one. */
export function readLink(entry: string): Link | { refused: string } {
  if (entry.startsWith(REFUSED)) {
    try {
      return { refused: shown(decodeURIComponent(entry.slice(REFUSED.length))) || NOT_ONE };
    } catch {
      return { refused: NOT_ONE };
    }
  }
  const match = /^endue:\/\/v1\/(open|plugin|command)(?:\/([^/?#]+))?(?:\?([^#]*))?$/u.exec(entry);
  if (!match) return { refused: NOT_ONE };
  const [, verb, id, query = ""] = match;
  const params = new URLSearchParams(query);
  if (verb === "open" && !id) {
    const path = params.get("path");
    if (path) return { kind: "open", path };
  }
  if (verb === "plugin" && id) {
    const surface = params.get("surface");
    return surface ? { kind: "plugin", id, surface } : { kind: "plugin", id };
  }
  if (verb === "command" && id && query === "") return { kind: "command", id };
  return { refused: NOT_ONE };
}

/** Wait until every command in `ids` is registered, or `ms` pass: whether they all are. */
function registered(host: LinksHost, ids: string[], ms: number): Promise<boolean> {
  const all = () => ids.every((id) => host.commands.has(id));
  if (all()) return Promise.resolve(true);
  return new Promise((done) => {
    const finish = (value: boolean) => {
      clearTimeout(timer);
      off();
      done(value);
    };
    const off = host.commands.onChange(() => {
      if (all()) finish(true);
    });
    const timer = setTimeout(() => finish(all()), ms);
  });
}

/** Ask the person `title`, "no" first: whether they chose `yes`. */
async function asked(host: LinksHost, title: string, yes: string, no: string): Promise<boolean> {
  const choice = await host.commands
    .run("desk.palette.pick", {
      title,
      items: [
        { id: "no", label: no },
        { id: "yes", label: yes },
      ],
    })
    .catch(() => undefined);
  return choice === "yes";
}

/** Open one queued link. Resolves once it ran, was declined, or was refused with a notice. */
export async function openLink(host: LinksHost, entry: string): Promise<void> {
  const ms = host.waitMs ?? WAIT_MS;
  const refuse = (body: string) =>
    host.notify({ caller: "desk", title: "This link was not opened", body, level: "warning" });
  const link = readLink(entry);
  if ("refused" in link) return refuse(link.refused);
  if (link.kind === "plugin") {
    // desk.plugins.open turns a plugin the person turned off back on: a link must not.
    const on = await host.pluginOn(link.id).catch(() => undefined);
    if (on === undefined) return refuse(`No plugin ${link.id} is installed.`);
    if (!on) return refuse(`${link.id} is turned off; a link does not turn it on.`);
    // It opens at its first window; the surface is kept for when desk.plugins.open takes one.
    await host.commands.run("desk.plugins.open", { plugin: link.id });
    return;
  }
  const needs = link.kind === "command" ? ["desk.palette.pick", link.id] : ["desk.palette.pick"];
  if (!(await registered(host, needs, ms))) {
    return refuse(
      link.kind === "command" && host.commands.has("desk.palette.pick")
        ? `The desk has no command ${link.id}.`
        : "The desk could not ask you about this link.",
    );
  }
  if (link.kind === "open") {
    const path = shown(link.path);
    const yes = await asked(
      host,
      `A link asks to open ${path}. Open it?`,
      "Open it",
      "Don't open it",
    );
    // Not the person's own open: the opener gets no folder grant and asks for its read as usual.
    if (yes) await host.commands.run("desk.files.open", { path: link.path, grant: false });
    return;
  }
  const title = shown(host.commands.list().find((c) => c.id === link.id)?.title ?? link.id);
  const yes = await asked(
    host,
    `A link asks to run "${title}". Run it?`,
    `Run "${title}"`,
    "Don't run it",
  );
  if (yes) await host.commands.run(link.id);
}
