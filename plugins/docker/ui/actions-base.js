// What every group of actions shares: the objects they act on (Item), confirming what cannot be
// undone with a preview of what goes, finishing with a refresh and a sentence, finding the target
// (named, under the cursor or marked), and one docker call per marked object (DOCK-19).

import { bulkSentence, runEach } from "./bulk.js";
import { objectRef } from "./refs.js";

/**
 * @typedef {import("./settings.js").Settings} Settings
 * @typedef {import("./run.js").RunOptions} RunOptions
 * @typedef {import("./run.js").Outcome} Outcome
 * @typedef {{ kind: "container", id: string, name: string, state: string, project: string }
 *   | { kind: "image", id: string, ref: string, dangling: boolean, containers: number | null }
 *   | { kind: "volume", name: string }
 *   | { kind: "network", id: string, name: string, builtin: boolean }
 *   | { kind: "project", name: string, files: string[] }
 *   | { kind: "section", section: string }
 *   | { kind: "field", section: string, label: string }
 *   | { kind: "goto", list: string, query: string }
 *   | { kind: "entry", path: string, dir: boolean }} Item
 * @typedef {{ id: string, label: string, detail?: string }} PickItem
 * @typedef {{ line(stream: string, line: string): void,
 *   end(state: "done" | "failed", error?: string): void }} Job
 * @typedef {{
 *   docker(args: string[], options?: RunOptions): Promise<Outcome>,
 *   cancel(): void,
 *   settings(): Settings,
 *   selection(): Item | undefined,
 *   marked(): Item[],
 *   setMarks(items: Item[]): void,
 *   track(title: string, tracker: import("./pane.js").Tracker): Job,
 *   refresh(): Promise<void>,
 *   say(text: string): void,
 *   pick(title: string, items: PickItem[], free?: boolean, placeholder?: string): Promise<string | undefined>,
 *   expect(id: string): void,
 *   cancelled(message: string): Error,
 * }} Deps
 * @typedef {Record<string, unknown>} Args
 * @typedef {{ ref: string, name: string, state: string, item?: Item }} Target
 */

/** "a, b and c", the first five and how many more. */
export function names(/** @type {string[]} */ list) {
  const shown = list.slice(0, 5);
  const more = list.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  return shown.length < 2
    ? (shown[0] ?? "")
    : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

/** The parts every group of actions shares: confirming, finishing, and finding what to act on. */
export function basics(/** @type {Deps} */ deps) {
  /**
   * Ask before something that cannot be undone; `confirm: false` in the settings skips the ask.
   * `detail` says under the yes what it takes away.
   */
  const confirm = async (
    /** @type {string} */ question,
    /** @type {string} */ yes,
    /** @type {string | undefined} */ detail = undefined,
  ) => {
    if (!deps.settings().confirm) return true;
    const answer = await deps.pick(question, [
      { id: "yes", label: yes, ...(detail ? { detail } : {}) },
      { id: "no", label: "Keep everything as it is" },
    ]);
    return answer === "yes";
  };

  /** Ask, and end the command as cancelled on anything but yes. */
  const ensure = async (
    /** @type {string} */ question,
    /** @type {string} */ yes,
    /** @type {string | undefined} */ detail = undefined,
  ) => {
    if (!(await confirm(question, yes, detail))) throw deps.cancelled("Nothing was changed.");
  };

  const done = async (/** @type {string} */ words) => {
    // The change happened: a screen that fails to read again does not make it a failure.
    await deps.refresh().catch(() => {});
    deps.say(words);
    return words;
  };

  /**
   * The object a command is about: the one its args name, else the selection when it is of `kind`.
   * @template {Item["kind"]} K
   * @param {Args} args
   * @param {K} kind
   * @param {string} key The args key that names one.
   * @returns {Extract<Item, { kind: K }> | { kind: K, named: string }}
   */
  const target = (args, kind, key) => {
    const named = args[key];
    if (named !== undefined) return { kind, named: String(named) };
    const item = deps.selection();
    if (item?.kind === kind) return /** @type {Extract<Item, { kind: K }>} */ (item);
    throw new Error(`Select a ${kind}, or name one with ${key}.`);
  };

  /**
   * Many objects at once: the list `plural` names in the args, else what is marked (two or more).
   * @param {Args} args
   * @param {Item["kind"]} kind
   * @param {string} plural
   * @param {(item: any) => Target} of How a marked item reads.
   * @returns {Target[] | undefined}
   */
  const many = (args, kind, plural, of) => {
    const listed = args[plural];
    if (listed !== undefined) {
      if (!Array.isArray(listed) || listed.length === 0)
        throw new Error(`${plural} is a list of names.`);
      return listed.map((named) => {
        const ref = objectRef(named, `The ${kind}`);
        return { ref, name: ref, state: "" };
      });
    }
    if (args[kind] !== undefined) return undefined;
    const marked = deps.marked().filter((item) => item.kind === kind);
    return marked.length > 1 ? marked.map(of) : undefined;
  };

  /**
   * Run one docker call per target, refresh once, say one sentence. The marks keep what failed.
   * An agent's list gets what was done and what failed; nothing done at all is a failure.
   * @param {Target[]} targets
   * @param {{ past: string, verb: string }} words
   * @param {string} noun
   * @param {(t: Target) => Promise<unknown>} fn
   * @param {boolean} answer Whether the command was given a list (and answers with data).
   */
  const bulk = async (targets, words, noun, fn, answer) => {
    const outcome = await runEach(targets, fn);
    const sentence = bulkSentence(
      words,
      noun,
      outcome.done.length,
      outcome.failed.map((f) => ({ name: f.item.name, message: f.message })),
    );
    deps.setMarks(outcome.failed.flatMap((f) => (f.item.item ? [f.item.item] : [])));
    await deps.refresh().catch(() => {});
    deps.say(sentence);
    if (outcome.done.length === 0) throw new Error(sentence);
    if (!answer) return sentence;
    return {
      done: outcome.done.map((t) => t.name),
      failed: outcome.failed.map((f) => ({ [noun]: f.item.ref, error: f.message })),
    };
  };

  return { confirm, ensure, done, target, many, bulk };
}
