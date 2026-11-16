// What the studio says about the objects docker lists: a container's state in words, what is
// wrong with it, which images and volumes are in use, the Compose stacks gathered from labels.
// Pure.

import { ago, duration } from "./format.js";

/** @typedef {import("./parse.js").Container} Container */

/** "Running · healthy", "Exited (1)", "Paused", … */
export function stateLabel(/** @type {Container} */ c) {
  if (c.state === "exited") return c.exitCode === 0 ? "Exited" : `Exited (${c.exitCode})`;
  if (c.state === "running" && c.health) return `Running · ${c.health}`;
  return c.state.charAt(0).toUpperCase() + c.state.slice(1);
}

/** The dot's state: running, unhealthy, paused, restarting, exited, failed, created. */
export function dotState(/** @type {Container} */ c) {
  if (c.state === "running" && c.health === "unhealthy") return "unhealthy";
  if (c.state === "exited" && c.exitCode !== 0) return "failed";
  return c.state;
}

/** How long it has run, or how long ago it stopped. */
export function since(/** @type {Container} */ c, now = Date.now()) {
  if (c.state === "running" || c.state === "paused")
    return c.startedAt ? `Up ${duration(now - c.startedAt)}` : "Up";
  if (c.finishedAt) return `Stopped ${ago(c.finishedAt, now)}`;
  return "Never started";
}

/**
 * What is wrong with a container, if anything: a crash, an OOM kill, a failing health check, a
 * restart loop. @returns {{ level: "danger" | "warning", text: string } | null}
 */
export function problemOf(/** @type {Container} */ c) {
  if (c.oom) return { level: "danger", text: "Killed: out of memory" };
  if (c.state === "restarting")
    return { level: "danger", text: `Restarting again and again (${c.restarts} restarts)` };
  if (c.state === "dead") return { level: "danger", text: c.error || "Dead" };
  if (c.state === "running" && c.health === "unhealthy")
    return { level: "warning", text: "Health check failing" };
  if (c.state === "exited" && c.exitCode !== 0 && c.exitCode !== 130 && c.exitCode !== 143)
    return { level: "danger", text: c.error || `Exited with code ${c.exitCode}` };
  if (c.state === "running" && c.restarts >= 3)
    return { level: "warning", text: `Restarted ${c.restarts} times` };
  return null;
}

/** The Compose stacks: from `compose ls` and from the containers' labels, with their containers. */
export function stacksOf(
  /** @type {Container[]} */ containers,
  /** @type {import("./parse.js").ProjectRow[]} */ projects,
) {
  /** @type {Map<string, { name: string, files: string[], dir: string, containers: Container[], status: string }>} */
  const map = new Map();
  for (const p of projects)
    map.set(p.name, { name: p.name, files: p.files, dir: "", containers: [], status: p.status });
  for (const c of containers) {
    if (!c.project) continue;
    const entry = map.get(c.project) ?? {
      name: c.project,
      files: (c.labels["com.docker.compose.project.config_files"] ?? "").split(",").filter(Boolean),
      dir: "",
      containers: [],
      status: "",
    };
    entry.dir ||= c.labels["com.docker.compose.project.working_dir"] ?? "";
    if (entry.files.length === 0)
      entry.files = (c.labels["com.docker.compose.project.config_files"] ?? "")
        .split(",")
        .filter(Boolean);
    entry.containers.push(c);
    map.set(c.project, entry);
  }
  for (const entry of map.values())
    entry.containers.sort((a, b) => (a.service || a.name).localeCompare(b.service || b.name));
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A stack's state: running when all run, partial, stopped. */
export function stackState(/** @type {{ containers: Container[] }} */ stack) {
  const up = stack.containers.filter((c) => c.state === "running").length;
  if (stack.containers.length === 0) return "stopped";
  if (up === stack.containers.length) return "running";
  return up === 0 ? "stopped" : "partial";
}

/** Image ids in use by a container, and how many use each. */
export function imageUse(/** @type {Container[]} */ containers) {
  /** @type {Map<string, number>} */
  const use = new Map();
  for (const c of containers) use.set(c.imageId, (use.get(c.imageId) ?? 0) + 1);
  return use;
}

/** Volume names in use, with the containers that mount each. */
export function volumeUse(/** @type {Container[]} */ containers) {
  /** @type {Map<string, Container[]>} */
  const use = new Map();
  for (const c of containers)
    for (const m of c.mounts)
      if (m.type === "volume" && m.name) use.set(m.name, [...(use.get(m.name) ?? []), c]);
  return use;
}

/** The URL a published port opens in the browser. */
export function portUrl(/** @type {import("./parse.js").Port} */ p) {
  const host =
    !p.ip || p.ip === "0.0.0.0" || p.ip === "::"
      ? "localhost"
      : p.ip.includes(":")
        ? `[${p.ip}]`
        : p.ip;
  const scheme = p.container === 443 || p.container === 8443 ? "https" : "http";
  return `${scheme}://${host}:${p.host}`;
}

/** What an image is called: its first tag, or its short id when it has none. */
export function imageName(/** @type {import("./parse.js").Image} */ image) {
  return image.refs[0] ?? `<none> ${image.id.replace(/^sha256:/, "").slice(0, 12)}`;
}

/** "nginx:1.27" → { repo: "nginx", tag: "1.27" }; a registry port is not a tag. */
export function splitRef(/** @type {string} */ ref) {
  const at = ref.lastIndexOf(":");
  if (at < 0 || ref.slice(at).includes("/")) return { repo: ref, tag: "latest" };
  return { repo: ref.slice(0, at), tag: ref.slice(at + 1) };
}
