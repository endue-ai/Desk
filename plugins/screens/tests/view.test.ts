// @vitest-environment jsdom
// The page (ui/index.html + ui/view.js) and the plugin's behaviour on it (ui/app.js) with a fake
// RFB: the list, the form, the commands, the toolbar while a screen is shown, and the sign-in that
// clears its password field. Fixture names only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createScreens } from "../ui/app.js";
import { createView } from "../ui/view.js";
import { fakeBridge, settle } from "./harness";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const byId = (id: string) => document.getElementById(id) as HTMLElement;
const input = (form: string, name: string) =>
  (byId(form) as HTMLFormElement).elements.namedItem(name) as HTMLInputElement;

class FakeRfb extends EventTarget {
  static last: FakeRfb | null = null;
  viewOnly = false;
  scaleViewport = false;
  clipViewport = false;
  resizeSession = true;
  focusOnClick = false;
  showDotCursor = false;
  constructor() {
    super();
    FakeRfb.last = this;
  }
  fire(name: string, detail: object = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
  disconnect() {
    this.fire("disconnect", { clean: true });
  }
  sendCredentials() {}
  approveServer() {}
  focus() {}
}

type Handlers = Record<string, (args: unknown) => unknown>;

function mount(kept: unknown[] = []) {
  const bridge = fakeBridge({
    "store.get": () => ({ value: kept }),
    "store.set": () => ({}),
  });
  const commands: Handlers = {};
  let app: ReturnType<typeof createScreens> | undefined;
  const view = createView(document, {
    connect: (raw) => app?.connect(raw),
    remove: (id) => app?.remove(id),
    disconnect: () => app?.disconnect(),
    viewOnly: (on) => app?.setViewOnly(on),
    fit: (on) => app?.setFit(on),
  });
  const sockets = { connect: async () => ({ close() {} }) };
  app = createScreens({ bridge, sockets, RFB: FakeRfb as never, view });
  app.wire({
    on: (name: string, handler: (args: unknown) => unknown) => {
      commands[name] = handler;
      return () => {};
    },
  } as never);
  return { bridge, app, commands, start: app.start() };
}

describe("the Screen Sharing page", () => {
  beforeEach(() => {
    document.body.innerHTML = /<body>([\s\S]*)<script/.exec(html)?.[1] ?? "";
    FakeRfb.last = null;
  });

  it("lists the kept computers, and says so when there are none", async () => {
    const empty = mount();
    await empty.start;
    expect(byId("empty").hidden).toBe(false);
    document.body.innerHTML = /<body>([\s\S]*)<script/.exec(html)?.[1] ?? "";
    const { start } = mount([
      { id: "m-a", name: "Studio", host: "studio.local", port: 5900, username: "ada" },
      { id: "m-b", name: "Lab", host: "192.0.2.10", port: 5901 },
    ]);
    await start;
    expect(byId("empty").hidden).toBe(true);
    const rows = [...document.querySelectorAll(".computer-open")].map((b) => b.textContent);
    expect(rows).toEqual(["Studioada @ studio.local", "Lab192.0.2.10:5901"]);
  });

  it("connects from the form, keeps the computer, and shows its screen with the toolbar", async () => {
    const { bridge, start } = mount();
    await start;
    input("add", "host").value = "vnc://studio.local:5901";
    input("add", "name").value = "Studio";
    (byId("add") as HTMLFormElement).requestSubmit();
    await settle();
    expect(bridge.params("store.set")[0]).toMatchObject({
      key: "computers",
      value: [{ name: "Studio", host: "studio.local", port: 5901 }],
    });
    expect(byId("home").hidden).toBe(true);
    expect(byId("screen").hidden).toBe(false);
    expect(byId("disconnect").hidden).toBe(false);
    FakeRfb.last?.fire("connect");
    expect(byId("state").textContent).toBe("Connected to Studio.");
    byId("view-only").click();
    expect(FakeRfb.last?.viewOnly).toBe(true);
    expect(byId("view-only").getAttribute("aria-pressed")).toBe("true");
    byId("disconnect").click();
    expect(byId("home").hidden).toBe(false);
    expect(byId("status").textContent).toBe("Disconnected from Studio.");
  });

  it("a wrong address is said in the status line and nothing is kept", async () => {
    const { bridge, start } = mount();
    await start;
    input("add", "host").value = "studio local";
    (byId("add") as HTMLFormElement).requestSubmit();
    await settle();
    expect(byId("status").textContent).toBe('"studio local" is not a host name.');
    expect(bridge.params("store.set")).toEqual([]);
  });

  it("endue.screens.connect connects to the address given, or opens the form filled", async () => {
    const { commands, start } = mount();
    await start;
    expect(
      await commands["endue.screens.connect"]?.({ name: "Lab", username: "grace" }),
    ).toBeNull();
    expect(input("add", "name").value).toBe("Lab");
    expect(input("add", "username").value).toBe("grace");
    expect(document.activeElement).toBe(input("add", "host"));
    const answer = await commands["endue.screens.connect"]?.({ host: "192.0.2.10", port: 5901 });
    expect(answer).toMatchObject({ name: "192.0.2.10" });
    expect(await commands["endue.screens.disconnect"]?.({})).toBe(true);
    expect(() => commands["endue.screens.disconnect"]?.({})).toThrow("No screen is being shown.");
  });

  it("asks for the sign-in, hands the answer over once and empties the password field", async () => {
    const view = createView(document, {
      connect: () => {},
      remove: () => {},
      disconnect: () => {},
      viewOnly: () => {},
      fit: () => {},
    });
    const asked = view.askCredentials({ types: ["username", "password"], username: "ada" });
    expect(byId("signin").hidden).toBe(false);
    expect(input("signin", "username").value).toBe("ada");
    input("signin", "password").value = "fixture";
    (byId("signin") as HTMLFormElement).requestSubmit();
    expect(await asked).toEqual({ username: "ada", password: "fixture" });
    expect(input("signin", "password").value).toBe("");
    expect(byId("signin").hidden).toBe(true);

    const passwordOnly = view.askCredentials({ types: ["password"] });
    expect(input("signin", "username").hidden).toBe(true);
    input("signin", "password").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(await passwordOnly).toBeNull();

    const trusted = view.askTrust("aa:bb");
    expect(byId("trust").querySelector(".fingerprint")?.textContent).toBe("aa:bb");
    (byId("trust") as HTMLFormElement).reset();
    expect(await trusted).toBe(false);
  });
});
