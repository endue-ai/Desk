#!/usr/bin/env node
// Package the CEF desk for one target with cargo-packager (#46, ADR 0145), from binaries already built
// (`cargo build -p desk-shell --bins --release --target T` against the CEF that scripts/cef-fetch.mjs
// fetched) and the built shell (apps/desk/dist):
// - macOS: `endue Desk.app` with the CEF framework and the five helper apps in Contents/Frameworks,
//   signed inside out by scripts/cef-sign-macos.sh (ad-hoc without APPLE_SIGNING_IDENTITY) before the
//   .dmg is made, notarised and stapled when the Apple credentials are set; then the .app.tar.gz.
// - Windows: CEF's files beside endue-desk-cef.exe, an NSIS installer and an MSI; every PE file
//   signed through DESK_WINDOWS_SIGN_COMMAND (cargo-packager's signCommand, `%1` the file) when set.
// - Linux: the executable and CEF's files in /usr/lib/endue-desk-cef, a launcher in /usr/bin; a .deb
//   and an AppImage. libcef.so ships stripped.
// Every package carries the built-in plugins (git's plugins/ without tests) beside the shell (#47).
// Outputs land in <out>/bundle/{macos,dmg,nsis,msi,deb,appimage}/, the layout
// scripts/release-collect.mjs reads. `--dry-run` prints the config and touches nothing; `--formats`
// makes some of the target's formats only (`app`: the .app and .app.tar.gz without a disk image).
//   node scripts/cef-package.mjs --target T --version V [--out DIR] [--binaries DIR] [--cef CEF_PATH]
//     [--formats a,b] [--dry-run]
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { plan, readPin } from "./cef-fetch.mjs";
import {
  bundleFolder,
  HELPER,
  helperApps,
  helperPlist,
  MAIN,
  osOf,
  PACKAGER,
  packagerConfig,
  pluginFiles,
  ROOT,
} from "./cef-package/config.mjs";

const SIGN_MACOS = join(ROOT, "scripts/cef-sign-macos.sh");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args[0] ?? ""} exited ${result.status}`);
}

/** Everything a run needs, from the arguments and the environment. */
export function resolveRun(args, env = process.env) {
  const value = (name) => {
    const at = args.indexOf(name);
    return at < 0 ? undefined : args[at + 1];
  };
  const target = value("--target");
  const version = value("--version");
  if (!target || !version)
    throw new Error("--target <rust triple> and --version <version> are needed");
  const pin = readPin();
  const cefPath = resolve(value("--cef") ?? env.CEF_PATH ?? join(homedir(), ".cache/desk/cef"));
  const out = resolve(value("--out") ?? join(ROOT, "target/packager", target));
  const crossBuilt = join(ROOT, "target", target, "release");
  const binaries = resolve(
    value("--binaries") ?? (existsSync(crossBuilt) ? crossBuilt : join(ROOT, "target/release")),
  );
  const paths = {
    binaries,
    out: join(out, "raw"),
    stage: join(out, "stage"),
    bundle: join(out, "bundle"),
    cef: plan(pin, target, cefPath).dir,
    dist: join(ROOT, "apps/desk/dist"),
  };
  const os = osOf(target);
  const app = join(
    paths.out,
    `${JSON.parse(readFileSync(join(PACKAGER, "packager.json"), "utf8")).productName}.app`,
  );
  if ([SIGN_MACOS, app].some((path) => path.includes("'"))) throw new Error("a path holds a quote");
  const hook = os === "macos" ? `bash '${SIGN_MACOS}' hook '${app}'` : undefined;
  const signCommand = os === "windows" ? env.DESK_WINDOWS_SIGN_COMMAND || undefined : undefined;
  const base = JSON.parse(readFileSync(join(PACKAGER, "packager.json"), "utf8"));
  const config = packagerConfig({ base, pin, target, version, paths, hook, signCommand });
  const formats = value("--formats");
  if (formats) config.formats = pickFormats(config.formats, formats);
  return {
    target,
    version,
    os,
    pin,
    paths,
    app,
    config,
    signCommand,
    dryRun: args.includes("--dry-run"),
  };
}

/**
 * `--formats a,b`: some of the target's formats only. macOS without `dmg` (an update rehearsal,
 * #47) makes the .app and its .app.tar.gz, and never mounts a disk image under /Volumes.
 */
export function pickFormats(all, asked) {
  const picked = asked.split(",").filter(Boolean);
  const unknown = picked.filter((format) => !all.includes(format));
  if (picked.length === 0 || unknown.length > 0) {
    throw new Error(`--formats takes some of ${all.join(", ")}, not ${asked}`);
  }
  return all.filter((format) => picked.includes(format));
}

function need(path, what) {
  if (!existsSync(path)) throw new Error(`${what} is missing: ${path}`);
}

/** The five helper apps, each a copy of the helper binary with its own Info.plist. */
function stageHelpers(r) {
  const template = readFileSync(join(PACKAGER, "macos/helper.plist"), "utf8");
  const minimum = r.config.macos.minimumSystemVersion;
  for (const helper of helperApps(r.config.identifier)) {
    const contents = join(r.paths.stage, "helpers", `${helper.name}.app`, "Contents");
    mkdirSync(join(contents, "MacOS"), { recursive: true });
    writeFileSync(
      join(contents, "Info.plist"),
      helperPlist(template, { ...helper, version: r.version, minimum }),
    );
    copyFileSync(join(r.paths.binaries, HELPER), join(contents, "MacOS", helper.name));
    chmodSync(join(contents, "MacOS", helper.name), 0o755);
  }
}

/** A copy of the built-in plugins the package carries (`pluginFiles`): what git tracks, no tests. */
export function stagePlugins(stage, root = ROOT) {
  const listed = spawnSync("git", ["ls-files", "-z", "--", "plugins"], {
    cwd: root,
    encoding: "utf8",
  });
  if (listed.status !== 0)
    throw new Error(`git ls-files plugins: ${listed.stderr || listed.error}`);
  const files = pluginFiles(listed.stdout.split("\0").filter(Boolean));
  if (files.length === 0) throw new Error("no built-in plugins to package");
  const into = join(stage, "plugins");
  rmSync(into, { recursive: true, force: true });
  for (const file of files) {
    const to = join(stage, file);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(root, file), to);
  }
  return files.length;
}

/** Is a PE file without an Authenticode signature (Microsoft's own DLLs keep theirs)? */
function unsignedPe(file) {
  const ps = spawnSync(
    "powershell",
    ["-NoProfile", "-Command", `(Get-AuthenticodeSignature -LiteralPath '${file}').Status`],
    {
      encoding: "utf8",
    },
  );
  return ps.status === 0 && ps.stdout.trim() === "NotSigned";
}

/** Copies of CEF's runtime files and notices for Windows and Linux, signed or stripped. */
function stageCef(r) {
  const into = join(r.paths.stage, "cef");
  mkdirSync(into, { recursive: true });
  for (const name of [...r.pin.runtime[r.os], ...r.pin.runtime.notices]) {
    const clean = name.replace(/\/$/u, "");
    need(join(r.paths.cef, clean), `CEF's ${clean}`);
    cpSync(join(r.paths.cef, clean), join(into, clean), { recursive: true });
  }
  if (r.os === "linux") {
    // libcef.so comes with its symbols (about 1.4 GB); Chromium's own packages strip them.
    run("strip", ["--strip-unneeded", join(into, "libcef.so")]);
    mkdirSync(join(r.paths.stage, "bin"), { recursive: true });
    const launcher = join(r.paths.stage, "bin", MAIN);
    copyFileSync(join(PACKAGER, "linux/launcher.sh"), launcher);
    chmodSync(launcher, 0o755);
  }
  if (r.os === "windows" && r.signCommand) {
    const [bin, ...rest] = r.signCommand.trim().split(" ");
    for (const name of readdirSync(into)) {
      const file = join(into, name);
      if (/\.(dll|exe)$/iu.test(name) && unsignedPe(file)) {
        run(
          bin,
          rest.map((arg) => (arg === "%1" ? file : arg)),
        );
      }
    }
  }
}

/** Sum of the file sizes under `path`. */
export function treeSize(path) {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(path).reduce((sum, name) => sum + treeSize(join(path, name)), 0);
}

/** Move cargo-packager's outputs (and the macOS .app.tar.gz) into <bundle>/<kind>/. */
function collectOutputs(r) {
  const moved = [];
  for (const name of readdirSync(r.paths.out)) {
    const folder = bundleFolder(name);
    if (!folder) continue;
    mkdirSync(join(r.paths.bundle, folder), { recursive: true });
    renameSync(join(r.paths.out, name), join(r.paths.bundle, folder, name));
    moved.push(join(r.paths.bundle, folder, name));
  }
  return moved;
}

export function packageCef(r) {
  for (const [path, what] of [
    [r.paths.cef, `the pinned CEF (node scripts/cef-fetch.mjs --target ${r.target})`],
    [join(r.paths.binaries, MAIN), "the shell's release build"],
    [join(r.paths.dist, "index.html"), "the built shell (pnpm --filter @endue-ai/desk-app build)"],
  ]) {
    need(path, what);
  }
  for (const dir of [r.paths.out, r.paths.stage, r.paths.bundle])
    rmSync(dir, { recursive: true, force: true });
  mkdirSync(r.paths.stage, { recursive: true });
  stagePlugins(r.paths.stage);
  if (r.os === "macos") {
    need(join(r.paths.binaries, HELPER), "the helper's release build");
    stageHelpers(r);
  } else {
    stageCef(r);
  }
  const configFile = join(r.paths.stage, "packager.json");
  writeFileSync(configFile, `${JSON.stringify(r.config, null, 2)}\n`);
  const packager = process.env.CARGO_PACKAGER
    ? [process.env.CARGO_PACKAGER, []]
    : ["cargo", ["packager"]];
  run(packager[0], [...packager[1], "--config", configFile, "-v"], { cwd: ROOT });
  if (r.os === "macos" && r.config.formats.includes("dmg")) {
    // The hook signed the app before the .dmg was made; the .dmg is signed and notarised after it.
    const dmg = readdirSync(r.paths.out).find((name) => name.endsWith(".dmg"));
    if (!dmg) throw new Error(`cargo-packager left no .dmg in ${r.paths.out}`);
    run("bash", [SIGN_MACOS, "dmg", join(r.paths.out, dmg)]);
  } else if (r.os === "macos") {
    // No .dmg, so no hook ran before it: sign the app here.
    run("bash", [SIGN_MACOS, "app", r.app]);
  }
  if (r.os === "macos") {
    const app = basename(r.app);
    // COPYFILE_DISABLE: no AppleDouble ._ entries for the updater to unpack.
    run("tar", ["-czf", `${app}.tar.gz`, app], {
      cwd: r.paths.out,
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
  }
  const outputs = collectOutputs(r);
  const installed = r.os === "macos" ? treeSize(r.app) : treeSize(r.paths.stage);
  return { outputs, installed };
}

function main(args) {
  const r = resolveRun(args);
  if (r.dryRun) {
    console.log(JSON.stringify(r.config, null, 2));
    return;
  }
  const { outputs, installed } = packageCef(r);
  const mib = (bytes) => `${(bytes / 2 ** 20).toFixed(1)} MiB`;
  for (const file of outputs) console.log(`cef-package: ${file} (${mib(statSync(file).size)})`);
  const what = r.os === "macos" ? "the .app" : "the staged files, without the executable";
  console.log(`cef-package: installed ${mib(installed)} (${what})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`cef-package: ${error.message}`);
    process.exit(1);
  }
}
