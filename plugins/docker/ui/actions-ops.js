// What moves files or makes images: build an image from a Dockerfile (DOCK-20) with its output in
// the pane, and copy a path out of a container or a file into one (DOCK-22). From the keyboard each
// asks for what it needs through the palette; agents and the drop target name it all.

import { basics } from "./actions.js";
import { buildArgs, createBuildProgress } from "./images.js";

/**
 * @typedef {import("./actions.js").Deps} Deps
 * @typedef {import("./actions.js").Args} Args
 * @typedef {{ copyOut(args: Args, dest: string): Promise<string>,
 *   copyIn(args: Args, source: string): Promise<string>, folder(): string | undefined }} Files
 */

const messageOf = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/**
 * @param {Deps} deps
 * @param {Files} files The pane's copies.
 */
export function createOps(deps, files) {
  const { done } = basics(deps);

  /** Ask for text; nothing (or cancel) ends the command as cancelled. */
  const ask = async (
    /** @type {string} */ title,
    /** @type {string} */ placeholder,
    /** @type {string} */ none,
    empty = false,
  ) => {
    const answer = await deps.pick(title, [], true, placeholder);
    if (answer === undefined || (!empty && answer.trim() === "")) throw deps.cancelled(none);
    return answer.trim();
  };

  /** @param {Args} [args] `{ dockerfile, tag?, context?, pull?, noCache? }`; asked for when absent. */
  const build = async (args = {}) => {
    /** @type {Parameters<typeof buildArgs>[0]} */
    let spec = args;
    if (args.dockerfile === undefined) {
      const dockerfile = await ask(
        "Docker: build which Dockerfile? (its absolute path)",
        "/path/to/Dockerfile",
        "Nothing was built.",
      );
      const tag = await ask(
        "Docker: tag the image as? (empty: no tag)",
        "name:tag",
        "Nothing was built.",
        true,
      );
      spec = { dockerfile, tag };
    }
    const { args: argv, cwd } = buildArgs(spec);
    const label = typeof spec.tag === "string" && spec.tag !== "" ? spec.tag : cwd;
    const progress = createBuildProgress();
    const job = deps.track(`Build ${label}`, progress);
    deps.say(`Building ${label}…`);
    try {
      await deps.docker(argv, { cwd, timeoutMs: 0, onLine: job.line });
    } catch (error) {
      if (/** @type {{ cancelled?: boolean }} */ (error)?.cancelled) {
        job.end("failed", "Cancelled.");
        throw error;
      }
      const why = progress.progress().error || messageOf(error);
      job.end("failed", why);
      throw new Error(`The build failed: ${why.replace(/\.$/, "")}.`);
    }
    job.end("done");
    return done(`Built ${label}.`);
  };

  /** @param {Args} [args] `{ container?, path, dest? }`: the destination is asked for when absent. */
  const copyOut = async (args = {}) => {
    if (args.path === undefined) throw new Error("Say which path of the container to copy out.");
    const dest =
      typeof args.dest === "string"
        ? args.dest
        : await ask(
            `Docker: copy ${String(args.path)} into which folder of this computer?`,
            "an absolute path, like /Users/me/Downloads",
            "Nothing was copied.",
          );
    deps.say(`Copying ${String(args.path)}…`);
    const words = await files.copyOut(args, dest);
    deps.say(words);
    return words;
  };

  /** @param {Args} [args] `{ container?, source?, path? }`: into the folder the Files tab shows. */
  const copyIn = async (args = {}) => {
    const into = typeof args.path === "string" ? args.path : (files.folder() ?? "/");
    const source =
      typeof args.source === "string"
        ? args.source
        : await ask(
            `Docker: copy which file or folder of this computer into ${into}?`,
            "an absolute path, like /Users/me/seed.sql",
            "Nothing was copied.",
          );
    deps.say(`Copying ${source}…`);
    const words = await files.copyIn({ ...args, path: into }, source);
    deps.say(words);
    return words;
  };

  return { build, copyOut, copyIn };
}
