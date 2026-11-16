import { BridgeClient, browserStub } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { framesText } from "../frames/copy";
import { PolicyHub } from "../hub";
import type { DeskContext } from "./context";
import { followLanguage, installLanguage, LANGUAGE_SETTING } from "./language";

function context(shared: unknown[] = []): DeskContext {
  const bridge = new BridgeClient(browserStub({}));
  const hub = new PolicyHub(bridge);
  return { hub, bridge, share: (message: unknown) => shared.push(message) } as unknown as DeskContext;
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
});
