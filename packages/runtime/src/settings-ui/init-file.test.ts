// @vitest-environment jsdom
// General's "Open init.yaml": the file init.get names, shown in the file manager through shell.open.
import { StubError } from "@endue-ai/bridge";
import { expect, it, vi } from "vitest";
import { browserCore } from "../bridge/core";
import { CORE_SETTINGS } from "../core/defaults";
import { Settings } from "../settings";
import { initFileRow } from "./init-file";
import { settingsPanel } from "./panels";

function general(core: ReturnType<typeof browserCore>) {
  const settings = new Settings();
  settings.setDefaults(CORE_SETTINGS);
  const el = settingsPanel("general", settings, "en", () => {}, {
    general: [initFileRow(core.client, "en")],
  });
  const button = [...el.querySelectorAll("button")].find((b) => b.textContent === "Open init.yaml");
  if (!button) throw new Error("General has no Open init.yaml row");
  return { el, button };
}

it("the General row reveals init.yaml", async () => {
  const named = browserCore({ manifests: [], init: { file: "~/work/init.yaml" } });
  general(named).button.click();
  await vi.waitFor(() =>
    expect(named.opened()).toEqual([
      expect.objectContaining({ target: "~/work/init.yaml", reveal: true }),
    ]),
  );

  // No file named: the app's own place for it.
  const unnamed = browserCore({ manifests: [] });
  general(unnamed).button.click();
  await vi.waitFor(() =>
    expect(unnamed.opened()).toEqual([
      expect.objectContaining({ target: "~/.desk/init.yaml", reveal: true }),
    ]),
  );

  const failing = browserCore({
    manifests: [],
    handlers: {
      "shell.open": () => {
        throw new StubError("not_found", "~/.desk/init.yaml does not exist");
      },
    },
  });
  const { el, button } = general(failing);
  button.click();
  await vi.waitFor(() =>
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("does not exist"),
  );
});
