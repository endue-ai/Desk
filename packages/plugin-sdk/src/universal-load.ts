// Universal view sources (specs/view/v0/universal.schema.json, ADR 0087): every source answers the
// same document, read here from YAML or JSON. Inline data as written; an asset from the plugin's own
// folder (the frame's fetch, no permission); a URL through net.fetch and a desk file through fs.read
// under the narrowest grant for them; another plugin's command through cmd.invoke; the item index
// through data.query, each item turned into an entry.
import type {
  BridgeMethod,
  Item,
  ItemPage,
  ItemQuery,
  ParamsOf,
  ResultOf,
  UniversalData,
  UniversalEntry,
  UniversalSource,
} from "@endue-ai/bridge";
import { parseYaml } from "./yaml";

/** A document that is not the universal data format, with where it breaks. */
export class UniversalError extends Error {
  readonly problems: string[];
  constructor(message: string, problems: string[] = []) {
    super(problems.length > 0 ? `${message}: ${problems.join("; ")}` : message);
    this.name = "UniversalError";
    this.problems = problems;
  }
}

/** The most text a source may answer: 8 MiB. */
export const MAX_TEXT = 8 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The universal data a value holds: a document with `entries`, or a bare list of entries. Checks the
 * shape the views rely on; the fields of an entry are the source's own.
 */
export function universalData(value: unknown): UniversalData {
  const doc = Array.isArray(value) ? { entries: value } : value;
  if (!isObject(doc)) throw new UniversalError("Not a universal data document", ["not an object"]);
  const problems: string[] = [];
  const entries = doc.entries;
  if (!Array.isArray(entries)) problems.push("entries: missing, or not a list");
  else {
    if (entries.length > MAX_ENTRIES) problems.push(`entries: more than ${MAX_ENTRIES}`);
    entries.forEach((entry, i) => {
      if (!isObject(entry)) problems.push(`entries/${i}: not an object`);
    });
  }
  if (doc.universal !== undefined && doc.universal !== "v0")
    problems.push(`universal: ${JSON.stringify(doc.universal)} is not v0`);
  if (doc.map !== undefined) {
    if (!isObject(doc.map)) problems.push("map: not an object");
    else
      for (const [role, path] of Object.entries(doc.map))
        if (typeof path !== "string") problems.push(`map/${role}: not a field path`);
  }
  if (problems.length > 0) throw new UniversalError("Not a universal data document", problems);
  return doc as unknown as UniversalData;
}

/** Parse universal data from YAML or JSON text (JSON is YAML). */
export function parseUniversal(text: string): UniversalData {
  if (text.length > MAX_TEXT) throw new UniversalError("The document is larger than 8 MiB");
  let value: unknown;
  try {
    value = parseYaml(text);
  } catch (error) {
    throw new UniversalError(`Not YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  return universalData(value);
}

const person = (who: { name?: string; email?: string } | undefined) =>
  who?.name ?? who?.email ?? "";

/**
 * The entries of items: the envelope (id, source, kind, title, url, the text in body) plus each
 * kind's fields in the roles they play. An event's start and end; a task's due as its start and its
 * status as its group and status; a message's sender as its author and its time as its start; a
 * file's, note's or record's last change as its start.
 */
export function entriesFromItems(items: readonly Item[]): UniversalEntry[] {
  return items.map((item) => {
    const base: UniversalEntry = {
      id: item.id,
      source: { ...item.source },
      kind: item.kind,
      title: item.title,
      updatedAt: item.updatedAt,
      ...(item.body ? { text: item.body } : {}),
      ...(item.deepLink ? { url: item.deepLink } : {}),
      ...(item.raw ? { raw: item.raw } : {}),
    };
    switch (item.kind) {
      case "event":
        return {
          ...base,
          // A whole day starts on its date; its end stays the instant it ends (the next midnight).
          start: item.allDay ? item.start.slice(0, 10) : item.start,
          end: item.end,
          ...(item.location ? { detail: item.location } : {}),
        };
      case "task":
        return {
          ...base,
          group: item.status,
          status: item.status,
          ...(item.due ? { start: item.due } : {}),
          ...(item.project ? { detail: item.project, tags: [item.project] } : {}),
        };
      case "message":
        return {
          ...base,
          author: person(item.from),
          start: item.receivedAt,
          ...(item.unread ? { status: "unread" } : {}),
          ...(item.body || item.snippet ? { text: item.body ?? item.snippet } : {}),
          ...(item.snippet ? { detail: item.snippet } : {}),
        };
      case "entry":
        return {
          ...base,
          start: item.publishedAt,
          url: item.url,
          detail: item.feed,
          ...(item.summary && !item.body ? { text: item.summary } : {}),
        };
      case "file":
        return { ...base, start: item.modifiedAt, detail: item.path };
      case "metric": {
        const last = item.points[item.points.length - 1];
        const value = last ? `${last.v}${item.unit ? ` ${item.unit}` : ""}` : "";
        return { ...base, ...(last ? { start: last.t } : {}), detail: value };
      }
      case "person":
        return { ...base, detail: item.org ?? item.emails?.[0] ?? "" };
      default:
        return { ...base, start: item.updatedAt };
    }
  });
}

/** What loading a source needs: bridge calls, a command runner, the item index, the frame's fetch. */
export interface UniversalHost {
  pluginId: string;
  call<M extends BridgeMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>>;
  run(command: string, args?: Record<string, unknown>): Promise<unknown>;
  query(query: ItemQuery): Promise<ItemPage>;
  /** Hear changes to what a query selects; resolves the function that stops. */
  subscribe?(query: ItemQuery, listener: () => void): Promise<() => void>;
  fetch?: (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
  /** The frame's address, for assets; location.href by default. */
  base?: string;
}

/**
 * Where an asset of the plugin lives: under the plugin's folder, which is the first segment of the
 * frame's path on the desk's scheme (/<plugin id>/ui/index.html), else next to the frame.
 */
export function assetUrl(pluginId: string, asset: string, base: string): string {
  const url = new URL(base);
  const root = `/${encodeURIComponent(pluginId)}/`;
  return new URL(asset, url.pathname.startsWith(root) ? new URL(root, url) : url).href;
}

function decode(body: string, encoding: string | undefined): string {
  if (encoding !== "base64") return body;
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Load the document a source answers. A source that cannot be read rejects (UniversalError, or a
 * BridgeCallError for a refused call). */
export async function loadUniversal(
  host: UniversalHost,
  source: UniversalSource,
): Promise<UniversalData> {
  if ("data" in source) return universalData(source.data);
  if ("items" in source) {
    const page = await host.query(source.items);
    return { entries: entriesFromItems(page.items) };
  }
  if ("command" in source) {
    const answer = await host.run(source.command, source.args);
    return typeof answer === "string" ? parseUniversal(answer) : universalData(answer);
  }
  if ("file" in source) {
    const scope = { permission: "fs:read" as const, paths: [source.file] };
    const read = await host.call("fs.read", { path: source.file, encoding: "utf8", scope });
    return parseUniversal(decode(read.content, read.encoding));
  }
  if ("url" in source) {
    const scope = { permission: "net:fetch" as const, hosts: [new URL(source.url).host] };
    const answer = await host.call("net.fetch", { url: source.url, scope });
    if (answer.status < 200 || answer.status > 299)
      throw new UniversalError(`${answer.status} from ${new URL(source.url).host}`);
    return parseUniversal(decode(answer.body, answer.bodyEncoding));
  }
  const fetcher = host.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!fetcher) throw new UniversalError("This frame cannot fetch its assets");
  const base = host.base ?? globalThis.location?.href ?? "desk-plugin://localhost/";
  const answer = await fetcher(assetUrl(host.pluginId, source.asset, base));
  if (!answer.ok) throw new UniversalError(`${answer.status} for ${source.asset}`);
  return parseUniversal(await answer.text());
}
