// The commands of a read its cursor keeps (PG-22, ADR 0352, rows/control.js): Count every row moves
// the cursor to its end and says the total, Fetch every row holds them all (up to 100,000), so the
// grid sorts and filters them here. Scrolling needs no command: the grid asks for the pages itself.

import { windowed } from "../../rows/control.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 */

/** The console on screen, when its result is a read its cursor keeps. */
const keeping = (/** @type {Deps} */ deps) => {
  const shown = deps.consoles.current();
  if (!shown || !windowed(shown))
    throw new Error("The result on screen holds every row it has: nothing to count or fetch.");
  return shown;
};

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "rows",
  commands: (deps) => ({
    "endue.database.count-result-rows": async () => {
      keeping(deps);
      const said = await deps.consoles.page({ count: true });
      deps.say(said);
      return said;
    },
    "endue.database.fetch-all-rows": async () => {
      keeping(deps);
      const said = await deps.consoles.page({ all: true });
      deps.say(said);
      return said;
    },
  }),
};
