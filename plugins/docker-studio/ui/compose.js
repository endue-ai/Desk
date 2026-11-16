// A Compose stack without DOM: its resolved config (`docker compose config --format json`) as
// services with their images, ports, volumes and what each depends on, laid out in levels (a
// service sits right of everything it depends on), and the arguments of compose commands. Pure.

import { objectRef, projectName } from "./refs.js";

/**
 * @typedef {{ name: string, condition: string }} Dependency
 * @typedef {{ name: string, image: string, build: boolean, ports: string[], volumes: string[],
 *   depends: Dependency[], restart: string, level: number }} Service
 * @typedef {{ name: string, services: Service[], volumes: string[], networks: string[] }} StackConfig
 */

/** The base of a compose call for a stack: no colours, the project by name, its files. */
export function composeBase(/** @type {string} */ project, /** @type {string[]} */ files = []) {
  return [
    "compose",
    "--ansi",
    "never",
    "--project-name",
    projectName(project),
    ...files.flatMap((f) => ["--file", f]),
  ];
}

export const configArgs = (/** @type {string} */ project, /** @type {string[]} */ files) => [
  ...composeBase(project, files),
  "config",
  "--format",
  "json",
];

/** One service's command on a stack: restart api, stop worker, … */
export const serviceArgs = (
  /** @type {string} */ project,
  /** @type {"start" | "stop" | "restart" | "pull"} */ op,
  /** @type {string} */ service,
  /** @type {string[]} */ files = [],
) => [...composeBase(project, op === "pull" ? files : []), op, objectRef(service, "The service")];

/** `docker compose up` of a file: a new stack, or an old one brought up to date. */
export function upArgs(
  /** @type {{ file: string, project: string, build: boolean, pull: boolean }} */ o,
) {
  if (!o.file.startsWith("/") || o.file.includes("\0"))
    throw new Error(`${o.file || "The file"} is not an absolute path.`);
  return [
    "compose",
    "--ansi",
    "never",
    ...(o.project.trim() ? ["--project-name", projectName(o.project.trim())] : []),
    "--file",
    o.file,
    "up",
    "--detach",
    "--remove-orphans",
    ...(o.build ? ["--build"] : []),
    ...(o.pull ? ["--pull", "always"] : []),
  ];
}

/** Ports as Compose resolves them ({ target, published, protocol }) or short strings. */
const portText = (/** @type {any} */ p) =>
  typeof p === "string" || typeof p === "number"
    ? String(p)
    : `${p.published ? `${p.published}:` : ""}${p.target}${p.protocol && p.protocol !== "tcp" ? `/${p.protocol}` : ""}`;

/** A volume as Compose resolves it ({ type, source, target }) or a short string. */
const volumeText = (/** @type {any} */ v) =>
  typeof v === "string" ? v : `${v.source ?? ""}${v.source ? ":" : ""}${v.target ?? ""}`;

/** The resolved config as services in levels. @returns {StackConfig} */
export function parseConfig(/** @type {string} */ text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { name: "", services: [], volumes: [], networks: [] };
  }
  const entries = Object.entries(raw?.services ?? {});
  /** @type {Service[]} */
  const services = entries.map(([name, s]) => {
    const deps = /** @type {any} */ (s).depends_on ?? {};
    return {
      name,
      image: String(/** @type {any} */ (s).image ?? ""),
      build: Boolean(/** @type {any} */ (s).build),
      ports: /** @type {any} */ (s.ports ?? []).map(portText),
      volumes: /** @type {any} */ (s.volumes ?? []).map(volumeText),
      depends: Array.isArray(deps)
        ? deps.map((d) => ({ name: String(d), condition: "service_started" }))
        : Object.entries(deps).map(([d, c]) => ({
            name: d,
            condition: String(/** @type {any} */ (c)?.condition ?? "service_started"),
          })),
      restart: String(/** @type {any} */ (s).restart ?? ""),
      level: 0,
    };
  });
  levels(services);
  return {
    name: String(raw?.name ?? ""),
    services,
    volumes: Object.keys(raw?.volumes ?? {}),
    networks: Object.keys(raw?.networks ?? {}),
  };
}

/** Each service's level: 0 with no dependencies, else one past its deepest; a cycle stops there. */
export function levels(/** @type {Service[]} */ services) {
  const by = new Map(services.map((s) => [s.name, s]));
  /** @type {Map<string, number>} */
  const memo = new Map();
  const level = (/** @type {string} */ name, /** @type {Set<string>} */ seen) => {
    const known = memo.get(name);
    if (known !== undefined) return known;
    if (seen.has(name)) return 0;
    seen.add(name);
    const s = by.get(name);
    const n = s?.depends.length
      ? 1 + Math.max(...s.depends.map((d) => (by.has(d.name) ? level(d.name, seen) : -1)))
      : 0;
    memo.set(name, n);
    return n;
  };
  for (const s of services) s.level = level(s.name, new Set());
  return services;
}

/** A config made from the containers alone, when the stack's files cannot be read. */
export function configFromContainers(
  /** @type {string} */ name,
  /** @type {import("./parse.js").Container[]} */ containers,
) {
  /** @type {Service[]} */
  const services = containers.map((c) => ({
    name: c.service || c.name,
    image: c.image,
    build: false,
    ports: c.ports.map((p) => `${p.host}:${p.container}`),
    volumes: c.mounts.map((m) => `${m.name || m.source}:${m.destination}`),
    depends: (c.labels["com.docker.compose.depends_on"] ?? "")
      .split(",")
      .filter(Boolean)
      .map((d) => {
        const [dep = "", condition = "service_started"] = d.split(":");
        return { name: dep, condition };
      }),
    restart: c.restartPolicy,
    level: 0,
  }));
  levels(services);
  return { name, services, volumes: [], networks: [] };
}
