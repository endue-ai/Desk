// A desk from a folder (#288, ADR 0079): a desk with a saved profile, a rebound key, a view and a
// plugin turned off is exported with `desk export --with-data`; the app quits, its HOME's desk folder
// and data folder are emptied (a fresh desk), the export is imported with `desk import --with-data`,
// and the app starts again with the same profiles, bindings, views and enabled plugins. Both sessions
// are read the same way (the desk's own lists over its socket, the views as the core reads them) and
// compared whole. The CLI is built beside the app (support/cli.ts).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import { desk, deskCli, deskOk } from "../support/cli";
import { shellReady, waitForData } from "../support/desk";
import { HOME_VAR } from "../support/driver";

const HELLO = "e2e.hello";
const KEY = "Mod+Shift+Y";
/** The person's binding as desk.keys.list says it: the combo is canonical (Control on Linux). */
const MINE = "desk.palette.open person";

type Plugins = { enabled?: Record<string, boolean> };
const home = () => process.env[HOME_VAR] ?? "";
const deskFolder = () => join(home(), ".desk");
const dataFolder = () => join(home(), ".local/share/ai.endue.desk");

function put(rel: string, text: string): void {
  const path = join(deskFolder(), rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

/** Wait until `test` holds for a snapshot, naming the last snapshot or error when it never does. */
async function until(test: (now: ReturnType<typeof snapshot>) => boolean, what: string) {
  let last = "";
  await browser.waitUntil(
    () => {
      try {
        const now = snapshot();
        last = JSON.stringify(now);
        return test(now);
      } catch (error) {
        last = String(error);
        return false;
      }
    },
    { timeout: 30_000, timeoutMsg: `${what}; last: ${last.slice(0, 600)}` },
  );
}

/** The desk as the person sees it: profiles, key bindings, views and plugins, read from outside. */
function snapshot() {
  const profiles = JSON.parse(deskOk(["cmd", "run", "desk.profiles.list"])) as {
    profiles: Array<{ id: string; name?: string }>;
  };
  const keys = JSON.parse(deskOk(["cmd", "run", "desk.keys.list"])) as Array<{
    combo: string;
    command: string;
    owner: string;
  }>;
  // doctor exits 1 when a file is invalid; its JSON says which, so read it either way.
  const files = JSON.parse(desk(["doctor", "--json"]).stdout.trim().split("\n").at(-1) ?? "{}") as {
    files?: Array<{ path: string; state: string }>;
  };
  return {
    profiles: profiles.profiles.map((p) => `${p.id} ${p.name ?? ""}`).sort(),
    keys: keys.map((k) => `${k.combo} ${k.command} ${k.owner}`).sort(),
    views: (files.files ?? [])
      .filter((f) => f.path.includes("/.desk/views/"))
      .map((f) => `${f.path.split("/.desk/")[1]} ${f.state}`),
    plugins: deskOk(["plugin", "list"]).trim().split("\n").sort(),
  };
}

describe("a desk from a folder", () => {
  before(function () {
    this.timeout(900_000);
    deskCli();
  });

  it("an export imported into a fresh desk brings back its profiles, bindings, views and plugins", async function () {
    this.timeout(180_000);
    await shellReady();
    put("profiles/e2e-quiet.yaml", "name: E2E quiet\nplugins:\n  disabled: [e2e.hello]\n");
    put("keys.yaml", `bindings:\n  - key: ${KEY}\n    command: desk.palette.open\n`);
    put(
      "views/e2e.today.yaml",
      "id: e2e.today\nversion: 0.1.0\ntitle: Today\nlayout:\n  type: list\n  binding:\n    kinds: [event]\n",
    );
    deskOk(["plugin", "disable", HELLO]);
    await waitForData(
      "plugins.json",
      (value) => (value as Plugins | undefined)?.enabled?.[HELLO] === false,
      `${HELLO} turned off`,
    );
    // Relaunch, so the desk reads the files it found at start.
    await browser.reloadSession();
    await shellReady();
    await until(
      (now) =>
        now.profiles.some((p) => p.startsWith("e2e-quiet")) &&
        now.keys.some((k) => k.endsWith(MINE)),
      "the desk never read the profile and the key binding",
    );
    const before = snapshot();
    expect(before.views).toEqual(["views/e2e.today.yaml valid"]);

    const out = join(mkdtempSync(join(tmpdir(), "desk-export-")), "desk");
    deskOk(["export", out, "--with-data"]);

    // Quit the app, empty its desk and data folders, import, and start it again.
    await browser.deleteSession();
    rmSync(deskFolder(), { recursive: true, force: true });
    rmSync(dataFolder(), { recursive: true, force: true });
    await browser.waitUntil(async () => desk(["import", out, "--with-data"]).status === 0, {
      timeout: 15_000,
      timeoutMsg: "desk import kept refusing: the app never let go of its socket",
    });
    await browser.reloadSession();
    await shellReady();
    await until(
      (now) => now.keys.some((k) => k.endsWith(MINE)),
      "the imported key binding never came back",
    );
    expect(snapshot()).toEqual(before);
  });
});
