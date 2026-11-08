// Links in the terminal (#538, TERM-E07): OSC 8 hyperlinks and plain URLs open in the system's
// browser or mail app through shell.open, on Mod+click so a click that selects never opens one;
// any other scheme stays closed, and a refusal is said, not thrown.
import { describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { createLinks, LINKS } from "../ui/links.js";

type Call = { method: string; params: unknown };

function links(platform: "mac" | "linux" | "windows" = "mac", fail?: unknown) {
  const calls: Call[] = [];
  const said: string[] = [];
  const bridge = {
    call: async (method: string, params: unknown) => {
      calls.push({ method, params });
      if (fail) throw fail;
      return { opened: true };
    },
  };
  const made = createLinks({ bridge, say: (text: string) => said.push(text), platform });
  return { ...made, calls, said };
}

const click = (mods: Partial<MouseEvent> = {}) =>
  ({ metaKey: false, ctrlKey: false, ...mods }) as MouseEvent;

describe("links", () => {
  it("the manifest's scope covers the schemes shell.open ever opens", () => {
    expect(LINKS).toEqual({ permission: "shell:open", schemes: ["http", "https", "mailto"] });
  });

  it("an OSC 8 hyperlink opens through shell.open on Mod+click", async () => {
    const mac = links("mac");
    expect(mac.handler.allowNonHttpProtocols).toBe(true);
    await mac.handler.activate(click({ metaKey: true }), "https://endue.ai/docs?q=1");
    await mac.handler.activate(click({ metaKey: true }), "mailto:team@endue.ai");
    expect(mac.calls).toEqual([
      { method: "shell.open", params: { target: "https://endue.ai/docs?q=1", scope: LINKS } },
      { method: "shell.open", params: { target: "mailto:team@endue.ai", scope: LINKS } },
    ]);
    const linux = links("linux");
    await linux.handler.activate(click({ ctrlKey: true }), "http://localhost:5173/");
    expect(linux.calls).toHaveLength(1);
  });

  it("a plain click only says how to open it; hovering names the link", async () => {
    const { handler, calls, said } = links("mac");
    handler.hover(click(), "https://endue.ai");
    await handler.activate(click(), "https://endue.ai");
    handler.leave(click(), "https://endue.ai");
    expect(calls).toEqual([]);
    expect(said).toEqual([
      "⌘-click to open https://endue.ai",
      "⌘-click to open https://endue.ai",
      "",
    ]);
    const linux = links("linux");
    linux.handler.hover(click(), "https://endue.ai");
    expect(linux.said).toEqual(["Ctrl-click to open https://endue.ai"]);
  });

  it("a URL the terminal finds in plain text opens the same way", async () => {
    const { open, calls } = links("windows");
    await open(click({ ctrlKey: true }), "https://github.com/endue-ai/Desk/pull/1");
    expect(calls).toEqual([
      {
        method: "shell.open",
        params: { target: "https://github.com/endue-ai/Desk/pull/1", scope: LINKS },
      },
    ]);
  });

  it("any other scheme stays closed", async () => {
    const { handler, calls, said } = links("mac");
    for (const uri of ["javascript:alert(1)", "file:///etc/passwd", "ftp://x.org/", "not a url"]) {
      await handler.activate(click({ metaKey: true }), uri);
    }
    expect(calls).toEqual([]);
    expect(said).toEqual(Array(4).fill("Only http, https and mailto links open."));
  });

  it("a refusal or a failure is said in the status", async () => {
    const refused = links("mac", new StubError("permission_denied", "no"));
    await refused.handler.activate(click({ metaKey: true }), "https://endue.ai");
    expect(refused.said).toEqual(["Not allowed to open links."]);
    const broken = links("mac", new StubError("io_error", "no browser"));
    await broken.handler.activate(click({ metaKey: true }), "https://endue.ai");
    expect(broken.said).toEqual(["Could not open the link: io_error."]);
  });
});
