// Who the plugin talks to and what is wrong with it: the versions `docker version` reports, the
// context in use, and the one problem the header shows until a read works again.

import { explain } from "./errors.js";
import { VERSION_ARGS } from "./lists.js";
import { parseVersion } from "./parse-engine.js";
import { DockerError } from "./run.js";

/**
 * @typedef {import("./parse-engine.js").Version} Version
 * @typedef {{ context: string, engine: string, problem: string, live: boolean }} Header
 */

const messageOf = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/**
 * @param {object} deps
 * @param {Pick<ReturnType<typeof import("./run.js").createRunner>, "run">} deps.runner
 * @param {{ header(header: Header): void }} deps.view
 * @param {() => string} deps.context The context picked in the plugin, or "".
 * @param {() => boolean} deps.live Whether the event stream runs.
 */
export function createEngine({ runner, view, context, live }) {
  /** @type {Version} */
  let version = { client: null, server: null };
  let problem = "";

  const header = () => {
    const server = version.server;
    view.header({
      context: context() || version.client?.context || "",
      engine: server
        ? `Docker ${server.version}${server.platform ? ` · ${server.platform}` : ""}`
        : "",
      problem,
      live: live(),
    });
  };

  return {
    header,
    /** Ask the engine who it is; true when it answered. */
    async probe() {
      try {
        const outcome = await runner.run([...VERSION_ARGS], { ok: [1] });
        version = parseVersion(outcome.stdout);
        problem = version.server ? "" : explain([...VERSION_ARGS], outcome);
      } catch (error) {
        version = { client: null, server: null };
        problem = messageOf(error);
      }
      header();
      return problem === "";
    },
    /** A run failed: when it says the engine is unreachable (not a missing Compose), say so. */
    failed(/** @type {unknown} */ error) {
      const kind = error instanceof DockerError ? error.kind : undefined;
      if (!kind || kind === "compose" || problem === messageOf(error)) return;
      problem = messageOf(error);
      header();
    },
    /** A read worked: whatever was wrong is not any more. */
    ok() {
      if (problem === "") return;
      problem = "";
      header();
    },
  };
}
