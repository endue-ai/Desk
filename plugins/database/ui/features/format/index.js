// The preview of Format SQL's style (ADR 0292): Database: preview the SQL format opens a panel of
// its own with a sample PostgreSQL script laid out by the format settings in force, and lays it out
// again when one of them changes while the panel is open, so each setting shows what it does before
// a console is formatted. The layout runs in the parse worker; the panel keeps nothing across a
// restart. No DOM here: panel.js draws.

import { formatStyle } from "../../settings.js";
import { sqlParser } from "../../sql/parse/client.js";
import { previewView } from "./panel.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("./panel.js").PreviewState} PreviewState
 */

/** A script with each thing a setting changes: a long list, joins, a condition, CASE, a subquery. */
export const SAMPLE = [
  "-- the people who spent the most this year",
  "with spent as (select person, sum(total) as total, count(*) as orders from orders where at >= date_trunc('year', now()) group by person)",
  "select p.id, p.name, s.total, s.orders, case when s.total > 1000 then 'gold' when s.total > 100 then 'silver' else 'bronze' end as tier",
  "from people p join spent s on s.person = p.id left join notes n on n.person = p.id and n.kind = 'vip'",
  "where p.active and (s.total > 100 or n.id is not null) and not exists (select 1 from refunds r where r.person = p.id)",
  "order by s.total desc limit 20;",
  "update people set note = 'gold', checked = now() where id in (select person from spent where total > 1000);",
].join("\n");

export const PREVIEW = "format: preview";

/** The sample laid out by the settings in force. */
async function laidOut(/** @type {Deps} */ deps) {
  const parser = sqlParser();
  if (!parser) throw new Error("The SQL parser has not started.");
  const style = formatStyle(deps.settings());
  const laid = await parser.layout(SAMPLE, style);
  return /** @type {PreviewState} */ ({ text: laid.text, style });
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "format",
  commands: (deps) => {
    let shown = "";
    let turn = 0;
    let following = false;
    const again = async () => {
      const mine = ++turn;
      const state = await laidOut(deps);
      if (mine === turn && shown && !deps.consoles.updatePanel(shown, state)) shown = "";
    };
    return {
      "endue.database.format-preview": async () => {
        const state = await laidOut(deps);
        turn++;
        shown = (await deps.consoles.openPanel(null, "format", PREVIEW, state)).id;
        if (!following)
          deps.onSettings(() => {
            if (shown) void again().catch((error) => deps.say(String(error?.message ?? error)));
          });
        following = true;
        return state.text;
      },
    };
  },
  panels: {
    format: {
      label: "Format SQL preview",
      render: (doc, /** @type {PreviewState} */ state) => previewView(doc, state),
    },
  },
  styles: [new URL("./format.css", import.meta.url).href],
};
