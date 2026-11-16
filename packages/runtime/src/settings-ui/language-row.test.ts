// @vitest-environment jsdom
import { BridgeClient, browserStub } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { PolicyHub } from "../hub";
import { languageRow } from "./language-row";

function setup() {
  const hub = new PolicyHub(new BridgeClient(browserStub({})));
  const saved: Array<[string, unknown]> = [];
  const preferences = {
    set: (key: string, value: unknown) => {
      saved.push([key, value]);
      hub.settings.set(key, value);
    },
  };
  return { hub, preferences, saved };
}

describe("Settings › General", () => {
  it("Settings › General has a Language row", () => {
    const { hub, preferences, saved } = setup();
    const row = languageRow({ settings: hub.settings, preferences, language: "en" });
    document.body.append(row);
    expect(row.querySelector('[data-setting="desk.language"]')).not.toBeNull();
    expect(row.querySelector(".settings-row-label > span")?.textContent).toBe("Language");
    const select = row.querySelector("select");
    if (!select) throw new Error("no select");
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ["system", "Follow the system"],
      ["en", "English"],
      ["ko", "한국어"],
    ]);
    expect(select.value).toBe("system");

    select.value = "en";
    select.dispatchEvent(new Event("change"));
    expect(saved).toEqual([["desk.language", "en"]]);
    expect(hub.settings.get("desk.language")).toBe("en");
  });

  it("the row reads in the desk's language and shows a change made elsewhere", () => {
    const { hub, preferences } = setup();
    const row = languageRow({ settings: hub.settings, preferences, language: "ko" });
    document.body.append(row);
    expect(row.querySelector(".settings-row-label > span")?.textContent).toBe("언어");
    const select = row.querySelector("select");
    expect(select?.options[0]?.textContent).toBe("시스템 언어 따르기");
    hub.settings.set("desk.language", "ko");
    expect(select?.value).toBe("ko");
  });
});
