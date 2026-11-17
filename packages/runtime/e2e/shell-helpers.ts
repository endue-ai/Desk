import type { Page } from "@playwright/test";

export const DESK = { width: 1440, height: 900 };

/** Open the shell fixture and wait until the saved desk is restored. */
export async function openShell(page: Page, query = ""): Promise<void> {
  await page.goto(`/shell.html${query}`);
  await page.waitForFunction(() => window.__shell !== undefined);
  await page.evaluate(() => window.__shell.desk.ready);
}

/**
 * Put a window in the drawer, the one in use when none is named: desk.windows.put-away, as the
 * palette runs it. No title bar's tool does (issue 280).
 */
export function putAway(page: Page, id?: string): Promise<unknown> {
  return page.evaluate(
    (window_) =>
      window.__shell.desk.runtime.commands.run(
        "desk.windows.put-away",
        window_ ? { window: window_ } : {},
      ),
    id,
  );
}

/** The theme studio lives in Settings > Appearance; Settings is a row of the avatar's menu. */
export async function openThemes(page: Page): Promise<void> {
  await page.locator(".account-profile").click();
  await page.locator('.account-popover [data-key="account-settings"]').click();
  const settings = page.locator(".desk-settings");
  await settings.locator('[data-key="settings-appearance"]').click();
  await settings.locator('[data-key="settings-themes"]').click();
}

/** Advance the manual clock by `ms` in 16 ms frames. */
export function step(page: Page, ms: number): Promise<void> {
  return page.evaluate((m) => window.__shell.step(m), ms);
}

/** Count the controls filled with the primary fill (thin progress lines excluded). */
export function primaryFills(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.background = "var(--desk-primary)";
    document.body.append(probe);
    const primary = getComputedStyle(probe).backgroundColor;
    probe.remove();
    // Filled controls only: the fill is ink, the text colour in Stone, so a dot or mark drawn in the
    // text colour (a desktop's map) shares its colour without being a filled button (ADR 0265).
    return [
      ...document.querySelectorAll("#desk button, #desk a[href], #desk [role='button']"),
    ].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 2 && r.width > 0 && getComputedStyle(el).backgroundColor === primary;
    }).length;
  });
}

/**
 * Which of the top chips (the profile switcher, the desktops) lie over a window's title or its
 * tools: none for a filled window, whose title bar keeps clear of them (surface/clearance.ts).
 */
export function chipsOverTitle(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const parts = [...document.querySelectorAll(`${sel} .surface-title > *`)].map((el) =>
      el.getBoundingClientRect(),
    );
    if (parts.length === 0) throw new Error(`no title in ${sel}`);
    const chips = [...document.querySelectorAll<HTMLElement>(".modes-row, .desktops")];
    return chips
      .filter((chip) => {
        const b = chip.getBoundingClientRect();
        return parts.some(
          (w) =>
            w.width > 0 &&
            b.left < w.right &&
            w.left < b.right &&
            b.top < w.bottom &&
            w.top < b.bottom,
        );
      })
      .map((chip) => chip.className);
  }, selector);
}
