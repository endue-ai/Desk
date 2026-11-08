/**
 * Views as the first kind Eris proposes (ADR 0032, 0073). The brain writes a `View` of specs/view/v0
 * without its id, version and provenance: the desk names it `eris.<slug of its title>`, gives it
 * 0.1.0 and records who made it from which words, then checks it with the spec's schema and the names
 * a schema cannot check (`viewProblems`). desk.views previews it over live data; Apply saves it with
 * view.save, which writes `~/.desk/views/<id>.yaml` after the core's own check (ADR 0036), and opens
 * it with an Undo notice; undo closes it and removes the file (view.remove).
 */
import {
  type BridgeClient,
  type CatalogConnector,
  type ConnectorInfo,
  type View,
  viewProblems,
} from "@endue-ai/bridge";
import type { AskTool } from "./asker";
import { brainName, freeId } from "./names";
import type { Applied, Choice, ProposalKind, Request } from "./pipeline";
import type { Schemas } from "./schema";
import { specSchemas, VIEW } from "./specs";

const VIEWS = { permission: "view:manage" } as const;
const CONNECTORS = { permission: "connector:manage" } as const;
const PLUGINS = { permission: "plugin:manage" } as const;
/** What the desk writes into a proposed view; the brain is not asked for it. */
const DESKS = ["id", "version", "provenance"];
/** Where the views Eris makes are named: `eris.events-this-week`. */
const PREFIX = "eris";
const CHOICES = new Set(["apply", "retry", "discard"]);

const GUIDE = [
  "A view is data that Desk draws, never code. Its layout is a tree: containers (grid, split, tabs,",
  "stack) hold components (list, table, card, agenda, stat, markdown and the others the desk lists),",
  "and each component shows the items its binding matches (an item query: kinds, sources, where,",
  "sort, limit). Name each source under requires, for example",
  '"requires": {"calendar": {"kinds": ["event"]}}, and bind it as "sources": ["$calendar"].',
  'Templates fill {field} from an item ("{start|time} {title}") and {today}, {tomorrow} or {now}',
  "from the clock. Use the kinds and fields the desk has.",
].join(" ");

export interface ViewKindOptions {
  /** The kind's name in desk.propose: `view`, or `item-view` beside universal views (ADR 0102). */
  kind?: string;
  bridge: BridgeClient;
  /** desk.views.preview, desk.views.open and desk.views.close go through the registry. */
  commands: { run(id: string, args?: unknown): Promise<unknown> };
  /** Wall-clock milliseconds, for provenance. */
  now(): number;
  /** The profile in force. */
  profile(): string | undefined;
  schemas?: Schemas;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function viewKind(options: ViewKindOptions): ProposalKind<View> {
  const { bridge, commands } = options;
  let schemas: Schemas | undefined;
  let tool: AskTool | undefined;
  let compact: Record<string, unknown> | undefined;
  const specs = () => {
    schemas ??= options.schemas ?? specSchemas();
    return schemas;
  };

  const name = options.kind ?? "view";
  return {
    kind: name,
    noun: "view",
    guide: GUIDE,
    tool() {
      tool ??= {
        name: "propose_view",
        description:
          "Propose one Desk view (specs/view/v0) that shows the person's items as they asked: its title, requires, params and layout. The desk names it, versions it and records where it came from.",
        schema: specs().bundle(VIEW, { omit: DESKS }),
      };
      return tool;
    },
    compact() {
      compact ??= specs().bundle(VIEW, { compact: true, omit: DESKS });
      return compact;
    },

    /** The components, the sources with their kinds and fields, the plugins on, the profile. */
    async context() {
      const [catalog, listed, plugins] = await Promise.all([
        bridge.call("catalog.get", {}).catch(() => undefined),
        bridge.call("connector.list", { scope: CONNECTORS }).catch(() => undefined),
        bridge.call("plugin.list", { scope: PLUGINS }).catch(() => undefined),
      ]);
      const profile = options.profile();
      return {
        ...(catalog ? { components: catalog.components } : {}),
        sources: sourcesOf(catalog?.connectors ?? [], listed?.connectors ?? []),
        plugins: (plugins?.plugins ?? [])
          .filter((p) => p.enabled)
          .map((p) => p.id)
          .sort(),
        ...(profile ? { profile } : {}),
      };
    },

    async check(answer, request) {
      if (!isObject(answer)) return { problems: ["/: the answer is not a JSON object"] };
      const rest = Object.fromEntries(Object.entries(answer).filter(([k]) => !DESKS.includes(k)));
      const brain = await brainName(bridge);
      const value = {
        ...rest,
        id: await freeId(
          bridge,
          PREFIX,
          typeof rest.title === "string" ? rest.title : "",
          options.now,
        ),
        version: "0.1.0",
        provenance: {
          author: "eris",
          createdAt: new Date(options.now()).toISOString(),
          words: [request.text, ...request.corrections].join("; "),
          ...(brain ? { brain } : {}),
        },
      };
      const problems = specs().validate(value, VIEW);
      if (problems.length === 0) problems.push(...viewProblems(value as unknown as View));
      return problems.length ? { problems } : { value: value as unknown as View };
    },

    async preview(view, request: Request) {
      const note = `Eris made this from “${request.text}”.`;
      const answer = await commands.run("desk.views.preview", { view, note });
      const choice = (answer as { choice?: unknown } | null)?.choice;
      return (CHOICES.has(String(choice)) ? answer : { choice: "discard" }) as Choice;
    },

    async dismiss() {
      await commands.run("desk.views.close");
    },

    async apply(view): Promise<Applied> {
      await bridge.call("view.save", { view, scope: VIEWS });
      const where = `~/.desk/views/${view.id}.yaml`;
      const undo = { kind: name, id: view.id };
      const notice = {
        text: `Eris made this view: ${where}`,
        action: { title: "Undo", command: "desk.propose.undo", args: undo },
      };
      // Saved either way: a desk without desk.views still has the file.
      await commands.run("desk.views.open", { id: view.id, notice }).catch(() => {});
      return { id: view.id, title: view.title, where };
    },

    async undo({ id }) {
      await commands.run("desk.views.close", { id }).catch(() => {});
      await bridge.call("view.remove", { id, scope: VIEWS }).catch((error: { code?: string }) => {
        if (error.code !== "not_found") throw error;
      });
    },
  };
}

export { slugOf } from "./names";

/**
 * Each connector with instances, its kinds and the fields the catalog knows for them: the catalog
 * lists only what the caller may read (`data:read`, which the runtime does not hold), connector.list
 * every connector and the kinds it brings in.
 */
export function sourcesOf(catalog: CatalogConnector[], listed: ConnectorInfo[]) {
  const ids = [...new Set([...catalog.map((c) => c.id), ...listed.map((c) => c.id)])];
  return ids.flatMap((connector) => {
    const known = catalog.find((c) => c.id === connector);
    const info = listed.find((c) => c.id === connector);
    const instances = info ? info.instances.map((i) => i.instance) : (known?.instances ?? []);
    if (instances.length === 0) return [];
    const kinds: Array<{ kind: string; fields?: string[] }> = (known?.kinds ?? []).map((k) => ({
      kind: k.kind,
      fields: [...k.fields],
    }));
    for (const { kind } of info?.resources ?? [])
      if (!kinds.some((k) => k.kind === kind)) kinds.push({ kind });
    return [{ connector, instances, kinds }];
  });
}
