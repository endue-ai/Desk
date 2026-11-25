import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkKeysFile } from "./desk-checks";
import { reservedChords } from "./sequences/reserved";
import en from "./surface/messages/en.json";
import ko from "./surface/messages/ko.json";

describe("endue product copy", () => {
  it("names the runtime development page endue", () => {
    const html = readFileSync(new URL("../dev/index.html", import.meta.url), "utf8");
    expect(html).toContain("<title>endue</title>");
  });

  it("identifies endue in both local session tabs", () => {
    expect(en["surface.localAgent.tabDesk"]).toBe("In endue {n}");
    expect(ko["surface.localAgent.tabDesk"]).toBe("endue {n}");
    expect(en["surface.localAgent.inDesk"]).toBe("In endue");
    expect(ko["surface.localAgent.inDesk"]).toBe("endue에 있음");
  });

  it("names the app in the upgrade guidance and reserved shortcuts", () => {
    expect(checkKeysFile({ version: 1 }).map((error) => error.message)).toContain(
      "version 1 is newer than endue supports (0); update endue",
    );
    expect(reservedChords("mac").find(({ chord }) => chord === "Meta+Q")?.does).toBe("quits endue");
  });

  it.each(["eris", "github", "item", "profiles", "terminal"])(
    "uses the current product name in the %s catalog entry",
    (id) => {
      const url = new URL(`../../../plugins/${id}/plugin.json`, import.meta.url);
      const manifest = readFileSync(url, "utf8");
      expect(manifest).not.toMatch(/\bDesk\b/);
    },
  );
});
