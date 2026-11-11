import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

// The permission prompter's page (plugins/permissions) covers the desk as an overlay (#161, #162):
// its question, its approval card and its list are whole at every size the app window takes, from
// 1024x500 up: each panel inside the viewport, its buttons too, however long its text. The page's own
// HTML and stylesheets, as the desk serves them, without its script.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = [
  "../../ui/src/tokens.css",
  "../../ui/src/base.css",
  "../../../plugins/permissions/ui/style.css",
]
  .map(read)
  .join("\n");
const body = read("../../../plugins/permissions/ui/index.html")
  .replace(/^[\s\S]*<body>/, "")
  .replace(/<script[\s\S]*?<\/script>/g, "")
  .replace(/<\/body>[\s\S]*$/, "");

const SIZES = [
  { width: 1024, height: 500 },
  { width: 1280, height: 800 },
  { width: 1500, height: 950 },
];

const LONG = "To check every file in the folder the person picked before it opens them. ".repeat(
  12,
);
const DIFF = Array.from({ length: 120 }, (_, i) => `+line ${i + 1} of a long change`).join("\n");

/** Show one panel with long content, as the view fills it. */
async function open(page: Page, panel: "prompt" | "approval" | "grants"): Promise<void> {
  await page.setContent(`<style>${css}</style>${body}`);
  await page.evaluate(
    ({ panel, long, diff }) => {
      const set = (id: string, text: string) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
      };
      set("prompt-title", "Sheets asks for permission");
      set("prompt-why", `Reason: ${long}`);
      set("approval-title", "Agent eris wants to write a file");
      set("approval-preview", diff);
      document.getElementById("approval-preview")?.removeAttribute("hidden");
      const groups = document.getElementById("grants-groups");
      for (let i = 0; i < 40; i++) {
        const li = document.createElement("p");
        li.textContent = `Grant ${i}`;
        groups?.append(li);
      }
      document.getElementById(panel)?.removeAttribute("hidden");
    },
    { panel, long: LONG, diff: DIFF },
  );
}

/** Whether every rect of `selector`'s matches lies inside the viewport. */
const inside = (page: Page, selector: string) =>
  page.evaluate((selector) => {
    const all = [...document.querySelectorAll<HTMLElement>(selector)].filter(
      (el) => el.getClientRects().length > 0,
    );
    return all.map((el) => {
      const r = el.getBoundingClientRect();
      const ok = r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
      return `${el.textContent?.trim().slice(0, 20) || el.id}: ${ok ? "in view" : "cut"}`;
    });
  }, selector);

for (const size of SIZES) {
  test.describe(`at ${size.width}x${size.height}`, () => {
    test.use({ viewport: size });

    test("the question and its four answers are whole", async ({ page }) => {
      await open(page, "prompt");
      const shown = await inside(page, "#prompt, #prompt .actions button");
      expect(shown).toHaveLength(5);
      for (const line of shown) expect(line).toMatch(/in view$/);
    });

    test("the approval card and its three answers are whole", async ({ page }) => {
      await open(page, "approval");
      const shown = await inside(page, "#approval, #approval [data-for=approval] button");
      expect(shown).toHaveLength(4);
      for (const line of shown) expect(line).toMatch(/in view$/);
    });

    test("the list and its Close are whole; the list scrolls inside", async ({ page }) => {
      await open(page, "grants");
      const shown = await inside(page, "#grants, #grants-close");
      expect(shown).toHaveLength(2);
      for (const line of shown) expect(line).toMatch(/in view$/);
    });
  });
}
