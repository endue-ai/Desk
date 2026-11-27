// Pinned results and two results compared (PG-26, ADR 0329): Database: pin the result tab keeps a
// console's result through its later runs (Pin in the result's toolbar), unpin lets one go;
// Database: compare two results opens their difference in a panel (Compare), keyed by the primary
// key or a key the person picks; Database: run again and compare with before is one command; the
// difference copies and exports in the plugin's formats. No DOM here.

import { createComparer } from "../../compare/client.js";
import { PIN_LIMIT } from "../../compare/pins.js";
import { t } from "../../strings/index.js";
import { compareResults, copyDifference, exportDifference, runAgain } from "./compare.js";
import { comparePanel } from "./panel.js";
import { pin, togglePin, unpin } from "./pin.js";

/** @typedef {import("../../feature-host.js").Deps} Deps */

/** One comparer a mount of the plugin: its worker is the SDK's, absent in tests. */
/** @type {WeakMap<Deps, ReturnType<typeof createComparer>>} */
const comparers = new WeakMap();

/**
 * The feature, with its limits (tests make them small).
 * @param {{ pinLimit?: number, inline?: number }} [options]
 * @returns {import("../../feature-host.js").Feature}
 */
export function compareFeature(options = {}) {
  const limit = options.pinLimit ?? PIN_LIMIT;
  const comparer = (/** @type {Deps} */ deps) => {
    let made = comparers.get(deps);
    if (!made) {
      made = createComparer(deps.startWorker, options.inline ? { inline: options.inline } : {});
      comparers.set(deps, made);
    }
    return made;
  };
  return {
    id: "compare",
    commands: (deps) => ({
      "endue.database.pin-result": () => pin(deps, limit),
      "endue.database.unpin-result": ({ pin: id }) => unpin(deps, id),
      "endue.database.compare-results": (args) => compareResults(deps, comparer(deps), args),
      "endue.database.run-again-and-compare": () => runAgain(deps, comparer(deps)),
      "endue.database.copy-difference": ({ format }) => copyDifference(deps, format),
      "endue.database.export-difference": ({ format }) => exportDifference(deps, format),
    }),
    actions: (deps) => ({
      togglePin: () => togglePin(deps, limit),
      compareResults: () => compareResults(deps, comparer(deps), {}),
      copyDifference: () => copyDifference(deps, undefined),
      exportDifference: () => exportDifference(deps, undefined),
    }),
    panels: {
      compare: {
        label: t("features.compare.index.twoResultsCompared"),
        render: (doc, state, act) => comparePanel(doc, state, act),
      },
    },
    styles: [new URL("./compare.css", import.meta.url).href],
  };
}

export const feature = compareFeature();
