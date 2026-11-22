// Compile real Rust location macros as the release recipes do, including a checkout with spaces.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

for (const desktop of [true, false]) {
  test(`the ${desktop ? "desktop" : "standalone"} release omits local paths from Rust executables`, (t) => {
    const temp = mkdtempSync(join(tmpdir(), "endue-release-"));
    t.after(() => rmSync(temp, { recursive: true, force: true }));
    const account = join(temp, "fixture-account");
    const checkout = join(account, "private checkout");
    const registry = join(temp, "external cargo cache");
    const src = join(checkout, "src");
    mkdirSync(src, { recursive: true });
    mkdirSync(registry);
    writeFileSync(
      join(checkout, "Cargo.toml"),
      '[package]\nname = "location-probe"\nversion = "1.0.0"\nedition = "2021"\n',
    );
    const cached = join(registry, "external.rs");
    writeFileSync(cached, "fn external() -> &'static str { file!() }");
    writeFileSync(join(src, "location.rs"), "fn checkout() -> &'static str { file!() }");
    writeFileSync(
      join(src, "main.rs"),
      [
        'include!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/location.rs"));',
        'include!(env!("LOCATION_PROBE"));',
        'fn main() { println!("{}\\n{}\\n{}", checkout(), external(), cfg!(desktop_flag)); }',
      ].join("\n"),
    );
    const env = {
      ...process.env,
      HOME: account,
      USERPROFILE: account,
      RUSTUP_HOME: process.env.RUSTUP_HOME || join(homedir(), ".rustup"),
      CARGO_HOME: registry,
      CARGO_TARGET_DIR: join(temp, "outside target"),
      LOCATION_PROBE: cached,
      RUSTFLAGS: "--cfg desktop_flag --check-cfg=cfg(desktop_flag)",
      RELEASE_ENV: join(
        import.meta.dirname,
        desktop ? "package-build-env.sh" : "package-cli-build-env.sh",
      ).replaceAll("\\", "/"),
    };
    delete env.CARGO_ENCODED_RUSTFLAGS;
    execFileSync(
      "bash",
      [
        "-euc",
        'if [ -f "$RELEASE_ENV" ]; then source "$RELEASE_ENV"; fi\nexec cargo build --quiet --release --offline',
      ],
      { cwd: checkout, env, stdio: "pipe" },
    );
    const executable = join(
      env.CARGO_TARGET_DIR,
      "release",
      process.platform === "win32" ? "location-probe.exe" : "location-probe",
    );
    const bytes = readFileSync(executable);
    for (const marker of [
      "fixture-account",
      "private checkout",
      "external cargo cache",
      "outside target",
    ]) {
      assert.ok(!bytes.includes(Buffer.from(marker)), "the executable retains a fixture path");
    }
    const [source, dep, flag] = execFileSync(executable, { encoding: "utf8" })
      .trim()
      .replaceAll("\\", "/")
      .split(/\r?\n/u);
    assert.equal(source, "/src/src/location.rs");
    assert.equal(dep, "/cargo/external.rs");
    assert.equal(flag, String(desktop));
  });
}
