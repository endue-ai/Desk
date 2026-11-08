import type { Page } from "@playwright/test";

export const DESK = { width: 1440, height: 900 };

/** Open the shell fixture and wait until the saved desk is restored. */
export async function openShell(page: Page, query = ""): Promise<void> {
  await page.goto(`/shell.html${query}`);
  await page.waitForFunction(() => window.__shell !== undefined);
  await page.evaluate(() => window.__shell.desk.ready);
}

/** The theme studio lives in Settings > Appearance. */
export async function openThemes(page: Page): Promise<void> {
  await page.locator(".account-settings-button").click();
  const settings = page.locator(".desk-settings");
  await settings.locator('[data-key="settings-appearance"]').click();
  await settings.locator('[data-key="settings-themes"]').click();
}

/** Advance the manual clock by `ms` in 16 ms frames. */
export function step(page: Page, ms: number): Promise<void> {
  return page.evaluate((m) => window.__shell.step(m), ms);
}

/** Count elements filled with the primary lavender (thin progress lines excluded). */
export function primaryFills(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.background = "var(--desk-primary)";
    document.body.append(probe);
    const primary = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return [...document.querySelectorAll("#desk *")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 2 && r.width > 0 && getComputedStyle(el).backgroundColor === primary;
    }).length;
  });
}

/**
 * What of the desk's own a window's box lies under: the side bars, the rail and the arrange strip,
 * the profile switcher, the desktops, the bottom chrome and Eris. Empty when it keeps clear of all.
 */
export function barsOver(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`no ${sel}`);
    const w = el.getBoundingClientRect();
    const bars = document.querySelectorAll<HTMLElement>(
      ".float-bar, .modes-row, .desktops, .bottom > *, .eris",
    );
    return [...bars]
      .filter((bar) => {
        const b = bar.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) return false;
        return b.left < w.right && w.left < b.right && b.top < w.bottom && w.top < b.bottom;
      })
      .map((bar) => bar.className);
  }, selector);
}
