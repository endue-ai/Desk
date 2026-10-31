// What the Docker surface does to volumes, networks, Compose projects and the engine as a whole:
// remove and prune volumes and networks; up, down, start, stop, restart and pull a Compose project;
// prune the system. Same rules as actions.js: names checked, the irreversible confirmed, a sentence
// and a refresh at the end.

import { basics, reclaimed } from "./actions.js";
import { composeBase } from "./logs.js";
import { objectRef, projectName } from "./refs.js";

/**
 * @typedef {import("./actions.js").Deps} Deps
 * @typedef {import("./actions.js").Args} Args
 * @typedef {{ name: string, files: string[] }} ProjectRef
 */

/** The folder a file is in: Compose reads `.env` and relative paths from there. */
export function folderOf(/** @type {string} */ path) {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "/" : path.slice(0, cut);
}

/** An absolute path to a Compose file. */
function composeFile(/** @type {unknown} */ value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\0"))
    throw new Error(`The Compose file ${JSON.stringify(value)} is not an absolute path.`);
  return value;
}

/**
 * @param {Deps} deps
 * @param {{ project(name: string): ProjectRef | undefined }} known The projects `compose ls` listed.
 */
export function createMoreActions(deps, known) {
  const { docker } = deps;
  const { ensure, done, target } = basics(deps);

  /** @param {Args} args */
  const volume = (args) => {
    const found = target(args, "volume", "volume");
    return objectRef("named" in found ? found.named : found.name, "The volume");
  };

  /** @param {Args} [args] */
  const removeVolume = async (args = {}) => {
    const name = volume(args);
    await ensure(`Remove the volume ${name}? Its data is gone for good.`, `Remove ${name}`);
    await docker(["volume", "rm", "--", name]);
    return done(`Removed the volume ${name}.`);
  };

  /** @param {Args} [args] `all: true` takes named volumes too, not only anonymous ones. */
  const pruneVolumes = async (args = {}) => {
    const all = args.all === true;
    await ensure(
      all
        ? "Remove every volume no container uses, named ones too? Their data is gone for good."
        : "Remove every anonymous volume no container uses? Their data is gone for good.",
      "Remove them",
    );
    const { stdout } = await docker(["volume", "prune", "-f", ...(all ? ["-a"] : [])], {
      timeoutMs: 0,
    });
    return done(reclaimed(stdout, "No volume was removed."));
  };

  /** @param {Args} [args] */
  const removeNetwork = async (args = {}) => {
    const found = target(args, "network", "network");
    const ref = objectRef("named" in found ? found.named : found.id, "The network");
    const name = "named" in found ? found.named : found.name;
    if (["bridge", "host", "none"].includes(name))
      throw new Error(`${name} is one of the engine's own networks and cannot be removed.`);
    await ensure(`Remove the network ${name}?`, `Remove ${name}`);
    await docker(["network", "rm", "--", ref]);
    return done(`Removed the network ${name}.`);
  };

  const pruneNetworks = async () => {
    await ensure("Remove every network no container uses?", "Remove them");
    const { stdout } = await docker(["network", "prune", "-f"]);
    const gone = stdout.split("\n").filter((line) => line.trim() !== "" && !/^Deleted/.test(line));
    return done(
      gone.length
        ? `Removed ${gone.length} network${gone.length === 1 ? "" : "s"}.`
        : "No network was removed.",
    );
  };

  /**
   * The project a command is about: named (and known to `compose ls`), selected, or a Compose file.
   * @param {Args} args
   * @returns {ProjectRef & { file?: string }}
   */
  const project = (args) => {
    if (args.file !== undefined && args.project === undefined) {
      const file = composeFile(args.file);
      return { name: "", files: [file], file };
    }
    const found = target(args, "project", "project");
    if (!("named" in found)) return { name: found.name, files: found.files };
    const name = projectName(found.named);
    return known.project(name) ?? { name, files: [] };
  };

  /** `docker compose -p NAME [-f FILE]…` (a file alone lets Compose name the project). */
  const base = (/** @type {ProjectRef} */ ref, /** @type {boolean} */ withFiles) => {
    const files = withFiles ? ref.files.flatMap((file) => ["-f", file]) : [];
    if (ref.name === "") return ["compose", "--ansi", "never", ...files];
    return [...composeBase(ref.name), ...files];
  };

  /**
   * Where compose runs: next to the files it reads, else at the root, so a compose file in some
   * other working folder is never picked up for a project named by its labels.
   */
  const where = (/** @type {ProjectRef} */ ref, /** @type {boolean} */ withFiles) =>
    withFiles && ref.files[0] ? { cwd: folderOf(ref.files[0]) } : { cwd: "/" };

  /** How a project reads: its name, or for a file Compose names itself, the folder it is in. */
  const label = (/** @type {ProjectRef & { file?: string }} */ ref) =>
    ref.name || `the project in ${folderOf(ref.file ?? "")}`;

  /** @param {Args} [args] */
  const up = async (args = {}) => {
    const ref = project(args);
    if (ref.files.length === 0)
      throw new Error(`Compose does not know where ${ref.name}'s files are: up it with a file.`);
    deps.say(`Starting ${label(ref)}…`);
    await docker([...base(ref, true), "up", "-d"], { ...where(ref, true), timeoutMs: 0 });
    return done(`${label(ref)} is up.`);
  };

  /** @param {Args} [args] `volumes: true` also removes the project's named volumes. */
  const down = async (args = {}) => {
    const ref = project(args);
    const volumes = args.volumes === true;
    await ensure(
      volumes
        ? `Take ${label(ref)} down and remove its volumes? Their data is gone for good.`
        : `Take ${label(ref)} down? Its containers and networks are removed; volumes and images stay.`,
      `Take ${label(ref)} down`,
    );
    await docker([...base(ref, ref.name === ""), "down", ...(volumes ? ["-v"] : [])], {
      ...where(ref, ref.name === ""),
      timeoutMs: 0,
    });
    return done(`${label(ref)} is down.`);
  };

  /**
   * @param {"start" | "stop" | "restart"} verb
   * @param {string} past
   */
  const verb =
    (verb, past) =>
    async (/** @type {Args} */ args = {}) => {
      const ref = project(args);
      const timed =
        verb === "stop" || verb === "restart" ? ["-t", String(deps.settings().stopTimeout)] : [];
      await docker([...base(ref, ref.name === ""), verb, ...timed], {
        ...where(ref, ref.name === ""),
        timeoutMs: 0,
      });
      return done(`${past} ${label(ref)}.`);
    };

  /** @param {Args} [args] */
  const pull = async (args = {}) => {
    const ref = project(args);
    if (ref.files.length === 0)
      throw new Error(`Compose does not know where ${ref.name}'s files are: pull it with a file.`);
    deps.say(`Pulling ${label(ref)}'s images…`);
    await docker([...base(ref, true), "pull"], { ...where(ref, true), timeoutMs: 0 });
    return done(`Pulled ${label(ref)}'s images.`);
  };

  /** @param {Args} [args] `volumes: true` also removes anonymous volumes; `all: true` unused images. */
  const pruneSystem = async (args = {}) => {
    const volumes = args.volumes === true;
    const all = args.all === true;
    await ensure(
      `Remove stopped containers, unused networks, ${all ? "every unused image" : "dangling images"} and the build cache${volumes ? ", and anonymous volumes no container uses" : ""}?`,
      "Clean up",
    );
    const { stdout } = await docker(
      ["system", "prune", "-f", ...(all ? ["-a"] : []), ...(volumes ? ["--volumes"] : [])],
      { timeoutMs: 0 },
    );
    return done(reclaimed(stdout, "Nothing needed cleaning up."));
  };

  return {
    removeVolume,
    pruneVolumes,
    removeNetwork,
    pruneNetworks,
    up,
    down,
    composeStart: verb("start", "Started"),
    composeStop: verb("stop", "Stopped"),
    composeRestart: verb("restart", "Restarted"),
    composePull: pull,
    pruneSystem,
  };
}
