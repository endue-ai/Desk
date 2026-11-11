// Who the plugin talks to and what is wrong with it: the versions `docker version` reports, the
// context in use, and the one problem the header shows until a read works again, with its kind
// (DockerError's), so the controller knows whether waiting can help.

import { explain, kindOf } from "./errors.js";
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
 * @param {() => void} [deps.back] A read worked while a problem was shown: the engine is back.
 */
export function createEngine({ runner, view, context, live, back = () => {} }) {
  /** @type {Version} */
  let version = { client: null, server: null };
  let problem = "";
  /** What kind of failure the problem is (missing, denied, daemon …), or "". */
  let kind = "";

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
    /** What `docker version` said last. */
    version: () => version,
    /** The sentence the header shows, or "". */
    problem: () => problem,
    /** What kind of failure the problem is, or "". */
    kind: () => kind,
    /** Whether the engine answered and nothing is wrong. */
    up: () => version.server !== null && problem === "",
    /** Ask the engine who it is; true when it answered. */
    async probe() {
      try {
        const outcome = await runner.run([...VERSION_ARGS], { ok: [1] });
        version = parseVersion(outcome.stdout);
        problem = version.server ? "" : explain([...VERSION_ARGS], outcome);
        kind = version.server ? "" : (kindOf(outcome.stderr) ?? "");
      } catch (error) {
        version = { client: null, server: null };
        problem = messageOf(error);
        kind = error instanceof DockerError ? (error.kind ?? "") : "";
      }
      header();
      return problem === "";
    },
    /** A run failed: when it says the engine is unreachable (not a missing Compose), say so. */
    failed(/** @type {unknown} */ error) {
      const failure = error instanceof DockerError ? error.kind : undefined;
      if (!failure || failure === "compose" || problem === messageOf(error)) return;
      problem = messageOf(error);
      kind = failure;
      header();
    },
    /** A read worked: whatever was wrong is not any more. */
    ok() {
      if (problem === "") return;
      problem = "";
      kind = "";
      header();
      back();
    },
  };
}
