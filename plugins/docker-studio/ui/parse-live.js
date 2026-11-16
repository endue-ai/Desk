// The streams docker keeps writing: `docker stats --format '{{json .}}'` (one line per container
// per tick, the screen cleared between ticks) and `docker events --format '{{json .}}'`. Pure.

import { stripAnsi } from "./errors.js";
import { parsePercent, parseSize } from "./format.js";

/**
 * @typedef {{ id: string, name: string, cpu: number, mem: number, memLimit: number, memPerc: number,
 *   netIn: number, netOut: number, blockIn: number, blockOut: number, pids: number }} Sample
 * @typedef {{ type: string, action: string, id: string, name: string, time: number,
 *   attributes: Record<string, string> }} DockerEvent
 */

/** "30MiB / 7.6GiB" → [used, limit] in bytes. */
const pair = (/** @type {unknown} */ text) => {
  const [a = "", b = ""] = String(text ?? "").split("/");
  return [parseSize(a) || 0, parseSize(b) || 0];
};

/** One line of `docker stats` as a sample, or undefined when it is not one. @returns {Sample | undefined} */
export function sample(/** @type {string} */ line) {
  const text = stripAnsi(line).trim();
  const at = text.indexOf("{");
  if (at < 0) return undefined;
  let row;
  try {
    row = JSON.parse(text.slice(at));
  } catch {
    return undefined;
  }
  const id = String(row.ID ?? row.Container ?? "");
  if (!id || id === "--") return undefined;
  const [mem, memLimit] = pair(row.MemUsage);
  const [netIn, netOut] = pair(row.NetIO);
  const [blockIn, blockOut] = pair(row.BlockIO);
  return {
    id,
    name: String(row.Name ?? ""),
    cpu: parsePercent(row.CPUPerc) || 0,
    mem,
    memLimit,
    memPerc: parsePercent(row.MemPerc) || 0,
    netIn,
    netOut,
    blockIn,
    blockOut,
    pids: Number(row.PIDs ?? 0) || 0,
  };
}

/** One line of `docker events` as an event, or undefined. @returns {DockerEvent | undefined} */
export function event(/** @type {string} */ line) {
  const text = line.trim();
  if (!text.startsWith("{")) return undefined;
  let row;
  try {
    row = JSON.parse(text);
  } catch {
    return undefined;
  }
  const attributes = row.Actor?.Attributes ?? {};
  const nano = Number(row.timeNano ?? 0);
  return {
    type: String(row.Type ?? row.type ?? ""),
    action: String(row.Action ?? row.status ?? "").split(":")[0] ?? "",
    id: String(row.Actor?.ID ?? row.id ?? ""),
    name: String(attributes.name ?? attributes.image ?? row.from ?? ""),
    time: nano > 0 ? Math.floor(nano / 1e6) : Number(row.time ?? 0) * 1000,
    attributes,
  };
}

/** Which lists an event changes: a container's start changes containers, a pull images, … */
export function touches(/** @type {DockerEvent} */ e) {
  if (e.type === "container") {
    if (e.action.startsWith("exec_") || e.action === "top" || e.action === "attach") return [];
    return ["containers"];
  }
  if (e.type === "image") return ["images"];
  if (e.type === "volume") return e.action === "mount" || e.action === "unmount" ? [] : ["volumes"];
  if (e.type === "network") return ["networks", "containers"];
  return [];
}

/** Events worth a line in the activity feed (not every exec or health probe). */
export function notable(/** @type {DockerEvent} */ e) {
  if (e.type === "container")
    return /^(create|start|stop|die|kill|pause|unpause|restart|destroy|oom|health_status|rename)$/.test(
      e.action,
    );
  if (e.type === "image") return /^(pull|push|tag|untag|delete|import|load|save)$/.test(e.action);
  if (e.type === "volume" || e.type === "network")
    return /^(create|destroy|remove)$/.test(e.action);
  return false;
}
