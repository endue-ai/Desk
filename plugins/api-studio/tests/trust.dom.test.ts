// @vitest-environment jsdom
// Which scripts may run (trust.js), on a studio cut down to what it reads: a script runs when the
// person wrote it here or allowed it, by its hash, wherever the tab came from; typing in one editor
// makes only that script theirs; tests the assistant adds onto tests from a file stay the file's.
import { describe, expect, it } from "vitest";
import { createApp } from "../ui/app.js";
import { normalize } from "../ui/model.js";
import type { Studio } from "../ui/studio.js";
import { installTrust } from "../ui/trust.js";

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};
const answer = async (label: string) => {
  await until(() => !!document.querySelector(".as-dialog.is-trust"));
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>(".as-dialog.is-trust button"),
  ].find((b) => b.textContent?.trim() === label);
  button?.click();
};

function studio() {
  const store = new Map<string, unknown>();
  const app = createApp();
  const S: Studio = {
    app,
    ctx: {
      bridge: {
        call: async (method: string, p: { key: string; value?: unknown }) => {
          if (method === "store.get") return { value: store.get(p.key) };
          if (method === "store.set") store.set(p.key, p.value);
          return {};
        },
      },
    },
    collections: { parents: () => [], byPath: () => undefined, locate: () => undefined },
    save: async () => true,
    collectionMenu: () => [],
  };
  installTrust(S);
  return S;
}

describe("which scripts run", () => {
  it("asks about a script the person did not touch, even beside one they typed", async () => {
    const S = studio();
    const tab = S.app.open(
      normalize({ scripts: { pre: "", post: 'api.env.set("baseUrl", "https://evil/")' } }),
    );
    tab.req.scripts.pre = 'api.set("mine", "1");';
    S.app.emit("req", { field: "scripts", which: "pre", tab });
    const asked = S.trust.allows(tab);
    await answer("Don't run");
    expect(await asked).toBe(false);

    // Allowed once, the same text runs from then on without asking, in any tab.
    const other = studio();
    const again = other.app.open(normalize({ scripts: { pre: "", post: "x()" } }));
    const first = other.trust.allows(again);
    await answer("Run scripts");
    expect(await first).toBe(true);
    const copy = other.app.open(normalize({ scripts: { pre: "", post: "x()" } }));
    expect(await other.trust.allows(copy)).toBe(true);
  });

  it("keeps the assistant's tests on top of a file's tests the file's", async () => {
    const S = studio();
    const tab = S.app.open(normalize({ tests: "fileTest()" }));
    const before = tab.req.tests;
    tab.req.tests = `${before}\n\nadded()`;
    S.app.emit("req", { field: "tests", which: "tests", tab, before });
    const asked = S.trust.allows(tab);
    await answer("Don't run");
    expect(await asked).toBe(false);

    const fresh = S.app.open(normalize({ tests: "" }));
    fresh.req.tests = "added()";
    S.app.emit("req", { field: "tests", which: "tests", tab: fresh, before: "" });
    expect(await S.trust.allows(fresh)).toBe(true);
  });
});
