// The overview the plugin opens on, without its DOM: the engine, containers counted by state, the
// Compose stacks with a dot per service, disk use per kind with what could be reclaimed, and the
// images, volumes and networks in a few numbers. Built from the lists' own models, so it costs no
// docker call of its own. Sizes are docker's text ("1.2GB", "37.75MiB") read as bytes.

/**
 * @typedef {import("./parse-list.js").Container} Container
 * @typedef {import("./parse-list.js").Project} Project
 * @typedef {import("./parse-list.js").Image} Image
 * @typedef {import("./parse-list.js").Volume} Volume
 * @typedef {import("./parse-list.js").Network} Network
 * @typedef {import("./parse-engine.js").DiskUse} DiskUse
 * @typedef {import("./parse-engine.js").Version} Version
 * @typedef {{ running: number, unhealthy: number, paused: number, restarting: number,
 *   stopped: number, total: number }} Counts
 * @typedef {{ name: string, id: string, state: string, health: string | null }} Service
 * @typedef {{ name: string, running: number, total: number, state: "running" | "partial" | "exited",
 *   services: Service[], files: string[] }} Stack
 * @typedef {{ type: string, label: string, bytes: number, reclaimable: number, count: number,
 *   active: number }} DiskRow
 * @typedef {{
 *   engine: { up: boolean, version: string, platform: string, context: string, problem: string },
 *   counts: Counts, stacks: Stack[], standalone: number,
 *   running: Array<{ id: string, name: string, project: string }>,
 *   disk: { rows: DiskRow[], bytes: number, reclaimable: number } | null,
 *   images: { count: number, bytes: number, dangling: { count: number, bytes: number },
 *     unused: number, largest: Array<{ ref: string, bytes: number }> },
 *   volumes: { count: number, anonymous: number, named: number },
 *   networks: { count: number, custom: number },
 * }} Overview
 * @typedef {{ containers?: Container[], projects?: Project[], images?: Image[], volumes?: Volume[],
 *   networks?: Network[], disk?: DiskUse[] | null, version?: Version, context?: string,
 *   problem?: string }} Sources
 */

const UNITS = /** @type {Record<string, number>} */ ({
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  pb: 1e15,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
});

/** docker's size text as bytes: "1.2GB", "438MB", "37.75MiB", "0B", "15.16GB (56%)"; 0 when unreadable. */
export function parseSize(/** @type {unknown} */ text) {
  if (typeof text !== "string") return 0;
  const found = /^\s*([\d.]+)\s*([kmgtp]i?b|b)\b/i.exec(text);
  if (!found) return 0;
  const n = Number.parseFloat(found[1] ?? "");
  const unit = UNITS[(found[2] ?? "").toLowerCase()] ?? 0;
  return Number.isFinite(n) ? Math.round(n * unit) : 0;
}

/** Bytes as docker writes them, in powers of 1000: "1.2 GB", "394 MB", "0 B". */
export function formatBytes(/** @type {number} */ n) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "kB", "MB", "GB", "TB", "PB"];
  let value = n;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const digits = value >= 100 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits).replace(/\.0$/, "")} ${units[unit]}`;
}

/** Which of the overview's buckets a container counts in. */
export function bucketOf(/** @type {Pick<Container, "state" | "health">} */ c) {
  if (c.state === "running") return c.health === "unhealthy" ? "unhealthy" : "running";
  if (c.state === "paused") return "paused";
  if (c.state === "restarting") return "restarting";
  return "stopped";
}

/** @param {Container[]} containers @returns {Counts} */
export function countStates(containers) {
  const counts = { running: 0, unhealthy: 0, paused: 0, restarting: 0, stopped: 0, total: 0 };
  for (const c of containers) {
    counts[bucketOf(c)]++;
    counts.total++;
  }
  return counts;
}

/**
 * The Compose stacks: every project `compose ls` knows, and any project label a container carries
 * that it does not, each with its services' containers. Sorted by name.
 * @param {Project[]} projects
 * @param {Container[]} containers
 * @returns {Stack[]}
 */
export function stacksOf(projects, containers) {
  /** @type {Map<string, Stack>} */
  const stacks = new Map();
  const stack = (/** @type {string} */ name, /** @type {string[]} */ files) => {
    const found = stacks.get(name);
    if (found) return found;
    /** @type {Stack} */
    const made = { name, running: 0, total: 0, state: "exited", services: [], files };
    stacks.set(name, made);
    return made;
  };
  for (const p of projects) stack(p.name, p.files);
  for (const c of containers) {
    if (c.project === "") continue;
    const s = stack(c.project, []);
    s.services.push({ name: c.service || c.name, id: c.id, state: c.state, health: c.health });
    s.total++;
    if (c.state === "running") s.running++;
  }
  for (const s of stacks.values()) {
    // A project compose ls counted whose containers this read did not see keeps compose's numbers.
    const listed = projects.find((p) => p.name === s.name);
    if (s.total === 0 && listed) {
      s.running = listed.running;
      s.total = listed.total;
    }
    s.services.sort((a, b) => a.name.localeCompare(b.name));
    s.state = s.running === 0 ? "exited" : s.running < s.total ? "partial" : "running";
  }
  return [...stacks.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** `system df`'s kinds, in the order the card lists them. */
const DISK_LABELS = /** @type {Record<string, string>} */ ({
  Images: "Images",
  Containers: "Containers",
  "Local Volumes": "Volumes",
  "Build Cache": "Build cache",
});

/** @param {DiskUse[]} disk */
function diskOf(disk) {
  const rows = disk.map((d) => ({
    type: d.type,
    label: DISK_LABELS[d.type] ?? d.type,
    bytes: parseSize(d.size),
    reclaimable: parseSize(d.reclaimable),
    count: Number.parseInt(d.total, 10) || 0,
    active: Number.parseInt(d.active, 10) || 0,
  }));
  return {
    rows,
    bytes: rows.reduce((sum, r) => sum + r.bytes, 0),
    reclaimable: rows.reduce((sum, r) => sum + r.reclaimable, 0),
  };
}

/** @param {Image[]} images */
function imagesOf(images) {
  const sized = images.map((i) => ({
    ref: i.dangling ? "<none>" : i.ref,
    bytes: parseSize(i.size),
  }));
  const dangling = images.filter((i) => i.dangling);
  return {
    count: images.length,
    bytes: sized.reduce((sum, i) => sum + i.bytes, 0),
    dangling: {
      count: dangling.length,
      bytes: dangling.reduce((sum, i) => sum + parseSize(i.size), 0),
    },
    unused: images.filter((i) => i.containers === 0).length,
    largest: sized
      .filter((i) => i.ref !== "<none>")
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 3),
  };
}

/**
 * @param {Sources} sources What the reads brought; a part that failed is left out.
 * @returns {Overview}
 */
export function overviewModel(sources) {
  const containers = sources.containers ?? [];
  const volumes = sources.volumes ?? [];
  const networks = sources.networks ?? [];
  const server = sources.version?.server ?? null;
  return {
    engine: {
      up: server !== null && !sources.problem,
      version: server?.version ?? "",
      platform: server?.platform ?? "",
      context: sources.context || sources.version?.client?.context || "",
      problem: sources.problem ?? "",
    },
    counts: countStates(containers),
    running: containers
      .filter((c) => c.state === "running")
      .map((c) => ({ id: c.id, name: c.name, project: c.project })),
    stacks: stacksOf(sources.projects ?? [], containers),
    standalone: containers.filter((c) => c.project === "").length,
    disk: sources.disk ? diskOf(sources.disk) : null,
    images: imagesOf(sources.images ?? []),
    volumes: {
      count: volumes.length,
      anonymous: volumes.filter((v) => v.anonymous).length,
      named: volumes.filter((v) => !v.anonymous).length,
    },
    networks: { count: networks.length, custom: networks.filter((n) => !n.builtin).length },
  };
}
