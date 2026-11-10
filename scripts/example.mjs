// `just example <name>`'s first step: an example that is a native plugin (kind `native`, #59) is
// built with cargo and its program put where its manifest names it for this platform, so the desk
// loads it. Other examples need no build. Usage: node scripts/example.mjs build <name>
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

/** This machine as a native plugin's manifest names it: `<os>-<arch>`, as Rust does. */
export function platform(os = process.platform, arch = process.arch) {
  const oses = { darwin: "macos", linux: "linux", win32: "windows" };
  const arches = { arm64: "aarch64", x64: "x86_64" };
  if (!oses[os] || !arches[arch]) throw new Error(`no native plugins on ${os}-${arch}`);
  return `${oses[os]}-${arches[arch]}`;
}

/** What building example `name` takes: undefined when it is not a native plugin. */
export function plan(name, root = ROOT, here = platform()) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`not an example name: ${name}`);
  const folder = join(root, "examples", name);
  const manifest = JSON.parse(readFileSync(join(folder, "plugin.json"), "utf8"));
  if (manifest.kind !== "native") return undefined;
  const program = manifest.native?.binaries?.[here];
  if (!program) throw new Error(`${name} has no program for ${here}`);
  const cargo = readFileSync(join(folder, "Cargo.toml"), "utf8");
  const crate = /^name\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
  if (!crate) throw new Error(`${name}'s Cargo.toml names no package`);
  const exe = here.startsWith("windows-") ? ".exe" : "";
  return {
    crate,
    built: join(root, "target", "debug", `${crate}${exe}`),
    to: join(folder, program),
  };
}

function build(name) {
  const steps = plan(name);
  if (!steps) return;
  execFileSync("cargo", ["build", "-p", steps.crate], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, CARGO_INCREMENTAL: "0" },
  });
  if (!existsSync(steps.built)) throw new Error(`cargo built no ${steps.built}`);
  mkdirSync(dirname(steps.to), { recursive: true });
  copyFileSync(steps.built, steps.to);
  chmodSync(steps.to, 0o755);
  console.log(`example ${name}: ${steps.to}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, name] = process.argv.slice(2);
  if (command !== "build" || !name) {
    console.error("usage: node scripts/example.mjs build <name>");
    process.exit(2);
  }
  build(name);
}
