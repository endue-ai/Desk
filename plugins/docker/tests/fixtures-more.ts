// More of what docker printed on a Docker Desktop engine (28.4, 29.8), names made generic: the stats
// stream with its cursor codes, an image's history, a container's `ls -lA`, a pull and a build.
import { DB_ID, WEB_ID } from "./fixtures";

const ESC = String.fromCharCode(27);
const line = (record: Record<string, unknown>) => JSON.stringify(record);

/** One sample line of `docker stats --no-trunc --format '{{json .}}'`. */
export function statsLine(id: string, name: string, cpu: string, mem: string, net: string): string {
  return line({
    BlockIO: "823kB / 323MB",
    CPUPerc: cpu,
    Container: id,
    ID: id,
    MemPerc: "6.55%",
    MemUsage: mem,
    Name: name,
    NetIO: net,
    PIDs: "71",
  });
}

/**
 * Frames as the stream writes them: the cursor goes home before each, the rest of the screen is
 * cleared after it, and the same numbers often come twice.
 */
export function statsFrames(
  frames: Array<Array<[string, string, string, string, string]>>,
): string[] {
  const out: string[] = [];
  for (const frame of frames) {
    frame.forEach((sample, i) => {
      out.push(`${i === 0 ? `${ESC}[J${ESC}[H` : ""}${statsLine(...sample)}`);
    });
    out.push(` ${ESC}[K`);
  }
  return out;
}

/** Three frames, a second apart: shop-db-1 gets busy, shop-web-1 sends 2 MB a second. */
export const STATS_STREAM = statsFrames([
  [
    [WEB_ID, "shop-web-1", "0.17%", "37.75MiB / 7.747GiB", "233MB / 10.7MB"],
    [DB_ID, "shop-db-1", "1.57%", "52.41MiB / 7.747GiB", "1.2kB / 0B"],
  ],
  [
    [WEB_ID, "shop-web-1", "0.25%", "38MiB / 7.747GiB", "234MB / 11.7MB"],
    [DB_ID, "shop-db-1", "12.40%", "60MiB / 7.747GiB", "1.2kB / 0B"],
  ],
  [
    [WEB_ID, "shop-web-1", "0.20%", "38.5MiB / 7.747GiB", "235MB / 12.7MB"],
    [DB_ID, "shop-db-1", "50.00%", "64MiB / 7.747GiB", "1.2kB / 0B"],
  ],
]);

/** `docker image history --no-trunc --format '{{json .}}' -- postgres:17`, trimmed to four layers. */
export const HISTORY = [
  {
    Comment: "buildkit.dockerfile.v0",
    CreatedAt: "2026-10-20T13:38:33+09:00",
    CreatedBy: 'CMD ["postgres"]',
    CreatedSince: "2 weeks ago",
    ID: "sha256:9431865c385c56c50707f2296920e460ca85097d2d3767caf0fc2d776007f8f7",
    Size: "0B",
  },
  {
    Comment: "buildkit.dockerfile.v0",
    CreatedAt: "2026-10-20T13:38:33+09:00",
    CreatedBy: "EXPOSE map[5432/tcp:{}]",
    CreatedSince: "2 weeks ago",
    ID: "<missing>",
    Size: "0B",
  },
  {
    Comment: "buildkit.dockerfile.v0",
    CreatedAt: "2026-10-20T13:38:20+09:00",
    CreatedBy:
      "RUN /bin/sh -c set -eux;   apt-get update; apt-get install -y postgresql # buildkit",
    CreatedSince: "2 weeks ago",
    ID: "<missing>",
    Size: "289MB",
  },
  {
    Comment: "",
    CreatedAt: "2026-10-13T09:00:00+09:00",
    CreatedBy: "/bin/sh -c #(nop) ADD file:6b2d45 in / ",
    CreatedSince: "3 weeks ago",
    ID: "<missing>",
    Size: "97.2MB",
  },
]
  .map(line)
  .join("\n");

/** `docker exec ID ls -lA -- /` in a Debian image. */
export const LS_ROOT = `total 52
lrwxrwxrwx   1 root root    7 Sep 18 00:00 bin -> usr/bin
drwxr-xr-x   2 root root 4096 Jul  2 19:05 boot
crw-rw-rw-   1 root root 1, 3 Oct 31 06:06 null
-rwxr-xr-x   1 root root    0 Oct 31 06:06 .dockerenv
drwxr-xr-x   1 root root 4096 Oct 31 06:06 etc
-rw-r--r--   1 root root  220 Jan  6  2025 my notes.txt
`;

/** `docker pull nginx:1.27` without a terminal. */
export const PULL = [
  "1.27: Pulling from library/nginx",
  "6e771e15690e: Pulling fs layer",
  "5a0b4b3a1c2d: Already exists",
  "7c3b2a1f0e9d: Pulling fs layer",
  "6e771e15690e: Verifying Checksum",
  "6e771e15690e: Download complete",
  "6e771e15690e: Pull complete",
  "7c3b2a1f0e9d: Download complete",
  "7c3b2a1f0e9d: Pull complete",
  "Digest: sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "Status: Downloaded newer image for nginx:1.27",
  "docker.io/library/nginx:1.27",
];

/** `docker build --progress plain` of a three-step Dockerfile, as BuildKit writes it to stderr. */
export const BUILD = [
  '#0 building with "desktop-linux" instance using docker driver',
  "#1 [internal] load build definition from Dockerfile",
  "#1 DONE 0.0s",
  "#5 [1/3] FROM docker.io/library/node:22-bookworm-slim@sha256:4f53cda18c2b",
  "#5 CACHED",
  "#6 [2/3] COPY package.json .",
  "#6 DONE 0.1s",
  "#7 [3/3] RUN npm install",
  "#7 1.204 added 12 packages in 1s",
  "#7 DONE 1.5s",
  "#8 exporting to image",
  "#8 naming to docker.io/library/shop-web:dev done",
  "#8 DONE 0.2s",
];
