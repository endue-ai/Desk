// Navigation from a name in the editor (PG-32): Database: go to the definition, show what the name
// is (its card) and find its usages, at the caret of the console on screen, as F12, Alt+F12 and
// Shift+F12 do there (and resting the pointer on a name shows its card). The `navigate` action is
// what the editor asks (navigate/editor.js); the usages panel lists what was found and opens it
// (`navigateOpen`). The work is navigate/controller.js's.
import { createNavigator, PANEL } from "../../navigate/controller.js";
import { usagesPanel } from "../../navigate/usages-panel.js";
import { t } from "../../strings/index.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../navigate/controller.js").What} What
 * @typedef {import("../../navigate/controller.js").Window} Window
 */

/** One navigator per plugin, shared by the feature's commands and actions. */
const navigators = new WeakMap();
const of = (/** @type {Deps} */ deps) => {
  let found = navigators.get(deps);
  if (!found) {
    found = createNavigator(deps);
    navigators.set(deps, found);
  }
  return /** @type {ReturnType<typeof createNavigator>} */ (found);
};

/**
 * A command at the caret: through the editor on screen, which applies what comes back, or, without
 * one (tests, an agent), over the whole text at the editor's caret.
 */
async function atCaret(/** @type {Deps} */ deps, /** @type {What} */ what) {
  const view = /** @type {{ navigate?(what: What): Promise<boolean> | boolean }} */ (
    /** @type {unknown} */ (deps.view)
  );
  if (view.navigate) {
    if (!(await view.navigate(what))) deps.say(t("features.navigate.index.openAConsoleToGoFrom"));
    return undefined;
  }
  const { text, end } = deps.view.editor();
  const answer = await of(deps).run(what, { text, caret: end, offset: 0 });
  if (answer?.move) deps.view.select(answer.move.from, answer.move.to);
  return answer ?? undefined;
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "navigate",
  commands: (deps) => ({
    "endue.database.go-to-definition": () => atCaret(deps, "definition"),
    "endue.database.show-card": () => atCaret(deps, "card"),
    "endue.database.find-usages": () => atCaret(deps, "usages"),
  }),
  actions: (deps) => ({
    navigate: (/** @type {What} */ what, /** @type {Window} */ w) => of(deps).run(what, w),
    navigateOpen: (
      /** @type {string} */ connection,
      /** @type {import("../../navigate/usages.js").Usage} */ usage,
    ) => of(deps).open(connection, usage),
  }),
  panels: { [PANEL]: { label: t("features.navigate.index.usages"), render: usagesPanel } },
  styles: [new URL("../../navigate/navigate.css", import.meta.url).href],
};
