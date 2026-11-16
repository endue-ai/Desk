// The preview engine's files inside containers: a few folders and files per kind of image, listed
// the way `ls -lA` prints them and read the way `head -c` does.

const D = (/** @type {string} */ name, size = 4096) => ["d", name, size];
const F = (/** @type {string} */ name, /** @type {number} */ size) => ["-", name, size];

/** @type {Record<string, Array<[string, string, number]>>} */
const COMMON = {
  "/": [
    D("app"),
    D("bin"),
    D("dev"),
    D("etc"),
    D("home"),
    D("lib"),
    D("proc"),
    D("root"),
    D("tmp"),
    D("usr"),
    D("var"),
  ],
  "/etc": [
    F("hostname", 13),
    F("hosts", 174),
    F("os-release", 189),
    F("passwd", 1172),
    F("resolv.conf", 38),
    D("nginx"),
    D("ssl"),
  ],
  "/etc/nginx": [D("conf.d"), F("mime.types", 5349), F("nginx.conf", 648)],
  "/etc/nginx/conf.d": [F("default.conf", 1093)],
  "/app": [
    F("Dockerfile", 412),
    D("node_modules"),
    F("package-lock.json", 184_220),
    F("package.json", 1381),
    D("scripts"),
    F("server.js", 3_214),
    D("src"),
    F("worker.js", 1_877),
  ],
  "/app/src": [
    F("db.js", 2210),
    F("orders.js", 5032),
    F("products.js", 4120),
    F("routes.js", 1990),
  ],
  "/app/scripts": [F("migrate.js", 2876)],
  "/var": [D("lib"), D("log"), D("run"), D("cache")],
  "/var/log": [D("nginx")],
  "/tmp": [],
};

const FILES = /** @type {Record<string, string>} */ ({
  "/etc/os-release":
    'NAME="Alpine Linux"\nID=alpine\nVERSION_ID=3.20.3\nPRETTY_NAME="Alpine Linux v3.20"\nHOME_URL="https://alpinelinux.org/"\n',
  "/etc/hostname": "609be3616e38\n",
  "/etc/nginx/conf.d/default.conf":
    "server {\n    listen       80;\n    server_name  localhost;\n\n    location / {\n        proxy_pass http://api:3000;\n        proxy_set_header Host $host;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    }\n\n    location /static/ {\n        root /usr/share/nginx/html;\n        expires 7d;\n    }\n\n    error_page   500 502 503 504  /50x.html;\n}\n",
  "/app/package.json":
    '{\n  "name": "shop-api",\n  "version": "1.8.0",\n  "type": "module",\n  "scripts": {\n    "start": "node server.js",\n    "migrate": "node scripts/migrate.js",\n    "build": "tsc -p tsconfig.build.json"\n  },\n  "dependencies": {\n    "express": "^4.21.1",\n    "pg": "^8.13.1",\n    "ioredis": "^5.4.1"\n  }\n}\n',
  "/app/Dockerfile":
    'FROM node:22-alpine AS base\nWORKDIR /app\n\nFROM base AS deps\nCOPY package.json package-lock.json ./\nRUN npm ci --omit=dev\n\nFROM deps AS build\nCOPY . .\nRUN npm run build\n\nEXPOSE 3000\nCMD ["node", "server.js"]\n',
  "/app/server.js":
    'import express from "express";\nimport { routes } from "./src/routes.js";\n\nconst app = express();\napp.use(express.json());\napp.get("/healthz", (_req, res) => res.send("ok"));\nroutes(app);\n\napp.listen(3000, () => console.log(JSON.stringify({ level: "info", msg: "listening", port: 3000 })));\n',
});

/** `ls -lA` of a folder, or undefined when it does not exist. */
export function ls(/** @type {string} */ path) {
  const list = COMMON[path];
  if (!list) return undefined;
  return list
    .map(
      ([type, name, size]) =>
        `${type}${type === "d" ? "rwxr-xr-x" : "rw-r--r--"}    ${type === "d" ? 2 : 1} root     root      ${String(size).padStart(8)} Nov 14 09:12 ${name}`,
    )
    .join("\n");
}

/** What `head -c` reads of a file. */
export function read(/** @type {string} */ path) {
  return FILES[path] ?? `// ${path}\n`;
}
