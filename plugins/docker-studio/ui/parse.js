// What docker prints, as the studio's models: containers, images, volumes and networks from their
// `inspect` JSON (exact sizes, labels as objects, ports as numbers), Compose projects from
// `compose ls`, the engine from `version` and `info`, disk use from `system df`. Pure.

import { parseSize, time } from "./format.js";

/**
 * @typedef {{ ip: string, host: number, container: number, proto: string }} Port
 * @typedef {{ type: string, name: string, source: string, destination: string, rw: boolean, mode: string }} Mount
 * @typedef {{ name: string, ip: string, mac: string, gateway: string, aliases: string[] }} Attachment
 * @typedef {{ id: string, name: string, image: string, imageId: string, command: string,
 *   created: number, state: string, health: string, exitCode: number, oom: boolean, error: string,
 *   startedAt: number, finishedAt: number, restarts: number, restartPolicy: string, ports: Port[],
 *   exposed: string[], labels: Record<string, string>, project: string, service: string,
 *   networks: Attachment[], mounts: Mount[], env: string[], cmd: string[], entrypoint: string[],
 *   user: string, workdir: string, hostname: string, platform: string, raw: any }} Container
 * @typedef {{ id: string, refs: string[], digests: string[], created: number, size: number,
 *   arch: string, os: string, env: string[], cmd: string[], entrypoint: string[], exposed: string[],
 *   workdir: string, user: string, labels: Record<string, string>, layers: number,
 *   dangling: boolean, raw: any }} Image
 * @typedef {{ name: string, driver: string, mountpoint: string, created: number, scope: string,
 *   labels: Record<string, string>, project: string, anonymous: boolean, options: Record<string, string>, raw: any }} Volume
 * @typedef {{ id: string, name: string, driver: string, scope: string, internal: boolean,
 *   ipv6: boolean, subnet: string, gateway: string, created: number, labels: Record<string, string>,
 *   project: string, members: Array<{ id: string, name: string, ip: string }>, builtin: boolean, raw: any }} Network
 * @typedef {{ name: string, status: string, files: string[] }} ProjectRow
 * @typedef {{ kind: string, count: number, active: number, size: number, reclaimable: number }} DiskRow
 */

/** One JSON value per line (docker's `--format '{{json .}}'`), the lines that do not parse left out. */
export function jsonLines(/** @type {string} */ text) {
  /** @type {any[]} */
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // A line cut short or not JSON at all: skip it.
    }
  }
  return out;
}

/** A JSON array (docker inspect), or one value per line, as an array. */
export function jsonArray(/** @type {string} */ text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    try {
      const value = JSON.parse(trimmed);
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }
  return jsonLines(text);
}

const list = (/** @type {unknown} */ v) => (Array.isArray(v) ? v.map(String) : []);
const record = (/** @type {unknown} */ v) =>
  v && typeof v === "object" ? /** @type {Record<string, string>} */ ({ ...v }) : {};
const PROJECT = "com.docker.compose.project";
const SERVICE = "com.docker.compose.service";

/** @returns {Container} */
export function container(/** @type {any} */ raw) {
  const state = raw.State ?? {};
  const config = raw.Config ?? {};
  const host = raw.HostConfig ?? {};
  const labels = record(config.Labels);
  /** @type {Port[]} */
  const ports = [];
  for (const [key, bindings] of Object.entries(raw.NetworkSettings?.Ports ?? {})) {
    const [num, proto = "tcp"] = key.split("/");
    for (const binding of Array.isArray(bindings) ? bindings : [])
      ports.push({
        ip: binding.HostIp ?? "",
        host: Number(binding.HostPort),
        container: Number(num),
        proto,
      });
  }
  // One row per published port: IPv4 and IPv6 bindings of the same port are one.
  const seen = new Set();
  const unique = ports.filter((p) => {
    const key = `${p.host}/${p.container}/${p.proto}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    id: raw.Id ?? "",
    name: String(raw.Name ?? "").replace(/^\//, ""),
    image: config.Image ?? "",
    imageId: raw.Image ?? "",
    command: [raw.Path, ...(raw.Args ?? [])].filter(Boolean).join(" "),
    created: time(raw.Created),
    state: state.Status ?? "created",
    health: state.Health?.Status ?? "",
    exitCode: Number(state.ExitCode ?? 0),
    oom: state.OOMKilled === true,
    error: state.Error ?? "",
    startedAt: time(state.StartedAt),
    finishedAt: time(state.FinishedAt),
    restarts: Number(raw.RestartCount ?? 0),
    restartPolicy: host.RestartPolicy?.Name ?? "",
    ports: unique.sort((a, b) => a.container - b.container),
    exposed: Object.keys(config.ExposedPorts ?? {}),
    labels,
    project: labels[PROJECT] ?? "",
    service: labels[SERVICE] ?? "",
    networks: Object.entries(raw.NetworkSettings?.Networks ?? {}).map(([name, n]) => ({
      name,
      ip: /** @type {any} */ (n).IPAddress ?? "",
      mac: /** @type {any} */ (n).MacAddress ?? "",
      gateway: /** @type {any} */ (n).Gateway ?? "",
      aliases: list(/** @type {any} */ (n).Aliases),
    })),
    mounts: (raw.Mounts ?? []).map((/** @type {any} */ m) => ({
      type: m.Type ?? "",
      name: m.Name ?? "",
      source: m.Source ?? "",
      destination: m.Destination ?? "",
      rw: m.RW !== false,
      mode: m.Mode ?? "",
    })),
    env: list(config.Env),
    cmd: list(config.Cmd),
    entrypoint: list(config.Entrypoint),
    user: config.User ?? "",
    workdir: config.WorkingDir ?? "",
    hostname: config.Hostname ?? "",
    platform: raw.Platform ?? "",
    raw,
  };
}

/** @returns {Image} */
export function image(/** @type {any} */ raw) {
  const config = raw.Config ?? {};
  const refs = list(raw.RepoTags).filter((ref) => ref !== "<none>:<none>");
  return {
    id: raw.Id ?? "",
    refs,
    digests: list(raw.RepoDigests),
    created: time(raw.Created),
    size: Number(raw.Size ?? raw.VirtualSize ?? 0),
    arch: raw.Architecture ?? "",
    os: raw.Os ?? "",
    env: list(config.Env),
    cmd: list(config.Cmd),
    entrypoint: list(config.Entrypoint),
    exposed: Object.keys(config.ExposedPorts ?? {}),
    workdir: config.WorkingDir ?? "",
    user: config.User ?? "",
    labels: record(config.Labels),
    layers: (raw.RootFS?.Layers ?? []).length,
    dangling: refs.length === 0,
    raw,
  };
}

/** @returns {Volume} */
export function volume(/** @type {any} */ raw) {
  const labels = record(raw.Labels);
  const name = raw.Name ?? "";
  return {
    name,
    driver: raw.Driver ?? "local",
    mountpoint: raw.Mountpoint ?? "",
    created: time(raw.CreatedAt),
    scope: raw.Scope ?? "local",
    labels,
    project: labels[PROJECT] ?? "",
    anonymous: /^[0-9a-f]{64}$/.test(name) || labels["com.docker.volume.anonymous"] !== undefined,
    options: record(raw.Options),
    raw,
  };
}

const BUILTIN = new Set(["bridge", "host", "none"]);

/** @returns {Network} */
export function network(/** @type {any} */ raw) {
  const labels = record(raw.Labels);
  const config = raw.IPAM?.Config?.[0] ?? {};
  return {
    id: raw.Id ?? "",
    name: raw.Name ?? "",
    driver: raw.Driver ?? "",
    scope: raw.Scope ?? "local",
    internal: raw.Internal === true,
    ipv6: raw.EnableIPv6 === true,
    subnet: config.Subnet ?? "",
    gateway: config.Gateway ?? "",
    created: time(raw.Created),
    labels,
    project: labels["com.docker.compose.project"] ?? "",
    members: Object.entries(raw.Containers ?? {}).map(([id, c]) => ({
      id,
      name: /** @type {any} */ (c).Name ?? "",
      ip: String(/** @type {any} */ (c).IPv4Address ?? "").replace(/\/\d+$/, ""),
    })),
    builtin: BUILTIN.has(raw.Name),
    raw,
  };
}

/** `docker compose ls --all --format json`: one array, or one object per line on older versions. @returns {ProjectRow[]} */
export function projects(/** @type {string} */ text) {
  return jsonArray(text).map((row) => ({
    name: String(row.Name ?? ""),
    status: String(row.Status ?? ""),
    files: String(row.ConfigFiles ?? "")
      .split(",")
      .map((file) => file.trim())
      .filter(Boolean),
  }));
}

/** "running(3)", "exited(2), running(1)" → { running: 3, exited: 2 }. */
export function projectStatus(/** @type {string} */ status) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const match of status.matchAll(/([a-z]+)\((\d+)\)/g)) out[match[1] ?? ""] = Number(match[2]);
  return out;
}

const KINDS = /** @type {Record<string, string>} */ ({
  Images: "images",
  Containers: "containers",
  "Local Volumes": "volumes",
  "Build Cache": "cache",
});

/** `docker system df --format '{{json .}}'`, one row per kind. @returns {DiskRow[]} */
export function disk(/** @type {string} */ text) {
  return jsonLines(text)
    .filter((row) => KINDS[row.Type])
    .map((row) => ({
      kind: KINDS[row.Type] ?? "",
      count: Number(row.TotalCount ?? 0),
      active: Number(row.Active ?? 0),
      size: parseSize(row.Size) || 0,
      reclaimable: parseSize(String(row.Reclaimable ?? "").replace(/\s*\(.*\)$/, "")) || 0,
    }));
}

/** Volume sizes from `docker system df -v --format json`: name → bytes (empty when not printed). */
export function volumeSizes(/** @type {string} */ text) {
  /** @type {Map<string, number>} */
  const sizes = new Map();
  for (const value of jsonLines(text)) {
    for (const row of Array.isArray(value.Volumes) ? value.Volumes : []) {
      const size = parseSize(row.Size);
      if (row.Name && Number.isFinite(size)) sizes.set(row.Name, size);
    }
  }
  return sizes;
}

/** The engine from `docker version --format '{{json .}}'` and `docker info --format '{{json .}}'`. */
export function engine(/** @type {any} */ version, /** @type {any} */ info) {
  const client = version?.Client ?? {};
  const server = version?.Server ?? {};
  return {
    client: client.Version ?? "",
    clientApi: client.ApiVersion ?? "",
    server: server.Version ?? info?.ServerVersion ?? "",
    api: server.ApiVersion ?? "",
    platform: server.Platform?.Name ?? "",
    os: info?.OperatingSystem ?? server.Os ?? "",
    arch: info?.Architecture ?? server.Arch ?? "",
    kernel: info?.KernelVersion ?? server.KernelVersion ?? "",
    cpus: Number(info?.NCPU ?? 0),
    memory: Number(info?.MemTotal ?? 0),
    driver: info?.Driver ?? "",
    name: info?.Name ?? "",
    root: info?.DockerRootDir ?? "",
    context: client.Context ?? "",
  };
}

/** `docker context ls --format '{{json .}}'`. */
export function contexts(/** @type {string} */ text) {
  return jsonArray(text).map((row) => ({
    name: String(row.Name ?? ""),
    current: row.Current === true || row.Current === "true",
    description: String(row.Description ?? ""),
    endpoint: String(row.DockerEndpoint ?? ""),
    error: String(row.Error ?? ""),
  }));
}
