// What docker says about the engine rather than its objects: the versions, the contexts, resource
// use (`stats`), disk use (`system df`) and the event stream. Parsing never throws.

import { records } from "./parse-list.js";

/**
 * @typedef {{ version: string, api: string, os: string, arch: string, context: string }} Client
 * @typedef {{ version: string, api: string, minApi: string, os: string, arch: string, platform: string }} Server
 * @typedef {{ client: Client | null, server: Server | null }} Version
 * @typedef {{ name: string, description: string, endpoint: string, current: boolean, error: string }} Context
 * @typedef {{ id: string, name: string, cpu: number, cpuText: string, memText: string, memPerc: number,
 *   net: string, block: string, pids: number }} Stats
 * @typedef {{ type: string, total: string, active: string, size: string, reclaimable: string }} DiskUse
 * @typedef {{ type: string, action: string, detail: string, id: string, name: string,
 *   attributes: Record<string, string>, time: number }} DockerEvent
 */

const str = (/** @type {unknown} */ value) => (typeof value === "string" ? value : "");
const obj = (/** @type {unknown} */ value) =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : undefined;

/** `docker version --format '{{json .}}'`; the server is null when the daemon is not reachable. */
export function parseVersion(/** @type {string} */ stdout) {
  /** @type {Version} */
  const none = { client: null, server: null };
  const [record] = records(stdout);
  if (!record) return none;
  const client = obj(record.Client);
  const server = obj(record.Server);
  return {
    client: client
      ? {
          version: str(client.Version),
          api: str(client.ApiVersion),
          os: str(client.Os),
          arch: str(client.Arch),
          context: str(client.Context),
        }
      : null,
    server: server
      ? {
          version: str(server.Version),
          api: str(server.ApiVersion),
          minApi: str(server.MinAPIVersion),
          os: str(server.Os),
          arch: str(server.Arch),
          platform: str(obj(server.Platform)?.Name),
        }
      : null,
  };
}

/** `docker context ls --format '{{json .}}'`. @returns {Context[]} */
export function parseContexts(/** @type {string} */ stdout) {
  return records(stdout).map((r) => ({
    name: str(r.Name),
    description: str(r.Description),
    endpoint: str(r.DockerEndpoint),
    current: r.Current === true || r.Current === "true",
    error: str(r.Error),
  }));
}

/** A percentage docker wrote as "12.5%"; 0 when it is "--" or missing. */
const percent = (/** @type {unknown} */ value) => {
  const n = Number.parseFloat(str(value).replace("%", ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * `docker stats --no-stream --no-trunc --format '{{json .}}'`, by full container id.
 * @returns {Map<string, Stats>}
 */
export function parseStats(/** @type {string} */ stdout) {
  /** @type {Map<string, Stats>} */
  const out = new Map();
  for (const r of records(stdout)) {
    const id = str(r.Container) || str(r.ID);
    if (id === "") continue;
    out.set(id, {
      id,
      name: str(r.Name),
      cpu: percent(r.CPUPerc),
      cpuText: str(r.CPUPerc),
      memText: str(r.MemUsage),
      memPerc: percent(r.MemPerc),
      net: str(r.NetIO),
      block: str(r.BlockIO),
      pids: Number.parseInt(str(r.PIDs), 10) || 0,
    });
  }
  return out;
}

/** The stats of a container by its id, full or short (older CLIs print the short one). */
export function statsFor(/** @type {Map<string, Stats>} */ stats, /** @type {string} */ id) {
  return stats.get(id) ?? stats.get(id.slice(0, 12));
}

/** `docker system df --format '{{json .}}'`. @returns {DiskUse[]} */
export function parseDiskUse(/** @type {string} */ stdout) {
  return records(stdout).map((r) => ({
    type: str(r.Type),
    total: str(r.TotalCount),
    active: str(r.Active),
    size: str(r.Size),
    reclaimable: str(r.Reclaimable),
  }));
}

/**
 * One line of `docker events --format '{{json .}}'`. An action with a detail ("exec_start: sh -c …",
 * "health_status: unhealthy") is split at the first colon. Undefined for a line that is not an event.
 * @returns {DockerEvent | undefined}
 */
export function parseEvent(/** @type {string} */ line) {
  const [record] = records(line);
  if (!record) return undefined;
  const type = str(record.Type) || str(record.type);
  const full = str(record.Action) || str(record.status);
  if (type === "" || full === "") return undefined;
  const colon = full.indexOf(":");
  const actor = obj(record.Actor);
  /** @type {Record<string, string>} */
  const attributes = {};
  for (const [key, value] of Object.entries(obj(actor?.Attributes) ?? {}))
    if (typeof value === "string") attributes[key] = value;
  const nano = Number(record.timeNano);
  return {
    type,
    action: colon < 0 ? full : full.slice(0, colon),
    detail: colon < 0 ? "" : full.slice(colon + 1).trim(),
    id: str(actor?.ID) || str(record.id),
    name: attributes.name ?? "",
    attributes,
    time: Number.isFinite(nano) && nano > 0 ? Math.floor(nano / 1e6) : Number(record.time) * 1000,
  };
}
