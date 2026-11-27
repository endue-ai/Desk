// The palette finds database objects (PG-80): the desk's palette asks Database: find objects
// (contributes.paletteProviders) as the person types, and it answers the tables, views, columns,
// routines, types and schemas of every PostgreSQL connection's schema caches, each database of its
// server, by the palette's own matching, never asking a server. Database: hide a connection from
// the palette leaves one out, and Database: copy a name copies what a result's last action names.

import { homeOf } from "../../databases.js";
import { bridgeStore } from "../../schema-cache/store.js";
import { t } from "../../strings/index.js";
import { agentsOf } from "../audit/agents.js";
import { best } from "./match.js";
import { resultOf } from "./results.js";
import { createSources } from "./sources.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("./names.js").Name} Name
 * @typedef {import("../../engines/common.js").Connection} Connection
 */

/** How many results the palette gets when it does not say, and the most it may ask for. */
export const LIMIT = 8;
export const MOST = 50;
const LONGEST = 200;

/**
 * Answer a PaletteQuery from the sources: the best names of all of them, as results.
 * @param {unknown} args
 * @param {{ all(): Promise<import("./sources.js").Source[]> }} sources
 */
export async function findObjects(args, sources) {
  const { query, limit } = /** @type {{ query?: unknown, limit?: unknown }} */ (args ?? {});
  const text = typeof query === "string" ? query.slice(0, LONGEST).trim() : "";
  if (text === "") return { results: [] };
  const n = typeof limit === "number" && Number.isInteger(limit) ? limit : LIMIT;
  const all = await sources.all();
  /** @type {Name[][]} */
  const blocks = [];
  /** @type {Connection[]} */
  const owners = [];
  for (const source of all)
    for (const block of source.blocks) {
      blocks.push(block);
      owners.push(source.conn);
    }
  const found = best(blocks, text, Math.min(Math.max(n, 1), MOST));
  return {
    results: found.map(({ item, block }) =>
      resultOf(item, /** @type {Connection} */ (owners[block])),
    ),
  };
}

/** @param {Deps} deps */
const sourcesOf = (deps) =>
  createSources({
    connections: () => deps.manager.list(),
    view: (conn) => deps.catalog.cache.view(conn),
    store: bridgeStore(deps.bridge),
  });

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "palette",
  commands: (deps) => {
    const sources = sourcesOf(deps);
    return {
      "endue.database.find-objects": (args, invocation) => {
        if (!/^(agent|mcp):/u.test(invocation?.caller ?? "")) return findObjects(args, sources);
        return findObjects(args, {
          async all() {
            const loaded = await sources.all();
            const visible = await agentsOf(deps.bridge)?.visible(loaded.map(({ conn }) => conn));
            const ids = visible ? new Set(visible.map(({ id }) => id)) : undefined;
            return ids ? loaded.filter(({ conn }) => ids.has(conn.id)) : loaded;
          },
        });
      },
      "endue.database.copy-name": async ({ text }) => {
        if (typeof text !== "string" || text === "")
          throw new Error(t("features.palette.index.sayTheNameToCopyAs"));
        deps.say(
          (await deps.view.copy(text))
            ? t("features.palette.index.copied", { text: String(text) })
            : text,
        );
        return text;
      },
      "endue.database.palette-hide": async ({ connection }) => {
        const conn = await deps.manager.choose(
          typeof connection === "string" ? connection : undefined,
          t("features.palette.index.databaseHideWhichConnectionFromThe"),
        );
        if (!conn) return undefined;
        const home = homeOf(conn);
        const now = await sources.toggle(home.id);
        deps.say(
          now
            ? t("features.palette.index.isHiddenFromThePalette", { name: String(home.name) })
            : t("features.palette.index.thePaletteFindsAgain", { name: String(home.name) }),
        );
        return now;
      },
    };
  },
};
