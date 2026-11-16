// @vitest-environment jsdom
// The page on jsdom over the fixtures' Mac: index.html wired by view.js and app.js, the four tabs,
// the administrator question, the map with its marks and words, a device's card and "Who is
// this?", the checkup with its score and cards, the channels with the hidden-SSID note, the log.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../ui/app.js";
import { parseOui } from "../ui/oui.js";
import { createStore } from "../ui/store.js";
import { createView } from "../ui/view.js";
import * as F from "./fixtures";
import { englishT, fakeBridge, macRunner } from "./harness";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");

async function page() {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const t = await englishT();
  const bridge = fakeBridge({
    "perm.request": () => ({ granted: true }),
    "net.connect": ({ port, host }) => {
      if (host === "192.168.0.23" && (port === 23 || port === 80)) return { socketId: `s-${port}` };
      throw Object.assign(new Error("refused"), { code: "io_error" });
    },
    "net.close": () => ({}),
  });
  let app: ReturnType<typeof createApp> | null = null;
  const view = createView(doc, (action, detail) => void app?.act(action, detail));
  view.words(t);
  app = createApp({
    bridge,
    runner: macRunner() as never,
    store: createStore(bridge),
    oui: () => parseOui(F.OUI),
    t,
    language: () => "en",
    platform: "mac",
    view,
    interval: async () => 5,
    timers: { set: (() => 0) as never, clear: () => {} },
  });
  await app.start();
  const click = async (selector: string) => {
    const el = doc.querySelector(selector) as HTMLElement | null;
    if (!el) throw new Error(`no ${selector}`);
    el.click();
    await new Promise((r) => setTimeout(r, 0));
    await app.net.scan();
  };
  return { doc, app, bridge, click };
}

describe("the page", () => {
  it("draws the map with the router in the middle and asks whether the person runs the network", async () => {
    const { doc, click } = await page();
    expect(doc.title).toBe("Network");
    expect([...doc.querySelectorAll('[role="tab"]')].map((b) => b.textContent)).toEqual([
      "Map",
      "Checkup",
      "Wi-Fi channels",
      "Log",
    ]);
    expect(doc.getElementById("here")?.textContent).toBe(
      "192.168.0.0/24 · router 192.168.0.1 · en0",
    );
    const ask = doc.getElementById("ask") as HTMLElement;
    expect(ask.hidden).toBe(false);
    expect(ask.textContent).toContain("Are you this network's administrator?");
    const hub = doc.querySelector(".room.hub") as HTMLElement;
    expect(hub.textContent).toContain("Router");
    expect(hub.getAttribute("style")).toContain("grid-row: 2; grid-column: 2;");
    const rooms = [...doc.querySelectorAll(".floor .room")];
    expect(rooms).toHaveLength(6);
    // Every status has a shape and a word, not only a colour.
    const phone = rooms.find((r) => r.textContent?.includes("192.168.0.42")) as HTMLElement;
    expect(phone.querySelector(".status-icon.status-new")).not.toBeNull();
    expect(phone.textContent).toContain("New");
    expect(phone.getAttribute("aria-label")).toBe(
      "Phone at 192.168.0.42, Phone, 192.168.0.42, New",
    );
    await click('[data-act="admin-yes"]');
    expect(ask.hidden).toBe(true);
  });

  it("opens a device's card and takes the answer to 'Who is this?'", async () => {
    const { doc, click, app } = await page();
    await click('[data-act="device"][data-mac="6a:1f:2e:3d:4c:5b"]');
    const card = doc.getElementById("device") as HTMLElement;
    expect(card.hidden).toBe(false);
    const facts = card.querySelector(".facts")?.textContent ?? "";
    for (const word of [
      "IP address",
      "192.168.0.42",
      "MAC address",
      "6a:1f:2e:3d:4c:5b",
      "Random MAC address (may be a phone)",
      "Ping (ms)",
      "no reply",
    ])
      expect(facts).toContain(word);
    expect(card.querySelector('dfn[title^="Phones and laptops make up"]')).not.toBeNull();
    await click('[data-act="who"]');
    const form = card.querySelector('form[data-form="who"]') as HTMLFormElement;
    (form.querySelector('[name="name"]') as HTMLInputElement).value = "Mina's phone";
    (form.querySelector('[name="mine"]') as HTMLInputElement).checked = true;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    const phone = app.net.state.devices.find((d: { mac: string }) => d.mac === "6a:1f:2e:3d:4c:5b");
    expect(phone).toMatchObject({ name: "Mina's phone", mine: true, status: "known" });
    expect(card.querySelector("h3")?.textContent).toBe("Mina's phone");
  });

  it("checks a device's ports and scores the network with what to do", async () => {
    const { doc, click, app } = await page();
    await click('[data-act="admin-yes"]');
    await app.net.checkDevice("00:bc:99:12:34:56");
    await click('[data-act="tab"][data-tab="checkup"]');
    const panel = doc.getElementById("panel-checkup") as HTMLElement;
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector(".ring")?.getAttribute("aria-label")).toMatch(/^\d+ out of 100$/);
    const todos = [...panel.querySelectorAll(".todo-text")].map((p) => p.textContent);
    expect(todos[0]).toBe("Camera at 192.168.0.23: port 23 (Telnet) is open.");
    const ports = [...panel.querySelectorAll(".device-ports .port")].map((p) => p.textContent);
    expect(ports).toEqual(["23Telnet", "80HTTP"]);
    expect(panel.querySelector(".port.risky .port-number")?.textContent).toBe("23");
  });

  it("draws the Wi-Fi channels apart per band and says why the SSIDs are missing", async () => {
    const { doc, click } = await page();
    await click('[data-act="tab"][data-tab="channels"]');
    await new Promise((r) => setTimeout(r, 0));
    const panel = doc.getElementById("panel-channels") as HTMLElement;
    expect([...panel.querySelectorAll(".band h3")].map((h) => h.firstChild?.textContent)).toEqual([
      "2.4 GHz",
      "5 GHz",
      "6 GHz",
    ]);
    expect(panel.querySelector(".verdict")?.textContent).toBe(
      "Channel 6 is crowded; channel 11 is recommended.",
    );
    expect(panel.textContent).toContain("no Location Services permission");
    expect(panel.querySelectorAll(".bar.mine")).toHaveLength(1);
    expect(panel.textContent).not.toContain("<redacted>");
  });

  it("lists the log in time order", async () => {
    const { doc, click } = await page();
    await click('[data-act="tab"][data-tab="log"]');
    const panel = doc.getElementById("panel-log") as HTMLElement;
    expect(panel.querySelector(".log-entry")?.textContent).toContain(
      "First scan of this network: 6 devices.",
    );
  });
});
