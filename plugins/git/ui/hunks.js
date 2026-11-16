// Staging, unstaging and discarding part of a file: the hunk under the cursor, or the lines chosen
// in it. The patch goes to `git apply -` on its stdin (ADR 0248). A discard runs as the plugin's own
// command endue.git.discard-patch, invoked through the desk, so the desk's undo stack holds it and
// endue.git.restore-patch, its inverse, puts the lines back.

import { allLines, linesPatch } from "./patch.js";

/**
 * @typedef {import("./actions.js").Item} Item
 * @typedef {import("./git.js").DiffView} DiffView
 * @typedef {import("./run.js").RunOptions} RunOptions
 * @typedef {import("./run.js").Outcome} Outcome
 * @typedef {{ kind: "hunk" | "line", path: string, index: number }
 *   | { kind: "lines", path: string, index: number, from: number, to: number }} Part
 * @typedef {{ path: string, patch: string, what: string }} DiscardArgs
 * @typedef {{
 *   git(args: string[], options?: RunOptions): Promise<Outcome>,
 *   diff(): DiffView | null,
 *   invoke(id: string, args: unknown): Promise<unknown>,
 *   confirm(question: string, yes: string): Promise<boolean>,
 *   done(words: string): Promise<void>,
 *   cancelled(message: string): Error,
 * }} Deps
 */

const APPLY = ["apply", "--recount", "--whitespace=nowarn"];

/** Whether an item is part of a file in a diff. @returns {item is Part} */
export const isPart = (/** @type {Item | undefined} */ item) =>
  item?.kind === "hunk" || item?.kind === "line" || item?.kind === "lines";

/** @param {Deps} deps */
export function createHunkActions(deps) {
  /**
   * The patch for a part of the diff on screen, checked against the side it must be on.
   * @param {Part} part
   * @param {"stage" | "unstage" | "discard"} verb
   */
  const patchOf = (part, verb) => {
    const view = deps.diff();
    if (!view) throw new Error(`Open the diff to ${verb} part of a file.`);
    if (view.target.sha) throw new Error(`A commit's changes cannot be ${verb}d here.`);
    const staged = view.target.staged === true;
    if (verb === "stage" && staged) throw new Error("That change is staged already.");
    if (verb === "unstage" && !staged) throw new Error("That change is not staged.");
    if (verb === "discard" && staged) throw new Error("Unstage the change before discarding it.");
    const file = view.files.find((f) => f.path === part.path);
    const hunk = file?.hunks[part.index];
    if (!file || !hunk) throw new Error("The diff changed: look again.");
    if (file.binary) throw new Error(`${file.path} is binary: ${verb} the whole file.`);
    const chosen =
      part.kind === "lines"
        ? new Set(hunk.lines.map((_, i) => i).filter((i) => i >= part.from && i <= part.to))
        : allLines(hunk);
    const patch = linesPatch(file, hunk, chosen, verb !== "stage");
    if (patch === null) throw new Error("The chosen lines change nothing.");
    const count = [...chosen].filter((i) => hunk.lines[i]?.kind === "add" || hunk.lines[i]?.kind === "del").length;
    const what = part.kind === "lines" ? `${count} line${count === 1 ? "" : "s"} of ${file.path}` : `a hunk of ${file.path}`;
    return { path: file.path, patch, what };
  };

  const stage = async (/** @type {Part} */ part) => {
    const { patch, what } = patchOf(part, "stage");
    await deps.git([...APPLY, "--cached", "-"], { input: patch });
    await deps.done(`Staged ${what}.`);
  };

  const unstage = async (/** @type {Part} */ part) => {
    const { patch, what } = patchOf(part, "unstage");
    await deps.git([...APPLY, "--cached", "--reverse", "-"], { input: patch });
    await deps.done(`Unstaged ${what}.`);
  };

  /** The key: build the patch, then run it as a command the desk can undo. */
  const discard = async (/** @type {Part} */ part) => {
    await deps.invoke("endue.git.discard-patch", patchOf(part, "discard"));
  };

  /**
   * endue.git.discard-patch: ask, then take the patch's change out of the worktree. Keeping the
   * change answers `cancelled`, so the desk pushes no undo for it.
   * @param {Partial<DiscardArgs>} args
   */
  const discardPatch = async (args) => {
    const { path, patch, what } = checked(args);
    if (!(await deps.confirm(`Discard ${what}?`, "Discard it")))
      throw deps.cancelled(`Kept ${what}.`);
    await deps.git([...APPLY, "--reverse", "-"], { input: patch });
    await deps.done(`Discarded ${what}.`);
    return { path };
  };

  /** endue.git.restore-patch, the inverse cmd.undo invokes with `{ args, result }`. */
  const restorePatch = async (/** @type {{ args?: Partial<DiscardArgs> }} */ undo) => {
    const { patch, what } = checked(undo?.args ?? {});
    await deps.git([...APPLY, "-"], { input: patch });
    await deps.done(`Put back ${what}.`);
  };

  return { stage, unstage, discard, discardPatch, restorePatch };
}

/** @param {Partial<DiscardArgs>} args @returns {DiscardArgs} */
function checked(args) {
  const { path, patch } = args;
  if (typeof path !== "string" || path === "") throw new Error("A path is empty.");
  if (typeof patch !== "string" || !patch.startsWith("diff --git "))
    throw new Error("The patch is not a diff.");
  return { path, patch, what: typeof args.what === "string" ? args.what : `the change to ${path}` };
}
