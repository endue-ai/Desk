// What a prune or a clean-up would take away, read before the question so the question says it: how
// many of what, and how much space. Each preview is one line under the yes of the confirmation; a
// preview that cannot be read leaves the question as it was.

import { formatBytes, parseSize } from "./overview.js";
import { parseDiskUse } from "./parse-engine.js";
import {
  IMAGE_FORMAT,
  NETWORK_FORMAT,
  PS_FORMAT,
  parseContainers,
  parseImages,
  parseNetworks,
  parseVolumes,
  VOLUME_FORMAT,
} from "./parse-list.js";

/** @typedef {(args: string[], options?: import("./run.js").RunOptions) => Promise<import("./run.js").Outcome>} Docker */

const plural = (/** @type {number} */ n, /** @type {string} */ noun) =>
  `${n} ${noun}${n === 1 ? "" : "s"}`;

/** "a, b, c, d and 3 more". */
const some = (/** @type {string[]} */ list) =>
  list.length <= 4 ? list.join(", ") : `${list.slice(0, 4).join(", ")} and ${list.length - 4} more`;

const shortId = (/** @type {string} */ id) => id.replace(/^sha256:/, "").slice(0, 12);

/** The images a prune takes: dangling ones, or (`all`) every one no container uses. */
async function prunable(/** @type {Docker} */ docker, /** @type {boolean} */ all) {
  const images = parseImages(
    (await docker(["image", "ls", "--no-trunc", "--format", IMAGE_FORMAT])).stdout,
  );
  return images.filter((i) => (all ? i.containers === 0 || i.dangling : i.dangling));
}

/** "2 images, 1.2 GB: a, b". */
export async function previewImages(/** @type {Docker} */ docker, /** @type {boolean} */ all) {
  const gone = await prunable(docker, all);
  if (gone.length === 0) return "Nothing looks unused";
  const bytes = gone.reduce((sum, i) => sum + parseSize(i.size), 0);
  return `${plural(gone.length, "image")}, ${formatBytes(bytes)}: ${some(gone.map((i) => (i.dangling ? shortId(i.id) : i.ref)))}`;
}

/** The volumes no container uses: anonymous ones, or (`all`) named ones too. */
export async function previewVolumes(/** @type {Docker} */ docker, /** @type {boolean} */ all) {
  const { stdout } = await docker([
    "volume",
    "ls",
    "--filter",
    "dangling=true",
    "--format",
    VOLUME_FORMAT,
  ]);
  const gone = parseVolumes(stdout).filter((v) => all || v.anonymous);
  if (gone.length === 0) return "Nothing looks unused";
  return `${plural(gone.length, "volume")}: ${some(gone.map((v) => (v.anonymous ? `${v.name.slice(0, 12)}…` : v.name)))}`;
}

/** The networks no container uses, never the engine's own. */
async function unusedNetworks(/** @type {Docker} */ docker) {
  const { stdout } = await docker([
    "network",
    "ls",
    "--no-trunc",
    "--filter",
    "dangling=true",
    "--format",
    NETWORK_FORMAT,
  ]);
  return parseNetworks(stdout).filter((n) => !n.builtin);
}

export async function previewNetworks(/** @type {Docker} */ docker) {
  const gone = await unusedNetworks(docker);
  if (gone.length === 0) return "Nothing looks unused";
  return `${plural(gone.length, "network")}: ${some(gone.map((n) => n.name))}`;
}

/**
 * A clean-up: stopped containers, unused networks, dangling (or every unused) image, the build
 * cache, and with `volumes` the anonymous volumes no container uses.
 * @param {Docker} docker
 * @param {{ all: boolean, volumes: boolean }} options
 */
export async function previewSystem(docker, { all, volumes }) {
  const [ps, images, networks, df, vols] = await Promise.all([
    docker(["ps", "-a", "--no-trunc", "--format", PS_FORMAT]).then((r) =>
      parseContainers(r.stdout),
    ),
    prunable(docker, all),
    unusedNetworks(docker),
    docker(["system", "df", "--format", "{{json .}}"], { timeoutMs: 60_000 })
      .then((r) => parseDiskUse(r.stdout))
      .catch(() => []),
    volumes
      ? docker(["volume", "ls", "--filter", "dangling=true", "--format", VOLUME_FORMAT]).then((r) =>
          parseVolumes(r.stdout).filter((v) => v.anonymous),
        )
      : Promise.resolve([]),
  ]);
  const stopped = ps.filter(
    (c) => c.state === "exited" || c.state === "created" || c.state === "dead",
  );
  const imageBytes = images.reduce((sum, i) => sum + parseSize(i.size), 0);
  const cache = parseSize(df.find((d) => d.type === "Build Cache")?.reclaimable ?? "");
  const parts = [
    stopped.length ? `${plural(stopped.length, "stopped container")}` : "",
    images.length
      ? `${plural(images.length, all ? "unused image" : "dangling image")} (${formatBytes(imageBytes)})`
      : "",
    networks.length ? plural(networks.length, "unused network") : "",
    cache > 0 ? `${formatBytes(cache)} of build cache` : "",
    vols.length ? plural(vols.length, "anonymous volume") : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "Nothing looks unused";
}
