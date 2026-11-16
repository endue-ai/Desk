// The preview engine's Compose: `config --format json` of each stack (services, their images,
// ports, dependencies, networks and volumes) and the operations that start, stop and remove them.

import { record } from "./world.mjs";

/** @typedef {import("./world.mjs").World} World @typedef {import("./streams.mjs").Io} Io */

const DEPENDS = /** @type {Record<string, Record<string, string[]>>} */ ({
  shop: { web: ["api"], api: ["db", "cache"], worker: ["db", "cache"], migrate: ["db"] },
  observability: { grafana: ["prometheus"] },
  blog: { wordpress: ["db"] },
});

/** `docker compose -p NAME config --format json`. */
export function composeConfig(/** @type {World} */ world, /** @type {string} */ project) {
  const members = world.containers.filter((c) => c.project === project);
  /** @type {Record<string, any>} */
  const services = {};
  for (const c of members) {
    const deps = DEPENDS[project]?.[c.service] ?? [];
    services[c.service] = {
      image: c.image,
      ...(c.image.endsWith(":dev")
        ? { build: { context: `/Users/dev/code/${project}`, dockerfile: "Dockerfile" } }
        : {}),
      ports: c.ports.map((/** @type {string} */ p) => ({
        mode: "ingress",
        target: Number(p.split(":")[1]),
        published: p.split(":")[0],
        protocol: "tcp",
      })),
      depends_on: Object.fromEntries(
        deps.map((d) => [
          d,
          { condition: d === "db" ? "service_healthy" : "service_started", required: true },
        ]),
      ),
      networks: { default: null },
      ...(c.volume
        ? {
            volumes: [
              {
                type: "volume",
                source: c.volume[0].replace(`${project}_`, ""),
                target: c.volume[1],
              },
            ],
          }
        : {}),
      ...(c.service === "migrate" ? { restart: "no" } : { restart: "unless-stopped" }),
      environment: Object.fromEntries(
        c.env
          .filter((/** @type {string} */ e) => !e.startsWith("PATH="))
          .map((/** @type {string} */ e) => e.split(/=(.*)/s).slice(0, 2)),
      ),
    };
  }
  const volumes = Object.fromEntries(
    world.volumes
      .filter((v) => v.project === project)
      .map((v) => [v.name.replace(`${project}_`, ""), { name: v.name }]),
  );
  return {
    name: project,
    services,
    networks: { default: { name: `${project}_default` } },
    volumes,
  };
}

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** start, stop, restart, up, down, pull, logs, ps on a stack, with Compose's progress lines. */
export async function composeOp(
  /** @type {World} */ world,
  /** @type {Io} */ io,
  /** @type {string} */ project,
  /** @type {string} */ op,
  /** @type {string[]} */ names,
  /** @type {Record<string, string[]>} */ flags,
) {
  const members = world.containers.filter(
    (c) => c.project === project && (names.length === 0 || names.includes(c.service)),
  );
  if (members.length === 0 && op !== "up") {
    io.err(`no such service or project: ${project}\n`);
    return io.exit(1);
  }
  const say = (/** @type {string} */ name, /** @type {string} */ what) =>
    io.err(` Container ${name}  ${what}\n`);
  if (op === "ps") {
    io.out(
      `${members.map((c) => JSON.stringify({ Name: c.name, Service: c.service, State: c.state })).join("\n")}\n`,
    );
    return io.exit(0);
  }
  if (op === "logs") {
    for (const c of members) io.out(`${c.service}-1  | ready\n`);
    return io.exit(0);
  }
  if (op === "pull") {
    for (const c of members) {
      io.err(` ${c.service} Pulling \n`);
      await sleep(200);
      io.err(` ${c.service} Pulled \n`);
    }
    return io.exit(0);
  }
  const now = Date.now();
  for (const c of members) {
    if (op === "stop" || op === "down") {
      if (c.state === "running" || c.state === "paused") {
        say(c.name, "Stopping");
        await sleep(160);
        c.state = "exited";
        c.exitCode = 0;
        c.finishedAt = Date.now();
        record(world, "container", "stop", c);
        record(world, "container", "die", c, { exitCode: "0" });
        say(c.name, "Stopped");
      }
      if (op === "down") {
        say(c.name, "Removing");
        world.containers = world.containers.filter((x) => x !== c);
        record(world, "container", "destroy", c);
        say(c.name, "Removed");
      }
    } else if (op === "start" || op === "up" || op === "restart") {
      if (c.service === "migrate" && op !== "restart") continue;
      say(c.name, op === "restart" ? "Restarting" : "Starting");
      await sleep(180);
      c.state = "running";
      c.startedAt = now;
      c.finishedAt = 0;
      record(world, "container", op === "restart" ? "restart" : "start", c);
      say(c.name, op === "restart" ? "Started" : "Started");
    }
  }
  if (op === "down") io.err(` Network ${project}_default  Removed\n`);
  void flags;
  io.exit(0);
}
