// What the person decides outlives a quit (#351): the app hands the core grants.json, settings.json and
// the logs folder in its data folder (ADR 0029, ADR 0031). browser.reloadSession() quits the app and
// launches it again with the same HOME (support/driver.ts); the spec polls the data files before
// relaunching.
//
// The grant: e2e.ask (a dev plugin for this spec only, wdio.conf.ts) asks for ~/Pictures/2024 and the
// person answers "Always allow" in endue.permissions' prompt; after the relaunch the same request is
// granted without a prompt. The setting: the brain the person picks in the rail's brain popover is the
// runtime's own setting brain.use (ADR 0094); after the relaunch it is still the one picked. The logs
// folder is covered by apps/desk/src-tauri/src/core_files.rs's unit test.
import { $, browser, expect } from "@wdio/globals";
import { inFrame, MODE, press, shellReady, waitForData } from "../support/desk";

const ASK = "e2e.ask";
const PERMISSIONS = "endue.permissions";
const FOLDER = "~/Pictures/2024";

type Settings = { desk?: Record<string, unknown> };

/** Whether grants.json holds a grant naming FOLDER (only lasting grants are written there). */
const granted = (value: unknown) => JSON.stringify(value ?? "").includes(FOLDER);

/** Ask for FOLDER from e2e.ask. */
async function ask(): Promise<void> {
  await inFrame(ASK, () => press(`button[data-folder="${FOLDER}"]`));
}

const answers = () => inFrame(ASK, () => $("[data-testid=answers]").getText());

async function pickBrain(brain: string): Promise<void> {
  const popover = $(`${MODE} [data-popover=brain]`);
  if (!(await popover.isExisting())) await press(`${MODE} [data-key=rail-brain]`);
  await press(`${MODE} [data-popover=brain] [data-key=brain-${brain}]`);
}

describe("persist: grants and settings across a relaunch", () => {
  it("an always grant and a set setting land in the data folder", async () => {
    await shellReady();

    await ask();
    await inFrame(PERMISSIONS, async () => {
      await $("button[data-answer=always]").waitForDisplayed({ timeout: 15_000 });
      await press("button[data-answer=always]");
    });
    await waitForData("grants.json", granted, `an always grant of ${FOLDER}`);
    await browser.waitUntil(async () => (await answers()).includes('"granted":true'), {
      timeoutMsg: "e2e.ask never listed the granted answer",
    });

    await pickBrain("echo");
    await waitForData(
      "settings.json",
      (value) => (value as Settings | undefined)?.desk?.["brain.use"] === "echo",
      "brain.use: echo under desk",
    );
  });

  it("after a relaunch the grant answers without a prompt and the brain is still the one picked", async () => {
    await browser.reloadSession();
    await shellReady();

    await ask();
    await browser.waitUntil(async () => (await answers()).includes('"granted":true'), {
      timeoutMsg: "the request after the relaunch was not granted at once",
    });
    await inFrame(PERMISSIONS, async () => {
      await expect($("button[data-answer=always]")).not.toBeDisplayed();
    });

    await press(`${MODE} [data-key=rail-brain]`);
    await expect($(`${MODE} [data-popover=brain] [data-key=brain-echo]`)).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
