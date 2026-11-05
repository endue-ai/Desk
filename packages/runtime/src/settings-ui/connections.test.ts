// @vitest-environment jsdom
// Settings, Connections: the connectors connector.list lists, each instance with its status, a form
// drawn from the connector's instanceSettings (a password field for a secret one, emptied once the
// call is made), and sync and disconnect. The stub bridge answers as the core does.
import { BridgeClient, browserStub, stubCommands } from "@endue-ai/bridge";
import { afterEach, describe, expect, it } from "vitest";
import { mountConnections } from "./connections";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function mount(focus?: { connector?: string; kinds?: string[] }) {
  const core = stubCommands(() => {});
  const bridge = new BridgeClient(browserStub(core.handlers));
  const panel = mountConnections({ bridge, language: "en", ...(focus ? { focus } : {}) });
  document.body.append(panel.el);
  return { bridge, panel };
}

const rows = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLElement>("[data-instance]")].map((row) => [
    row.dataset.instance,
    row.querySelector(".connection-state")?.textContent,
  ]);

afterEach(() => {
  document.body.replaceChildren();
});

describe("Settings, Connections", () => {
  it("lists every connector with its instances and their status", async () => {
    const { panel } = mount();
    await panel.ready;
    const group = panel.el.querySelector<HTMLElement>('[data-connector="desk.fixtures"]');
    expect(group?.querySelector("h2")?.textContent).toBe("Fixtures");
    expect(group?.textContent).toContain("events, tasks, notes and messages");
    expect(rows(panel.el)).toEqual([["desk.fixtures/default", "Connected"]]);
    panel.dispose();
  });

  it("connects an instance with a password field it empties after the call", async () => {
    const { bridge, panel } = mount();
    await panel.ready;
    const form = panel.el.querySelector<HTMLFormElement>('form[data-connect="desk.fixtures"]');
    if (!form) throw new Error("no connect form");
    const field = (name: string) =>
      form.querySelector<HTMLInputElement>(`[name="${name}"]`) ?? undefined;
    expect(field("token")?.type).toBe("password");
    expect(field("token")?.autocomplete).toBe("off");
    expect(field("folder")?.type).toBe("text");
    const name = field("title");
    if (!name) throw new Error("no name field");
    name.value = "Work";
    (field("folder") as HTMLInputElement).value = "~/Work";
    (field("token") as HTMLInputElement).value = "s3cret";
    form.requestSubmit();
    await panel.idle();
    expect(field("token")?.value).toBe("");
    const listed = await bridge.call("connector.list", {
      scope: { permission: "connector:manage" },
    });
    const work = listed.connectors[0]?.instances.find((i) => i.instance === "work");
    expect(work).toMatchObject({ title: "Work", settings: { folder: "~/Work" } });
    expect(JSON.stringify(listed)).not.toContain("s3cret");
    await settle();
    await panel.idle();
    expect(rows(panel.el).map(([id]) => id)).toEqual(["desk.fixtures/default", "desk.fixtures/work"]);
    expect(panel.el.textContent).not.toContain("s3cret");
    panel.dispose();
  });

  it("says why a connect was refused and still empties the secret", async () => {
    // No name is the instance `default`, which the fixture connector already has.
    const { panel } = mount();
    await panel.ready;
    const form = panel.el.querySelector<HTMLFormElement>('form[data-connect="desk.fixtures"]');
    if (!form) throw new Error("no connect form");
    const title = form.querySelector<HTMLInputElement>('[name="title"]');
    const token = form.querySelector<HTMLInputElement>('[name="token"]');
    if (!title || !token) throw new Error("fields missing");
    title.value = "";
    token.value = "again";
    form.requestSubmit();
    await panel.idle();
    expect(form.querySelector('[role="alert"]')?.textContent).toContain("already");
    expect(token.value).toBe("");
    panel.dispose();
  });

  it("syncs and disconnects an instance", async () => {
    const { bridge, panel } = mount();
    await panel.ready;
    const row = panel.el.querySelector<HTMLElement>('[data-instance="desk.fixtures/default"]');
    const button = (label: string) =>
      [...(row?.querySelectorAll("button") ?? [])].find((b) => b.textContent === label);
    button("Sync now")?.click();
    await panel.idle();
    button("Disconnect")?.click();
    await panel.idle();
    const listed = await bridge.call("connector.list", {
      scope: { permission: "connector:manage" },
    });
    expect(listed.connectors[0]?.instances).toEqual([]);
    await settle();
    await panel.idle();
    expect(rows(panel.el)).toEqual([]);
    panel.dispose();
  });

  it("puts the connector desk.connectors.open names first and opens its form", async () => {
    const { panel } = mount({ connector: "desk.fixtures" });
    await panel.ready;
    const first = panel.el.querySelector<HTMLElement>("[data-connector]");
    expect(first?.dataset.connector).toBe("desk.fixtures");
    expect(first?.classList.contains("focused")).toBe(true);
    panel.dispose();
  });
});
