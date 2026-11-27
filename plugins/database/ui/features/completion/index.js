// Completion (PG-31, ADR 0327): the editor's `picked` action (picks.js) and the commands that ask the
// editor on screen for a call's signature help and for `*` written out as its columns. The `complete`
// action is the view's built-in one (actions.js), answered by controller.js here. The editor draws the
// list and the help (editor/completion.js, editor/signature-help.js).

import { t } from "../../strings/index.js";
import { picksFor } from "./picks.js";

/** @typedef {import("../../feature-host.js").Deps} Deps */

/** Ask the editor on screen; say so when it has no console to do it in. */
async function inEditor(/** @type {Deps} */ deps, /** @type {"signatures" | "expandStar"} */ what) {
  const view = /** @type {Record<string, (() => Promise<boolean> | boolean) | undefined>} */ (
    /** @type {unknown} */ (deps.view)
  );
  const done = await view[what]?.();
  if (!done)
    deps.say(
      what === "signatures"
        ? t("features.completion.index.putTheCaretInsideAFunction")
        : t("features.completion.index.putTheCaretAfterAIn"),
    );
  return undefined;
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "completion",
  commands: (deps) => ({
    "endue.database.signatures": () => inEditor(deps, "signatures"),
    "endue.database.expand-star": () => inEditor(deps, "expandStar"),
  }),
  actions: (deps) => ({
    picked: (/** @type {string} */ key) => picksFor(deps.bridge).record(key),
  }),
  styles: [new URL("./completion.css", import.meta.url).href],
};
