import { describe, expect, it } from "vitest";
import { sampleAgentId } from "../bridge/studio-fixtures";
import { settle, testDesk } from "../surface/endue/test-desk";
import {
  agentPage,
  enduePresence,
  flipCard,
  hexColour,
  loadEndue,
  openEndueAgent,
  openEndueSpace,
  openOnWeb,
  readFacets,
  spacePage,
  watchEndue,
} from "./endue";

describe("the person's endue agents and spaces in the shell (ADR 0129)", () => {
  it("stays off while signed out, so the agent bar keeps the directory", async () => {
    const { ctx, store, studio } = testDesk();
    studio.setSignedIn(true);
    await loadEndue(ctx);
    expect(store.get().endue.state).toBe("off");
    expect(store.get().endue.agents).toEqual([]);
  });

  it("reads the agents, the spaces and the conversations once signed in", async () => {
    const { ctx, store, signIn } = testDesk();
    signIn();
    await loadEndue(ctx);
    const { endue } = store.get();
    expect(endue.state).toBe("ready");
    expect(endue.agents.map((a) => a.name)).toEqual(["Miso", "Mailie", "Scout"]);
    expect(endue.spaces.map((s) => s.name)).toEqual(["Launch", "Reading club"]);
    expect(endue.conversations.length).toBeGreaterThan(0);
  });

  it("follows signing in and out, and says offline when endue AI cannot be read", async () => {
    const { ctx, store, bridge, signIn } = testDesk();
    const off = watchEndue(ctx);
    signIn();
    await settle();
    await settle();
    expect(store.get().endue.state).toBe("ready");
    await bridge.account.signOut();
    await settle();
    expect(store.get().endue.state).toBe("off");

    signIn();
    const studio = bridge.studio;
    if (!studio) throw new Error("the stub has studio");
    studio.spaces = () => Promise.reject(new Error("down"));
    await loadEndue(ctx);
    expect(store.get().endue.state).toBe("offline");
    off();
  });

  it("opens an agent's and a space's window and reads them on the way in", async () => {
    const { ctx, store, signIn } = testDesk();
    signIn();
    await loadEndue(ctx);
    openEndueAgent(ctx, sampleAgentId(1));
    expect(store.get().focused).toBe(`endue-agent:${sampleAgentId(1)}`);
    expect(store.get().endue.agent).toBe(sampleAgentId(1));
    await settle();
    expect(store.get().endue.facets[sampleAgentId(1)]?.state).toBe("ready");
    openEndueSpace(ctx, "sp_sample001");
    expect(store.get().focused).toBe("endue-space:sp_sample001");
    await settle();
    expect(store.get().endue.details.sp_sample001?.state).toBe("ready");
  });

  it("keeps a failed read with why, and reads again on request", async () => {
    const { ctx, store, signIn, studio } = testDesk();
    signIn();
    await loadEndue(ctx);
    studio.setSignedIn(false);
    await readFacets(ctx, sampleAgentId(1));
    expect(store.get().endue.facets[sampleAgentId(1)]).toMatchObject({
      state: "failed",
      signedOut: true,
    });
    studio.setSignedIn(true);
    await readFacets(ctx, sampleAgentId(1));
    expect(store.get().endue.facets[sampleAgentId(1)]?.state).toBe("ready");
  });

  it("turns a window's card over and back", () => {
    const { ctx, store } = testDesk();
    flipCard(ctx, "endue-agent:a");
    expect(store.get().endue.flipped).toEqual(["endue-agent:a"]);
    flipCard(ctx, "endue-agent:a", true);
    expect(store.get().endue.flipped).toEqual(["endue-agent:a"]);
    flipCard(ctx, "endue-agent:a");
    expect(store.get().endue.flipped).toEqual([]);
  });

  it("opens only endue.ai's pages, with ids as one path segment", async () => {
    const { ctx, bridge } = testDesk();
    expect(agentPage("ag/../x")).toBe("https://endue.ai/agent/ag%2F..%2Fx/studio");
    expect(spacePage("sp_1")).toBe("https://endue.ai/spaces/sp_1");
    await openOnWeb(ctx, spacePage("sp_1"));
    await expect(openOnWeb(ctx, "https://endue.ai.example/x")).rejects.toThrow(/endue.ai/);
    await expect(openOnWeb(ctx, "javascript:alert(1)")).rejects.toThrow();
    expect(bridge.fake.opened).toEqual(["https://endue.ai/spaces/sp_1"]);
  });

  it("words presence as the agent cards do, and lets only #rrggbb into a style", () => {
    const conversation = (activity: "active" | "waiting" | "done") => ({ agentId: "a", activity });
    expect(enduePresence({ id: "a", status: "inactive" }, [conversation("active")])).toBe("paused");
    expect(enduePresence({ id: "a", status: "archived" }, [])).toBe("offline");
    expect(enduePresence({ id: "a", status: "active" }, [conversation("active")])).toBe("working");
    expect(enduePresence({ id: "a", status: "active" }, [conversation("waiting")])).toBe("waiting");
    expect(enduePresence({ id: "a", status: "active" }, [conversation("done")])).toBe("online");
    expect(hexColour("#B6A3F5")).toBe("#B6A3F5");
    expect(hexColour("red")).toBeUndefined();
    expect(hexColour("#fff;x")).toBeUndefined();
  });
});
