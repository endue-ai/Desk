import { BridgeClient, browserStub, type StubHandlers, stubCommands } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { framesText } from "../frames/copy";
import { PolicyHub } from "../hub";
import type { DeskContext } from "./context";
import { CORE_LANGUAGE, followLanguage, installLanguage, LANGUAGE_SETTING } from "./language";

function context(shared: unknown[] = [], handlers: StubHandlers = {}): DeskContext {
  const bridge = new BridgeClient(browserStub(handlers));
  const hub = new PolicyHub(bridge);
  return {
    hub,
    bridge,
    share: (message: unknown) => shared.push(message),
  } as unknown as DeskContext;
}

describe("desk.language", () => {
  it("desk.language defaults to system and the desk reads the OS's language", () => {
    const ko = context();
    expect(ko.hub.settings.get(LANGUAGE_SETTING)).toBe("system");
    expect(installLanguage(ko, "ko").current()).toBe("ko");
    expect(installLanguage(context(), "en").current()).toBe("en");
  });

  it("choosing a language changes the desk's words without a restart", () => {
    const shared: unknown[] = [];
    const ctx = context(shared);
    const language = installLanguage(ctx, "en");
    const heard: string[] = [];
    language.onChange((lang) => heard.push(lang));
    const followed: string[] = [];
    const stop = followLanguage(ctx.hub.settings, "en", (lang) => followed.push(lang));
    expect(shared.at(-1)).toEqual({ type: "desk:language", language: "en" });
    expect(framesText(language.current(), "notResponding")).toBe("Not responding");

    ctx.hub.settings.set(LANGUAGE_SETTING, "ko");
    expect(language.current()).toBe("ko");
    expect(heard).toEqual(["ko"]);
    expect(followed).toEqual(["en", "ko"]);
    expect(shared.at(-1)).toEqual({ type: "desk:language", language: "ko" });
    expect(framesText(language.current(), "notResponding")).toBe("응답 없음");

    ctx.hub.settings.set(LANGUAGE_SETTING, "system");
    expect(language.current()).toBe("en");
    expect(followed).toEqual(["en", "ko", "en"]);
    stop();
    language.dispose();
    ctx.hub.settings.set(LANGUAGE_SETTING, "ko");
    expect(heard).toEqual(["ko", "en"]);
    expect(followed).toEqual(["en", "ko", "en"]);
  });

  it("the runtime tells the core the language chosen, so the shell follows it", async () => {
    const core = () => stubCommands(() => undefined).handlers;
    const ctx = context([], core());
    const set = vi.spyOn(ctx.bridge, "call");
    const inCore = async () =>
      ((await ctx.bridge.call("settings.get", { key: CORE_LANGUAGE })) as { value?: unknown })
        .value;
    const writes = () => set.mock.calls.filter(([method]) => method === "settings.set");
    const language = installLanguage(ctx, "en");
    // While the settings load, nothing is written: the core keeps what the shell started with.
    ctx.hub.settings.set(LANGUAGE_SETTING, "ko");
    expect(writes()).toEqual([]);

    await language.loaded();
    expect(await inCore()).toBe("ko");
    expect(writes()).toHaveLength(1);
    ctx.hub.settings.set(LANGUAGE_SETTING, "system");
    await vi.waitFor(async () => expect(await inCore()).toBe("system"));
    ctx.hub.settings.set(LANGUAGE_SETTING, "en");
    await vi.waitFor(async () => expect(await inCore()).toBe("en"));
    expect(writes()).toHaveLength(3);

    // A choice the core holds already is not written again.
    const again = context([], core());
    await again.bridge.call("settings.set", { key: CORE_LANGUAGE, value: "en" });
    again.hub.settings.set(LANGUAGE_SETTING, "en");
    const calls = vi.spyOn(again.bridge, "call");
    await installLanguage(again, "en").loaded();
    expect(calls.mock.calls.filter(([method]) => method === "settings.set")).toEqual([]);
    language.dispose();
  });
});
