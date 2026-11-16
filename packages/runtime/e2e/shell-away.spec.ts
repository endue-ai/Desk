// The desk's chrome goes away while a window fills the whole app, and comes back at the app's
// edges (ADR 0221, `src/shell/away.ts`). This page hears its own pointer everywhere; on the desk
// the compositor says where the pointer is over a window (`apps/desk/shell`, `edges.rs`).
import { expect, type Page, test } from "@playwright/test";
import type { SurfacePlacement } from "../src/modes/types";
import { DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });

const AWAY = [".sidebar", ".rail", ".map-strip", ".modes", ".desktops", ".eris", ".composer"];
// The account bar alone (#296): the Drawer and the origin button go with the map's strip.
const STAY = [".account-bar"];

/**
 * Two of the shell's own windows on desktop 1, Notes in use; Eris placed at the top centre, so she
 * is in sight at rest (at rest with no place of her own she is in the talk line, ADR 0254) and goes
 * past the top edge. One frame lays her there.
 */
async function seed(page: Page) {
  await page.evaluate(async () => {
    const at = (id: string, x: number, y: number): SurfacePlacement => ({
      id,
      plugin: "endue.shell",
      x,
      y,
      w: 420,
      h: 320,
      pinned: false,
    });
    await window.__shell.wm.desktop(1);
    await window.__shell.wm.session({
      1: {
        surfaces: [at("calendar", 140, 230), at("notes", 600, 300)],
        eris: { x: 656, y: 40 },
        rail: { visible: true },
        drawer: { visible: true },
      },
    });
    await window.__shell.wm.focus("notes");
    window.__shell.step(16);
  });
}

const fill = (page: Page, where: "full" | "left") =>
  page.evaluate((w) => window.__shell.wm.fill("notes", w), where);
const part = (page: Page, selector: string) => page.locator(`#desk ${selector}`).first();
/** Each part's left and top as drawn, whole pixels. */
const places = (page: Page, selectors: string[]) =>
  page.evaluate(
    (all) =>
      Object.fromEntries(
        all.map((sel) => {
          const r = document.querySelector(`#desk ${sel}`)?.getBoundingClientRect();
          return [sel, r ? [Math.round(r.x), Math.round(r.y)] : null];
        }),
      ),
    selectors,
  );

test.describe("a window that fills the whole app", () => {
  test("sends the desk's chrome out past the edges, all but the bottom left, and brings it back when it no longer fills", async ({
    page,
  }) => {
    await openShell(page, "?lang=en");
    await seed(page);
    const rest = await places(page, AWAY);
    await fill(page, "full");
    await expect(page.locator("#desk")).toHaveClass(/is-away/);
    for (const selector of AWAY) await expect(part(page, selector)).toBeHidden();
    for (const selector of STAY) await expect(part(page, selector)).toBeVisible();
    // Out of the app, each past the edge it is nearest.
    const out = await page.evaluate(
      (all) =>
        all.map((sel) => {
          const r = document.querySelector(`#desk ${sel}`)?.getBoundingClientRect();
          if (!r) return `${sel}: none`;
          const inside = r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
          return inside ? `${sel}: in sight` : "out";
        }),
      AWAY,
    );
    expect(out).toEqual(AWAY.map(() => "out"));
    // The title bar keeps clear of nothing: the switcher and the desktops are not there.
    const insets = await page.evaluate(() => {
      const style = document.querySelector<HTMLElement>(".surfaces")?.style;
      return [style?.getPropertyValue("--chrome-left"), style?.getPropertyValue("--chrome-right")];
    });
    expect(insets).toEqual(["0px", "0px"]);

    await page.evaluate(() => window.__shell.wm.unfill("notes"));
    await expect(page.locator("#desk")).not.toHaveClass(/is-away/);
    for (const selector of AWAY) await expect(part(page, selector)).toBeVisible();
    await expect.poll(() => places(page, AWAY)).toEqual(rest);
  });

  test("leaves the chrome where it is for a window that fills half the app", async ({ page }) => {
    await openShell(page, "?lang=en");
    await seed(page);
    await fill(page, "left");
    await page.waitForTimeout(300);
    await expect(page.locator("#desk")).not.toHaveClass(/is-away/);
    for (const selector of AWAY) await expect(part(page, selector)).toBeVisible();
  });

  test("brings back what went past an edge while the pointer is at that edge or on it, and sends it away after", async ({
    page,
  }) => {
    await openShell(page, "?lang=en");
    await seed(page);
    const rest = await places(page, [".sidebar", ".rail"]);
    await fill(page, "full");
    await expect(part(page, ".sidebar")).toBeHidden();

    // The left edge: the agent bar, and nothing else.
    await page.mouse.move(3, 300);
    await expect(part(page, ".sidebar")).toBeVisible();
    await expect.poll(() => places(page, [".sidebar"])).toEqual({ ".sidebar": rest[".sidebar"] });
    await expect(part(page, ".rail")).toBeHidden();
    await expect(part(page, ".modes")).toBeHidden();
    // Onto it: it stays for as long as the pointer does.
    await part(page, ".sidebar").hover();
    await page.waitForTimeout(700);
    await expect(part(page, ".sidebar")).toBeVisible();
    await page.mouse.move(700, 400);
    await expect(part(page, ".sidebar")).toBeHidden();

    // The right edge: the rail and the map's strip, the rail's Arrange actions keeping it in sight
    // while they are open.
    await page.mouse.move(1437, 400);
    await expect(part(page, ".rail")).toBeVisible();
    await expect(part(page, ".map-strip")).toBeVisible();
    await expect.poll(() => places(page, [".map-strip"])).toEqual({ ".map-strip": [1214, 836] });
    await page.locator('.rail [data-rail="tasks"]').click();
    await page.mouse.move(700, 400);
    await page.waitForTimeout(700);
    await expect(part(page, ".rail")).toBeVisible();
    // Closed with a press elsewhere, the rail goes.
    await page.mouse.click(700, 400);
    await expect(part(page, ".rail")).toBeHidden();
    // The keyboard's focus on one of its buttons keeps it too, until the focus moves on.
    await page.mouse.move(1437, 400);
    await expect(part(page, ".rail")).toBeVisible();
    await page.locator('.rail [data-rail="tasks"]').focus();
    await page.keyboard.press("ArrowDown");
    await page.mouse.move(700, 400);
    await page.waitForTimeout(700);
    await expect(part(page, ".rail")).toBeVisible();
    await page.locator('.rail [data-rail="tasks"]').blur();
    await expect(part(page, ".rail")).toBeHidden();

    // The top edge: the profile switcher, the desktops and Eris; the bottom: the talk pill.
    await page.mouse.move(700, 2);
    for (const selector of [".modes", ".desktops", ".eris"]) {
      await expect(part(page, selector)).toBeVisible();
    }
    await expect(part(page, ".composer")).toBeHidden();
    await page.mouse.move(700, 897);
    await expect(part(page, ".composer")).toBeVisible();
    await expect(part(page, ".modes")).toBeHidden();
  });

  test("is there or not, with nothing sliding, under reduced motion", async ({ page }) => {
    await openShell(page, "?lang=en&reduced=1");
    await seed(page);
    await fill(page, "full");
    const duration = await part(page, ".rail").evaluate(
      (el) => getComputedStyle(el).transitionDuration,
    );
    expect(duration.split(", ").every((d) => Number.parseFloat(d) === 0)).toBe(true);
    await expect(part(page, ".rail")).toBeHidden();
    await page.mouse.move(1437, 400);
    await expect(part(page, ".rail")).toBeVisible();
  });
});
