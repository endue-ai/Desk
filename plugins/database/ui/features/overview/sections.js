// The overview's sections in the order the panel shows them, each one statement of its own picked
// for the server's version, and the sentence a section says when the server refused to read it.
// No DOM.

import { t } from "../../strings/index.js";
import { indexSections, tableSections } from "./health.js";
import { serverSections } from "./server.js";
import { sizeSections } from "./sizes.js";
import { NOT_LOADED, statementsSection } from "./statements.js";

/**
 * @typedef {import("./sql.js").Section} Section
 * @typedef {import("./probe.js").Server} Server
 */

/** Every section of a server's overview. */
export function sectionsFor(/** @type {Server} */ server) {
  const [figures, long, replication, slots, settings] = serverSections(server);
  const [seqscans, vacuum, wraparound, cache] = tableSections(server);
  return /** @type {Section[]} */ ([
    figures,
    ...sizeSections(),
    ...indexSections(server),
    seqscans,
    vacuum,
    wraparound,
    cache,
    statementsSection(server),
    long,
    replication,
    slots,
    settings,
  ]);
}

/**
 * What a section says when its statement failed: pg_stat_statements not loaded is its steps, a
 * refused read names the role and who may read it, a lock waited on too long says to come back.
 * @param {Section} section
 * @param {string} message The server's words.
 * @param {string} role
 * @returns {{ failed: string } | { missing: string }}
 */
export function failureOf(section, message, role) {
  const words = message.trim().replace(/\.$/u, "");
  if (/must be loaded via "?shared_preload_libraries/u.test(words)) return { missing: NOT_LOADED };
  if (/permission denied/iu.test(words))
    return {
      failed: t("features.overview.sections.mayNotReadARoleWith", {
        value: String(role || t("features.overview.sections.thisRole")),
        source: String(section.source),
        words: String(words),
      }),
    };
  if (/lock timeout/iu.test(words))
    return {
      failed: t("features.overview.sections.notReadAnotherSessionHoldsA"),
    };
  return { failed: t("features.overview.sections.notRead", { words: String(words) }) };
}
