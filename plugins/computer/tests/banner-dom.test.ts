// @vitest-environment jsdom
// The banner's page (ui/banner.html) as the desk shows it over every app: hidden until an agent
// acts, then who and what with Stop, which goes back to the desk as `?stop`; Resume after a stop.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { mountBanner } from "../ui/banner.js";

const html = readFileSync(join(import.meta.dirname, "../ui/banner.html"), "utf8");

describe("banner.html", () => {
  beforeEach(() => {
    document.body.innerHTML = /<body>([\s\S]*)<script/.exec(html)?.[1] ?? "";
  });

  it("is hidden until an agent acts, then names her and what she does", () => {
    const banner = mountBanner(document, () => {});
    const root = document.getElementById("banner") as HTMLElement;
    expect(root.hidden).toBe(true);
    banner.show({
      state: "acting",
      caller: "endue.computer",
      agent: "eris",
      action: "type",
      app: "Notes",
    });
    expect(root.hidden).toBe(false);
    expect(document.getElementById("banner-title")?.textContent).toBe(
      "Eris is using your computer",
    );
    expect(document.getElementById("banner-detail")?.textContent).toBe("type in Notes");
    expect(document.getElementById("banner-key")?.textContent).toBe("Hold Esc to stop");
  });

  it("stops through the desk, and resumes after a stop", () => {
    const went: string[] = [];
    const banner = mountBanner(document, (to) => went.push(to));
    banner.show({ state: "acting", caller: "endue.computer", agent: "eris" });
    const button = document.getElementById("banner-stop") as HTMLButtonElement;
    button.click();
    expect(went).toEqual(["?stop"]);
    banner.show({ state: "stopped", caller: "core" });
    expect(button.textContent).toBe("Resume");
    button.click();
    expect(went).toEqual(["?stop", "?resume"]);
    banner.key("Ctrl+Alt+Cmd+Period stops");
    expect(document.getElementById("banner-key")?.textContent).toBe("Ctrl+Alt+Cmd+Period stops");
  });
});
