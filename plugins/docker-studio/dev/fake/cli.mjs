// The preview engine's `docker`: argument vectors in, what docker would print out. One-shot
// commands answer at once; streams (events, stats, logs -f, pull, build, exec -i) go through
// streams.mjs. Unknown commands fail the way docker does.

import { composeConfig, composeOp } from "./compose.mjs";
import * as F from "./files.mjs";
import * as J from "./inspect.mjs";
import { image, network, volume } from "./objects.mjs";
import * as S from "./streams.mjs";
import { findContainer, findImage, hex, record } from "./world.mjs";

/** @typedef {import("./streams.mjs").Io} Io @typedef {import("./world.mjs").World} World */

/** Flags that take a value (everything else is a switch). */
const VALUED = new Set(
  "--context --format --filter -f --file --tail --since --until --name -p --publish -e --env -v --volume --network --restart -t --tag --time --limit --signal --label -l --driver -d --subnet --gateway --progress --build-arg --target --platform -w --workdir -u --user --cpus --memory -m --entrypoint --hostname --mount --ansi --project-name --project-directory --timeout --profile --scale".split(
    " ",
  ),
);

/** Split args into flags and positionals; `valued` adds flags that take a value here. */
export function parse(/** @type {string[]} */ args, /** @type {Set<string>} */ valued = new Set()) {
  /** @type {Record<string, string[]>} */
  const flags = {};
  /** @type {string[]} */
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--") {
      rest.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith("-") && arg !== "-") {
      const [name = "", inline] = arg.split(/=(.*)/s);
      const takes = VALUED.has(name) || valued.has(name);
      const value = inline !== undefined ? inline : takes ? (args[++i] ?? "") : "true";
      if (!flags[name]) flags[name] = [];
      flags[name].push(value);
    } else rest.push(arg);
  }
  return { flags, rest };
}

const ok = (/** @type {Io} */ io, text = "") => {
  if (text) io.out(text.endsWith("\n") ? text : `${text}\n`);
  io.exit(0);
};
const fail = (/** @type {Io} */ io, /** @type {string} */ text, code = 1) => {
  io.err(`${text}\n`);
  io.exit(code);
};
const lines = (/** @type {any[]} */ rows) => rows.map((r) => JSON.stringify(r)).join("\n");

/** Run one docker command in the world. @param {World} world @param {string[]} argv @param {Io} io */
export function docker(world, argv, io) {
  let args = argv;
  let context = "";
  if (args[0] === "--context") {
    context = args[1] ?? "";
    args = args.slice(2);
  }
  if (context === "prod-eu")
    return fail(
      io,
      'error during connect: Get "http://docker.example/v1.47/version": ssh: connect to host prod-eu.internal port 22: Operation timed out',
    );
  const [cmd = "", sub = "", ...more] = args;
  const container = (/** @type {string} */ ref) => findContainer(world, ref);
  switch (cmd) {
    case "version":
      return ok(io, JSON.stringify(J.VERSION));
    case "info":
      return ok(io, JSON.stringify(J.info(world)));
    case "context":
      if (sub === "ls")
        return ok(
          io,
          lines(world.contexts.map((c) => ({ ...c, Current: c.Name === "desk-local", Error: "" }))),
        );
      return fail(io, `docker context ${sub}: not in the preview`);
    case "container":
      return docker(world, [sub === "ls" ? "ps" : sub, ...more], io);
    case "ps": {
      const { flags } = parse([sub, ...more]);
      const all = flags["--all"] || flags["-a"];
      const list = world.containers.filter((c) => all || c.state === "running");
      return ok(io, list.map((c) => c.id).join("\n"));
    }
    case "inspect": {
      const { rest } = parse([sub, ...more]);
      return ok(
        io,
        JSON.stringify(
          rest
            .map((r) => container(r))
            .filter(Boolean)
            .map((c) => J.containerJson(world, c)),
          null,
          2,
        ),
      );
    }
    case "image":
      return image(world, sub, more, io);
    case "images":
      return image(world, "ls", [sub, ...more], io);
    case "volume":
      return volume(world, sub, more, io);
    case "network":
      return network(world, sub, more, io);
    case "system":
      if (sub === "df") {
        const { flags } = parse(more);
        if (flags["--verbose"] || flags["-v"]) return ok(io, JSON.stringify(J.dfVerbose(world)));
        return ok(io, lines(J.dfRows(world)));
      }
      if (sub === "prune")
        return ok(io, "Deleted Containers:\nDeleted Images:\nTotal reclaimed space: 2.14GB");
      break;
    case "events": {
      const { flags } = parse([sub, ...more]);
      const since = flags["--since"]?.[0];
      return S.events(world, io, since ? Number(since) * 1000 : Date.now());
    }
    case "stats":
      return S.stats(world, io);
    case "logs": {
      const { flags, rest } = parse([sub, ...more]);
      const c = container(rest[0] ?? "");
      if (!c) return fail(io, `Error response from daemon: No such container: ${rest[0]}`);
      return S.logs(world, io, c, {
        tail: Number(flags["--tail"]?.[0] ?? 500),
        stamps: Boolean(flags["--timestamps"] || flags["-t"]),
        follow: Boolean(flags["--follow"] || flags["-f"]),
      });
    }
    case "start":
    case "stop":
    case "restart":
    case "pause":
    case "unpause":
    case "kill":
    case "rm":
      return lifecycle(world, cmd, [sub, ...more], io);
    case "compose":
      if (sub === "ls") return ok(io, JSON.stringify(J.composeLs(world)));
      return compose(world, [sub, ...more], io);
    case "pull":
      return S.pull(world, io, parse([sub, ...more]).rest[0] ?? "");
    case "build":
    case "buildx": {
      const { flags } = parse(cmd === "buildx" ? more : [sub, ...more]);
      return S.build(world, io, flags["-t"]?.[0] ?? flags["--tag"]?.[0] ?? "image:latest");
    }
    case "exec": {
      const { rest, flags } = parse([sub, ...more]);
      const c = container(rest[0] ?? "");
      if (c?.state !== "running")
        return fail(io, `Error response from daemon: container ${rest[0]} is not running`);
      if (flags["-i"] || flags["--interactive"]) return S.shell(world, io, c);
      const [, program, ...rest2] = rest;
      if (program === "ls") {
        const listing = F.ls(rest2.at(-1) ?? "/");
        if (listing === undefined)
          return fail(io, `ls: ${rest2.at(-1)}: No such file or directory`);
        return ok(io, listing);
      }
      if (program === "head") return ok(io, F.read(rest2.at(-1) ?? ""));
      return ok(io, `${rest.slice(1).join(" ")}: ran\n`);
    }
    case "top": {
      const c = container(sub);
      if (c?.state !== "running")
        return fail(io, `Error response from daemon: container ${sub} is not running`);
      return ok(
        io,
        "UID    PID    PPID   C    STIME   TTY   TIME       CMD\nroot   4211   4190   0    09:12   ?     00:00:42   " +
          c.cmd.join(" ") +
          "\nroot   4388   4211   0    09:12   ?     00:00:03   " +
          c.cmd.join(" ") +
          " --child\n",
      );
    }
    case "search": {
      const { rest } = parse([sub, ...more]);
      const term = rest[0] ?? "";
      return ok(
        io,
        lines(
          SEARCH.filter((s) => s.Name.includes(term) || s.Description.toLowerCase().includes(term)),
        ),
      );
    }
    case "run":
    case "create":
      return runContainer(world, cmd, [sub, ...more], io);
    case "cp":
      return ok(io, "Successfully copied 4.1kB");
    case "rename": {
      const c = container(sub);
      if (c) c.name = more[0] ?? c.name;
      return ok(io);
    }
    case "tag":
      return image(world, "tag", [sub, ...more], io);
    case "rmi":
      return image(world, "rm", [sub, ...more], io);
  }
  return fail(io, `docker: '${cmd}' is not a docker command.\nSee 'docker --help'`);
}

const SEARCH = [
  {
    Name: "nginx",
    Description: "Official build of Nginx.",
    StarCount: 20512,
    IsOfficial: true,
    IsAutomated: false,
  },
  {
    Name: "postgres",
    Description:
      "The PostgreSQL object-relational database system provides reliability and data integrity.",
    StarCount: 14203,
    IsOfficial: true,
    IsAutomated: false,
  },
  {
    Name: "redis",
    Description:
      "Redis is the world's fastest data platform for caching, vector search, and NoSQL databases.",
    StarCount: 13011,
    IsOfficial: true,
    IsAutomated: false,
  },
  {
    Name: "node",
    Description:
      "Node.js is a JavaScript-based platform for server-side and networking applications.",
    StarCount: 13870,
    IsOfficial: true,
    IsAutomated: false,
  },
  {
    Name: "python",
    Description:
      "Python is an interpreted, interactive, object-oriented, open-source programming language.",
    StarCount: 9921,
    IsOfficial: true,
    IsAutomated: false,
  },
  {
    Name: "nginxinc/nginx-unprivileged",
    Description: "Unprivileged NGINX Dockerfiles",
    StarCount: 172,
    IsOfficial: false,
    IsAutomated: false,
  },
  {
    Name: "bitnami/nginx",
    Description: "Bitnami container image for NGINX",
    StarCount: 197,
    IsOfficial: false,
    IsAutomated: false,
  },
  {
    Name: "grafana/grafana",
    Description: "The official Grafana docker container",
    StarCount: 3240,
    IsOfficial: false,
    IsAutomated: false,
  },
];

function lifecycle(
  /** @type {World} */ world,
  /** @type {string} */ cmd,
  /** @type {string[]} */ args,
  /** @type {Io} */ io,
) {
  const { rest, flags } = parse(args);
  /** @type {string[]} */
  const out = [];
  for (const ref of rest) {
    const c = findContainer(world, ref);
    if (!c) return fail(io, `Error response from daemon: No such container: ${ref}`);
    const now = Date.now();
    if (cmd === "rm") {
      if (c.state === "running" && !flags["-f"] && !flags["--force"])
        return fail(
          io,
          `Error response from daemon: cannot remove container "/${c.name}": container is running: stop the container before removing or force remove`,
        );
      world.containers = world.containers.filter((x) => x !== c);
      record(world, "container", "destroy", c);
    } else if (cmd === "start" || cmd === "restart") {
      c.state = "running";
      c.startedAt = now;
      c.finishedAt = 0;
      c.exitCode = 0;
      record(world, "container", cmd, c);
    } else if (cmd === "stop" || cmd === "kill") {
      c.state = "exited";
      c.finishedAt = now;
      c.exitCode = cmd === "kill" ? 137 : 0;
      record(world, "container", cmd === "kill" ? "kill" : "stop", c);
      record(world, "container", "die", c, { exitCode: String(c.exitCode) });
    } else if (cmd === "pause" || cmd === "unpause") {
      c.state = cmd === "pause" ? "paused" : "running";
      record(world, "container", cmd, c);
    }
    out.push(ref);
  }
  return ok(io, out.join("\n"));
}

function compose(/** @type {World} */ world, /** @type {string[]} */ args, /** @type {Io} */ io) {
  const { flags, rest } = parse(args);
  const project = flags["--project-name"]?.[0] ?? flags["-p"]?.[0] ?? "";
  const [op = "", ...names] = rest;
  if (op === "config") return ok(io, JSON.stringify(composeConfig(world, project)));
  return composeOp(world, io, project, op, names, flags);
}

function runContainer(
  /** @type {World} */ world,
  /** @type {string} */ cmd,
  /** @type {string[]} */ args,
  /** @type {Io} */ io,
) {
  const { flags, rest } = parse(args);
  const [ref = "", ...command] = rest;
  const img = findImage(world, ref);
  if (!img)
    return fail(
      io,
      `Unable to find image '${ref}' locally\ndocker: Error response from daemon: pull access denied for ${ref}, repository does not exist or may require 'docker login'.`,
      125,
    );
  const name =
    flags["--name"]?.[0] ??
    `${["brave", "calm", "eager", "quiet"][world.containers.length % 4]}_${["turing", "hopper", "lovelace", "knuth"][world.containers.length % 4]}`;
  if (world.containers.some((c) => c.name === name))
    return fail(
      io,
      `docker: Error response from daemon: Conflict. The container name "/${name}" is already in use.`,
      125,
    );
  const now = Date.now();
  const c = {
    id: hex(`${name}-${now}`),
    name,
    image: ref,
    imageId: img.id,
    kind: img.kind,
    state: cmd === "run" ? "running" : "created",
    exitCode: 0,
    health: "",
    created: now,
    startedAt: cmd === "run" ? now : 0,
    finishedAt: 0,
    project: "",
    service: "",
    ports: [...(flags["-p"] ?? []), ...(flags["--publish"] ?? [])],
    env: [...(flags["-e"] ?? []), ...(flags["--env"] ?? [])],
    cmd: command.length ? command : img.cmd,
    volume: null,
    network: flags["--network"]?.[0] ?? "bridge",
    cpu: 0.4,
    mem: 24e6,
    restarts: 0,
    privileged: false,
  };
  world.containers.unshift(c);
  record(world, "container", "create", c);
  if (cmd === "run") record(world, "container", "start", c);
  return ok(io, c.id);
}
