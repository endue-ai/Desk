import { describe, expect, it } from "vitest";
import type { PluginContext } from "./sdk";
import { defineUiPlugin } from "./sdk";
import { createTestHost } from "./testing";

const catalogs = {
  en: { hello: "Hello", named: "Hello, {name}", files: { one: "{count} file", other: "{count} files" } },
  ko: { hello: "안녕하세요", named: "{name}님, 안녕하세요" },
};

describe("ctx.messages", () => {
  it("a plugin reads its own catalog in the desk's language", async () => {
    const host = createTestHost({
      pluginId: "example.greeter",
      language: "ko",
      messages: { folder: "messages", catalogs },
    });
    let seen: string | undefined;
    const ctx: PluginContext = await defineUiPlugin(
      { mount: (c) => void (seen = c.messages.t("hello")) },
      host.transport,
    );
    expect(seen).toBe("안녕하세요");
    expect(ctx.messages.language()).toBe("ko");
    expect(ctx.messages.t("named", { name: "Eris" })).toBe("Eris님, 안녕하세요");
    // An id Korean lacks reads in English.
    expect(ctx.messages.t("files", { count: 2 })).toBe("2 files");

    const heard: string[] = [];
    ctx.messages.onChange((language) => heard.push(language));
    host.language("en");
    await host.settle();
    await ctx.messages.ready;
    expect(heard).toEqual(["en"]);
    expect(ctx.messages.language()).toBe("en");
    expect(ctx.messages.t("hello")).toBe("Hello");
    expect(ctx.messages.t("files", { count: 1 })).toBe("1 file");
  });

  it("a plugin without catalogs reads ids, in English by default", async () => {
    const host = createTestHost({ pluginId: "example.plain" });
    const ctx = await defineUiPlugin({ mount: () => undefined }, host.transport);
    expect(ctx.messages.language()).toBe("en");
    expect(ctx.messages.t("hello")).toBe("hello");
  });
});
