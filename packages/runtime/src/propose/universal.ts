/**
 * Universal views as the view Eris proposes (ADR 0073, 0087, 0102): "show this repo's issues as a
 * board" becomes one presentation of entries from a source. The brain writes a `UniversalView`
 * without its id and provenance: the desk names it `eris.<slug of its title>`, records who made it
 * from which words, puts its type first in the presentations the person may switch between (all of
 * list, board, timeline and calendar when the brain named none), then checks it with the spec's
 * schema. desk.universal shows the drafting state at once, previews it over its live source, and on
 * Apply the view stays drawn while view.save writes `~/.desk/views/<id>.yaml` and the preview turns
 * into the notice with Undo; undo closes it and removes the file (view.remove).
 */
import type { BridgeClient, UniversalType, UniversalView } from "@endue-ai/bridge";
import type { AskTool } from "./asker";
import { brainName, freeId } from "./names";
import type { Applied, Choice, ProposalKind, Request } from "./pipeline";
import type { Schemas } from "./schema";
import { specSchemas, UNIVERSAL } from "./specs";
import { sourcesOf } from "./view";

const VIEWS = { permission: "view:manage" } as const;
const CONNECTORS = { permission: "connector:manage" } as const;
/** What the desk writes into a proposed view; the brain is not asked for it. */
const DESKS = ["id", "provenance"];
const PREFIX = "eris";
const CHOICES = new Set(["apply", "retry", "discard"]);
/** Every presentation, and the ones a view may always switch to after its own. */
export const PRESENTATIONS: UniversalType[] = [
  "list",
  "kanban",
  "timeline",
  "calendar",
  "text",
  "chat",
  "agent",
];
const SWITCH: UniversalType[] = ["list", "kanban", "timeline", "calendar"];

const GUIDE = [
  "A universal view is data that Desk draws, never code: one presentation (type: timeline,",
  "calendar, kanban for a board, list, text, chat or agent) of entries from one source. The source",
  "is items (the desk's index: an item query with kinds, where, sort, limit; an event's start, a",
  "task's status as its group and a message's sender as its author come with them), url (an http or",
  "https address that answers YAML or JSON entries), file (a .yaml or .json file on the desk),",
  "command (a plugin's command that answers entries: desk.universal.folder { path } lists a folder,",
  "its files' modified times as start and their kinds as group) or data (entries written inline).",
  "map says which entry field plays which role (title, start, end, group, author, status, text,",
  "detail, tags, url) when the source names it otherwise; options.groups orders a board's columns.",
  "Give it a short title and types, the presentations the person may switch to. Use what the",
  "person named; otherwise the kinds the desk has.",
].join(" ");

export interface UniversalKindOptions {
  bridge: BridgeClient;
  /** desk.universal.drafting, preview, open and close go through the registry. */
  commands: { run(id: string, args?: unknown): Promise<unknown> };
  /** Wall-clock milliseconds, for provenance. */
  now(): number;
  /** The profile in force. */
  profile(): string | undefined;
  schemas?: Schemas;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `types` with `type` first: the brain's own order, or the four every view may switch between. */
export function typesFor(type: unknown, types: unknown): unknown {
  if (typeof type !== "string") return types;
  const given = Array.isArray(types) ? types.filter((t) => t !== type) : SWITCH;
  return [type, ...new Set(given.filter((t) => t !== type))];
}

export function universalKind(options: UniversalKindOptions): ProposalKind<UniversalView> {
  const { bridge, commands } = options;
  let schemas: Schemas | undefined;
  let tool: AskTool | undefined;
  let compact: Record<string, unknown> | undefined;
  const specs = () => {
    schemas ??= options.schemas ?? specSchemas();
    return schemas;
  };
  const noteOf = (request: Request) => `Eris made this from “${request.text}”.`;

  return {
    kind: "view",
    noun: "view",
    guide: GUIDE,
    tool() {
      tool ??= {
        name: "propose_universal_view",
        description:
          "Propose one Desk universal view (specs/view/v0/universal.schema.json) that shows what the person asked for, from the source they named: its title, type, types, source, map and options. The desk names it and records where it came from.",
        schema: specs().bundle(UNIVERSAL, { omit: DESKS }),
      };
      return tool;
    },
    compact() {
      compact ??= specs().bundle(UNIVERSAL, { compact: true, omit: DESKS });
      return compact;
    },

    /** The presentations, the item kinds the desk has with their fields, the profile. */
    async context() {
      const [catalog, listed] = await Promise.all([
        bridge.call("catalog.get", {}).catch(() => undefined),
        bridge.call("connector.list", { scope: CONNECTORS }).catch(() => undefined),
      ]);
      const sources = sourcesOf(catalog?.connectors ?? [], listed?.connectors ?? []);
      const kinds = [...new Set(sources.flatMap((s) => s.kinds.map((k) => k.kind)))].sort();
      const profile = options.profile();
      return {
        presentations: PRESENTATIONS,
        kinds,
        sources,
        commands: ["desk.universal.folder"],
        ...(profile ? { profile } : {}),
      };
    },

    async drafting(request) {
      await commands.run("desk.universal.drafting", { note: `Making a view from “${request.text}”…` });
    },

    async check(answer, request) {
      if (!isObject(answer)) return { problems: ["/: the answer is not a JSON object"] };
      const rest = Object.fromEntries(Object.entries(answer).filter(([k]) => !DESKS.includes(k)));
      const brain = await brainName(bridge);
      const title = typeof rest.title === "string" ? rest.title : "";
      const types = typesFor(rest.type, rest.types);
      const value = {
        ...rest,
        ...(types === undefined ? {} : { types }),
        id: await freeId(bridge, PREFIX, title, options.now),
        provenance: {
          author: "eris",
          createdAt: new Date(options.now()).toISOString(),
          words: [request.text, ...request.corrections].join("; "),
          ...(brain ? { brain } : {}),
        },
      };
      const problems = specs().validate(value, UNIVERSAL);
      return problems.length ? { problems } : { value: value as unknown as UniversalView };
    },

    async preview(view, request) {
      const answer = await commands.run("desk.universal.preview", { view, note: noteOf(request) });
      const choice = (answer as { choice?: unknown } | null)?.choice;
      return (CHOICES.has(String(choice)) ? answer : { choice: "discard" }) as Choice;
    },

    async dismiss() {
      await commands.run("desk.universal.close");
    },

    async apply(view): Promise<Applied> {
      const id = view.id ?? "";
      await bridge.call("view.save", { view, scope: VIEWS });
      const where = `~/.desk/views/${id}.yaml`;
      const notice = {
        text: `Eris made this view: ${where}`,
        action: { title: "Undo", command: "desk.propose.undo", args: { kind: "view", id } },
      };
      // Saved either way: a desk without desk.universal still has the file.
      await commands.run("desk.universal.open", { id, notice }).catch(() => {});
      return { id, title: view.title ?? id, where };
    },

    async undo({ id }) {
      await commands.run("desk.universal.close", { id }).catch(() => {});
      await bridge.call("view.remove", { id, scope: VIEWS }).catch((error: { code?: string }) => {
        if (error.code !== "not_found") throw error;
      });
    },
  };
}
