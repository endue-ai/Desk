// The preview engine's seed: the images, containers, volumes, networks and contexts it starts
// with. For the preview only; the desk never loads dev/.

import { createHash } from "node:crypto";

/** A stable hex id of a text. */
export const hex = (/** @type {string} */ text, n = 64) =>
  createHash("sha256").update(text).digest("hex").slice(0, n);

export const MB = 1e6;
export const GB = 1e9;
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** The images, newest first. */
export const IMAGES = [
  ["shop-api:dev", 412 * MB, 2 * HOUR, "node", ["3000/tcp"], ["node", "server.js"]],
  ["nginx:1.27-alpine", 52.4 * MB, 9 * DAY, "nginx", ["80/tcp"], ["nginx", "-g", "daemon off;"]],
  ["postgres:16-alpine", 275 * MB, 12 * DAY, "postgres", ["5432/tcp"], ["postgres"]],
  ["redis:7-alpine", 41.2 * MB, 15 * DAY, "redis", ["6379/tcp"], ["redis-server"]],
  ["grafana/grafana:11.3.0", 476 * MB, 20 * DAY, "grafana", ["3000/tcp"], []],
  [
    "prom/prometheus:v2.55.0",
    286 * MB,
    22 * DAY,
    "prometheus",
    ["9090/tcp"],
    ["--config.file=/etc/prometheus/prometheus.yml"],
  ],
  ["ollama/ollama:0.4.1", 3.41 * GB, 25 * DAY, "ollama", ["11434/tcp"], ["serve"]],
  ["ghcr.io/acme/payments:2.3.1", 188 * MB, 6 * DAY, "go", ["8443/tcp"], ["/payments"]],
  ["axllent/mailpit:v1.20", 30.1 * MB, 31 * DAY, "go", ["1025/tcp", "8025/tcp"], []],
  ["wordpress:6.6-php8.2-apache", 703 * MB, 40 * DAY, "php", ["80/tcp"], ["apache2-foreground"]],
  ["mysql:8.4", 603 * MB, 41 * DAY, "mysql", ["3306/tcp", "33060/tcp"], ["mysqld"]],
  ["moby/buildkit:buildx-stable-1", 210 * MB, 44 * DAY, "go", [], []],
  ["node:22-alpine", 158 * MB, 10 * DAY, "node", [], ["node"]],
  ["python:3.12-slim", 151 * MB, 13 * DAY, "python", [], ["python3"]],
  ["alpine:3.20", 8.8 * MB, 60 * DAY, "alpine", [], ["/bin/sh"]],
  ["hello-world:latest", 13_256, 300 * DAY, "hello", [], ["/hello"]],
  ["<none>:<none>#1", 409 * MB, 1 * DAY, "node", ["3000/tcp"], ["node", "server.js"]],
  ["<none>:<none>#2", 405 * MB, 3 * DAY, "node", ["3000/tcp"], ["node", "server.js"]],
];

/**
 * The containers: [name, image, state, project, service, ports, extra].
 * `ago` is how long ago it started (or stopped, when not running).
 */
export const CONTAINERS = [
  [
    "shop-web-1",
    "nginx:1.27-alpine",
    "running",
    "shop",
    "web",
    ["8080:80"],
    { ago: 3 * HOUR, cpu: 0.4, mem: 18 * MB, net: "shop_default" },
  ],
  [
    "shop-api-1",
    "shop-api:dev",
    "running",
    "shop",
    "api",
    ["3000:3000"],
    {
      ago: 2 * HOUR,
      cpu: 6.5,
      mem: 182 * MB,
      health: "healthy",
      env: [
        "NODE_ENV=development",
        "DATABASE_URL=postgres://shop:s3cr3t@db:5432/shop",
        "REDIS_URL=redis://cache:6379",
        "JWT_SECRET=dev-only-secret",
      ],
    },
  ],
  [
    "shop-worker-1",
    "shop-api:dev",
    "running",
    "shop",
    "worker",
    [],
    { ago: 2 * HOUR, cpu: 2.1, mem: 121 * MB, cmd: ["node", "worker.js"] },
  ],
  [
    "shop-db-1",
    "postgres:16-alpine",
    "running",
    "shop",
    "db",
    ["5432:5432"],
    {
      ago: 3 * HOUR,
      cpu: 1.3,
      mem: 96 * MB,
      health: "healthy",
      volume: ["shop_pgdata", "/var/lib/postgresql/data"],
      env: ["POSTGRES_USER=shop", "POSTGRES_PASSWORD=s3cr3t", "POSTGRES_DB=shop"],
    },
  ],
  [
    "shop-cache-1",
    "redis:7-alpine",
    "running",
    "shop",
    "cache",
    ["6379:6379"],
    { ago: 3 * HOUR, cpu: 0.3, mem: 9 * MB, volume: ["shop_redis", "/data"] },
  ],
  [
    "shop-migrate-1",
    "shop-api:dev",
    "exited",
    "shop",
    "migrate",
    [],
    { ago: 2 * HOUR, exit: 1, cmd: ["npm", "run", "migrate"] },
  ],
  [
    "observability-grafana-1",
    "grafana/grafana:11.3.0",
    "running",
    "observability",
    "grafana",
    ["3001:3000"],
    {
      ago: 26 * HOUR,
      cpu: 0.9,
      mem: 88 * MB,
      volume: ["observability_grafana", "/var/lib/grafana"],
    },
  ],
  [
    "observability-prometheus-1",
    "prom/prometheus:v2.55.0",
    "running",
    "observability",
    "prometheus",
    ["9090:9090"],
    { ago: 26 * HOUR, cpu: 1.8, mem: 142 * MB, volume: ["observability_prom", "/prometheus"] },
  ],
  [
    "blog-wordpress-1",
    "wordpress:6.6-php8.2-apache",
    "exited",
    "blog",
    "wordpress",
    ["8000:80"],
    { ago: 4 * DAY, exit: 0, volume: ["blog_wp", "/var/www/html"] },
  ],
  [
    "blog-db-1",
    "mysql:8.4",
    "exited",
    "blog",
    "db",
    [],
    { ago: 4 * DAY, exit: 0, volume: ["blog_db", "/var/lib/mysql"] },
  ],
  [
    "ollama",
    "ollama/ollama:0.4.1",
    "running",
    "",
    "",
    ["11434:11434"],
    {
      ago: 5 * HOUR,
      cpu: 18.5,
      mem: 2.3 * GB,
      volume: ["ollama_models", "/root/.ollama"],
      net: "devnet",
    },
  ],
  [
    "payments-sandbox",
    "ghcr.io/acme/payments:2.3.1",
    "running",
    "",
    "",
    ["8443:8443"],
    { ago: 50 * MIN, cpu: 0.7, mem: 34 * MB, health: "unhealthy", net: "devnet", restarts: 4 },
  ],
  [
    "mailpit",
    "axllent/mailpit:v1.20",
    "paused",
    "",
    "",
    ["8025:8025", "1025:1025"],
    { ago: 9 * HOUR, cpu: 0, mem: 12 * MB },
  ],
  [
    "buildx_buildkit_desk0",
    "moby/buildkit:buildx-stable-1",
    "running",
    "",
    "",
    [],
    { ago: 30 * HOUR, cpu: 0.1, mem: 28 * MB, privileged: true },
  ],
];

export const VOLUMES = [
  ["shop_pgdata", "shop", 68.2 * MB],
  ["shop_redis", "shop", 1.9 * MB],
  ["observability_grafana", "observability", 24.6 * MB],
  ["observability_prom", "observability", 512 * MB],
  ["blog_db", "blog", 214 * MB],
  ["blog_wp", "blog", 88.5 * MB],
  ["ollama_models", "", 4.12 * GB],
  ["old_build_cache", "", 1.21 * GB],
  [hex("anonymous-1"), "", 0],
];

export const NETWORKS = [
  ["bridge", "bridge", "172.17.0.0/16", ""],
  ["host", "host", "", ""],
  ["none", "null", "", ""],
  ["shop_default", "bridge", "172.20.0.0/16", "shop"],
  ["observability_default", "bridge", "172.21.0.0/16", "observability"],
  ["blog_default", "bridge", "172.22.0.0/16", "blog"],
  ["devnet", "bridge", "172.30.0.0/16", ""],
];

export const CONTEXTS = [
  {
    Name: "default",
    Description: "Current DOCKER_HOST based configuration",
    DockerEndpoint: "unix:///var/run/docker.sock",
  },
  {
    Name: "desk-local",
    Description: "The engine on this computer",
    DockerEndpoint: "unix:///Users/dev/.docker/run/docker.sock",
  },
  {
    Name: "prod-eu",
    Description: "Production (EU), over SSH",
    DockerEndpoint: "ssh://deploy@prod-eu.internal",
  },
];
