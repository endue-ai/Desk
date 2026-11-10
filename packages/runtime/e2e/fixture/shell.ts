/// <reference types="vite/client" />
// Test page: the desk shell on the browser bridge stubs (the core's and the shell's), a manual clock
// and in-memory storage. ?lang=en, ?persist=1 (the core's store and the desk folder in localStorage), ?reduced=1
// (desk.theme.motion: reduce), ?init={...} (more init.yaml settings), ?themes=1 (the test theme
// plugin installed), ?studio=1 (the theme studio open once the desk is ready; ?studio=<theme id>
// previews that theme too; ?edit=<theme id> opens the editor on a copy of it; ?describe=<sentence>
// runs Describe on it; ?say=<sentence> says it to Eris through the composer; ?market=1 lists the
// fixture market, e2e/themes/market served at /market/, as https://market.test/index.json, and
// ?market=tab opens the studio's Market tab, ?market=<theme id> previews that theme there). brain.ask
// answers as examples/brain-echo does (propose_theme from the words of the prompt's last line).
// ?views=1 installs desk.views and desk.universal, and brain.ask answers propose_universal_view,
// propose_view, propose_profile and propose_key_bindings for desk.propose as
// src/propose/fixtures.ts scripts them. ?apps=1 installs
// endue.notes and a terminal stand-in, for the profile and key bindings Eris proposes. ?endue=1 gives
// the shell the studio stub's sample endue agents and spaces (ADR 0129), shown once it signs in;
// ?endue=signed-in starts signed in. ?account=1 serves account.* from src/bridge/account-stub.ts,
// signed in with the sample account (ADR 0130); ?account=signedout starts signed out. ?many=<n>
// (with ?plugins=1) adds n more centre windows, test.many-1 to test.many-<n>, each the hello-ui page
// whose count lives in desk:state, for the live budget (#37). With ?files=1 and ?apps=1, ?heavy=1
// adds a long note and a large image (heavy-files.ts, #38). ?hang=1 adds test.hang, a window whose
// frame stops answering the desk on command and whose net.fetch the core never answers (#39);
// ?hang=late wedges it once mounted and ?hang=stopped stops it once late (for screenshots). Never
// shipped.
import type { PluginManifest } from "@endue-ai/bridge";
import "../../src/desk.css";
import "../../src/shell/styles";
import { proposeTheme } from "../../../../examples/brain-echo/theme.mjs";
import { accountStub } from "../../src/bridge/account-stub";
import { browserBridge, type Envelope, SAMPLE_PROFILE } from "../../src/bridge/browser";
import { browserCore, localStore, memoryStore } from "../../src/bridge/core";
import erisReply from "../../src/bridge/envelopes/eris-reply.json";
import userHello from "../../src/bridge/envelopes/user-hello.json";
import { studioHandlers } from "../../src/bridge/studio";
import { ManualClock } from "../../src/clock";
import { proposalFor } from "../../src/propose/fixtures";
import { mountDesk } from "../../src/shell/Desk";
import { sampleState } from "../../src/shell/state";
import testTheme from "../themes/test-theme/plugin.json";
import { fileHandlers, grantFilePlugins } from "./file-viewers";
import { heavyHandlers } from "./heavy-files";
import { fixtureWm } from "./wm";

const root = document.getElementById("desk");
if (!root) throw new Error("no #desk element");
const params = new URLSearchParams(location.search);
const clock = new ManualClock();
// The desk.* policies (the shell's own included) and the palette: the plugin chrome the shell
// replaces (dock, toolbar, sidebar) is not installed here, nor the view engines (desk.views and
// desk.universal, which ?views=1 adds) and the view plugins (views.html has them).
const manifests = import.meta.glob<PluginManifest>("../../../../plugins/*/plugin.json", {
  eager: true,
  import: "default",
});
// ?plugins=1 adds centre test surfaces; ?edges=1 adds the actual left and right plugin panels.
const testPlugins: PluginManifest[] = [
  {
    id: "test.counter",
    version: "0.1.0",
    kind: "ui",
    entry: "ui/index.html",
    surfaces: [{ id: "main", title: "Counter", placement: "center" }],
  },
  {
    id: "example.hello-ui",
    version: "0.1.0",
    kind: "ui",
    entry: "ui/index.html",
    surfaces: [{ id: "main", title: "Hello", placement: "center" }],
  },
];
// ?many=<n>: the hello-ui page under n more ids (e2e/vite.config.ts serves test.many-* from it).
const many: PluginManifest[] = Array.from(
  { length: Math.min(Number(params.get("many")) || 0, 50) },
  (_, i) => ({
    id: `test.many-${i + 1}`,
    version: "0.1.0",
    kind: "ui",
    entry: "ui/index.html",
    surfaces: [{ id: "main", title: `Hello ${i + 1}`, placement: "center" }],
  }),
);
const MARKET = "https://market.test/";
/** Where ?persist=1 keeps the desk folder's files. */
const FOLDER = "desk.folder";
const market = params.has("market");
// ?apps=1: the notes plugin, and the counter's page standing in for the terminal with the
// terminal's name, its two first commands and its key (Mod+Shift+T opens a new one).
const terminal: PluginManifest = {
  id: "endue.terminal",
  name: "Terminal",
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  surfaces: [{ id: "main", title: "Terminal", placement: "center" }],
  contributes: {
    commands: [
      { id: "endue.terminal.new", title: "New terminal" },
      { id: "endue.terminal.focus", title: "Focus the terminal" },
    ],
    keys: [{ key: "Mod+Shift+T", command: "endue.terminal.new" }],
  },
};
const apps = Object.values(manifests).filter((m) => m.id === "endue.notes");
const files = params.has("heavy") ? await heavyHandlers(fileHandlers) : fileHandlers;
const hang: PluginManifest = {
  id: "test.hang",
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  surfaces: [{ id: "main", title: "Hang", placement: "center" }],
};
// The account's events go out on the core stub, as the core's account.changed does.
const account = params.has("account")
  ? accountStub((event) => core.stub.emit(event), {
      signedIn: params.get("account") !== "signedout",
    })
  : undefined;
const core = browserCore({
  manifests: [
    ...Object.values(manifests).filter(
      (m) =>
        m.id.startsWith("desk.") &&
        ((m.id !== "desk.views" && m.id !== "desk.universal") || params.has("views")) &&
        // View plugins and packs are views.html's, where the view engines are (ADR 0108).
        m.kind !== "view" &&
        m.kind !== "pack",
    ),
    ...(params.has("plugins") ? [...testPlugins, ...many] : []),
    ...(params.has("edges")
      ? Object.values(manifests).filter((m) => ["endue.sidebar", "endue.toolbar"].includes(m.id))
      : []),
    ...(params.has("themes") ? [testTheme as PluginManifest] : []),
    // ?designs=1: the built-in design systems (ADR 0090).
    ...(params.has("designs")
      ? Object.values(manifests).filter((m) => m.kind === "design-system")
      : []),
    ...(params.has("apps") ? [...apps, terminal] : []),
    ...(params.has("hang") ? [hang] : []),
    ...(params.has("files")
      ? Object.values(manifests).filter((m) => ["endue.images", "endue.explorer"].includes(m.id))
      : []),
  ],
  handlers: {
    ...(params.has("files") ? files : {}),
    ...(account ? account.handlers : {}),
    // A slow call: the network that never answers.
    ...(params.has("hang") ? { "net.fetch": () => new Promise<never>(() => {}) } : {}),
  },
  store: params.has("persist") ? localStore("desk.core.") : memoryStore(),
  // The desk folder (~/.desk: keys.yaml, saved profiles) survives a reload with ?persist=1 too.
  ...(params.has("persist")
    ? {
        files: JSON.parse(localStorage.getItem(FOLDER) ?? "{}") as Record<string, string>,
        keepFiles: (files: Record<string, string>) =>
          localStorage.setItem(FOLDER, JSON.stringify(files)),
      }
    : {}),
  ask: (prompt, tool) =>
    tool === "propose_theme"
      ? proposeTheme(prompt)
      : params.has("views")
        ? proposalFor(prompt, tool)
        : undefined,
  ...(market ? { download: fromFixtureMarket } : {}),
  init: {
    profile: "morning",
    settings: {
      ...(params.has("reduced")
        ? { "desk.theme.motion": "reduce" }
        : { "desk.theme.motion": "full" }),
      ...(market ? { "desk.theme.markets": [`${MARKET}index.json`] } : {}),
      ...JSON.parse(params.get("init") ?? "{}"),
    },
  },
});
if (params.has("files")) await grantFilePlugins(core, params.has("heavy") ? ["endue.notes"] : []);
// A fixed wall clock and platform, so "4:12 ago" and "⌘N" read the same on every machine.
const epoch = Date.parse("2026-10-28T09:00:00.000Z");
const endue = params.has("endue") ? studioHandlers({ epoch }) : undefined;
const bridge = browserBridge({
  now: () => clock.now(),
  epoch,
  ...(endue ? { studio: endue } : {}),
});
if (params.get("endue") === "signed-in")
  bridge.fake.setAccount({ state: "signed-in", profile: { ...SAMPLE_PROFILE } });
const lang = params.get("lang") === "en" ? "en" : "ko";
const desk = mountDesk({
  root,
  bridge,
  core: core.client,
  plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
  clock,
  epoch,
  platform: "mac",
  lang,
  seed: sampleState(lang, epoch),
});

/** The fixture market's files, as the network would answer its https URLs. */
async function fromFixtureMarket(url: string): Promise<ArrayBuffer> {
  const answer = await fetch(url.replace(MARKET, "/market/"));
  if (!answer.ok) throw new Error(`${url} answered ${answer.status}`);
  return answer.arrayBuffer();
}

/** Advance the clock in 16 ms frames, ending exactly at `ms` later. */
function step(ms: number): void {
  let left = ms;
  while (left > 0) {
    const d = Math.min(16, left);
    clock.advance(d);
    left -= d;
  }
}

window.__shell = {
  desk,
  wm: fixtureWm(desk),
  clock,
  bridge,
  stub: core.stub,
  step,
  envelopes: { user: userHello as Envelope, eris: erisReply as Envelope },
};

if (params.has("studio")) {
  const previewed = params.get("studio") ?? "1";
  void desk.ready
    .then(() => desk.runtime.commands.run("desk.theme.studio"))
    .then(() => previewed !== "1" && desk.runtime.themes.preview(previewed));
}

if (params.has("edit")) {
  void desk.ready.then(() =>
    desk.runtime.commands.run("desk.theme.edit", { id: params.get("edit") }),
  );
}

if (params.has("describe")) {
  void desk.ready.then(() =>
    desk.runtime.commands.run("desk.theme.describe", { text: params.get("describe") }),
  );
}

const marketView = params.get("market");
if (marketView && marketView !== "1") {
  const press = (selector: string, tries = 50): void => {
    const button = document.querySelector<HTMLElement>(selector);
    if (button) button.click();
    else if (tries > 0) setTimeout(() => press(selector, tries - 1), 50);
  };
  void desk.ready.then(async () => {
    await desk.runtime.commands.run("desk.theme.studio");
    press('[data-key="market"]');
    if (marketView !== "tab") press(`[data-theme="${marketView}"] [data-key="market-preview"]`);
  });
}

if (params.has("say")) {
  void desk.ready.then(() => {
    const input = document.querySelector<HTMLInputElement>("#composer-input");
    if (!input) return;
    input.focus();
    input.value = params.get("say") ?? "";
    input.dispatchEvent(new Event("input"));
    // The last choice says it to Eris.
    for (const key of ["ArrowUp", "Enter"])
      input.dispatchEvent(new KeyboardEvent("keydown", { key }));
    // Once her answer is in, run her clock until she says it.
    setTimeout(() => step(2500), 100);
  });
}

// ?hang=late: test.hang stops answering once the desk watches it; ?hang=stopped: and is stopped
// once its window says it is not responding (#39).
const hangMode = params.get("hang");
if (hangMode === "late" || hangMode === "stopped") {
  desk.runtime.frames.onChange((id, state) => {
    if (id !== "test.hang") return;
    if (state === "responding") desk.runtime.plugins?.command(id, "wedge");
    if (state === "late" && hangMode === "stopped") desk.runtime.frames.stop(id);
  });
}
