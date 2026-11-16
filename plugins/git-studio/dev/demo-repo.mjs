#!/usr/bin/env node
// A small made-up project with a history worth looking at, for the preview and its screenshots:
// branches merged and not, tags, a remote with commits to pull and push, a stash, a branch that
// conflicts with main, and changes in the working copy. Everything happens under the folder given.
//
//   node plugins/git-studio/dev/demo-repo.mjs <folder>     → <folder>/lumen (and <folder>/origin.git)
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const base = process.argv[2];
if (!base) {
  console.error("usage: demo-repo.mjs <folder>");
  process.exit(2);
}
const origin = join(base, "origin.git");
const work = join(base, "lumen");
const other = join(base, "teammate");
for (const dir of [origin, work, other]) rmSync(dir, { recursive: true, force: true });
mkdirSync(base, { recursive: true });

const PEOPLE = {
  mira: ["Mira Chen", "mira@example.com"],
  jonas: ["Jonas Weber", "jonas@example.com"],
  ana: ["Ana Souza", "ana@example.com"],
  kenji: ["Kenji Sato", "kenji@example.com"],
  lea: ["Lea Novak", "lea@example.com"],
};
let clock = Math.floor(Date.now() / 1000) - 40 * 86_400;

/** @param {string} cwd @param {string[]} args @param {keyof typeof PEOPLE} [who] */
function git(cwd, args, who = "mira") {
  const [name, email] = PEOPLE[who];
  const date = `${clock} +0000`;
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: name,
      GIT_COMMITTER_EMAIL: email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}
/** @param {string} root @param {Record<string, string>} files */
function write(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}
/** @param {string} root @param {keyof typeof PEOPLE} who @param {string} message @param {Record<string, string>} files @param {number} [hours] */
function commit(root, who, message, files, hours = 9) {
  clock += Math.round(hours * 3600);
  write(root, files);
  git(root, ["add", "-A"], who);
  git(root, ["commit", "-q", "-m", message], who);
}
/** @param {string} root @param {keyof typeof PEOPLE} who @param {string} branch @param {string} message */
function merge(root, who, branch, message) {
  clock += 3 * 3600;
  git(root, ["merge", "--no-ff", "-q", "-m", message, branch], who);
}

git(base, ["init", "-q", "--bare", "-b", "main", origin]);
git(base, ["init", "-q", "-b", "main", work]);
git(work, ["config", "user.name", "Mira Chen"]);
git(work, ["config", "user.email", "mira@example.com"]);
git(work, ["remote", "add", "origin", origin]);

const server = (port = 8080, extra = "") => `import { createServer } from "node:http";
import { routes } from "./routes/index.js";
${extra}
export function start(port = ${port}) {
  const server = createServer((req, res) => routes(req, res));
  server.listen(port);
  return server;
}
`;
const config = (accent) => `export const theme = {
  accent: "${accent}",
  radius: 8,
  font: "Inter",
};
`;

commit(work, "mira", "Initial commit", {
  "README.md": "# Lumen\n\nA tiny photo API.\n",
  "package.json": '{ "name": "lumen", "version": "0.1.0" }\n',
});
commit(work, "mira", "Add the HTTP server", {
  "src/server.js": server(),
  "src/routes/index.js": 'export function routes(req, res) {\n  res.end("ok");\n}\n',
});
commit(work, "jonas", "Add the users route", {
  "src/routes/users.js": "export const users = [];\n",
});
commit(work, "mira", "Theme settings for the gallery", { "src/config.js": config("#3b82f6") });
git(work, ["tag", "-a", "v0.1.0", "-m", "First release"], "mira");
git(work, ["switch", "-q", "-c", "develop"]);
commit(work, "ana", "Album model and storage", {
  "src/models/album.js":
    "export class Album {\n  constructor(name) {\n    this.name = name;\n  }\n}\n",
});
git(work, ["switch", "-q", "-c", "feature/auth"]);
commit(work, "kenji", "Sessions with signed cookies", {
  "src/auth/session.js": "export const sessions = new Map();\n",
});
commit(work, "kenji", "Login and logout routes", {
  "src/auth/routes.js": "export function login() {}\nexport function logout() {}\n",
});
git(work, ["switch", "-q", "main"]);
git(work, ["switch", "-q", "-c", "fix/login-redirect"]);
commit(work, "lea", "Fix the redirect after login", {
  "src/routes/index.js":
    'export function routes(req, res) {\n  if (req.url === "/login") return res.writeHead(302, { location: "/" }).end();\n  res.end("ok");\n}\n',
});
git(work, ["switch", "-q", "main"]);
merge(work, "mira", "fix/login-redirect", "Merge branch 'fix/login-redirect'");
git(work, ["tag", "-a", "v0.1.1", "-m", "Login fix"], "mira");
git(work, ["switch", "-q", "feature/auth"]);
commit(work, "kenji", "Rate limit login attempts", {
  "src/auth/limit.js": "export const MAX = 5;\n",
});
git(work, ["switch", "-q", "develop"]);
commit(work, "ana", "Upload photos to an album", {
  "src/routes/upload.js": "export function upload() {}\n",
});
merge(work, "ana", "feature/auth", "Merge branch 'feature/auth' into develop");
git(work, ["switch", "-q", "-c", "feature/graph-zoom"]);
commit(work, "jonas", "Zoomable timeline of uploads", {
  "src/ui/timeline.js": "export function zoom(level) {\n  return level * 2;\n}\n",
});
commit(work, "jonas", "Pinch to zoom on touch screens", {
  "src/ui/touch.js": "export const pinch = true;\n",
});
git(work, ["switch", "-q", "develop"]);
commit(work, "lea", "Thumbnails in three sizes", {
  "src/images/thumbs.js": "export const SIZES = [64, 256, 1024];\n",
});
git(work, ["switch", "-q", "main"]);
merge(work, "mira", "develop", "Merge branch 'develop' for 0.2.0");
commit(
  work,
  "mira",
  "Release 0.2.0",
  { "package.json": '{ "name": "lumen", "version": "0.2.0" }\n' },
  2,
);
git(work, ["tag", "-a", "v0.2.0", "-m", "Albums, auth and thumbnails"], "mira");
git(work, ["switch", "-q", "-c", "feature/theme-colors", "v0.2.0"]);
commit(work, "ana", "Warmer accent colour for the gallery", { "src/config.js": config("#f97316") });
git(work, ["switch", "-q", "develop"]);
commit(work, "kenji", "Paginate album listings", {
  "src/routes/albums.js": "export const PAGE = 50;\n",
});
git(work, [
  "push",
  "-q",
  "-u",
  "origin",
  "main",
  "develop",
  "feature/graph-zoom",
  "feature/theme-colors",
]);
git(work, ["push", "-q", "origin", "--tags"]);

// A teammate pushes to develop and main: the work copy is behind until it pulls.
git(base, ["clone", "-q", origin, other]);
git(other, ["switch", "-q", "develop"]);
commit(other, "lea", "Cache album covers for an hour", {
  "src/images/cache.js": "export const TTL = 3600;\n",
});
git(other, ["push", "-q", "origin", "develop"]);
git(other, ["switch", "-q", "main"]);
commit(other, "jonas", "Document the API in the README", {
  "README.md": "# Lumen\n\nA tiny photo API.\n\n## Routes\n\n- `GET /albums`\n- `POST /upload`\n",
});
git(other, ["push", "-q", "origin", "main"]);
git(work, ["fetch", "-q", "origin"]);

// Main moves on with a change the theme branch conflicts with, and one commit not pushed yet.
git(work, ["switch", "-q", "main"]);
commit(
  work,
  "mira",
  "Cooler accent colour and a larger radius",
  { "src/config.js": config("#14b8a6").replace("radius: 8", "radius: 12") },
  20,
);
git(work, ["switch", "-q", "-c", "feature/search"]);
commit(
  work,
  "mira",
  "Search photos by tag",
  { "src/routes/search.js": "export function search(tag) {\n  return [];\n}\n" },
  3,
);
git(work, ["switch", "-q", "main"]);

// A stash, then the working copy: a change, a staged new file and an untracked note.
write(work, { "src/routes/albums.js": "export const PAGE = 25;\n" });
git(work, ["add", "src/routes/albums.js"]);
git(work, ["stash", "push", "-q", "-m", "Half-done pagination"]);
write(work, { "src/server.js": server(8080, 'import { log } from "./log.js";\n') });
write(work, {
  "src/log.js":
    "export function log(message) {\n  console.log(new Date().toISOString(), message);\n}\n",
});
git(work, ["add", "src/log.js"]);
write(work, { "docs/notes.md": "- try WebP thumbnails\n" });
rmSync(other, { recursive: true, force: true });
console.log(work);
