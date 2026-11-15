/**
 * endue:// links (#310, ADR 0244), as the shell queues them among the opened files: the canonical
 * form of a link the v1 grammar reads (`crates/desk-link`), or `endue:refused?why=…` for one it
 * refused. A file link opens as a double-click does and grants nothing more; a plugin link brings the
 * plugin up; a command link runs only once the person says yes. Anything else is said in a plain
 * notice and run never.
 */

/** The queue's mark for a link the shell refused, followed by the percent-encoded reason. */
export const REFUSED = "endue:refused?why=";

export interface LinksHost {
  commands: {
    run(id: string, args?: unknown): Promise<unknown>;
    has(id: string): boolean;
    list(): Array<{ id: string; title: string }>;
  };
  notify(input: { caller: string; title: string; body?: string; level?: "info" | "warning" }): void;
}

export type Link =
  | { kind: "open"; path: string }
  | { kind: "plugin"; id: string; surface?: string }
  | { kind: "command"; id: string };

/** A canonical link as the shell queued it, or the sentence that says why it is not one. */
export function readLink(entry: string): Link | { refused: string } {
  if (entry.startsWith(REFUSED)) {
    const why = entry.slice(REFUSED.length);
    try {
      return { refused: decodeURIComponent(why) };
    } catch {
      return { refused: "This link is not one the desk opens." };
    }
  }
  const match = /^endue:\/\/v1\/(open|plugin|command)(?:\/([^/?#]+))?(?:\?([^#]*))?$/u.exec(entry);
  if (!match) return { refused: "This link is not one the desk opens." };
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
  return { refused: "This link is not one the desk opens." };
}

/** Open one queued link. Resolves once it ran, was declined, or was refused with a notice. */
export async function openLink(host: LinksHost, entry: string): Promise<void> {
  const link = readLink(entry);
  const refuse = (body: string) =>
    host.notify({ caller: "desk", title: "This link was not opened", body, level: "warning" });
  if ("refused" in link) return refuse(link.refused);
  if (link.kind === "open") {
    await host.commands.run("desk.files.open", { path: link.path });
    return;
  }
  if (link.kind === "plugin") {
    // desk.plugins.open brings the plugin up at its first window; the surface is kept for later.
    await host.commands.run("desk.plugins.open", { plugin: link.id });
    return;
  }
  if (!host.commands.has(link.id)) return refuse(`The desk has no command ${link.id}.`);
  if (!host.commands.has("desk.palette.pick")) return refuse("The desk cannot ask you now.");
  const title = host.commands.list().find((c) => c.id === link.id)?.title ?? link.id;
  const choice = await host.commands
    .run("desk.palette.pick", {
      title: `A link asks to run "${title}". Run it?`,
      items: [
        { id: "run", label: `Run "${title}"` },
        { id: "no", label: "Don't run it" },
      ],
    })
    .catch(() => undefined);
  if (choice === "run") await host.commands.run(link.id);
}
