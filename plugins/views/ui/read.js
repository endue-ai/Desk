// Read saved item sections with the same queries as the displayed views.
import { build, queryOf } from "./components.js";
import { fill } from "./template.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").View} View
 * @typedef {import("@endue-ai/bridge").UniversalEntry} UniversalEntry
 * @typedef {import("./template.js").Env} Env
 * @typedef {Pick<typeof import("@endue-ai/plugin-sdk"), "entriesFromItems" | "universalItems" | "universalParams">} ReadTools
 */

const readError = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string } | null} */ (error)?.code === "permission_denied"
    ? "denied"
    : "error";

const entriesAsData = (/** @type {UniversalEntry[]} */ entries) =>
  entries.map(({ raw: _raw, ...entry }) => entry);

/** The item view's declared parameters and defaults. */
export const itemParams = (
  /** @type {View} */ view,
  /** @type {Record<string, unknown>} */ given,
) =>
  Object.fromEntries(
    Object.entries(view.params ?? {}).map(([name, param]) => [name, given[name] ?? param.default]),
  );

/**
 * @param {PluginContext} ctx
 * @param {ReturnType<typeof import("./accounts.js").createAccounts>} accounts
 * @param {(params: Record<string, unknown>) => Env} envOf
 * @param {ReadTools} sdk
 */
export function readSavedView(
  ctx,
  accounts,
  envOf,
  { entriesFromItems, universalItems, universalParams },
) {
  return async (/** @type {unknown} */ args) => {
    const { id, params = {} } = /** @type {{ id?: unknown, params?: Record<string, unknown> }} */ (
      args ?? {}
    );
    if (typeof id !== "string" || !id) throw new Error("Give the ID of a saved view.");
    const view = await ctx.views.get(id);
    if ("layout" in view) {
      const env = envOf(itemParams(view, params));
      const listed = await accounts.list();
      const choice = await accounts.resolve(view, listed?.connectors ?? [], {}, { saved: true });
      const { live } = build(view.layout, choice.bound, env);
      const sections = await Promise.all(
        [...live.values()].map(async (entry) => {
          const { type, path, title, state, message } = entry.model;
          const base = { path, type, title: title || fill(view.title, {}, env) };
          if (!entry.binding) {
            const needsChoice = entry.model.node.binding?.sources?.some(
              (source) => source.startsWith("$") && Object.hasOwn(choice.pick, source.slice(1)),
            );
            return {
              ...base,
              state: state === "loading" ? "unsupported" : state,
              message: needsChoice ? "Open the view to choose an account." : message,
              entries: [],
            };
          }
          try {
            const page = await ctx.data.query(queryOf(entry, env));
            const entries = entriesAsData(entriesFromItems(page.items));
            return {
              ...base,
              state: entries.length ? "ready" : "empty",
              entries,
              more: page.cursor !== undefined,
            };
          } catch (error) {
            return { ...base, state: readError(error), entries: [] };
          }
        }),
      );
      return { id, title: fill(view.title, {}, env), sections };
    }
    const page = "sections" in view;
    const sections = page ? view.sections : [view];
    const given = page ? universalParams(view.params, params) : params;
    const env = envOf({});
    const results = await Promise.all(
      sections.map(async (section, index) => {
        const base = {
          path: page ? `0.${index}` : "0",
          title: section.title ?? view.title ?? id,
          type: section.type,
        };
        try {
          const source = universalItems(section, {
            params: given,
            now: () => env.now,
            zone: env.zone,
          });
          if (!source) return { ...base, state: "unsupported", entries: [] };
          const { entries } = await ctx.universal.load(source);
          return {
            ...base,
            state: entries.length ? "ready" : "empty",
            entries: entriesAsData(entries),
          };
        } catch (error) {
          return { ...base, state: readError(error), entries: [] };
        }
      }),
    );
    return { id, title: view.title ?? id, sections: results };
  };
}
