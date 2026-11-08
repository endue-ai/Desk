// The Linux container that runs the runtime e2e on macOS (ADR 0018). WebKit there renders without a
// window server, as in CI's runtime-e2e job, so render-tree snapshots come out the same.
//
// The image holds Playwright's browsers and the workspace's node_modules for Linux, built from the
// manifests (Dockerfile next to this file). Each run copies the checkout in read-only; only the
// snapshot folder and the test results are written back.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DOCKERFILE = join(dirname(fileURLToPath(import.meta.url)), "Dockerfile");
const IMAGE = "desk-e2e";
const KEEP_IMAGES = 3;

// Inside the container: copy the checkout without dependencies, build output or other worktrees,
// run Playwright, and hand the results back. The snapshot folder is mounted, so updates land directly.
const SCRIPT = `set -uo pipefail
tar -C /src --exclude=./.git --exclude=./.claude --exclude=./target --exclude=node_modules \\
  --exclude=test-results --exclude=playwright-report --exclude=./packages/runtime/e2e/__snapshots__ \\
  -cf - . | tar -C /work -xf - || exit 1
cd /work/packages/runtime
pnpm exec playwright test "$@"
status=$?
if [ -d test-results ]; then find /results -mindepth 1 -delete; cp -a test-results/. /results/; fi
exit $status`;

/** The @playwright/test version pinned in pnpm-lock.yaml. */
export function playwrightVersion(lockText) {
  const match = /@playwright\/test@(\d+\.\d+\.\d+)/.exec(lockText);
  if (!match) throw new Error("pnpm-lock.yaml pins no @playwright/test version");
  return match[1];
}

/** The pnpm version from package.json's packageManager field. */
export function pnpmVersion(packageJson) {
  const match = /^pnpm@(\d+\.\d+\.\d+)/.exec(JSON.parse(packageJson).packageManager ?? "");
  if (!match) throw new Error('package.json has no "packageManager": "pnpm@x.y.z"');
  return match[1];
}

/** Files that decide the installed dependencies: root manifests plus every workspace package.json. */
export function manifestPaths(repo) {
  const roots = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc"];
  const paths = roots.filter((path) => existsSync(join(repo, path)));
  const workspace = readFileSync(join(repo, "pnpm-workspace.yaml"), "utf8");
  const block =
    /^packages:[ \t]*\r?\n((?:[ \t]+.*(?:\r?\n|$)|[ \t]*\r?\n)*)/m.exec(workspace)?.[1] ?? "";
  for (const [, glob] of block.matchAll(/^\s*-\s*["']?([^"'\s#]+)["']?/gm)) {
    if (!/^[\w.-]+\/\*$/.test(glob) && /[*?{]/.test(glob)) {
      throw new Error(`pnpm-workspace.yaml: only "dir/*" globs are supported here, not "${glob}"`);
    }
    const dirs = glob.endsWith("/*")
      ? readdirSync(join(repo, glob.slice(0, -2)), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => `${glob.slice(0, -2)}/${entry.name}`)
          .sort()
      : [glob];
    for (const dir of dirs)
      if (existsSync(join(repo, dir, "package.json"))) paths.push(`${dir}/package.json`);
  }
  return paths;
}

/** desk-e2e:<hash of the manifests, the Dockerfile and the versions>. */
export function imageTag({ repo, paths, dockerfile, playwright, pnpm }) {
  const hash = createHash("sha256").update(`${dockerfile}\0${playwright}\0${pnpm}\0`);
  for (const path of paths)
    hash
      .update(`${path}\0`)
      .update(readFileSync(join(repo, path)))
      .update("\0");
  return `${IMAGE}:${hash.digest("hex").slice(0, 12)}`;
}

/** `docker run` arguments for one run. Only snapshots and results are writable. */
export function runArgs({ repo, image, name, workers, memory, color = false, args }) {
  return [
    "run",
    "--rm",
    "--init",
    "--name",
    name,
    "--label",
    `${IMAGE}=1`,
    "--memory",
    memory,
    "--memory-swap",
    memory,
    "-v",
    `${repo}:/src:ro`,
    "-v",
    `${repo}/packages/runtime/e2e/__snapshots__:/work/packages/runtime/e2e/__snapshots__`,
    "-v",
    `${repo}/packages/runtime/test-results:/results`,
    "-e",
    `DESK_E2E_WORKERS=${workers}`,
    ...(color ? ["-e", "FORCE_COLOR=1"] : []),
    image,
    "bash",
    "-c",
    SCRIPT,
    "desk-e2e",
    ...args,
  ];
}

const docker = (args, options = {}) => spawnSync("docker", args, { encoding: "utf8", ...options });

/** Make sure the Docker daemon answers; on macOS start Docker Desktop and wait for it. */
export async function ensureDocker({ platform = process.platform, log = console.error } = {}) {
  const probe = () => docker(["info", "--format", "{{.ServerVersion}}"], { timeout: 15_000 });
  let result = probe();
  if (result.error?.code === "ENOENT") {
    throw new Error(
      "Docker is not installed. On macOS the runtime e2e runs in a Linux container (ADR 0018): " +
        "install Docker Desktop (https://docs.docker.com/desktop/setup/install/mac-install/) and run again.",
    );
  }
  if (result.status === 0) return;
  if (platform !== "darwin") throw new Error(`docker is not running: ${result.stderr.trim()}`);
  log("e2e: starting Docker Desktop...");
  spawnSync("open", ["-a", "Docker"]);
  for (let waited = 0; waited < 180; waited += 3) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    result = probe();
    if (result.status === 0) return;
  }
  throw new Error("Docker Desktop did not start within 3 minutes; start it and run again.");
}

/** Build the dependency image for this checkout unless it exists. Returns its tag. */
export function ensureImage(repo, { log = console.error } = {}) {
  const paths = manifestPaths(repo);
  const dockerfile = readFileSync(DOCKERFILE, "utf8");
  const playwright = playwrightVersion(readFileSync(join(repo, "pnpm-lock.yaml"), "utf8"));
  const pnpm = pnpmVersion(readFileSync(join(repo, "package.json"), "utf8"));
  const tag = imageTag({ repo, paths, dockerfile, playwright, pnpm });
  if (docker(["image", "inspect", tag]).status === 0) return tag;

  log(`e2e: building ${tag} (Playwright ${playwright}, pnpm ${pnpm}); once per lockfile change`);
  const context = mkdtempSync(join(tmpdir(), "desk-e2e-image-"));
  try {
    for (const path of paths) {
      mkdirSync(dirname(join(context, path)), { recursive: true });
      copyFileSync(join(repo, path), join(context, path));
    }
    copyFileSync(DOCKERFILE, join(context, "Dockerfile"));
    const build = docker(
      [
        "build",
        "--build-arg",
        `PLAYWRIGHT_VERSION=${playwright}`,
        "--build-arg",
        `PNPM_VERSION=${pnpm}`,
      ].concat(["--label", `${IMAGE}=1`, "-t", tag, context]),
      { stdio: "inherit" },
    );
    if (build.status !== 0) throw new Error(`docker build of ${tag} failed`);
  } finally {
    rmSync(context, { recursive: true, force: true });
  }
  pruneImages(tag);
  return tag;
}

/** Keep the newest few desk-e2e images; Docker refuses to remove one a running container uses. */
function pruneImages(current) {
  const list = docker(["images", IMAGE, "--format", "{{.Repository}}:{{.Tag}}"]).stdout ?? "";
  const old = list
    .split("\n")
    .filter((tag) => tag && tag !== current)
    .slice(KEEP_IMAGES - 1);
  for (const tag of old) docker(["rmi", tag]);
}

/** Remove a container left by a runner that died. */
export function removeContainer(name) {
  if (name) docker(["rm", "--force", name]);
}

/** Stop a running container now (signals to the runner reach it this way). */
export function killContainer(name) {
  try {
    execFileSync("docker", ["kill", name], { stdio: "ignore", timeout: 15_000 });
  } catch {
    // Already gone.
  }
}
