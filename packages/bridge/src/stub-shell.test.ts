import { describe, expect, it, vi } from "vitest";
import {
  BridgeClient,
  browserStub,
  type PermPromptData,
  type ShellOpenPermission,
  type StubOptions,
  stubCommands,
} from "./index";

const LINKS: ShellOpenPermission = { permission: "shell:open", schemes: ["https", "mailto"] };
const DOWNLOADS: ShellOpenPermission = { permission: "shell:open", paths: ["~/Downloads/**"] };
const ME = { caller: "example.links" };

function client(options: StubOptions = {}) {
  const core = stubCommands(() => {}, {
    grants: { "example.links": [LINKS, DOWNLOADS] },
    ...options,
  });
  return { core, bridge: new BridgeClient(browserStub(core.handlers)) };
}

describe("the stub's shell.open", () => {
  it("records every link and reveal it would hand to the system", async () => {
    const { core, bridge } = client();
    const https = { target: "https://example.com", scope: LINKS };
    expect(await bridge.call("shell.open", https, ME)).toEqual({ opened: true });
    await bridge.call("shell.open", { target: "mailto:ada@example.com", scope: LINKS }, ME);
    const file = { target: "~/Downloads/report.pdf", reveal: true, scope: DOWNLOADS };
    await bridge.call("shell.open", file, ME);
    expect(core.state().opened).toEqual([
      { caller: "example.links", target: "https://example.com/", reveal: false },
      { caller: "example.links", target: "mailto:ada@example.com", reveal: false },
      { caller: "example.links", target: "~/Downloads/report.pdf", reveal: true },
    ]);
  });

  it("refuses the schemes the core refuses, whatever the scope", async () => {
    const { core, bridge } = client();
    for (const target of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "slack://channel?team=T1",
      "https://example.com/\n",
      "https://example.com/\u0000",
      "/etc/passwd",
      "example.com",
    ]) {
      const call = bridge.call("shell.open", { target, scope: LINKS }, ME);
      await expect(call, target).rejects.toMatchObject({ code: "invalid_params" });
    }
    // The runtime too: a scheme is refused before any grant is looked at.
    const desk = bridge.call("shell.open", { target: "javascript:alert(1)", scope: LINKS });
    await expect(desk).rejects.toMatchObject({ code: "invalid_params" });
    expect(core.state().opened).toEqual([]);
  });

  it("refuses a scheme or a path outside the scope", async () => {
    const { core, bridge } = client();
    const https: ShellOpenPermission = { permission: "shell:open", schemes: ["https"] };
    const mail = bridge.call("shell.open", { target: "mailto:ada@example.com", scope: https }, ME);
    await expect(mail).rejects.toMatchObject({ code: "permission_denied", permission: https });
    const link = bridge.call("shell.open", { target: "https://example.com", scope: DOWNLOADS }, ME);
    await expect(link).rejects.toMatchObject({ code: "permission_denied" });
    for (const target of ["~/Documents/a.txt", "~/Downloads/../Documents/a.txt"]) {
      const call = bridge.call("shell.open", { target, reveal: true, scope: DOWNLOADS }, ME);
      await expect(call, target).rejects.toMatchObject({ code: "permission_denied" });
    }
    const url = { target: "https://example.com", reveal: true, scope: DOWNLOADS };
    await expect(bridge.call("shell.open", url, ME)).rejects.toMatchObject({
      code: "invalid_params",
    });
    expect(core.state().opened).toEqual([]);
  });

  it("asks without a grant, as the core does, and keeps the grant for the session", async () => {
    const asked: PermPromptData[] = [];
    const prompt = (data: PermPromptData) => asked.push(data) === 1;
    const { core, bridge } = client({ grants: {}, prompt });
    await bridge.call("shell.open", { target: "https://example.com", scope: LINKS }, ME);
    expect(asked).toMatchObject([
      { caller: "example.links", permission: LINKS, duration: "session" },
    ]);
    expect(asked[0]?.reason).toContain("https://example.com/");
    await bridge.call("shell.open", { target: "https://example.com/next", scope: LINKS }, ME);
    expect(asked).toHaveLength(1);
    const file = { target: "~/Downloads/a.pdf", reveal: true, scope: DOWNLOADS };
    await expect(bridge.call("shell.open", file, ME)).rejects.toMatchObject({
      code: "permission_denied",
    });
    expect(core.state().opened.map((o) => o.target)).toEqual([
      "https://example.com/",
      "https://example.com/next",
    ]);
  });

  it("hands each call that passes to `open`", async () => {
    const open = vi.fn();
    const { bridge } = client({ open });
    await bridge.call("shell.open", { target: "https://example.com/a b", scope: LINKS }, ME);
    await expect(
      bridge.call("shell.open", { target: "ftp://example.com", scope: LINKS }, ME),
    ).rejects.toMatchObject({ code: "invalid_params" });
    expect(open.mock.calls).toEqual([
      [{ caller: "example.links", target: "https://example.com/a%20b", reveal: false }],
    ]);
  });
});
