// What docker 29.8 printed for the plugin's templates and commands on a Docker Desktop engine, with
// names and paths made generic. Tests read these instead of a live engine.

const line = (record: Record<string, unknown>) => JSON.stringify(record);

export const WEB_ID = "07879365b0f1ac9240f32924c022436198d8b103bbf5414ec312717eada5ff83";
export const DB_ID = "3f771f073bb54447231a5e72d999ce7af2cfce86c3a48c1071ad600aa70beaa5";
export const OLD_ID = "c7815ed7a35b36d76a180ae7d54994afdaa845be8e44c44427fcc883b81ba85a";

/** `docker ps -a --no-trunc --format PS_FORMAT`: two Compose services and a standalone container. */
export const PS = `${[
  line({
    id: WEB_ID,
    names: "shop-web-1",
    image: "node:22-bookworm-slim",
    state: "running",
    status: "Up 6 hours",
    ports: "0.0.0.0:8080->80/tcp, [::]:8080->80/tcp",
    created: "2026-10-31 09:29:37 +0900 KST",
    command: '"docker-entrypoint.sh npm start"',
    project: "shop",
    service: "web",
  }),
  line({
    id: DB_ID,
    names: "shop-db-1",
    image: "postgres:17",
    state: "running",
    status: "Up 6 hours (healthy)",
    ports: "127.0.0.1:5432->5432/tcp",
    created: "2026-10-31 09:29:36 +0900 KST",
    command: '"docker-entrypoint.sh postgres"',
    project: "shop",
    service: "db",
  }),
  line({
    id: OLD_ID,
    names: "scratch",
    image: "alpine:3.20",
    state: "exited",
    status: "Exited (137) 2 days ago",
    ports: "",
    created: "2026-10-29 11:02:12 +0900 KST",
    command: '"sleep infinity"',
    project: "",
    service: "",
  }),
].join("\n")}\n`;

/** `docker image ls --no-trunc --format IMAGE_FORMAT`. */
export const IMAGES = `${[
  line({
    id: "sha256:9431865c385c56c50707f2296920e460ca85097d2d3767caf0fc2d776007f8f7",
    repository: "postgres",
    tag: "17",
    digest: "<none>",
    created: "2026-10-20 13:38:33 +0900 KST",
    size: "438MB",
    containers: "1",
  }),
  line({
    id: "sha256:0e4a9e06ad098f56141720405808c3601a3c8d498d3a7b790d6d4f3eff480102",
    repository: "<none>",
    tag: "<none>",
    digest: "<none>",
    created: "2026-10-31 09:29:36 +0900 KST",
    size: "394MB",
    containers: "0",
  }),
  line({
    id: "sha256:e45cdcfd2c0e7e0c4d5d5ba2f4b8d0a1d6c3a1d9c8f7e6d5c4b3a291807f6e5d",
    repository: "ghcr.io/acme/api",
    tag: "<none>",
    digest: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    created: "2026-10-30 06:40:58 +0900 KST",
    size: "1.2GB",
    containers: "N/A",
  }),
].join("\n")}\n`;

/** `docker volume ls --format VOLUME_FORMAT`. */
export const VOLUMES = `${[
  line({
    name: "0a651bd9b02808d74eb250b2f94638f17471b578a5a001f3206a07638beb4736",
    driver: "local",
    mountpoint: "/var/lib/docker/volumes/0a65/_data",
    labels: "com.docker.volume.anonymous=",
    project: "",
  }),
  line({
    name: "shop_db-data",
    driver: "local",
    mountpoint: "/var/lib/docker/volumes/shop_db-data/_data",
    labels: "com.docker.compose.project=shop,com.docker.compose.volume=db-data",
    project: "shop",
  }),
].join("\n")}\n`;

/** `docker network ls --no-trunc --format NETWORK_FORMAT`. */
export const NETWORKS = `${[
  line({
    id: "6c1e1c06f71d",
    name: "bridge",
    driver: "bridge",
    scope: "local",
    internal: "false",
    project: "",
  }),
  line({
    id: "69a6b65334df",
    name: "shop_default",
    driver: "bridge",
    scope: "local",
    internal: "false",
    project: "shop",
  }),
  line({
    id: "11aa22bb33cc",
    name: "backplane",
    driver: "bridge",
    scope: "local",
    internal: "true",
    project: "",
  }),
].join("\n")}\n`;

/** `docker compose ls --all --format json`: one JSON array. */
export const PROJECTS = JSON.stringify([
  {
    Name: "shop",
    Status: "running(2)",
    ConfigFiles: "/Users/me/shop/compose.yaml,/Users/me/shop/compose.override.yaml",
  },
  { Name: "old-demo", Status: "exited(4), running(1)", ConfigFiles: "/Users/me/demo/compose.yaml" },
]);

/** `docker stats --no-stream --no-trunc --format '{{json .}}'`. */
export const STATS = `${[
  line({
    BlockIO: "47.1MB / 522MB",
    CPUPerc: "0.17%",
    Container: WEB_ID,
    ID: WEB_ID.slice(0, 12),
    MemPerc: "0.48%",
    MemUsage: "37.75MiB / 7.747GiB",
    Name: "shop-web-1",
    NetIO: "233MB / 10.7MB",
    PIDs: "43",
  }),
  line({
    BlockIO: "66.6MB / 202MB",
    CPUPerc: "12.40%",
    Container: DB_ID,
    ID: DB_ID.slice(0, 12),
    MemPerc: "0.66%",
    MemUsage: "52.41MiB / 7.747GiB",
    Name: "shop-db-1",
    NetIO: "1.2kB / 0B",
    PIDs: "12",
  }),
].join("\n")}\n`;

/** `docker system df --format '{{json .}}'`. */
export const DISK = `${[
  line({
    Active: "14",
    Reclaimable: "15.16GB (56%)",
    Size: "26.7GB",
    TotalCount: "38",
    Type: "Images",
  }),
  line({
    Active: "2",
    Reclaimable: "708.9MB (85%)",
    Size: "832.1MB",
    TotalCount: "3",
    Type: "Containers",
  }),
  line({
    Active: "1",
    Reclaimable: "43.64GB (80%)",
    Size: "53.96GB",
    TotalCount: "2",
    Type: "Local Volumes",
  }),
  line({
    Active: "0",
    Reclaimable: "17.7GB",
    Size: "29.57GB",
    TotalCount: "214",
    Type: "Build Cache",
  }),
].join("\n")}\n`;

/** `docker version --format '{{json .}}'` with the engine up. */
export const VERSION = line({
  Client: {
    Version: "29.8.1",
    ApiVersion: "1.56",
    DefaultAPIVersion: "1.56",
    GitCommit: "4a63305",
    GoVersion: "go1.26.8",
    Os: "darwin",
    Arch: "arm64",
    BuildTime: "Tue Sep 15 16:24:48 2026",
    Context: "desktop-linux",
  },
  Server: {
    Platform: { Name: "Docker Desktop 4.93.0 (240920)" },
    Version: "29.8.1",
    ApiVersion: "1.56",
    MinAPIVersion: "1.40",
    Os: "linux",
    Arch: "arm64",
    Components: [],
  },
});

/** The same with the engine down: exit 1, no server, and what the CLI said. */
export const VERSION_DOWN = line({
  Client: {
    Version: "29.8.1",
    ApiVersion: "1.56",
    Os: "darwin",
    Arch: "arm64",
    Context: "desktop-linux",
  },
  Server: null,
});
export const DAEMON_DOWN =
  "failed to connect to the docker API at unix:///Users/me/.docker/run/docker.sock; check if the path is correct and if the daemon is running: dial unix /Users/me/.docker/run/docker.sock: connect: no such file or directory\n";

/** `docker context ls --format '{{json .}}'`. */
export const CONTEXTS = `${[
  line({
    Current: false,
    Description: "Current DOCKER_HOST based configuration",
    DockerEndpoint: "unix:///var/run/docker.sock",
    Error: "",
    Name: "default",
  }),
  line({
    Current: true,
    Description: "Docker Desktop",
    DockerEndpoint: "unix:///Users/me/.docker/run/docker.sock",
    Error: "",
    Name: "desktop-linux",
  }),
  line({
    Current: false,
    Description: "build box",
    DockerEndpoint: "ssh://me@build.example",
    Error: "",
    Name: "build",
  }),
].join("\n")}\n`;

/** One line of `docker events --format '{{json .}}'`. */
export function event(
  type: string,
  action: string,
  id: string,
  attributes: Record<string, string> = {},
  time = 1793426838,
) {
  return line({
    Type: type,
    Action: action,
    Actor: { ID: id, Attributes: { name: "shop-web-1", ...attributes } },
    scope: "local",
    time,
    timeNano: time * 1e9 + 31343464,
  });
}

/** `docker container inspect` of shop-db-1, trimmed to the fields the detail reads. */
export const INSPECT = JSON.stringify([
  {
    Id: DB_ID,
    Created: "2026-10-31T00:29:36.1Z",
    Path: "docker-entrypoint.sh",
    Args: ["postgres"],
    State: {
      Status: "running",
      Running: true,
      Paused: false,
      OOMKilled: false,
      Pid: 66135,
      ExitCode: 0,
      Error: "",
      StartedAt: "2026-10-31T00:29:44.605365507Z",
      FinishedAt: "0001-01-01T00:00:00Z",
      Health: {
        Status: "healthy",
        FailingStreak: 0,
        Log: [
          {
            Start: "2026-10-31T06:00:00Z",
            End: "2026-10-31T06:00:01Z",
            ExitCode: 0,
            Output: "accepting connections\n",
          },
        ],
      },
    },
    Image: "sha256:75731e2765e7d0c8bb7dea960ef3bdcde68d16314991ab2057a2a74ea0fff257",
    Name: "/shop-db-1",
    RestartCount: 0,
    Platform: "linux",
    HostConfig: {
      RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 },
      Memory: 536870912,
      NanoCpus: 1500000000,
      PidsLimit: 0,
      NetworkMode: "shop_default",
    },
    Mounts: [
      {
        Type: "volume",
        Name: "shop_db-data",
        Source: "/var/lib/docker/volumes/shop_db-data/_data",
        Destination: "/var/lib/postgresql/data",
        RW: true,
      },
    ],
    Config: {
      Image: "postgres:17",
      Env: ["POSTGRES_PASSWORD=hunter2", "POSTGRES_DB=shop", "PATH=/usr/local/bin:/usr/bin"],
      Cmd: ["postgres"],
      Entrypoint: ["docker-entrypoint.sh"],
      WorkingDir: "",
      Labels: { "com.docker.compose.service": "db", "com.docker.compose.project": "shop" },
    },
    NetworkSettings: {
      Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "5432" }] },
      Networks: {
        shop_default: {
          IPAddress: "172.18.0.2",
          IPPrefixLen: 16,
          Gateway: "172.18.0.1",
          Aliases: ["db"],
        },
      },
    },
  },
]);
