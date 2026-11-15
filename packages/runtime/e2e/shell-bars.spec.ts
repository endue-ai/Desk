// The desk's floating bars share one shape (#291, #292): the agent bar, the account bar and the
// rail are 52 wide with a 16 radius, a 1px border and no shadow, 16 from the app's edge; a button
// in a bar is 36 square with a 10 radius and an avatar 34. The agent bar names an avatar in a
// tooltip of the page's own, beside it, on hover and on keyboard focus; the rail stands in three
// groups, and its Listen button is filled while the desk listens. The agent bar unfolds into a
// list of names where it stands, 256 wide, once the pointer has rested on it, and a pin keeps it
// so through a restart (issue 294).
import { expect, type Page, test } from "@playwright/test";
import type { SurfacePlacement } from "../src/modes/types";
import { DESK, openShell, step } from "./shell-helpers";

test.use({ viewport: DESK });

const MIRA = "ag_01JBZ8Q4MR0000000000000001";
/** The bar's waits on the desk's clock, as `src/shell/bar-unfold.ts` has them. */
const UNFOLD_MS = 300;
const FOLD_MS = 400;

/** A colour token as the engine computes it. */
const colourOf = (page: Page, token: string) =>
  page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  }, token);

/** Each element `selector` finds in the desk: its size and corner radius. */
const sizes = (page: Page, selector: string) =>
  page.evaluate(
    (sel) =>
      [...document.querySelectorAll<HTMLElement>(`#desk ${sel}`)].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          name: el.getAttribute("aria-label") ?? el.className,
          size: [r.width, r.height],
          radius: getComputedStyle(el).borderTopLeftRadius,
        };
      }),
    selector,
  );

/** Two agent programs found on this computer, so the agent bar holds all three of its groups. */
const findLocalAgents = (page: Page) =>
  page.evaluate(() => {
    const found = { vendor: "", sessions: 0, archived: 0, imported: 0, running: 0 };
    window.__shell.desk.store.set({
      localAgents: [
        { ...found, id: "claude", name: "Claude Code" },
        { ...found, id: "codex", name: "Codex" },
      ],
    });
  });

/** The agent bar's box as it is drawn. */
async function barBox(page: Page) {
  const box = await page.locator("#desk .sidebar").boundingBox();
  if (!box) throw new Error("no agent bar");
  return box;
}

/** Rest the pointer on the agent bar until it unfolds, and wait for its width to settle. */
async function restOnBar(page: Page) {
  await page.locator("#desk .sidebar").hover();
  await step(page, UNFOLD_MS);
  await expect(page.locator("#desk .sidebar")).toHaveClass(/is-unfolded/);
  await expect.poll(async () => (await barBox(page)).width).toBe(256);
}

test.beforeEach(async ({ page }) => {
  await openShell(page);
});

test("the agent bar, the account bar and the rail have one shape", async ({ page }) => {
  await findLocalAgents(page);
  const shapes = await page.evaluate(() =>
    [".sidebar", ".account-bar", ".rail"].map((selector) => {
      const el = document.querySelector<HTMLElement>(`#desk ${selector}`);
      if (!el) throw new Error(`no ${selector}`);
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        selector,
        left: r.left,
        right: window.innerWidth - r.right,
        bottom: window.innerHeight - r.bottom,
        shape: [r.width, style.borderRadius, style.borderWidth, style.borderStyle, style.boxShadow],
      };
    }),
  );
  for (const bar of shapes)
    expect(bar.shape, bar.selector).toEqual([52, "16px", "1px", "solid", "none"]);
  const [agents, account, rail] = shapes;
  expect(agents?.left).toBe(16);
  expect(account?.left).toBe(16);
  expect(account?.bottom).toBe(16);
  expect(rail?.right).toBe(16);

  // A button is 36 square with a 10 radius: the account bar's launcher (its other control is the
  // person's own avatar) and the rail's seven.
  // The agent bar's unfold control is out of sight until the keyboard's focus is on it.
  const avatars = ".avatar, .space, .account-profile";
  const buttons = await sizes(page, `.float-bar button:not(${avatars}, .bar-unfold)`);
  expect(buttons).toHaveLength(8);
  for (const button of buttons)
    expect([button.size, button.radius], button.name).toEqual([[36, 36], "10px"]);

  // An avatar is 34: round for an agent and the person, a 10 radius for a space or a program.
  const faces = await sizes(page, `.float-bar :is(${avatars})`);
  expect(faces).toHaveLength(8);
  for (const face of faces) expect(face.size, face.name).toEqual([34, 34]);
  const radii = async (selector: string) =>
    (await sizes(page, selector)).map((face) => Number.parseFloat(face.radius));
  for (const radius of await radii(".sidebar [data-agent], .account-profile"))
    expect(radius).toBeGreaterThanOrEqual(17);
  expect(await radii(".sidebar :is(.space, [data-local-agent])")).toEqual([10, 10, 10, 10]);

  // No caption; a 20 wide rule between the programs, the agents and the spaces.
  await expect(page.locator(".sidebar .rail-label")).toHaveCount(0);
  const rules = await sizes(page, ".sidebar .bar-divider");
  expect(rules.map((rule) => rule.size)).toEqual([
    [20, 1],
    [20, 1],
  ]);
});

test("the agent bar's tooltip stands to the right of the avatar it names", async ({ page }) => {
  const avatar = page.locator(`.sidebar [data-agent="${MIRA}"]`);
  const tip = page.locator("#agents-tooltip");
  await expect(tip).toBeHidden();

  const beside = async () => {
    const bar = await page.locator(".sidebar").boundingBox();
    const a = await avatar.boundingBox();
    const t = await tip.boundingBox();
    if (!bar || !a || !t) throw new Error("no box");
    expect(t.x).toBeGreaterThan(bar.x + bar.width);
    expect(Math.abs(t.y + t.height / 2 - (a.y + a.height / 2))).toBeLessThanOrEqual(1);
  };

  await avatar.hover();
  await expect(tip).toBeVisible();
  await expect(tip).toHaveRole("tooltip");
  // The name as the avatar says it, then what it works on and for how long.
  await expect(tip.locator(".tip-line")).toHaveText([
    "Mira · 일하는 중",
    /^Sort the inbox · \d+:\d\d$/,
  ]);
  await expect(tip).toHaveCSS("pointer-events", "none");
  await beside();
  await expect(avatar).not.toHaveAttribute("title");

  await page.mouse.move(720, 450);
  await expect(tip).toBeHidden();

  await avatar.focus();
  await expect(tip).toBeVisible();
  await beside();
  await page.keyboard.press("Tab");
  await expect(tip.locator(".tip-line")).toHaveText(["Theo"]);
  await avatar.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(tip).toBeHidden();
});

test("the agent bar unfolds where it stands, over the windows, and folds again", async ({
  page,
}) => {
  await findLocalAgents(page);
  // A window on the desktop, under where the list unfolds.
  await page.evaluate(async () => {
    const calendar: SurfacePlacement = {
      id: "calendar",
      plugin: "endue.shell",
      x: 140,
      y: 230,
      w: 420,
      h: 320,
      pinned: false,
    };
    await window.__shell.wm.desktop(1);
    await window.__shell.wm.session({
      1: {
        surfaces: [calendar],
        eris: null,
        rail: { visible: true },
        drawer: { visible: true },
      },
    });
  });
  const bar = page.locator("#desk .sidebar");
  const calendar = page.locator('[data-surface="calendar"]');
  await expect(calendar).toBeVisible();
  const window_ = await calendar.boundingBox();
  const folded = await barBox(page);
  expect([folded.x, folded.width]).toEqual([16, 52]);
  await expect(bar.locator(".bar-caption, .bar-row, .bar-pin")).toHaveCount(0);

  // The pointer rests on the bar: nothing before UNFOLD_MS on the desk's clock, then the list.
  await bar.hover();
  await step(page, UNFOLD_MS - 16);
  await expect(bar).not.toHaveClass(/is-unfolded/);
  await step(page, 16);
  await expect(bar).toHaveClass(/is-unfolded/);
  await expect.poll(async () => (await barBox(page)).width).toBe(256);
  // In the same place: its left edge still 16 from the app's, its middle where it was.
  const unfolded = await barBox(page);
  expect(unfolded.x).toBe(16);
  expect(Math.abs(unfolded.y + unfolded.height / 2 - (folded.y + folded.height / 2))).toBeLessThan(
    1,
  );

  // A caption per group, an agent's row 44 high and a space's 40, the pin at the top right.
  await expect(bar.locator(".bar-caption")).toHaveText(["이 컴퓨터", "에이전트", "스페이스"]);
  await expect(bar.locator(".bar-caption").first()).toBeVisible();
  const heights = (selector: string) =>
    bar
      .locator(selector)
      .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
  expect(await heights(".bar-row:is([data-local-agent], [data-agent])")).toEqual([
    44, 44, 44, 44, 44,
  ]);
  expect(await heights(".bar-row[data-space]")).toEqual([40, 40]);
  await expect(bar.locator(`.bar-row[data-agent="${MIRA}"] .bar-row-name`)).toHaveText("Mira");
  await expect(bar.locator(`.bar-row[data-agent="${MIRA}"] .bar-row-note`)).toHaveText(
    "Sort the inbox",
  );
  await expect(bar.locator(`.bar-row[data-agent="${MIRA}"] .bar-row-time`)).toHaveText(
    /^\d+:\d\d$/,
  );
  await expect(bar.locator('.bar-row[data-space] svg[data-icon="check"]')).toHaveCount(1);
  const pin = await bar.locator('[data-key="agents-pin"]').boundingBox();
  if (!pin) throw new Error("no pin");
  expect(pin.x + pin.width).toBeGreaterThan(unfolded.x + unfolded.width - 16);
  expect(pin.y).toBeLessThan(unfolded.y + 16);
  // A row says what the tooltip would: none shows.
  await bar.locator(`.bar-row[data-agent="${MIRA}"]`).hover();
  await expect(page.locator("#agents-tooltip")).toBeHidden();

  // Over the window, which keeps its box.
  const over = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest(".sidebar, .surface")?.className ?? "",
    [200, 300] as const,
  );
  expect(over).toContain("sidebar");
  expect(await calendar.boundingBox()).toEqual(window_);

  // The pointer away and the clock stepped: 52 wide again, the window where it was.
  await page.mouse.move(720, 450);
  await step(page, FOLD_MS - 16);
  await expect(bar).toHaveClass(/is-unfolded/);
  await step(page, 16);
  await expect(bar).not.toHaveClass(/is-unfolded/);
  await expect.poll(async () => (await barBox(page)).width).toBe(52);
  expect((await barBox(page)).x).toBe(16);
  expect(await calendar.boundingBox()).toEqual(window_);
});

test("pinned, the list stays and comes back after a restart", async ({ page }) => {
  await openShell(page, "?persist=1");
  await page.evaluate(() => localStorage.clear());
  await openShell(page, "?persist=1");
  const bar = page.locator("#desk .sidebar");
  const pin = bar.locator('[data-key="agents-pin"]');
  await restOnBar(page);
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  // Pinned, it stays with the pointer gone.
  await page.mouse.move(720, 450);
  await step(page, FOLD_MS * 2);
  await expect(bar).toHaveClass(/is-unfolded/);
  // desk.session saves 250 ms after a change.
  await page.waitForTimeout(400);

  await openShell(page, "?persist=1");
  await expect(bar).toHaveClass(/is-unfolded/);
  await expect.poll(async () => (await barBox(page)).width).toBe(256);
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await expect(bar.locator('[data-key="agents-unfold"]')).toHaveAttribute("aria-expanded", "true");

  // Let go and opened again, it is the bar at rest.
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await page.mouse.move(720, 450);
  await page.waitForTimeout(400);
  await openShell(page, "?persist=1");
  await expect(bar).not.toHaveClass(/is-unfolded/);
  expect((await barBox(page)).width).toBe(52);
  await page.evaluate(() => localStorage.clear());
});

test("under reduced motion it unfolds without animation", async ({ page }) => {
  await openShell(page, "?reduced=1");
  const bar = page.locator("#desk .sidebar");
  /** Every transition time in the bar and its parts. */
  const times = () =>
    bar.evaluate((el) => [
      ...new Set(
        [el, ...el.querySelectorAll("*")].flatMap((part) =>
          getComputedStyle(part).transitionDuration.split(", "),
        ),
      ),
    ]);
  expect(await times()).toEqual(["0s"]);
  await bar.hover();
  await step(page, UNFOLD_MS);
  await expect(bar).toHaveClass(/is-unfolded/);
  // At its width at once: there is no transition to wait for.
  expect((await barBox(page)).width).toBe(256);
  expect(await times()).toEqual(["0s"]);
  await page.mouse.move(720, 450);
  await step(page, FOLD_MS);
  await expect(bar).not.toHaveClass(/is-unfolded/);
  expect((await barBox(page)).width).toBe(52);
});

test("the rail's dividers part three groups, and listening fills its button", async ({ page }) => {
  const order = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("#desk .rail > *")].map(
      (part) => part.dataset.rail ?? part.getAttribute("role"),
    ),
  );
  expect(order).toEqual([
    "brain",
    "sees",
    "tasks",
    "separator",
    "desks",
    "vm",
    "listen",
    "separator",
    "arrange",
  ]);
  const rules = await sizes(page, ".rail .bar-divider");
  expect(rules.map((rule) => rule.size)).toEqual([
    [20, 1],
    [20, 1],
  ]);

  // The sample desk listens: its button is on, and no other is.
  const soft = await colourOf(page, "--desk-primary-soft");
  const listen = page.locator('.rail [data-rail="listen"]');
  await expect(listen).toHaveAttribute("aria-pressed", "true");
  await expect(listen).toHaveCSS("background-color", soft);
  await expect(page.locator(".rail .is-on")).toHaveCount(1);
  // A state dot keeps a 2px ring of the bar's colour, so it reads over the icon.
  const card = await colourOf(page, "--desk-card");
  const ring = await listen.locator(".rail-dot").evaluate((dot) => getComputedStyle(dot).boxShadow);
  expect(ring).toContain(`${card} 0px 0px 0px 2px`);

  await listen.click();
  await expect(listen).toHaveAttribute("aria-pressed", "false");
  await page.mouse.move(720, 450);
  await expect(listen).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator(".rail .is-on")).toHaveCount(0);
});
