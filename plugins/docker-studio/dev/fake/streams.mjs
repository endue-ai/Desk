// The preview engine's long-running commands: `events`, `stats`, `logs -f`, pulls and builds with
// progress, Compose up and down, and `exec -i` shells that answer a few commands.

import { history, lineOf } from "./logs.mjs";
import { findContainer, hex, record, seeded } from "./world.mjs";

/**
 * @typedef {import("./world.mjs").World} World
 * @typedef {{ out(text: string): void, err(text: string): void, exit(code: number): void,
 *   onKill(fn: () => void): void, onInput(fn: (data: string, close: boolean) => void): void }} Io
 */

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** Repeat `fn` every `ms` until the process is killed. @param {Io} io */
function every(io, /** @type {number} */ ms, /** @type {() => void} */ fn) {
  const timer = setInterval(fn, ms);
  io.onKill(() => {
    clearInterval(timer);
    io.exit(143);
  });
}

/** `docker events [--since …]`: the recorded events since then, then new ones as they happen. */
export function events(
  /** @type {World} */ world,
  /** @type {Io} */ io,
  /** @type {number} */ since,
) {
  let sent = 0;
  for (const e of world.events) {
    sent++;
    if (e.time * 1000 >= since) io.out(`${JSON.stringify(e)}\n`);
  }
  const rnd = seeded(5);
  let tick = 0;
  every(io, 700, () => {
    tick++;
    // Now and then the unhealthy container's check fails again.
    if (tick % 40 === 0) {
      const c = findContainer(world, "payments-sandbox");
      if (c?.state === "running")
        record(world, "container", "health_status", c, { health_status: "unhealthy" });
    }
    while (sent < world.events.length) io.out(`${JSON.stringify(world.events[sent++])}\n`);
    void rnd;
  });
}

/** `docker stats`: a minute of past ticks at once, then one tick every 1.5 s. */
export function stats(/** @type {World} */ world, /** @type {Io} */ io) {
  const rnd = seeded(11);
  /** @type {Map<string, { cpu: number, mem: number, net: number, block: number }>} */
  const walk = new Map();
  const frame = () => {
    io.out("\u001b[2J\u001b[H");
    for (const c of world.containers) {
      if (c.state !== "running" && c.state !== "paused") continue;
      const w = walk.get(c.id) ?? {
        cpu: c.cpu,
        mem: c.mem,
        net: 1e5 + rnd() * 1e6,
        block: 1e6 + rnd() * 2e7,
      };
      if (c.state === "running") {
        w.cpu = Math.max(0, c.cpu * (0.55 + rnd() * 0.9) + (rnd() < 0.05 ? c.cpu * 2 : 0));
        w.mem = Math.max(1e6, w.mem + (rnd() - 0.48) * c.mem * 0.03);
        w.net += rnd() * 4e4 * (c.cpu + 0.2);
        w.block += rnd() * 2e4;
      } else w.cpu = 0;
      walk.set(c.id, w);
      const limit = 16_744_448_000;
      io.out(
        `${JSON.stringify({
          BlockIO: `${(w.block / 1e6).toFixed(1)}MB / ${(w.block / 4e6).toFixed(1)}MB`,
          CPUPerc: `${w.cpu.toFixed(2)}%`,
          Container: c.id,
          ID: c.id,
          MemPerc: `${((w.mem / limit) * 100).toFixed(2)}%`,
          MemUsage: `${(w.mem / 1048576).toFixed(1)}MiB / 15.59GiB`,
          Name: c.name,
          NetIO: `${(w.net / 1e6).toFixed(2)}MB / ${(w.net / 2.6e6).toFixed(2)}MB`,
          PIDs: String(c.state === "running" ? 4 + (c.name.length % 30) : 0),
        })}\n`,
      );
    }
  };
  for (let i = 0; i < 80; i++) frame();
  every(io, 1500, frame);
}

/** `docker logs [--tail N] [-t] [-f]`. */
export function logs(
  /** @type {World} */ _world,
  /** @type {Io} */ io,
  /** @type {any} */ c,
  /** @type {{ tail: number, stamps: boolean, follow: boolean }} */ o,
) {
  const write = (
    /** @type {string} */ stream,
    /** @type {string} */ text,
    /** @type {number} */ t,
  ) => {
    const line = `${o.stamps ? `${new Date(t).toISOString().replace("Z", "000000Z")} ` : ""}${text}\n`;
    if (stream === "stderr") io.err(line);
    else io.out(line);
  };
  for (const [stream, text, t] of history(c, o.tail)) write(stream, text, t);
  if (!o.follow || c.state !== "running") return io.exit(0);
  const rnd = seeded(c.name.length);
  let n = 1000;
  every(io, c.kind === "nginx" || c.service === "api" ? 900 : 2600, () => {
    if (c.state !== "running") return;
    const [stream, text] = lineOf(c, rnd, Date.now(), n++);
    write(stream, text, Date.now());
  });
}

/** `docker pull ref`: layers that download and extract, then the digest. */
export async function pull(
  /** @type {World} */ world,
  /** @type {Io} */ io,
  /** @type {string} */ ref,
) {
  let killed = false;
  io.onKill(() => {
    killed = true;
  });
  const [repo, tag = "latest"] = ref.split(":");
  const layers = [0, 1, 2, 3].map((i) => hex(`${ref}-${i}`, 12));
  io.out(`${tag}: Pulling from ${repo?.includes("/") ? repo : `library/${repo}`}\n`);
  for (const l of layers) io.out(`${l}: Pulling fs layer\n`);
  for (let step = 1; step <= 6 && !killed; step++) {
    await sleep(260);
    for (const [i, l] of layers.entries()) {
      const total = (12 + i * 9) * 1.1;
      const done = Math.min(total, (total * step) / 5);
      io.out(
        done >= total
          ? `${l}: Download complete\n`
          : `${l}: Downloading  ${done.toFixed(1)}MB/${total.toFixed(1)}MB\n`,
      );
    }
  }
  for (const l of layers) {
    if (killed) break;
    await sleep(120);
    io.out(`${l}: Pull complete\n`);
  }
  if (killed) return io.exit(143);
  io.out(
    `Digest: sha256:${hex(`digest-${ref}`)}\nStatus: Downloaded newer image for ${ref.includes(":") ? ref : `${ref}:latest`}\ndocker.io/${repo?.includes("/") ? repo : `library/${repo}`}:${tag}\n`,
  );
  if (!world.images.some((i) => i.refs.includes(ref.includes(":") ? ref : `${ref}:latest`))) {
    const image = {
      id: `sha256:${hex(`pulled-${ref}`)}`,
      refs: [ref.includes(":") ? ref : `${ref}:latest`],
      size: 48e6,
      created: Date.now() - 86400_000 * 3,
      kind: "alpine",
      exposed: [],
      cmd: ["/bin/sh"],
    };
    world.images.unshift(image);
    record(world, "image", "pull", { id: image.id, name: image.refs[0] });
  }
  io.exit(0);
}

const STEPS = [
  ["[internal] load build definition from Dockerfile", 0.1, false],
  ["[internal] load metadata for docker.io/library/node:22-alpine", 1.2, false],
  ["[internal] load .dockerignore", 0.0, false],
  ["[base 1/2] FROM docker.io/library/node:22-alpine@sha256:4a9", 0.0, true],
  ["[internal] load build context", 0.3, false],
  ["[base 2/2] WORKDIR /app", 0.0, true],
  ["[deps 1/2] COPY package.json package-lock.json ./", 0.0, true],
  ["[deps 2/2] RUN npm ci --omit=dev", 14.6, false],
  ["[build 1/2] COPY . .", 0.4, false],
  ["[build 2/2] RUN npm run build", 6.8, false],
  ["exporting to image", 1.1, false],
];

/** `docker build --progress=plain`: numbered steps, some cached, the output of the long ones. */
export async function build(
  /** @type {World} */ world,
  /** @type {Io} */ io,
  /** @type {string} */ tag,
) {
  let killed = false;
  io.onKill(() => {
    killed = true;
  });
  const started = Date.now();
  for (const [i, [name, secs, cached]] of STEPS.entries()) {
    if (killed) return io.exit(143);
    const n = i + 1;
    io.err(`#${n} ${name}\n`);
    if (cached) {
      io.err(`#${n} CACHED\n\n`);
      continue;
    }
    if (String(name).includes("npm ci")) {
      for (const line of [
        "added 412 packages, and audited 413 packages in 13s",
        "68 packages are looking for funding",
        "found 0 vulnerabilities",
      ]) {
        await sleep(350);
        io.err(`#${n} ${(Number(secs) * 0.6).toFixed(2)} ${line}\n`);
      }
    }
    if (String(name).includes("npm run build")) {
      for (const line of [
        "> shop-api@1.8.0 build",
        "> tsc -p tsconfig.build.json",
        "Done in 6.4s",
      ]) {
        await sleep(300);
        io.err(`#${n} ${(Number(secs) * 0.7).toFixed(2)} ${line}\n`);
      }
    }
    await sleep(Math.min(700, Number(secs) * 80 + 120));
    if (String(name).startsWith("exporting")) {
      io.err(
        `#${n} exporting layers 0.9s done\n#${n} writing image sha256:${hex(`built-${tag}`)} done\n#${n} naming to docker.io/library/${tag} done\n`,
      );
    }
    io.err(`#${n} DONE ${Number(secs).toFixed(1)}s\n\n`);
  }
  const image = {
    id: `sha256:${hex(`built-${tag}-${started}`)}`,
    refs: [tag.includes(":") ? tag : `${tag}:latest`],
    size: 415e6,
    created: Date.now(),
    kind: "node",
    exposed: ["3000/tcp"],
    cmd: ["node", "server.js"],
  };
  for (const other of world.images) other.refs = other.refs.filter((r) => r !== image.refs[0]);
  world.images.unshift(image);
  record(world, "image", "tag", { id: image.id, name: image.refs[0] });
  io.exit(0);
}

/** `docker exec -i c sh`: a shell without a terminal that answers a few commands. */
export function shell(/** @type {World} */ _world, /** @type {Io} */ io, /** @type {any} */ c) {
  let cwd = c.kind === "node" ? "/app" : "/";
  let buffer = "";
  const run = (/** @type {string} */ line) => {
    const cmd = line.trim();
    if (cmd.startsWith("printf")) {
      const code = /\$\?/.test(cmd) ? 0 : 0;
      io.out(`\n\u001e${code} ${cwd}\u001e\n`);
      return;
    }
    if (cmd === "") return;
    const [name, ...args] = cmd.split(/\s+/);
    if (name === "cd")
      cwd = args[0]?.startsWith("/") ? args[0] : `${cwd.replace(/\/$/, "")}/${args[0] ?? ""}`;
    else if (name === "pwd") io.out(`${cwd}\n`);
    else if (name === "whoami") io.out("root\n");
    else if (name === "hostname") io.out(`${c.id.slice(0, 12)}\n`);
    else if (name === "ls")
      io.out(
        c.kind === "node"
          ? "Dockerfile\nnode_modules\npackage-lock.json\npackage.json\nscripts\nserver.js\nsrc\nworker.js\n"
          : "bin\ndev\netc\nhome\nlib\nmedia\nmnt\nopt\nproc\nroot\nrun\nsbin\nsrv\nsys\ntmp\nusr\nvar\n",
      );
    else if (name === "env")
      io.out(`${c.env.join("\n")}\nHOSTNAME=${c.id.slice(0, 12)}\nHOME=/root\n`);
    else if (name === "uname") io.out("Linux 6.10.14-linuxkit aarch64 Linux\n");
    else if (name === "node" && args[0] === "-v") io.out("v22.11.0\n");
    else if (name === "cat" && args[0] === "/etc/os-release")
      io.out(
        'NAME="Alpine Linux"\nID=alpine\nVERSION_ID=3.20.3\nPRETTY_NAME="Alpine Linux v3.20"\n',
      );
    else if (name === "ps")
      io.out(
        "PID   USER     TIME  COMMAND\n    1 root      0:42 node server.js\n   38 root      0:00 sh\n   45 root      0:00 ps\n",
      );
    else if (name === "df")
      io.out(
        "Filesystem     Size  Used Avail Use% Mounted on\noverlay         59G   21G   35G  38% /\ntmpfs           64M     0   64M   0% /dev\n",
      );
    else io.err(`sh: ${name}: not found\n`);
  };
  io.onInput((data, close) => {
    buffer += data;
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) run(line);
    if (close) io.exit(0);
  });
  io.onKill(() => io.exit(137));
}

export { sleep };
