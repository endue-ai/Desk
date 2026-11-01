import type { PluginManifest, ShellOpenPermission } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { browserCore } from "./core";

const LINKS: ShellOpenPermission = { permission: "shell:open", schemes: ["https", "mailto"] };
const DOWNLOADS: ShellOpenPermission = { permission: "shell:open", paths: ["~/Downloads/**"] };
const links: PluginManifest = {
  id: "desk.links",
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  permissions: [LINKS, DOWNLOADS],
};
const AS_LINKS = { caller: "desk.links" };

describe("shell.open on the browser core", () => {
  it("hands links to `open` (window.open on the dev page) and records reveals only", async () => {
    const open = vi.fn();
    const core = browserCore({ manifests: [links], open });
    const https = { target: "https://example.com/docs", scope: LINKS };
    expect(await core.client.call("shell.open", https, AS_LINKS)).toEqual({ opened: true });
    const file = { target: "~/Downloads/a.pdf", reveal: true, scope: DOWNLOADS };
    expect(await core.client.call("shell.open", file, AS_LINKS)).toEqual({ opened: true });
    expect(open.mock.calls).toEqual([["https://example.com/docs"]]);
    expect(core.opened()).toEqual([
      { caller: "desk.links", target: "https://example.com/docs", reveal: false },
      { caller: "desk.links", target: "~/Downloads/a.pdf", reveal: true },
    ]);
    const refused = core.client.call("shell.open", { target: "file:///etc/hosts", scope: LINKS });
    await expect(refused).rejects.toMatchObject({ code: "invalid_params" });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("opens nothing without a window to open it in", async () => {
    const core = browserCore({ manifests: [links] });
    const https = { target: "https://example.com", scope: LINKS };
    expect(await core.client.call("shell.open", https, AS_LINKS)).toEqual({ opened: true });
    expect(core.opened()).toHaveLength(1);
  });
});
