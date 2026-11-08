// @vitest-environment jsdom
// A bound key whose command fails says why (#582): Mod+S with no file in use used to say nothing.
// The whole runtime on the browser stub's core, with desk.files and desk.notify on.
import type { PluginManifest } from "@endue-ai/bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import files from "../../../plugins/files/plugin.json";
import notify from "../../../plugins/notify/plugin.json";
import { browserCore } from "./bridge/core";
import { ManualClock } from "./clock";
import { CommandError } from "./commands";
import { PERSONAL_KEYS } from "./core/defaults";
import type { Notice } from "./notify";
import { createRuntime } from "./runtime";

const meta = (key: string) => ({
  key,
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
});

async function desk() {
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  const core = browserCore({ manifests: [files as PluginManifest, notify as PluginManifest] });
  const runtime = createRuntime({
    root,
    bridge: core.client,
    clock: new ManualClock(),
    platform: "mac",
    plugins: { url: (id, path) => `/plugins/${id}/${path}` },
  });
  await runtime.plugins?.ready;
  await runtime.commands.settled();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const status = () => root.querySelector<HTMLElement>(".desk-status");
  const errors = async () =>
    ((await runtime.commands.run("desk.notify.history", { show: false })) as Notice[]).filter(
      (notice) => notice.level === "error",
    );
  return { runtime, status, errors, log };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("a bound key whose command fails", () => {
  it("Mod+S with no file in use says why the save failed", async () => {
    const d = await desk();
    try {
      expect(d.runtime.commands.has("desk.files.save")).toBe(true);
      expect(d.runtime.shortcuts.handle(meta("s"))).toBe(true);
      await vi.waitFor(() =>
        expect(d.status()?.textContent).toBe(
          "Save the file failed — the buffer in use holds no file",
        ),
      );
      expect(d.status()?.dataset.level).toBe("error");
      expect(await d.errors()).toHaveLength(1);
      expect(d.log).toHaveBeenCalledOnce();
    } finally {
      d.runtime.dispose();
    }
  });

  it("a key whose command is cancelled says nothing", async () => {
    const d = await desk();
    try {
      let ran = 0;
      d.runtime.commands.define("example.backs-out", {
        title: "Back out",
        owner: "desk",
        run: () => {
          ran++;
          throw new CommandError("cancelled", "the person closed the pick");
        },
      });
      d.runtime.settings.set(PERSONAL_KEYS, [{ key: "Mod+J", command: "example.backs-out" }]);
      await d.runtime.commands.settled();
      expect(d.runtime.shortcuts.handle(meta("j"))).toBe(true);
      await vi.waitFor(() => expect(ran).toBe(1));
      // Let the cancelled answer come back to the key before looking.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await d.errors()).toEqual([]);
      expect(d.log).not.toHaveBeenCalled();
    } finally {
      d.runtime.dispose();
    }
  });
});
