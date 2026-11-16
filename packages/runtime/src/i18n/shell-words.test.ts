// The shell's, the desktops', Eris's and arranging's words come from their catalogs (#358, ADR 0250),
// and read as they did when they were inline.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { arrangeText, spreadCopy } from "../arrange/copy";
import { dt } from "../desktops/copy";
import { floatText, statusText } from "../eris/float-copy";
import { REFUSED_LINES, SAMPLE_LINES } from "../eris/talk";
import { barWord } from "../shell/bar-new";
import { t } from "../shell/copy";

const src = join(import.meta.dirname, "..");
const catalog = (module: string, lang: string) =>
  JSON.parse(readFileSync(join(src, module, "messages", `${lang}.json`), "utf8")) as Record<
    string,
    unknown
  >;

describe("the shell's words in catalogs", () => {
  it("the shell, desktops, Eris and arrange read their words from catalogs", () => {
    for (const module of ["shell", "desktops", "eris", "arrange"])
      for (const lang of ["en", "ko"])
        expect(existsSync(join(src, module, "messages", `${lang}.json`)), `${module}/${lang}`).toBe(
          true,
        );
    expect(t("ko", "modes")).toBe("프로필");
    expect(t("en", "modes")).toBe("Profiles");
    expect(dt("ko", "desktops")).toBe("데스크톱");
    expect(dt("en", "newDesktop")).toBe("New desktop");
    expect(floatText("en", "hint", { key: "⌥↩" })).toBe("⌥↩ summons her anywhere");
    expect(statusText("ko", "listening")).toBe("듣는 중…");
    expect(arrangeText("ko", "foundOn", { plugin: "Notes", desktop: 2 })).toBe(
      "Notes · 데스크톱 2",
    );
    expect(arrangeText("en", "tile")).toBe("Tile windows");
    // The compositor fills the spread's words itself.
    expect(spreadCopy("en").count).toContain("{");
    expect(catalog("shell", "en")["shell.modes"]).toBe("Profiles");
  });

  it("the talk line, the new-agent bar and Eris's said and heard lines follow the language", () => {
    expect(barWord("ko", "more", 3)).toBe("+3명 더");
    expect(barWord("en", "moreEndue", 3)).toBe("+3 more");
    expect(SAMPLE_LINES.heard.ko).toBe("잘 들었어요. 지금은 샘플 답이에요.");
    expect(SAMPLE_LINES.nothing.en).toBe("I didn't catch that. Tap and try again.");
    expect(REFUSED_LINES.en).toBe("I need the microphone to hear you. You can type instead.");
    const shell = { en: catalog("shell", "en"), ko: catalog("shell", "ko") };
    expect(shell.ko["shell.talkPlaceholder"]).toBe("Eris에게 계속 말해 보세요");
    expect(shell.en["shell.talkPreview"]).toBe("Agents you can call today…");
    const eris = { en: catalog("eris", "en"), ko: catalog("eris", "ko") };
    expect(eris.ko["eris.said.label"]).toBe("Eris가 한 말");
    expect(eris.en["eris.said.none"]).toBe("Eris has said nothing yet.");
  });
});
