// The lists docker prints: containers, images, volumes, networks and Compose projects. Each list is
// asked for with a Go template that writes one JSON object per line with only the fields the views
// need (no `.Size`, which makes docker measure every container), so field names are ours and stable
// across CLI versions. Parsing never throws: a line that is not an object is skipped.

/**
 * @typedef {"running" | "paused" | "restarting" | "exited" | "created" | "dead" | "removing"} State
 * @typedef {"healthy" | "unhealthy" | "starting" | null} Health
 * @typedef {{ ip: string, host: string, container: string, proto: string }} Port
 * @typedef {{ id: string, name: string, image: string, state: State, status: string, health: Health,
 *   ports: Port[], created: string, project: string, service: string, command: string }} Container
 * @typedef {{ id: string, repository: string, tag: string, digest: string, created: string,
 *   size: string, containers: number | null, dangling: boolean, ref: string }} Image
 * @typedef {{ name: string, driver: string, mountpoint: string, anonymous: boolean, project: string }} Volume
 * @typedef {{ id: string, name: string, driver: string, scope: string, internal: boolean,
 *   project: string, builtin: boolean }} Network
 * @typedef {{ name: string, status: string, files: string[], running: number, total: number }} Project
 */

const PROJECT = '(.Label "com.docker.compose.project")';

/** `docker ps -a --no-trunc --format <this>`. */
export const PS_FORMAT = template({
  id: ".ID",
  names: ".Names",
  image: ".Image",
  state: ".State",
  status: ".Status",
  ports: ".Ports",
  created: ".CreatedAt",
  command: ".Command",
  project: PROJECT,
  service: '(.Label "com.docker.compose.service")',
});

/** `docker image ls --no-trunc --format <this>`. */
export const IMAGE_FORMAT = template({
  id: ".ID",
  repository: ".Repository",
  tag: ".Tag",
  digest: ".Digest",
  created: ".CreatedAt",
  size: ".Size",
  containers: ".Containers",
});

/** `docker volume ls --format <this>`. The anonymous label has no value, so the labels are read. */
export const VOLUME_FORMAT = template({
  name: ".Name",
  driver: ".Driver",
  mountpoint: ".Mountpoint",
  labels: ".Labels",
  project: PROJECT,
});

/** `docker network ls --no-trunc --format <this>`. */
export const NETWORK_FORMAT = template({
  id: ".ID",
  name: ".Name",
  driver: ".Driver",
  scope: ".Scope",
  internal: ".Internal",
  project: PROJECT,
});

/** The networks every engine has; they cannot be removed. */
const BUILTIN_NETWORKS = new Set(["bridge", "host", "none"]);

const STATES = new Set([
  "running",
  "paused",
  "restarting",
  "exited",
  "created",
  "dead",
  "removing",
]);

/** A Go template that writes `fields` as one JSON object. */
function template(/** @type {Record<string, string>} */ fields) {
  const parts = Object.entries(fields).map(([key, expr]) => `"${key}":{{json ${expr}}}`);
  return `{${parts.join(",")}}`;
}

/**
 * The objects in docker's output: one per line (NDJSON), or one JSON array (older Compose).
 * @param {string} stdout
 * @returns {Record<string, unknown>[]}
 */
export function records(stdout) {
  const text = stdout.trim();
  if (text === "") return [];
  if (text.startsWith("[")) {
    try {
      const all = JSON.parse(text);
      if (Array.isArray(all)) return all.filter(isObject);
    } catch {
      // Not one array: read it line by line below.
    }
  }
  /** @type {Record<string, unknown>[]} */
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const value = JSON.parse(trimmed);
      if (isObject(value)) out.push(value);
    } catch {
      // A broken line is skipped; the rest of the list still reads.
    }
  }
  return out;
}

const isObject = (/** @type {unknown} */ value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (/** @type {unknown} */ value) => (typeof value === "string" ? value : "");

/** A number docker wrote as text; "N/A" and the like are null. */
const count = (/** @type {unknown} */ value) => {
  const n = typeof value === "number" ? value : Number.parseInt(str(value), 10);
  return Number.isFinite(n) ? n : null;
};

/** The health a status text ends with: "Up 2 hours (healthy)". */
export function healthOf(/** @type {string} */ status) {
  const found = /\((healthy|unhealthy|health: starting)\)/.exec(status)?.[1];
  if (!found) return null;
  return found === "health: starting" ? "starting" : /** @type {Health} */ (found);
}

/** @returns {Container[]} */
export function parseContainers(/** @type {string} */ stdout) {
  return records(stdout).map((r) => {
    const status = str(r.status);
    const state = str(r.state).toLowerCase();
    return {
      id: str(r.id),
      // A container with links lists every name; the first is its own.
      name: str(r.names).split(",")[0] ?? "",
      image: str(r.image),
      state: /** @type {State} */ (STATES.has(state) ? state : stateOf(status)),
      status,
      health: healthOf(status),
      ports: parsePorts(str(r.ports)),
      created: str(r.created),
      command: str(r.command).replace(/^"|"$/g, ""),
      project: str(r.project),
      service: str(r.service),
    };
  });
}

/** The state an older CLI (no `.State`) shows only in its status text. */
function stateOf(/** @type {string} */ status) {
  if (/^Up .*\(Paused\)/.test(status)) return "paused";
  if (/^Up /.test(status)) return "running";
  if (/^Restarting/.test(status)) return "restarting";
  if (/^Exited/.test(status)) return "exited";
  if (/^Dead/.test(status)) return "dead";
  if (/^Removal/.test(status)) return "removing";
  return "created";
}

/**
 * docker's ports column: "0.0.0.0:8080->80/tcp, [::]:8080->80/tcp, 5432/tcp". The same mapping on
 * IPv4 and IPv6 is one entry; a port only exposed has no host side.
 * @returns {Port[]}
 */
export function parsePorts(/** @type {string} */ text) {
  /** @type {Port[]} */
  const out = [];
  const seen = new Set();
  for (const raw of text.split(",")) {
    const part = raw.trim();
    if (part === "") continue;
    const mapped = /^(.*):([\d-]+)->([\d-]+)\/(\w+)$/.exec(part);
    const exposed = /^([\d-]+)\/(\w+)$/.exec(part);
    /** @type {Port | undefined} */
    let port;
    if (mapped) {
      const ip = (mapped[1] ?? "").replace(/^\[|\]$/g, "");
      port = { ip, host: mapped[2] ?? "", container: mapped[3] ?? "", proto: mapped[4] ?? "" };
    } else if (exposed) {
      port = { ip: "", host: "", container: exposed[1] ?? "", proto: exposed[2] ?? "" };
    }
    if (!port) continue;
    const key = `${port.host}->${port.container}/${port.proto}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(port);
  }
  return out;
}

/** How a port reads in a row: "8080→80", "127.0.0.1:5432→5432", "5432/udp". */
export function portText(/** @type {Port} */ port) {
  const proto = port.proto === "tcp" ? "" : `/${port.proto}`;
  if (!port.host) return `${port.container}${proto || "/tcp"}`;
  const local = port.ip === "127.0.0.1" || port.ip === "::1" ? `${port.ip}:` : "";
  return `${local}${port.host}→${port.container}${proto}`;
}

/** @returns {Image[]} */
export function parseImages(/** @type {string} */ stdout) {
  return records(stdout).map((r) => {
    const repository = str(r.repository);
    const tag = str(r.tag);
    const digest = str(r.digest);
    const dangling = repository === "<none>" && tag === "<none>";
    const id = str(r.id);
    const bare = id.replace(/^sha256:/, "");
    let ref = bare.slice(0, 12);
    if (!dangling && tag !== "<none>") ref = `${repository}:${tag}`;
    else if (!dangling && digest !== "<none>" && digest !== "") ref = `${repository}@${digest}`;
    return {
      id,
      repository,
      tag,
      digest: digest === "<none>" ? "" : digest,
      created: str(r.created),
      size: str(r.size),
      containers: count(r.containers),
      dangling,
      ref,
    };
  });
}

/** @returns {Volume[]} */
export function parseVolumes(/** @type {string} */ stdout) {
  return records(stdout).map((r) => {
    const name = str(r.name);
    const labels = str(r.labels);
    const anonymous =
      labels.split(",").some((label) => label.startsWith("com.docker.volume.anonymous=")) ||
      /^[0-9a-f]{64}$/.test(name);
    return {
      name,
      driver: str(r.driver),
      mountpoint: str(r.mountpoint),
      anonymous,
      project: str(r.project),
    };
  });
}

/** @returns {Network[]} */
export function parseNetworks(/** @type {string} */ stdout) {
  return records(stdout).map((r) => {
    const name = str(r.name);
    return {
      id: str(r.id),
      name,
      driver: str(r.driver),
      scope: str(r.scope),
      internal: str(r.internal) === "true" || r.internal === true,
      project: str(r.project),
      builtin: BUILTIN_NETWORKS.has(name),
    };
  });
}

/**
 * `docker compose ls --all --format json`: a JSON array (every Compose v2 so far). Status reads
 * "exited(4), running(1)"; config files are comma-separated.
 * @returns {Project[]}
 */
export function parseProjects(/** @type {string} */ stdout) {
  return records(stdout).map((r) => {
    const status = str(r.Status ?? r.status);
    let running = 0;
    let total = 0;
    for (const [, state, n] of status.matchAll(/(\w+)\((\d+)\)/g)) {
      total += Number(n);
      if (state === "running") running += Number(n);
    }
    const files = str(r.ConfigFiles ?? r.configFiles)
      .split(",")
      .map((file) => file.trim())
      .filter((file) => file !== "");
    return { name: str(r.Name ?? r.name), status, files, running, total };
  });
}
