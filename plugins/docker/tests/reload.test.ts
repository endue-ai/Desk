import { describe, expect, it } from "vitest";
import { DB_ID, WEB_ID } from "./fixtures";
import { engine, mount } from "./harness";

describe("contexts and reloads", () => {
  it("switches context for this plugin only, keeps it, and watches the new engine", async () => {
    const m = await mount({ commands: { "desk.palette.pick": () => "build" } });
    expect(await m.host.invoke("endue.docker.context")).toBe("build");
    expect(m.store.context).toBe("build");
    expect(
      m.docker.calls.filter((c) => c.args[0] === "context").every((c) => c.args[1] === "ls"),
    ).toBe(true);
    expect(m.docker.last("events")?.context).toBe("build");
    expect(m.docker.last("version")?.context).toBe("build");
    expect(m.view.said.at(-1)).toBe("Using the context build.");
    const picked = m.ran("desk.palette.pick")[0] as { items: Array<{ id: string }> };
    expect(picked.items.map((i) => i.id)).toEqual(["@cli", "default", "desktop-linux", "build"]);
    // The list on screen (the overview) is read again from the new engine.
    expect(m.docker.last("ps")?.context).toBe("build");
    expect(await m.host.invoke("endue.docker.context", { name: "" })).toBe("");
    expect(m.docker.last("version")?.context).toBeUndefined();
    await expect(m.host.invoke("endue.docker.context", { name: "-H tcp://x" })).rejects.toThrow(
      /not a context name/,
    );
  });

  it("comes back to the list, logs or detail a reload left, in the pane", async () => {
    const images = await mount({ state: { view: "images", back: "images", all: true } });
    expect(images.view.shown.at(-1)).toBe("images");
    expect(images.view.latest("images").images).toHaveLength(3);
    const logs = await mount({
      script: engine({ logs: { hang: true } }),
      state: {
        view: "logs",
        back: "compose",
        logs: { kind: "container", id: WEB_ID, name: "shop-web-1" },
      },
    });
    expect(logs.view.shown.at(-1)).toBe("logs");
    expect(logs.docker.last("logs")?.args.at(-1)).toBe(WEB_ID);
    expect(logs.app.back()).toBe("compose");
    expect(logs.view.panes.at(-1)).toMatchObject({
      kind: "container",
      tab: "logs",
      title: "shop-web-1",
    });
    const detail = await mount({ state: { view: "inspect", detail: DB_ID } });
    expect(detail.view.shown.at(-1)).toBe("inspect");
    expect(detail.view.details.at(-1)?.name).toBe("shop-db-1");
    expect(detail.view.panes.at(-1)).toMatchObject({
      kind: "container",
      tab: "info",
      state: "running",
    });
  });

  it("reads the Engine list an older version saved as the overview", async () => {
    const m = await mount({ state: { view: "system", back: "system", all: true } });
    expect(m.view.shown.at(-1)).toBe("overview");
    expect(await m.host.invoke("endue.docker.open", { view: "system" })).toBe("overview");
  });
});
