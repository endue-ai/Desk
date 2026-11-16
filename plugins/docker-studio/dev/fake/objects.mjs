// The preview engine's images, volumes and networks: ls, inspect, history, tag, remove, prune,
// create, connect.

import { parse } from "./cli.mjs";
import * as J from "./inspect.mjs";
import * as S from "./streams.mjs";
import { findImage, hex, record } from "./world.mjs";

/** @typedef {import("./streams.mjs").Io} Io @typedef {import("./world.mjs").World} World */

const ok = (/** @type {Io} */ io, text = "") => {
  if (text) io.out(text.endsWith("\n") ? text : `${text}\n`);
  io.exit(0);
};
const fail = (/** @type {Io} */ io, /** @type {string} */ text, code = 1) => {
  io.err(`${text}\n`);
  io.exit(code);
};
const lines = (/** @type {any[]} */ rows) => rows.map((r) => JSON.stringify(r)).join("\n");

export function image(
  /** @type {World} */ world,
  /** @type {string} */ sub,
  /** @type {string[]} */ args,
  /** @type {Io} */ io,
) {
  const { rest, flags } = parse(args);
  if (sub === "ls") return ok(io, world.images.map((i) => i.id).join("\n"));
  if (sub === "inspect")
    return ok(
      io,
      JSON.stringify(
        rest
          .map((r) => findImage(world, r))
          .filter(Boolean)
          .map((i) => J.imageJson(world, i)),
        null,
        2,
      ),
    );
  if (sub === "history") {
    const img = findImage(world, rest[0] ?? "");
    if (!img) return fail(io, `Error response from daemon: No such image: ${rest[0]}`);
    return ok(io, lines(historyOf(img)));
  }
  if (sub === "rm") {
    for (const ref of rest) {
      const img = findImage(world, ref);
      if (!img) return fail(io, `Error response from daemon: No such image: ${ref}`);
      if (world.containers.some((c) => c.imageId === img.id) && !flags["-f"])
        return fail(
          io,
          `Error response from daemon: conflict: unable to delete ${ref} (must be forced) - image is being used by a container`,
        );
      world.images = world.images.filter((i) => i !== img);
      record(world, "image", "delete", { id: img.id, name: ref });
      io.out(`Untagged: ${ref}\nDeleted: ${img.id}\n`);
    }
    return io.exit(0);
  }
  if (sub === "tag") {
    const img = findImage(world, rest[0] ?? "");
    if (!img) return fail(io, `Error response from daemon: No such image: ${rest[0]}`);
    img.refs.push(rest[1] ?? "");
    record(world, "image", "tag", { id: img.id, name: rest[1] });
    return ok(io);
  }
  if (sub === "prune") {
    const used = new Set(world.containers.map((c) => c.imageId));
    const gone = world.images.filter(
      (i) => !used.has(i.id) && (flags["-a"] || flags["--all"] || i.refs.length === 0),
    );
    world.images = world.images.filter((i) => !gone.includes(i));
    for (const g of gone) record(world, "image", "delete", { id: g.id, name: g.refs[0] ?? g.id });
    return ok(
      io,
      `Deleted Images:\n${gone.map((g) => `deleted: ${g.id}`).join("\n")}\n\nTotal reclaimed space: ${J.human(gone.reduce((s, g) => s + g.size, 0))}`,
    );
  }
  if (sub === "pull") return S.pull(world, io, rest[0] ?? "");
  if (sub === "push") return S.pull(world, io, rest[0] ?? "");
  return fail(io, `docker image ${sub}: not in the preview`);
}

/** Plausible layers for an image, newest first, as `docker image history --format json` writes. */
function historyOf(/** @type {any} */ img) {
  const base = [
    ["/bin/sh -c #(nop) ADD file:5b1e0a in / ", 8.8e6],
    ['/bin/sh -c #(nop)  CMD ["/bin/sh"]', 0],
  ];
  const app =
    img.kind === "node"
      ? [
          ["ENV NODE_VERSION=22.11.0", 0],
          [
            "RUN /bin/sh -c addgroup -g 1000 node && adduser -u 1000 -G node -s /bin/sh -D node && apk add --no-cache libstdc++ # buildkit",
            121e6,
          ],
          ["WORKDIR /app", 0],
          ["COPY package.json package-lock.json ./ # buildkit", 412e3],
          ["RUN /bin/sh -c npm ci --omit=dev # buildkit", 236e6],
          ["COPY . . # buildkit", 3.1e6],
          ["EXPOSE map[3000/tcp:{}]", 0],
          ['CMD ["node" "server.js"]', 0],
        ]
      : [
          ["ENV VERSION=1", 0],
          [
            "RUN /bin/sh -c set -eux; apk add --no-cache ca-certificates tzdata # buildkit",
            Math.max(1e6, img.size * 0.7),
          ],
          ["COPY docker-entrypoint.sh /usr/local/bin/ # buildkit", 12e3],
          [`CMD ${JSON.stringify(img.cmd)}`, 0],
        ];
  const rows = [...base, ...app].reverse();
  return rows.map(([by, size], i) => ({
    CreatedAt: new Date(img.created - i * 3600_000).toISOString(),
    CreatedBy: by,
    CreatedSince: `${Math.max(1, Math.round((Date.now() - img.created) / 86400_000))} days ago`,
    ID: i === 0 ? img.id : "<missing>",
    Size: J.human(Number(size)),
    Comment: String(by).includes("buildkit") ? "buildkit.dockerfile.v0" : "",
  }));
}

export function volume(
  /** @type {World} */ world,
  /** @type {string} */ sub,
  /** @type {string[]} */ args,
  /** @type {Io} */ io,
) {
  const { rest } = parse(args);
  if (sub === "ls") return ok(io, world.volumes.map((v) => v.name).join("\n"));
  if (sub === "inspect")
    return ok(
      io,
      JSON.stringify(
        rest
          .map((r) => world.volumes.find((v) => v.name === r))
          .filter(Boolean)
          .map((v) => J.volumeJson(world, v)),
        null,
        2,
      ),
    );
  if (sub === "create") {
    const v = {
      name: rest[0] || hex(String(Date.now())),
      project: "",
      size: 0,
      created: Date.now(),
    };
    world.volumes.push(v);
    record(world, "volume", "create", { id: v.name, name: v.name });
    return ok(io, v.name);
  }
  if (sub === "rm") {
    world.volumes = world.volumes.filter((v) => !rest.includes(v.name));
    for (const r of rest) record(world, "volume", "destroy", { id: r, name: r });
    return ok(io, rest.join("\n"));
  }
  if (sub === "prune") return ok(io, "Total reclaimed space: 0B");
  return fail(io, `docker volume ${sub}: not in the preview`);
}

export function network(
  /** @type {World} */ world,
  /** @type {string} */ sub,
  /** @type {string[]} */ args,
  /** @type {Io} */ io,
) {
  const { rest, flags } = parse(args);
  const find = (/** @type {string} */ r) =>
    world.networks.find((n) => n.name === r || n.id === r || n.id.startsWith(r));
  if (sub === "ls") return ok(io, world.networks.map((n) => n.id).join("\n"));
  if (sub === "inspect")
    return ok(
      io,
      JSON.stringify(
        rest
          .map(find)
          .filter(Boolean)
          .map((n) => J.networkJson(world, n)),
        null,
        2,
      ),
    );
  if (sub === "create") {
    const n = {
      id: hex(`net-${rest[0]}`),
      name: rest[0] ?? "",
      driver: flags["--driver"]?.[0] ?? "bridge",
      subnet: flags["--subnet"]?.[0] ?? "172.31.0.0/16",
      project: "",
      created: Date.now(),
    };
    world.networks.push(n);
    record(world, "network", "create", { id: n.id, name: n.name });
    return ok(io, n.id);
  }
  if (sub === "rm") {
    world.networks = world.networks.filter((n) => !rest.includes(n.name) && !rest.includes(n.id));
    return ok(io, rest.join("\n"));
  }
  if (sub === "connect" || sub === "disconnect") return ok(io);
  if (sub === "prune") return ok(io, "Deleted Networks:\n");
  return fail(io, `docker network ${sub}: not in the preview`);
}
