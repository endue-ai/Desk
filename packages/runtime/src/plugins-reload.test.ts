// A plugin's frame that loads its page again in place (its update, #84's hot reload) on the plugin
// host alone: one frame window played by the test, the same window across the reload as in a browser.
// The page it leaves cannot answer, and the new one hears nothing before it says hello (#142).
import { BridgeClient, type BridgeEvent, browserStub, type PluginInfo } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { PluginHost } from "./plugins";

const ID = "test.notes";
const NOTES = {
  id: ID,
  status: "ready",
  enabled: true,
  builtIn: false,
  revision: 1,
  manifest: {
    id: ID,
    version: "0.1.0",
    kind: "ui",
    entry: "ui/index.html",
    surfaces: [{ id: "main", title: "Notes", placement: "center" }],
    contributes: { commands: [{ id: "test.notes.open", title: "Open" }] },
  },
} as PluginInfo;

type Posted = { type: string; name?: string; call?: number; event?: BridgeEvent };

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function host() {
  const stub = browserStub({
    "plugin.list": () => ({ plugins: [NOTES] }),
    "cmd.register": () => ({}),
    "cmd.unregister": () => ({}),
    "cmd.answer": () => ({}),
  });
  let receive = (_event: MessageEvent) => {};
  const win = {
    addEventListener: (_type: string, listener: typeof receive) => {
      receive = listener;
    },
    removeEventListener() {},
  } as unknown as Window;
  const frame = { postMessage: vi.fn() } as unknown as Window & {
    postMessage: ReturnType<typeof vi.fn>;
  };
  /** Whether the host still counted the page as greeted when it asked for the reload. */
  const greetedAtReload: boolean[] = [];
  const reload = vi.fn(() => void greetedAtReload.push(plugins.greeted(ID)));
  const plugins = new PluginHost(
    { bridge: new BridgeClient(stub), win, open() {}, close() {}, reload, frame: () => frame },
    { url: () => "about:blank" },
  );
  await plugins.start();
  const send = (data: unknown) => receive({ source: frame, data } as unknown as MessageEvent);
  const update = () =>
    stub.emit({
      event: "plugin.changed",
      data: { plugin: ID, change: "updated", revision: 2 },
    } as BridgeEvent);
  const invoked = (invocationId: string) =>
    stub.emit({
      event: "cmd.invoked",
      data: { invocationId, id: "test.notes.open", caller: "desk" },
    } as unknown as BridgeEvent);
  /** What the frame was posted since the last look, by what it is. */
  let looked = 0;
  const posted = () => {
    const calls = frame.postMessage.mock.calls.slice(looked);
    looked += calls.length;
    return calls.map(([m]) => {
      const message = m as Posted;
      if (message.event) return `event ${message.event.event}`;
      return message.name ? `${message.type} ${message.name}` : message.type;
    });
  };
  const callOf = (name: string) =>
    frame.postMessage.mock.calls
      .map(([m]) => m as Posted)
      .find((m) => m.type === "desk:command" && m.name === name)?.call;
  send({ type: "desk:hello" });
  await settle();
  return { plugins, reload, greetedAtReload, send, update, invoked, posted, callOf };
}

describe("a plugin that reloads in place (#142)", () => {
  it("asks the reload while its page still counts as greeted, then holds what needs an answer for the new page's hello", async () => {
    const h = await host();
    h.posted();
    h.update();
    await settle();
    // The reload pings the page it leaves only while it counts as live: its last desk:state first (#84).
    expect(h.reload).toHaveBeenCalledWith(ID, "about:blank");
    expect(h.greetedAtReload).toEqual([true]);
    expect(h.plugins.greeted(ID)).toBe(false);
    expect(h.plugins.asleep(ID)).toBe(false);

    h.plugins.command(ID, "notes.show");
    h.invoked("i-1");
    const asked = h.plugins.request(ID, "notes.visit");
    h.plugins.share({ type: "desk:theme", theme: "dark" });
    await settle();
    expect(h.posted()).toEqual([]);

    h.send({ type: "desk:hello" });
    await settle();
    expect(h.posted()).toEqual([
      "desk:init",
      "desk:theme",
      "desk:command notes.show",
      "event cmd.invoked",
      "desk:command notes.visit",
    ]);
    h.send({ type: "desk:reply", call: h.callOf("notes.visit"), ok: true, result: "shown" });
    await expect(asked).resolves.toBe("shown");
    expect(h.plugins.greeted(ID)).toBe(true);
  });

  it("cancels at the new page's hello what the page it left was asked and never answered", async () => {
    const h = await host();
    const answered = h.plugins.request(ID, "notes.one");
    const unanswered = h.plugins.request(ID, "notes.two");
    await settle();
    const [one, two] = [h.callOf("notes.one"), h.callOf("notes.two")];
    h.update();
    // Until the frame loads again, the page it leaves still answers what it was asked.
    h.send({ type: "desk:reply", call: one, ok: true, result: 1 });
    await expect(answered).resolves.toBe(1);
    expect(h.plugins.busy(ID)).toBe(true);
    h.send({ type: "desk:hello" });
    expect(h.plugins.busy(ID)).toBe(false);
    await expect(unanswered).rejects.toMatchObject({ code: "cancelled" });
    // A late answer from the page that went resolves nothing.
    h.send({ type: "desk:reply", call: two, ok: true, result: 2 });
  });

  it("keeps a plugin that sleeps when it updates asleep, with what waits for it", async () => {
    const h = await host();
    h.plugins.unloaded(ID, { kept: true });
    h.plugins.command(ID, "notes.show");
    h.update();
    await settle();
    expect(h.greetedAtReload).toEqual([false]);
    expect(h.plugins.asleep(ID)).toBe(true);
    h.posted();
    h.send({ type: "desk:hello" });
    expect(h.posted()).toEqual(["desk:init", "desk:command notes.show"]);
  });
});
