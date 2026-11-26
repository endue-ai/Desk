// Eris in a console (PG-90, ADR 0345): Database: Eris writes a statement from a sentence (Mod+I),
// explains this statement (Mod+E), fixes this error (Mod+J) and explains this plan (Mod+Shift+H),
// each answered as a proposal the person puts in the console, changes or puts aside, never a run;
// what this console sends to Eris, and a connection closed to Eris or opened again. The brain is
// the desk's, through brain.ask (brain.js); what is sent is payload.js's and scope.js's.

import { t } from "../../strings/index.js";
import { createBrain } from "./brain.js";
import { createChoices } from "./choices.js";
import { createAssist } from "./flow.js";
import { proposalDialog } from "./proposal-dialog.js";
import { sentDialog } from "./sent-dialog.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("./payload.js").Task} Task
 */

/** The assist of a plugin's deps, made once and shared by its commands and its keys. */
const made = new WeakMap();
const assistOf = (/** @type {Deps} */ deps) => {
  let assist = made.get(deps);
  if (!assist) {
    const bridge = /** @type {import("./brain.js").Bridge} */ (deps.bridge);
    assist = createAssist(deps, { brain: createBrain(bridge), choices: createChoices(bridge) });
    made.set(deps, assist);
  }
  return /** @type {ReturnType<typeof createAssist>} */ (assist);
};

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "assist",
  commands: (deps) => ({
    "endue.database.assist-write": (args) => assistOf(deps).ask("write", args),
    "endue.database.assist-explain": () => assistOf(deps).ask("explain"),
    "endue.database.assist-fix": () => assistOf(deps).ask("fix"),
    "endue.database.assist-plan": () => assistOf(deps).ask("plan"),
    "endue.database.assist-sent": () => assistOf(deps).sent(),
    "endue.database.assist-close": () => assistOf(deps).closed(true),
    "endue.database.assist-open": () => assistOf(deps).closed(false),
  }),
  actions: (deps) => ({
    assistWrite: () => assistOf(deps).ask("write"),
    assistExplain: () => assistOf(deps).ask("explain"),
    assistFix: () => assistOf(deps).ask("fix"),
    assistPlan: () => assistOf(deps).ask("plan"),
  }),
  dialogs: {
    "assist-sent": { label: t("features.assist.index.whatIsSentToEris"), render: sentDialog },
    "assist-proposal": { label: t("features.assist.index.erisSProposal"), render: proposalDialog },
  },
  styles: [new URL("./assist.css", import.meta.url).href],
};
