// Start-up: a second start with a saved session of six surfaces, the median of three relaunches.
// The first start opens six files of six kinds (fixtures/session) through the desk socket, so the
// session keeps them and brings back the surfaces of notes, sheets, data, images, web and docs.
// Each relaunch runs with DESK_TRACE=1 (wdio.conf.ts); the times come from its trace: process start
// to the ready line, and to the end of the first interactive frame. The traces go in the artifact.
import { cpSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { browser, expect } from "@wdio/globals";
import { appData, shellReady, waitForData } from "../support/desk";
import { HOME_VAR } from "../support/driver";
import { median } from "./lib/stats";
import { phaseNames, type StartupTimes, startedAt, startupTimes } from "./lib/trace";
import { keep, measured } from "./support/out";
import { DeskSocket, keepAnswering, socketPath } from "./support/socket";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures/session");
/** The files and the plugin whose surface each one brings back. */
const FILES: Record<string, string> = {
  "notes.md": "endue.notes",
  "table.csv": "endue.sheets",
  "data.json": "endue.data",
  "picture.svg": "endue.images",
  "page.html": "endue.web",
  "letter.rtf": "endue.docs",
};
const RUNS = 3;

type Store = { desk?: { session?: { files?: Array<{ path: string }> } } };
const savedFiles = (value: unknown) => (value as Store | undefined)?.desk?.session?.files ?? [];

/** The trace of the start launched after `launched` (ms since the epoch), once it is complete. */
async function traceSince(launched: number): Promise<unknown> {
  const file = join(appData(), "trace.json");
  let trace: unknown;
  await browser.waitUntil(
    async () => {
      try {
        trace = JSON.parse(readFileSync(file, "utf8"));
        return (startedAt(trace) ?? 0) >= launched && startupTimes(trace) !== undefined;
      } catch {
        return false;
      }
    },
    { timeout: 30_000, interval: 100, timeoutMsg: `no complete trace in ${file}` },
  );
  return trace;
}

describe("start-up: a second start with a saved session of six surfaces", () => {
  it("measures the ready line and the first interactive frame from each relaunch's trace", async () => {
    const home = process.env[HOME_VAR];
    if (!home) throw new Error(`${HOME_VAR} is not set: run through just perf-app`);
    await shellReady();

    // The first start: open the six files, granting what their plugins ask for.
    const folder = join(home, "perf");
    cpSync(FIXTURES, folder, { recursive: true });
    const desk = await DeskSocket.connect(socketPath(home));
    desk.answerPrompts();
    for (const file of Object.keys(FILES)) {
      await desk.run("desk.files.open", { path: join(folder, file) });
    }
    desk.close();
    await waitForData(
      "store.json",
      (value) => savedFiles(value).length === Object.keys(FILES).length,
      "desk.session with six files",
    );

    const runs: StartupTimes[] = [];
    for (let run = 1; run <= RUNS; run++) {
      const answering = keepAnswering(socketPath(home));
      const launched = Date.now();
      try {
        await browser.reloadSession();
        await shellReady();
        const trace = await traceSince(launched);
        keep(`startup-${run}.trace.json`, trace);
        const mounts = Object.values(FILES).map((plugin) => `mount ${plugin}`);
        expect(phaseNames(trace)).toEqual(
          expect.arrayContaining(["core init", "plugin registry", "session restore", ...mounts]),
        );
        runs.push(startupTimes(trace));
      } finally {
        answering.stop();
      }
    }
    measured("startup", {
      startup: {
        readyMs: median(runs.map((r) => r.readyMs)),
        firstFrameMs: median(runs.map((r) => r.firstFrameMs)),
        sessionSurfaces: Object.keys(FILES).length,
        runs,
      },
    });
  });
});
