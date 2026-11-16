// The preview's engine: a small, believable set of containers, Compose stacks, images, volumes and
// networks, seeded the same way every time so screenshots match, and the changes docker would make
// to them (start, stop, remove, pull, …). For the preview only; the desk never loads dev/.

import { CONTAINERS, CONTEXTS, DAY, HOUR, hex, IMAGES, MIN, NETWORKS, VOLUMES } from "./seed.mjs";

export { CONTEXTS, hex };

/** A seeded random number generator (mulberry32), so every run shows the same numbers. */
export function seeded(seed = 7) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The world as docker would hold it, made fresh. */
export function createWorld(now = Date.now()) {
  const images = IMAGES.map(([ref, size, age, kind, exposed, cmd]) => ({
    id: `sha256:${hex(String(ref))}`,
    refs: String(ref).startsWith("<none>") ? [] : [String(ref)],
    size: Number(size),
    created: now - Number(age),
    kind: String(kind),
    exposed: /** @type {string[]} */ (exposed),
    cmd: /** @type {string[]} */ (cmd),
  }));
  const imageOf = (/** @type {string} */ ref) =>
    images.find((i) => i.refs.includes(ref)) ?? images[0];
  const containers = CONTAINERS.map(([name, ref, state, project, service, ports, extra]) => {
    const x = /** @type {any} */ (extra);
    const running = state === "running" || state === "paused";
    const img = imageOf(String(ref));
    return {
      id: hex(String(name)),
      name: String(name),
      image: String(ref),
      imageId: img?.id ?? "",
      kind: img?.kind ?? "",
      state: String(state),
      exitCode: x.exit ?? 0,
      health: x.health ?? "",
      created: now - x.ago - 5 * MIN,
      startedAt: running ? now - x.ago : now - x.ago - 40_000,
      finishedAt: running ? 0 : now - x.ago,
      project: String(project),
      service: String(service),
      ports: /** @type {string[]} */ (ports),
      env: [...(x.env ?? []), "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],
      cmd: x.cmd ?? img?.cmd ?? [],
      volume: x.volume ?? null,
      network: x.net ?? (project ? `${project}_default` : "bridge"),
      cpu: x.cpu ?? 0,
      mem: x.mem ?? 0,
      restarts: x.restarts ?? 0,
      privileged: x.privileged === true,
    };
  });
  const volumes = VOLUMES.map(([name, project, size], i) => ({
    name: String(name),
    project: String(project),
    size: Number(size),
    created: now - (i + 2) * DAY,
  }));
  const networks = NETWORKS.map(([name, driver, subnet, project], i) => ({
    id: hex(`net-${name}`),
    name: String(name),
    driver: String(driver),
    subnet: String(subnet),
    project: String(project),
    created: now - (i + 3) * DAY,
  }));
  return {
    now,
    images,
    containers,
    volumes,
    networks,
    contexts: CONTEXTS,
    events: /** @type {any[]} */ ([]),
  };
}

/** @typedef {ReturnType<typeof createWorld>} World */

/** A container by name, id or id prefix. @param {World} world @param {string} ref */
export function findContainer(world, ref) {
  return world.containers.find(
    (c) => c.name === ref || c.id === ref || (ref.length >= 4 && c.id.startsWith(ref)),
  );
}

/** An image by reference, id or id prefix. @param {World} world @param {string} ref */
export function findImage(world, ref) {
  const bare = ref.replace(/^sha256:/, "");
  const withTag = ref.includes(":") || ref.includes("@") ? ref : `${ref}:latest`;
  return world.images.find(
    (i) =>
      i.refs.includes(ref) ||
      i.refs.includes(withTag) ||
      i.id === ref ||
      (bare.length >= 4 && i.id.replace(/^sha256:/, "").startsWith(bare)),
  );
}

/** Record an event for `docker events`. @param {World} world */
export function record(
  world,
  /** @type {string} */ type,
  /** @type {string} */ action,
  /** @type {any} */ actor,
  attributes = {},
) {
  const time = Date.now();
  const attrs = { name: actor.name ?? actor.refs?.[0] ?? actor.name, ...attributes };
  if (actor.project) {
    attrs["com.docker.compose.project"] = actor.project;
    attrs["com.docker.compose.service"] = actor.service;
  }
  if (type === "container") attrs.image = actor.image;
  const event = {
    Type: type,
    Action: action,
    Actor: { ID: actor.id ?? actor.name, Attributes: attrs },
    scope: "local",
    time: Math.floor(time / 1000),
    timeNano: time * 1e6,
  };
  world.events.push(event);
  if (world.events.length > 500) world.events.shift();
  return event;
}

/** The events of the last hours, as `docker events --since` would replay them. @param {World} world */
export function seedEvents(world) {
  const at = (/** @type {number} */ ago) => world.now - ago;
  /** @type {Array<[number, string, string, any, Record<string, string>]>} */
  const past = [];
  const byName = (/** @type {string} */ n) => findContainer(world, n);
  const add = (
    /** @type {number} */ ago,
    /** @type {string} */ action,
    /** @type {string} */ name,
    attrs = {},
  ) => {
    const c = byName(name);
    if (c) past.push([at(ago), "container", action, c, attrs]);
  };
  add(3 * HOUR, "start", "shop-db-1");
  add(3 * HOUR - 4000, "start", "shop-cache-1");
  add(3 * HOUR - 9000, "start", "shop-web-1");
  add(2 * HOUR, "start", "shop-api-1");
  add(2 * HOUR - 1000, "start", "shop-worker-1");
  add(2 * HOUR - 2000, "start", "shop-migrate-1");
  add(2 * HOUR - 42_000, "die", "shop-migrate-1", { exitCode: "1" });
  add(50 * MIN, "start", "payments-sandbox");
  add(34 * MIN, "health_status", "payments-sandbox", { health_status: "unhealthy" });
  add(21 * MIN, "restart", "payments-sandbox");
  add(9 * MIN, "pause", "mailpit");
  const img = world.images.find((i) => i.refs.includes("shop-api:dev"));
  if (img)
    past.push([at(2 * HOUR + 3 * MIN), "image", "tag", { id: img.id, name: "shop-api:dev" }, {}]);
  past.sort((a, b) => a[0] - b[0]);
  for (const [time, type, action, actor, attrs] of past) {
    const event = record(world, type, action, actor, attrs);
    event.time = Math.floor(time / 1000);
    event.timeNano = time * 1e6;
  }
}
