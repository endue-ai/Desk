// The desk's floating bars share one shape (#291, #292): the agent bar, the account bar and the
// rail are 52 wide with a 16 radius, a 1px border and no shadow, 16 from the app's edge; a button
// in a bar is 36 square with a 10 radius and an avatar 34. The agent bar names an avatar in a
// tooltip of the page's own, beside it, on hover and on keyboard focus; the rail stands in three
// groups, and its Listen button is filled while the desk listens.
import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });

const MIRA = "ag_01JBZ8Q4MR0000000000000001";

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
  // person's own avatar) and the rail's seven. The agent bar's labelled places are not buttons of
  // that shape (below).
  const avatars = ".avatar, .space, .account-profile";
  const buttons = await sizes(page, `.float-bar button:not(${avatars}, .bar-labeled)`);
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

  // New agent ends the agents and New space the spaces: each the bar's inside wide, a dashed face
  // an avatar's size, round for an agent and with a button's corners for a space, over its name in
  // the muted ink (bar-new.ts).
  const places = await sizes(page, ".sidebar .bar-labeled");
  expect(places.map((place) => [place.name, place.size[0]])).toEqual([
    ["새 에이전트 만들기", 50],
    ["새 스페이스 만들기", 50],
  ]);
  const plus = await sizes(page, ".sidebar .bar-new .bar-face");
  expect(plus.map((face) => face.size)).toEqual([
    [34, 34],
    [34, 34],
  ]);
  expect(Number.parseFloat(plus[0]?.radius ?? "0")).toBeGreaterThanOrEqual(17);
  expect(plus[1]?.radius).toBe("10px");
  await expect(page.locator(".sidebar .bar-new .bar-face").first()).toHaveCSS(
    "border-style",
    "dashed",
  );
  await expect(page.locator(".sidebar .bar-new").first()).toHaveCSS(
    "color",
    await colourOf(page, "--desk-text-muted"),
  );

  // No caption under an avatar; a 20 wide rule between the programs, the agents and the spaces.
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
