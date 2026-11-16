// A built-in command's title follows the desk's language without a restart (#359, ADR 0250).
import { BridgeClient, type BridgeEvent, browserStub, stubCommands } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { browserCore } from "./bridge/core";
import { Commands } from "./commands";
import { defineFrameCommands } from "./frames/commands";
import type { FrameResponses } from "./frames/watch";
import { PolicyHub } from "./hub";
import { ShortcutRouter } from "./input";
import type { DeskContext } from "./policies/context";
import { installKeys } from "./policies/keys";
import { installLanguage, LANGUAGE_SETTING } from "./policies/language";

const ALL = { permission: "cmd:invoke" as const, ids: ["*"] };

describe("live command titles", () => {
  it("a built-in's title can follow the language", async () => {
    const registry = stubCommands((event: BridgeEvent) => stub.emit(event));
    const stub = browserStub({ ...registry.handlers });
    /** Every cmd.register the desk sent, in order. */
    const registered = () =>
      stub.calls
        .filter((c) => c.method === "cmd.register")
        .map((c) => c.params as unknown as Record<string, unknown>);
    const client = new BridgeClient(stub);
    const commands = new Commands(client);
    let title = "Open the thing";
    commands.define("desk.thing", {
      title: () => title,
      keywords: ["thing"],
      owner: "desk",
      undo: "desk.thing.undo",
      run: () => "ran",
    });
    commands.define("desk.fixed", { title: "Stay as you are", owner: "desk", run: () => 1 });
    await commands.settled();
    expect(
      registered()
        .map((r) => r.id)
        .sort(),
    ).toEqual(["desk.fixed", "desk.thing"]);

    title = "그것 열기";
    commands.retitle();
    await commands.settled();
    expect(registered().slice(2)).toEqual([
      expect.objectContaining({ id: "desk.thing", title: "그것 열기", keywords: ["thing"] }),
    ]);
    expect(registered().at(-1)).toMatchObject({ undo: "desk.thing.undo" });
    const listed = await client.call("cmd.list", { scope: ALL });
    expect(listed.commands.find((c) => c.id === "desk.thing")?.title).toBe("그것 열기");
    expect(commands.list().find((c) => c.id === "desk.thing")?.title).toBe("그것 열기");
    expect(await commands.run("desk.thing")).toBe("ran");
  });

  it("desk.language re-titles the desk's commands without a restart", async () => {
    const core = browserCore({ manifests: [] });
    const hub = new PolicyHub(core.client);
    const ctx = {
      hub,
      bridge: core.client,
      shortcuts: new ShortcutRouter({ platform: "other" }),
      share: () => undefined,
    } as unknown as DeskContext;
    hub.settings.set(LANGUAGE_SETTING, "en");
    const language = installLanguage(ctx, "en");
    const keys = installKeys(ctx, "en");
    const responses = { state: () => undefined } as unknown as FrameResponses;
    const offFrames = defineFrameCommands(hub.commands, responses, () => ctx.language?.() ?? "en");
    await hub.commands.settled();
    const title = async (id: string) =>
      (await core.client.call("cmd.list", { scope: ALL })).commands.find((c) => c.id === id)?.title;
    expect(await title("desk.keys.list")).toBe("List key bindings");
    expect(await title("desk.frames.wait")).toBe("Not responding · wait");

    hub.settings.set(LANGUAGE_SETTING, "ko");
    await hub.commands.settled();
    expect(await title("desk.keys.list")).toBe("단축키 목록 보기");
    expect(await title("desk.frames.wait")).toBe("응답 없는 창 · 기다리기");
    offFrames();
    keys.dispose();
    language.dispose();
  });
});
