// The preview engine's objects as docker prints them: `inspect` JSON for containers, images,
// volumes and networks, `system df` rows, `compose ls`, `version` and `info`.

import { hex } from "./world.mjs";

/** @typedef {import("./world.mjs").World} World */

const iso = (/** @type {number} */ ms) =>
  ms ? new Date(ms).toISOString() : "0001-01-01T00:00:00Z";
const MB = 1e6;

/** @param {World} world @param {any} c */
export function containerJson(world, c) {
  const ports = /** @type {Record<string, any>} */ ({});
  const img = world.images.find((i) => i.id === c.imageId);
  for (const exposed of img?.exposed ?? []) ports[exposed] = null;
  for (const spec of c.ports) {
    const [host, inner] = spec.split(":");
    const key = `${inner}/tcp`;
    ports[key] =
      c.state === "running" || c.state === "paused"
        ? [
            { HostIp: "0.0.0.0", HostPort: host },
            { HostIp: "::", HostPort: host },
          ]
        : null;
  }
  const labels = /** @type {Record<string, string>} */ ({});
  if (c.project) {
    const dir = `/Users/dev/code/${c.project}`;
    Object.assign(labels, {
      "com.docker.compose.project": c.project,
      "com.docker.compose.service": c.service,
      "com.docker.compose.container-number": "1",
      "com.docker.compose.project.working_dir": dir,
      "com.docker.compose.project.config_files": `${dir}/compose.yaml`,
      "com.docker.compose.version": "2.30.3",
      "com.docker.compose.oneoff": "False",
    });
    if (c.service === "migrate")
      labels["com.docker.compose.depends_on"] = "db:service_healthy:false";
  }
  if (c.kind === "nginx") labels.maintainer = "NGINX Docker Maintainers";
  const up = c.state === "running" || c.state === "paused";
  const networkIndex = world.networks.findIndex((n) => n.name === c.network);
  const ip =
    up && c.network !== "host"
      ? `172.${17 + Math.max(0, networkIndex)}.0.${(world.containers.indexOf(c) % 200) + 2}`
      : "";
  const health = c.health
    ? {
        Status: c.health,
        FailingStreak: c.health === "unhealthy" ? 6 : 0,
        Log: [
          {
            Start: iso(Date.now() - 30_000),
            End: iso(Date.now() - 29_000),
            ExitCode: c.health === "unhealthy" ? 1 : 0,
            Output:
              c.health === "unhealthy"
                ? "curl: (7) Failed to connect to localhost port 8443 after 0 ms: Connection refused\n"
                : "OK\n",
          },
        ],
      }
    : undefined;
  return {
    Id: c.id,
    Created: iso(c.created),
    Path: c.cmd[0] ?? "",
    Args: c.cmd.slice(1),
    State: {
      Status: c.state,
      Running: c.state === "running",
      Paused: c.state === "paused",
      Restarting: c.state === "restarting",
      OOMKilled: false,
      Dead: c.state === "dead",
      Pid: up ? 4200 + world.containers.indexOf(c) : 0,
      ExitCode: c.exitCode,
      Error: "",
      StartedAt: iso(c.startedAt),
      FinishedAt: iso(c.finishedAt),
      ...(health ? { Health: health } : {}),
    },
    Image: c.imageId,
    Name: `/${c.name}`,
    RestartCount: c.restarts,
    Driver: "overlayfs",
    Platform: "linux",
    HostConfig: {
      RestartPolicy: { Name: c.project ? "unless-stopped" : "no", MaximumRetryCount: 0 },
      NetworkMode: c.network,
      Privileged: c.privileged,
      PortBindings: Object.fromEntries(
        c.ports.map((/** @type {string} */ p) => [
          `${p.split(":")[1]}/tcp`,
          [{ HostIp: "", HostPort: p.split(":")[0] }],
        ]),
      ),
      Memory: 0,
      NanoCpus: 0,
    },
    Mounts: c.volume
      ? [
          {
            Type: "volume",
            Name: c.volume[0],
            Source: `/var/lib/docker/volumes/${c.volume[0]}/_data`,
            Destination: c.volume[1],
            Driver: "local",
            Mode: "z",
            RW: true,
            Propagation: "",
          },
        ]
      : c.kind === "nginx"
        ? [
            {
              Type: "bind",
              Source: `/Users/dev/code/${c.project}/nginx.conf`,
              Destination: "/etc/nginx/conf.d/default.conf",
              Mode: "ro",
              RW: false,
              Propagation: "rprivate",
            },
          ]
        : [],
    Config: {
      Hostname: c.id.slice(0, 12),
      User: "",
      Env: c.env,
      Cmd: c.cmd,
      Image: c.image,
      WorkingDir: c.kind === "node" ? "/app" : "",
      Entrypoint: c.kind === "postgres" ? ["docker-entrypoint.sh"] : null,
      ExposedPorts: Object.fromEntries((img?.exposed ?? []).map((p) => [p, {}])),
      Labels: labels,
    },
    NetworkSettings: {
      Ports: ports,
      Networks: up
        ? {
            [c.network]: {
              IPAddress: ip,
              Gateway: ip.replace(/\.\d+$/, ".1"),
              MacAddress: `02:42:ac:${hex(c.name, 6).replace(/(..)(?=.)/g, "$1:")}`,
              Aliases: c.service ? [c.service, c.name] : null,
              NetworkID: world.networks[Math.max(0, networkIndex)]?.id ?? "",
            },
          }
        : {},
    },
  };
}

/** @param {World} world @param {any} i */
export function imageJson(_world, i) {
  const env =
    {
      node: ["NODE_VERSION=22.11.0", "YARN_VERSION=1.22.22"],
      postgres: ["PG_MAJOR=16", "PG_VERSION=16.4", "PGDATA=/var/lib/postgresql/data"],
      nginx: ["NGINX_VERSION=1.27.2", "NJS_VERSION=0.8.7"],
      python: ["PYTHON_VERSION=3.12.7", "LANG=C.UTF-8"],
      redis: ["REDIS_VERSION=7.4.1"],
    }[/** @type {"node"} */ (i.kind)] ?? [];
  return {
    Id: i.id,
    RepoTags: i.refs,
    RepoDigests:
      i.refs.length && !i.refs[0].includes("dev")
        ? [`${i.refs[0].split(":")[0]}@sha256:${hex(`digest-${i.refs[0]}`)}`]
        : [],
    Created: iso(i.created),
    Size: Math.round(i.size),
    Architecture: "arm64",
    Os: "linux",
    Config: {
      Env: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", ...env],
      Cmd: i.cmd,
      Entrypoint: i.kind === "postgres" ? ["docker-entrypoint.sh"] : null,
      ExposedPorts: Object.fromEntries(i.exposed.map((/** @type {string} */ p) => [p, {}])),
      WorkingDir: i.kind === "node" ? "/app" : "",
      User: i.kind === "grafana" ? "472" : "",
      Labels:
        i.refs[0]?.startsWith("shop-api") || !i.refs.length
          ? {
              "org.opencontainers.image.source": "https://github.com/acme/shop",
              "com.docker.compose.project": "shop",
            }
          : { "org.opencontainers.image.version": i.refs[0]?.split(":")[1] ?? "" },
    },
    RootFS: {
      Type: "layers",
      Layers: Array.from(
        { length: 4 + (i.size > 2e8 ? 5 : 2) },
        (_, n) => `sha256:${hex(`${i.id}-${n}`)}`,
      ),
    },
  };
}

/** @param {World} world @param {any} v */
export function volumeJson(_world, v) {
  return {
    CreatedAt: iso(v.created),
    Driver: "local",
    Labels: v.project
      ? {
          "com.docker.compose.project": v.project,
          "com.docker.compose.volume": v.name.replace(`${v.project}_`, ""),
        }
      : v.name.length === 64
        ? { "com.docker.volume.anonymous": "" }
        : null,
    Mountpoint: `/var/lib/docker/volumes/${v.name}/_data`,
    Name: v.name,
    Options: null,
    Scope: "local",
  };
}

/** @param {World} world @param {any} n */
export function networkJson(world, n) {
  const members = world.containers.filter(
    (c) => c.network === n.name && (c.state === "running" || c.state === "paused"),
  );
  return {
    Name: n.name,
    Id: n.id,
    Created: iso(n.created),
    Scope: "local",
    Driver: n.driver,
    EnableIPv6: false,
    IPAM: {
      Driver: "default",
      Config: n.subnet ? [{ Subnet: n.subnet, Gateway: n.subnet.replace(/0\/16$/, "1") }] : [],
    },
    Internal: false,
    Attachable: false,
    Containers: Object.fromEntries(
      members.map((c, k) => [
        c.id,
        {
          Name: c.name,
          IPv4Address: `${n.subnet.replace(/0\/16$/, "")}${k + 2}/16`,
          MacAddress: "",
        },
      ]),
    ),
    Labels: n.project
      ? { "com.docker.compose.project": n.project, "com.docker.compose.network": "default" }
      : {},
  };
}

/** Volume sizes (bytes) and sizes as docker prints them. */
export function human(/** @type {number} */ n) {
  if (n < 1000) return `${n}B`;
  const units = ["kB", "MB", "GB", "TB"];
  let v = n / 1000;
  let u = 0;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2)}${units[u]}`;
}

/** `docker system df --format '{{json .}}'`. @param {World} world */
export function dfRows(world) {
  const used = new Set(world.containers.map((c) => c.imageId));
  const imgSize = world.images.reduce((s, i) => s + i.size, 0);
  const imgFree = world.images.filter((i) => !used.has(i.id)).reduce((s, i) => s + i.size, 0);
  const ctr = world.containers.length * 2.4 * MB;
  const stopped = world.containers.filter((c) => c.state === "exited").length * 2.4 * MB;
  const mounted = new Set(world.containers.map((c) => c.volume?.[0]).filter(Boolean));
  const volSize = world.volumes.reduce((s, v) => s + v.size, 0);
  const volFree = world.volumes.filter((v) => !mounted.has(v.name)).reduce((s, v) => s + v.size, 0);
  const pct = (/** @type {number} */ a, /** @type {number} */ b) =>
    `${human(a)} (${b ? Math.round((a / b) * 100) : 0}%)`;
  return [
    {
      Type: "Images",
      TotalCount: String(world.images.length),
      Active: String(used.size),
      Size: human(imgSize),
      Reclaimable: pct(imgFree, imgSize),
    },
    {
      Type: "Containers",
      TotalCount: String(world.containers.length),
      Active: String(world.containers.filter((c) => c.state === "running").length),
      Size: human(ctr),
      Reclaimable: pct(stopped, ctr),
    },
    {
      Type: "Local Volumes",
      TotalCount: String(world.volumes.length),
      Active: String(mounted.size),
      Size: human(volSize),
      Reclaimable: pct(volFree, volSize),
    },
    { Type: "Build Cache", TotalCount: "64", Active: "0", Size: "2.31GB", Reclaimable: "1.87GB" },
  ];
}

/** `docker system df -v --format json`. @param {World} world */
export function dfVerbose(world) {
  return {
    Volumes: world.volumes.map((v) => ({ Name: v.name, Links: "1", Size: human(v.size) })),
  };
}

/** `docker compose ls --all --format json`. @param {World} world */
export function composeLs(world) {
  /** @type {Map<string, Record<string, number>>} */
  const by = new Map();
  for (const c of world.containers) {
    if (!c.project) continue;
    const counts = by.get(c.project) ?? {};
    counts[c.state] = (counts[c.state] ?? 0) + 1;
    by.set(c.project, counts);
  }
  return [...by].map(([name, counts]) => ({
    Name: name,
    Status: Object.entries(counts)
      .map(([state, n]) => `${state}(${n})`)
      .join(", "),
    ConfigFiles: `/Users/dev/code/${name}/compose.yaml`,
  }));
}

export const VERSION = {
  Client: {
    Version: "27.3.1",
    ApiVersion: "1.47",
    Os: "darwin",
    Arch: "arm64",
    Context: "desk-local",
  },
  Server: {
    Platform: { Name: "Docker Engine - Community" },
    Version: "27.3.1",
    ApiVersion: "1.47",
    Os: "linux",
    Arch: "arm64",
    KernelVersion: "6.10.14-linuxkit",
  },
};

/** @param {World} world */
export function info(world) {
  const by = (/** @type {string} */ s) => world.containers.filter((c) => c.state === s).length;
  return {
    ID: "desk-local-engine",
    Containers: world.containers.length,
    ContainersRunning: by("running"),
    ContainersPaused: by("paused"),
    ContainersStopped: by("exited"),
    Images: world.images.length,
    Driver: "overlayfs",
    NCPU: 10,
    MemTotal: 16_744_448_000,
    OperatingSystem: "Docker Engine on Linux VM",
    OSType: "linux",
    Architecture: "aarch64",
    KernelVersion: "6.10.14-linuxkit",
    Name: "desk-local",
    ServerVersion: "27.3.1",
    DockerRootDir: "/var/lib/docker",
  };
}
