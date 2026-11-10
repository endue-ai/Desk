// The CEF pin and its fetch (#46): the pin names the build the cef crate wraps, for every release
// target; a fetch refuses anything but the pinned bytes and leaves the layout cef-dll-sys reads.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { parse } from "yaml";
import { cefVersion, crateCefVersion, fetchCef, plan, readPin } from "./cef-fetch.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts/cef-fetch.mjs");
const VERSION = "156.0.26+gtest+chromium-156.0.1.2";
const NAME = `cef_binary_${VERSION}_macosarm64_minimal.tar.bz2`;

/** A tiny archive shaped like CEF's minimal macOS one, and a pin that names it. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "cef-fetch-"));
  const stem = join(dir, "src", NAME.replace(/\.tar\.bz2$/u, ""));
  for (const sub of [
    "Release/Chromium Embedded Framework.framework",
    "cmake",
    "include",
    "libcef_dll",
  ]) {
    mkdirSync(join(stem, sub), { recursive: true });
  }
  writeFileSync(
    join(stem, "Release/Chromium Embedded Framework.framework/Chromium Embedded Framework"),
    "cef",
  );
  for (const name of ["CMakeLists.txt", "CREDITS.html", "LICENSE.txt", "README.txt"]) {
    writeFileSync(join(stem, name), name);
  }
  execFileSync("tar", [
    "-cjf",
    join(dir, NAME),
    "-C",
    join(dir, "src"),
    NAME.replace(/\.tar\.bz2$/u, ""),
  ]);
  const bytes = readFileSync(join(dir, NAME));
  const hash = (algorithm) => createHash(algorithm).update(bytes).digest("hex");
  const archive = { name: NAME, size: bytes.length, sha1: hash("sha1"), sha256: hash("sha256") };
  const pin = {
    version: VERSION,
    cdn: "https://cdn.test",
    archives: { "aarch64-apple-darwin": archive },
  };
  return { dir, bytes, pin, out: join(dir, "out") };
}

/** A fetch that serves `bytes` and counts its calls. */
function serving(bytes) {
  const served = { calls: 0, urls: [] };
  served.fetch = async (url) => {
    served.calls += 1;
    served.urls.push(url);
    return new Response(bytes);
  };
  return served;
}

describe("cef-fetch", () => {
  it("pins the CEF build the cef crate wraps, for every release target", async () => {
    const pin = readPin();
    assert.equal(cefVersion(pin), crateCefVersion(readFileSync(join(ROOT, "Cargo.lock"), "utf8")));
    const build = parse(readFileSync(join(ROOT, ".github/workflows/release-build.yml"), "utf8"));
    for (const { rust } of build.jobs.build.strategy.matrix.include) {
      assert.ok(pin.archives[rust], `cef.json pins an archive for ${rust}`);
      assert.match(pin.archives[rust].name, /_minimal\.tar\.bz2$/u, "the minimal distribution");
    }
    assert.ok(
      pin.runtime.windows.includes("libcef.dll") && pin.runtime.linux.includes("libcef.so"),
    );
  });

  it("fetches the pinned archive once and unpacks it where cef-dll-sys looks", async () => {
    const { dir, bytes, pin, out } = fixture();
    const served = serving(bytes);
    const cef = await fetchCef({
      target: "aarch64-apple-darwin",
      out,
      pin,
      fetchImpl: served.fetch,
    });
    assert.equal(cef, join(out, "156.0.26", "cef_macos_aarch64"));
    assert.deepEqual(served.urls, [`https://cdn.test/${NAME}`]);
    const framework = "Chromium Embedded Framework.framework/Chromium Embedded Framework";
    assert.equal(readFileSync(join(cef, framework), "utf8"), "cef");
    for (const name of ["CMakeLists.txt", "cmake", "include", "libcef_dll", "LICENSE.txt"]) {
      assert.ok(existsSync(join(cef, name)), name);
    }
    const archiveJson = JSON.parse(readFileSync(join(cef, "archive.json"), "utf8"));
    assert.deepEqual(archiveJson, {
      type: "minimal",
      name: NAME,
      sha1: pin.archives["aarch64-apple-darwin"].sha1,
    });
    await fetchCef({ target: "aarch64-apple-darwin", out, pin, fetchImpl: served.fetch });
    assert.equal(served.calls, 1, "the kept archive is the cache");
    rmSync(join(cef, "include"), { recursive: true });
    rmSync(join(cef, ".desk-sha256"));
    await fetchCef({ target: "aarch64-apple-darwin", out, pin, fetchImpl: served.fetch });
    assert.equal(served.calls, 1, "a folder that lost its mark is unpacked from the kept archive");
    assert.ok(existsSync(join(cef, "include")));
    rmSync(dir, { recursive: true });
  });

  it("refuses bytes that are not the pinned archive and keeps nothing of them", async () => {
    const { dir, bytes, pin, out } = fixture();
    const tampered = Buffer.from(bytes);
    tampered[tampered.length >> 1] ^= 1;
    await assert.rejects(
      fetchCef({ target: "aarch64-apple-darwin", out, pin, fetchImpl: serving(tampered).fetch }),
      /sha256 is [0-9a-f]{64}, the pin says/u,
    );
    await assert.rejects(
      fetchCef({
        target: "aarch64-apple-darwin",
        out,
        pin,
        fetchImpl: serving(bytes.subarray(1)).fetch,
      }),
      /size is \d+, the pin says/u,
    );
    const p = plan(pin, "aarch64-apple-darwin", out);
    assert.ok(!existsSync(p.file) && !existsSync(`${p.file}.part`) && !existsSync(p.dir));
    await assert.rejects(
      fetchCef({ target: "x86_64-pc-windows-msvc", out, pin, fetchImpl: serving(bytes).fetch }),
      /pins no CEF archive for x86_64-pc-windows-msvc/u,
    );
    rmSync(dir, { recursive: true });
  });

  it("fetches again over a kept archive whose hash no longer matches", async () => {
    const { dir, bytes, pin, out } = fixture();
    const p = plan(pin, "aarch64-apple-darwin", out);
    mkdirSync(resolve(p.file, ".."), { recursive: true });
    writeFileSync(p.file, "a truncated download");
    const served = serving(bytes);
    await fetchCef({ target: "aarch64-apple-darwin", out, pin, fetchImpl: served.fetch });
    assert.equal(served.calls, 1);
    assert.equal(
      createHash("sha256").update(readFileSync(p.file)).digest("hex"),
      pin.archives["aarch64-apple-darwin"].sha256,
    );
    rmSync(dir, { recursive: true });
  });

  it("a dry run names the URL, the hash and the folder and fetches nothing", () => {
    const out = mkdtempSync(join(tmpdir(), "cef-fetch-dry-"));
    const run = spawnSync(
      process.execPath,
      [SCRIPT, "--target", "x86_64-unknown-linux-gnu", "--out", out, "--dry-run"],
      {
        encoding: "utf8",
      },
    );
    assert.equal(run.status, 0, run.stderr);
    const pin = readPin();
    assert.ok(run.stdout.includes(`${pin.cdn}/${pin.archives["x86_64-unknown-linux-gnu"].name}`));
    assert.ok(run.stdout.includes(pin.archives["x86_64-unknown-linux-gnu"].sha256));
    assert.ok(run.stdout.includes(join(out, "156.0.26", "cef_linux_x86_64")));
    assert.deepEqual(readdirSync(out), []);
    rmSync(out, { recursive: true });
  });
});
