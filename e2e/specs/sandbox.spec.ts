// Chromium's sandbox holds on the CEF desk (ADR 0148), on macOS, where it is on: every renderer, the
// GPU process and the sandboxed utilities run in it, and none may read or write the person's files
// (a file in HOME, the desk's own data folder) though the desk's own process may; and a plugin still
// does all it does in its renderer: a bridge call, its own files over desk-plugin, WebAssembly, a
// worker, a WebGPU compute pass and a Range read through fs.url (e2e/fixtures/plugin-e2e-sandbox,
// e2e.sandbox, a dev plugin for this spec only: wdio.conf.ts). The kernel answers for each process
// through sandbox_check(3) (support/sandbox-probe.c); nothing runs inside the desk's processes.
// Linux and Windows run without the sandbox until #61 proves it there, so the spec waits on them.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { $, expect } from "@wdio/globals";
import { dataDir } from "../support/cef";
import { expectSurface, inFrame, press, shellReady } from "../support/desk";
import { appPid, HOME_VAR } from "../support/driver";
import { deskSubprocesses, probe, probeBinary, type Subprocess } from "../support/sandbox";

const PLUGIN = "e2e.sandbox";
const PERMISSIONS = "endue.permissions";
const results = join(dirname(fileURLToPath(import.meta.url)), "../test-results");

/** The app's HOME (support/driver.ts) and the files no sandboxed process may touch. */
function personsFiles(): { home: string; files: string[] } {
  const home = process.env[HOME_VAR];
  if (!home) throw new Error(`${HOME_VAR} is not set: run the spec through just test-app-e2e`);
  mkdirSync(join(home, "sandbox-fixture"), { recursive: true });
  writeFileSync(join(home, "secret.txt"), "the person's own file\n");
  writeFileSync(
    join(home, "sandbox-fixture/range.bin"),
    Uint8Array.from({ length: 64 }, (_, i) => i),
  );
  const data = dataDir(home);
  return {
    home,
    files: [
      join(home, "secret.txt"),
      join(home, "sandbox-fixture/range.bin"),
      join(data, "last-start.json"),
      join(data, "index.sqlite"),
    ],
  };
}

/** A check's line in e2e.sandbox's frame reads "<name>: ok ...". */
async function passes(name: string, detail = ""): Promise<void> {
  await inFrame(PLUGIN, () =>
    expect($(`[data-testid=${name}]`)).toHaveText(
      expect.stringContaining(`${name}: ok ${detail}`),
      {
        wait: 30_000,
      },
    ),
  );
}

const label = (p: Subprocess) => `${p.type}${p.service ? ` ${p.service}` : ""} (pid ${p.pid})`;

describe("sandbox: Chromium's sandbox on the CEF desk (macOS)", () => {
  before(function () {
    if (process.platform !== "darwin") this.skip();
  });

  it("every renderer, the GPU process and each sandboxed utility run in it, and none reads the person's files", async () => {
    await shellReady();
    await expectSurface(PLUGIN);
    const { files } = personsFiles();
    const desk = appPid();
    if (!desk) throw new Error("the app's pid is not known (E2E_APP_PID)");
    const binary = probeBinary(results);

    // The control: the desk's own process is not sandboxed and may read and write them all.
    const own = probe(binary, desk, { read: files, write: files });
    expect(own.sandboxed).toBe(false);
    for (const file of files) {
      expect([file, own.read?.[file], own.write?.[file]]).toEqual([file, "allowed", "allowed"]);
    }

    const subprocesses = deskSubprocesses(desk);
    const renderers = subprocesses.filter((p) => p.type === "renderer");
    // The desk's page, the palette's and Eris's, and a renderer per plugin surface (ADR 0140).
    expect(renderers.length).toBeGreaterThanOrEqual(4);
    expect(subprocesses.some((p) => p.type === "gpu-process")).toBe(true);
    const held = subprocesses.filter((p) => p.sandbox !== "none");
    for (const child of held) {
      const answer = probe(binary, child.pid, { read: files, write: files });
      expect([label(child), answer.sandboxed]).toEqual([label(child), true]);
      for (const file of files) {
        expect([label(child), file, answer.read?.[file], answer.write?.[file]]).toEqual([
          label(child),
          file,
          "denied",
          "denied",
        ]);
      }
    }
  });

  it("a plugin's bridge, its own files, WebAssembly, a worker and WebGPU work in its renderer", async () => {
    await shellReady();
    await passes("bridge");
    await passes("scheme", "200 sandbox fixture");
    await passes("wasm", "2+3=5");
    await passes("worker", "2+3=5, 200 sandbox fixture");
    await passes("webgpu", "[3,5,7,9]");
  });

  it("a Range read through fs.url answers 206 with the range's bytes", async () => {
    await shellReady();
    personsFiles();
    await inFrame(PLUGIN, () => press("#range"));
    await inFrame(PERMISSIONS, async () => {
      await $("button[data-answer=always]").waitForDisplayed({ timeout: 15_000 });
      await press("button[data-answer=always]");
    });
    await passes("range", "206 04 05 06 07 08 09 0a 0b");
  });
});
