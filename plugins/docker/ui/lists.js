// The reads behind each list: which docker commands fill it and how their output becomes the model
// the view draws. Reads run in parallel where a list needs more than one.

import { parseContexts, parseDiskUse, parseStats, parseVersion } from "./parse-engine.js";
import {
  IMAGE_FORMAT,
  NETWORK_FORMAT,
  PS_FORMAT,
  parseContainers,
  parseImages,
  parseNetworks,
  parseProjects,
  parseVolumes,
  VOLUME_FORMAT,
} from "./parse-list.js";

/**
 * @typedef {import("./run.js").Outcome} Outcome
 * @typedef {import("./run.js").RunOptions} RunOptions
 * @typedef {(args: string[], options?: RunOptions) => Promise<Outcome>} Docker
 * @typedef {import("./parse-list.js").Container} Container
 * @typedef {import("./parse-list.js").Project} Project
 * @typedef {import("./parse-engine.js").Version} Version
 * @typedef {import("./parse-engine.js").Context} Context
 * @typedef {import("./parse-engine.js").DiskUse} DiskUse
 * @typedef {import("./parse-engine.js").Stats} Stats
 * @typedef {{ containers: Container[], stats: Map<string, Stats>, all: boolean }} ContainersModel
 * @typedef {{ projects: Project[], containers: Container[] }} ComposeModel
 * @typedef {{ images: import("./parse-list.js").Image[] }} ImagesModel
 * @typedef {{ volumes: import("./parse-list.js").Volume[] }} VolumesModel
 * @typedef {{ networks: import("./parse-list.js").Network[] }} NetworksModel
 * @typedef {{ version: Version, contexts: Context[], disk: DiskUse[], context: string }} SystemModel
 */

/** `docker version`: exit 1 still prints the client when the daemon is down. */
export const VERSION_ARGS = Object.freeze(["version", "--format", "{{json .}}"]);
export const STATS_ARGS = Object.freeze([
  "stats",
  "--no-stream",
  "--no-trunc",
  "--format",
  "{{json .}}",
]);
export const CONTEXT_ARGS = Object.freeze(["context", "ls", "--format", "{{json .}}"]);

/** @param {Docker} docker */
export function createLoaders(docker) {
  const ps = async (/** @type {boolean} */ all) =>
    parseContainers(
      (await docker(["ps", ...(all ? ["-a"] : []), "--no-trunc", "--format", PS_FORMAT])).stdout,
    );

  return {
    ps,

    /** @param {boolean} all */
    async containers(all) {
      return { containers: await ps(all), all };
    },

    /** @returns {Promise<ComposeModel>} */
    async compose() {
      const [ls, containers] = await Promise.all([
        docker(["compose", "--ansi", "never", "ls", "--all", "--format", "json"]),
        ps(true),
      ]);
      return {
        projects: parseProjects(ls.stdout),
        containers: containers.filter((c) => c.project !== ""),
      };
    },

    /** @returns {Promise<ImagesModel>} */
    async images() {
      const { stdout } = await docker(["image", "ls", "--no-trunc", "--format", IMAGE_FORMAT]);
      return { images: parseImages(stdout) };
    },

    /** @returns {Promise<VolumesModel>} */
    async volumes() {
      const { stdout } = await docker(["volume", "ls", "--format", VOLUME_FORMAT]);
      return { volumes: parseVolumes(stdout) };
    },

    /** @returns {Promise<NetworksModel>} */
    async networks() {
      const { stdout } = await docker(["network", "ls", "--no-trunc", "--format", NETWORK_FORMAT]);
      return { networks: parseNetworks(stdout) };
    },

    /**
     * @param {string} context The context picked in the plugin, or "" for the CLI's.
     * @returns {Promise<SystemModel>}
     */
    async system(context) {
      const [version, disk, contexts] = await Promise.all([
        docker([...VERSION_ARGS], { ok: [1] }),
        docker(["system", "df", "--format", "{{json .}}"], { timeoutMs: 60_000 }),
        docker([...CONTEXT_ARGS]),
      ]);
      return {
        version: parseVersion(version.stdout),
        disk: parseDiskUse(disk.stdout),
        contexts: parseContexts(contexts.stdout),
        context,
      };
    },

    /** One sample of every running container's use; docker takes about two seconds for it. */
    async stats() {
      return parseStats((await docker([...STATS_ARGS], { timeoutMs: 30_000 })).stdout);
    },
  };
}
