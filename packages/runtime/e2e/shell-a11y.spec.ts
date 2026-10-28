import { expect, type Page, test } from "@playwright/test";
import { contrast, over, parseColor, type RGBA } from "../src/shell/contrast";
import { DESK, openShell, primaryFills, step } from "./shell-helpers";
import { shellTree } from "./shell-tree";

/** Every visible text element with its colour and the backgrounds stacked under it, innermost first. */
async function textSamples(page: Page) {
  return page.evaluate(() => {
    const out: { text: string; color: string; layers: string[] }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("#desk *")) {
      const own = [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
      );
      if (!own || el.closest("[aria-hidden='true'], .soul, .eris, [disabled], .is-waiting"))
        continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
      const layers: string[] = [];
      for (let a: HTMLElement | null = el; a; a = a.parentElement) {
        const bg = getComputedStyle(a).backgroundColor;
        if (bg !== "rgba(0, 0, 0, 0)") layers.push(bg);
      }
      layers.push(getComputedStyle(document.querySelector("#desk") as Element).backgroundColor);
      out.push({
        text: el.textContent?.trim().slice(0, 40) ?? "",
        color: getComputedStyle(el).color,
        layers,
      });
    }
    return out;
  });
}

function ratio(sample: { color: string; layers: string[] }): number {
  let bg: RGBA = parseColor(sample.layers.at(-1) ?? "rgb(0,0,0)");
  for (const layer of sample.layers.slice(0, -1).reverse()) bg = over(parseColor(layer), bg);
  return contrast(parseColor(sample.color), bg);
}

test.describe("at 1440×900", () => {
  test.use({ viewport: DESK });

  for (const theme of ["dark", "light"] as const) {
    test(`every visible text is at least 4.5:1 in the ${theme} theme`, async ({ page }) => {
      await openShell(page);
      await page.evaluate((t) => window.__shell.desk.store.set({ theme: t, desktop: 2 }), theme);
      for (const popover of [null, "tasks", "drawer"] as const) {
        await page.evaluate((p) => window.__shell.desk.store.set({ popover: p }), popover);
        await step(page, 100);
        const failing = (await textSamples(page)).filter((s) => ratio(s) < 4.5);
        expect(failing.map((s) => `${s.text}: ${ratio(s).toFixed(2)}`)).toEqual([]);
        expect(await primaryFills(page)).toBeLessThanOrEqual(1);
      }
    });
  }

  test("every icon button has an aria-label, and tab order runs modes → desktops → bar → Eris → rail → bottom", async ({
    page,
  }) => {
    await openShell(page);
    const unlabelled = await page.evaluate(
      () =>
        [...document.querySelectorAll("#desk button")].filter(
          (b) => !b.getAttribute("aria-label") && !b.textContent?.trim(),
        ).length,
    );
    expect(unlabelled).toBe(0);
    // WebKit only tabs to buttons with Safari's "Tab highlights each item" on, so check the
    // sequential focus order the DOM defines (no positive tabindex anywhere) instead of pressing Tab.
    const order = await page.evaluate(() => {
      const parts = [".modes", ".desktops", ".sidebar", ".eris", ".rail", ".bottom"];
      const focusable = [
        ...document.querySelectorAll<HTMLElement>("#desk button, #desk input, #desk [tabindex]"),
      ].filter((el) => el.tabIndex >= 0 && !el.closest("[inert]"));
      const seen: string[] = [];
      for (const el of focusable) {
        const part = parts.find((p) => el.closest(p));
        if (part && seen.at(-1) !== part) seen.push(part);
      }
      const positive = [...document.querySelectorAll<HTMLElement>("[tabindex]")].some(
        (el) => el.tabIndex > 0,
      );
      return positive ? ["positive tabindex"] : seen;
    });
    expect(order).toEqual([".modes", ".desktops", ".sidebar", ".eris", ".rail", ".bottom"]);
  });

  test("reduced motion: no float, no breathing, soul text only fades", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openShell(page, "?reduced=1");
    await page.evaluate(() => window.__shell.desk.eris.say("Quiet morning."));
    await step(page, 100);
    await expect(page.locator(".soul-line")).toHaveCSS("opacity", "0.5");
    await expect(page.locator(".soul-glyph").first()).toHaveCSS("filter", "none");
    await step(page, 1900);
    await expect(page.locator(".eris-body")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    expect(await shellTree(page)).toMatchSnapshot("reduced-motion.json");
  });
});

test.describe("at 1024 wide", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("bars stay, surfaces shrink, nothing overlaps", async ({ page }) => {
    await openShell(page);
    await page.evaluate(() => window.__shell.desk.store.set({ desktop: 2 }));
    await step(page, 100);
    const boxes = await page.evaluate(() =>
      [
        ".modes",
        ".desktops",
        ".sidebar",
        ".rail",
        ".drawer",
        ".composer",
        ".running",
        ".eris",
        ".surface",
      ].flatMap((sel) =>
        [...document.querySelectorAll(sel)].map((el) => {
          const r = el.getBoundingClientRect();
          return { sel, x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      ),
    );
    const chrome = boxes.filter((b) => b.sel !== ".eris" && b.sel !== ".surface");
    const overlaps: string[] = [];
    for (const a of boxes) {
      for (const b of chrome) {
        if (a === b || (a.sel === ".eris" && b.sel !== ".eris")) continue;
        const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        if (hit && a.sel !== b.sel) overlaps.push(`${a.sel} × ${b.sel}`);
      }
    }
    expect([...new Set(overlaps)]).toEqual([]);
    expect(boxes.filter((b) => b.sel === ".surface").every((b) => b.w < 560)).toBe(true);
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(page.locator(".rail")).toBeVisible();
  });
});
