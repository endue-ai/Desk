import { describe, expect, it } from "vitest";
import { type Catalogs, messageText, resolveLanguage } from "./messages";

const catalogs: Catalogs = {
  en: {
    "greet.hello": "Hello",
    "greet.named": "Hello, {name}",
    "greet.only": "Only in English",
    "inbox.unread": { one: "{count} unread notice", other: "{count} unread notices" },
  },
  ko: {
    "greet.hello": "안녕하세요",
    "greet.named": "{name}님, 안녕하세요",
    "inbox.unread": { other: "읽지 않은 알림 {count}개" },
  },
};

describe("messageText", () => {
  it("a message is read in the desk's language, then English, then shown as its id", () => {
    expect(messageText(catalogs, "ko", "greet.hello")).toBe("안녕하세요");
    expect(messageText(catalogs, "en", "greet.hello")).toBe("Hello");
    expect(messageText(catalogs, "ko", "greet.only")).toBe("Only in English");
    expect(messageText(catalogs, "ko", "greet.nowhere")).toBe("greet.nowhere");
  });

  it("parameters fill {name} and a missing one stays empty", () => {
    expect(messageText(catalogs, "en", "greet.named", { name: "Eris" })).toBe("Hello, Eris");
    expect(messageText(catalogs, "ko", "greet.named", { name: "Eris" })).toBe("Eris님, 안녕하세요");
    expect(messageText(catalogs, "en", "greet.named", {})).toBe("Hello, ");
    // Without parameters the text stays as written, for a caller that fills it later.
    expect(messageText(catalogs, "en", "greet.named")).toBe("Hello, {name}");
  });

  it("a plural message picks its form by count", () => {
    expect(messageText(catalogs, "en", "inbox.unread", { count: 1 })).toBe("1 unread notice");
    expect(messageText(catalogs, "en", "inbox.unread", { count: 2 })).toBe("2 unread notices");
    expect(messageText(catalogs, "ko", "inbox.unread", { count: 1 })).toBe("읽지 않은 알림 1개");
    expect(messageText(catalogs, "en", "inbox.unread", {})).toBe(" unread notices");
  });
});

describe("resolveLanguage", () => {
  it("system follows the OS's languages", () => {
    expect(resolveLanguage("system", ["ko-KR"])).toBe("ko");
    expect(resolveLanguage("system", ["fr-FR", "ko"])).toBe("ko");
    expect(resolveLanguage("system", ["fr-FR"])).toBe("en");
    expect(resolveLanguage("system", [])).toBe("en");
    expect(resolveLanguage(undefined, ["ko-KR"])).toBe("ko");
    expect(resolveLanguage("en", ["ko-KR"])).toBe("en");
    expect(resolveLanguage("ko", ["en-US"])).toBe("ko");
  });
});
