import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell, step } from "./shell-helpers";

test.use({ viewport: DESK });

const id = (n: number) => `ag_01JBZ8Q4MR00000000000000${String(n).padStart(2, "0")}`;

test.beforeEach(async ({ page }) => {
  await openShell(page);
});

async function switchMode(page: Page, mode: string) {
  await page.hover(".mode-chip.is-current");
  await step(page, 400);
  await page.click(`[data-mode="${mode}"]`);
  await page.mouse.move(720, 600);
  await step(page, 400);
}

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

/** The ring around an agent's avatar: its computed box shadow, "none" without one. */
const ringOf = (page: Page, agent: string) =>
  page
    .locator(`.sidebar [data-agent="${agent}"]`)
    .evaluate((avatar) => getComputedStyle(avatar).boxShadow);

/** Top-left corners of the system layer's parts. */
const corners = (page: Page) =>
  page.evaluate(() =>
    [".modes", ".mode-chip.is-current", ".mode-add", ".desktops", ".sidebar"].map((sel) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return [sel, Math.round(r?.x ?? -1), Math.round(r?.y ?? -1)];
    }),
  );

test.describe("the system layer", () => {
  test("holds the mode switcher, desktops and agent bar, at the same place in every mode", async ({
    page,
  }) => {
    const system = page.locator('[data-layer="system"]');
    await expect(system.locator(".modes")).toBeVisible();
    await expect(system.locator(".desktops")).toBeVisible();
    await expect(system.locator(".sidebar")).toBeVisible();
    const before = await corners(page);
    for (const mode of ["deep-work", "review", "studio", "night", "morning"]) {
      await switchMode(page, mode);
      await expect(page.locator(".mode-chip.is-current")).toHaveAttribute("data-mode", mode);
      expect(await corners(page)).toEqual(before);
    }
  });

  test("a mode changes the layer below it, never the system layer: Night hides the rail", async ({
    page,
  }) => {
    await switchMode(page, "night");
    await expect(page.locator(".rail")).toBeHidden();
    await expect(page.locator(".drawer")).toBeVisible();
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(page.locator(".modes")).toBeVisible();
    await switchMode(page, "morning");
    await expect(page.locator(".rail")).toBeVisible();
  });

  test("sits above everything a mode lays out: Eris dragged onto the agent bar goes under it", async ({
    page,
  }) => {
    const bar = await page.locator(".sidebar").boundingBox();
    if (!bar) throw new Error("no agent bar");
    await page.evaluate((y) => {
      const { desk } = window.__shell;
      desk.store.set((s) => ({
        session: {
          ...s.session,
          1: {
            surfaces: [],
            eris: { x: 0, y },
            rail: { visible: true },
            drawer: { visible: true },
          },
        },
      }));
    }, Math.round(bar.y));
    await step(page, 16);
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest(".sidebar, .eris")?.className ?? "",
      [bar.x + bar.width / 2, bar.y + 40] as const,
    );
    expect(hit).toContain("sidebar");
  });
});

test.describe("the agent bar reads the agent directory", () => {
  test("lists the space's agents with their A2A presence", async ({ page }) => {
    const avatars = page.locator(".sidebar [data-agent]");
    await expect(avatars).toHaveCount(3);
    await expect(avatars.nth(0)).toHaveAttribute("data-agent", id(1));
    await expect(page.locator(`[data-agent="${id(1)}"]`)).toHaveAttribute(
      "data-presence",
      "working",
    );
    await expect(page.locator(`[data-agent="${id(1)}"]`)).toHaveAttribute(
      "aria-label",
      "Mira · 일하는 중",
    );
    await expect(page.locator(`[data-agent="${id(2)}"]`)).toHaveAttribute("data-presence", "idle");
    await expect(page.locator(`[data-agent="${id(3)}"]`)).toHaveAttribute(
      "data-presence",
      "waiting",
    );
    await expect(page.locator(`[data-agent="${id(3)}"]`)).toHaveAttribute(
      "aria-label",
      "Juno · 대기 중",
    );
    // The state is a ring of the avatar's own (#292): info while it works, warning while it
    // waits, none at rest; nothing is laid over the avatar.
    const card = await colourOf(page, "--desk-card");
    expect(await ringOf(page, id(1))).toBe(
      `${card} 0px 0px 0px 2px, ${await colourOf(page, "--desk-info")} 0px 0px 0px 3.5px`,
    );
    expect(await ringOf(page, id(3))).toBe(
      `${card} 0px 0px 0px 2px, ${await colourOf(page, "--desk-warning")} 0px 0px 0px 3.5px`,
    );
    expect(await ringOf(page, id(2))).toBe("none");
    await expect(page.locator(".avatar-dot")).toHaveCount(0);
    // The selected one has a 3 by 18 bar in the primary colour at the bar's inner left edge.
    const mark = (selector: string) =>
      page.evaluate((sel) => {
        const el = document.querySelector<HTMLElement>(`.sidebar ${sel}`);
        const bar = document.querySelector<HTMLElement>(".sidebar");
        if (!el || !bar) throw new Error(`no ${sel}`);
        const before = getComputedStyle(el, "::before");
        if (before.content === "none") return null;
        return {
          size: [before.width, before.height],
          colour: before.backgroundColor,
          fromBar:
            el.getBoundingClientRect().left +
            Number.parseFloat(before.left) -
            bar.getBoundingClientRect().left,
        };
      }, selector);
    const selected = {
      size: ["3px", "18px"],
      colour: await colourOf(page, "--desk-primary"),
      // Inside the bar's 1px border.
      fromBar: 1,
    };
    expect(await mark(`[data-agent="${id(1)}"]`)).toEqual(selected);
    expect(await mark('[data-space="sp_home"]')).toEqual(selected);
    expect(await mark(`[data-agent="${id(2)}"]`)).toBeNull();
    expect(await mark('[data-space="sp_studio"]')).toBeNull();
    await page.click('[data-space="sp_studio"]');
    await expect(avatars).toHaveCount(2);
    await expect(page.locator(`[data-agent="${id(4)}"]`)).toHaveAttribute(
      "data-presence",
      "working",
    );
    await expect(page.locator(`[data-agent="${id(5)}"]`)).toHaveAttribute("data-presence", "idle");
  });

  test("follows the directory: a new working A2A task lights the agent's ring", async ({
    page,
  }) => {
    await expect(page.locator(`[data-agent="${id(2)}"]`)).toHaveAttribute("data-presence", "idle");
    expect(await ringOf(page, id(2))).toBe("none");
    await page.evaluate(async () => {
      const { desk, bridge } = window.__shell;
      const task = bridge.fake.directory.tasks.find((t) => t.goal === "Tidy meeting notes");
      if (task) task.status = "working";
      await desk.refresh();
    });
    await expect(page.locator(`[data-agent="${id(2)}"]`)).toHaveAttribute(
      "data-presence",
      "working",
    );
    expect(await ringOf(page, id(2))).toContain(await colourOf(page, "--desk-info"));
    await expect(page.locator(".run-chip")).toHaveCount(3);
  });

  test("past six agents, the last place opens the rest", async ({ page }) => {
    await page.evaluate(async () => {
      const { desk, bridge } = window.__shell;
      const [first] = bridge.fake.directory.agents;
      if (!first) return;
      for (const [n, name] of ["Ada", "Bo", "Cy", "Dee", "Eve"].entries()) {
        const createdAt = "2026-09-01T09:00:00.000Z";
        const agent = {
          ...first.agent,
          id: `ag_extra_${n}`,
          name,
          slug: name.toLowerCase(),
          createdAt,
        };
        bridge.fake.directory.agents.push({ agent, spaceId: "sp_home" });
      }
      await desk.refresh();
    });
    await expect(page.locator(".sidebar [data-agent]")).toHaveCount(5);
    const more = page.locator(".avatar-more");
    await expect(more).toHaveText("+3");
    await expect(more).toHaveAttribute("aria-label", "에이전트 3명 더");
    await more.click();
    const list = page.getByRole("dialog", { name: "에이전트 3명 더" });
    const named = await list
      .locator("[data-agent]")
      .evaluateAll((items) => items.map((i) => i.getAttribute("data-agent")));
    expect(named).toEqual(["ag_extra_2", "ag_extra_3", "ag_extra_4"]);
    await list.locator('[data-agent="ag_extra_4"]').click();
    await expect(page.locator('[data-surface="agent:ag_extra_4"]')).toBeVisible();
  });

  test("a bar taller than its place scrolls, and draws no scrollbar", async ({ page }) => {
    // The shortest app: the bar's place is shorter than the bar.
    await page.setViewportSize({ width: 1100, height: 520 });
    const bar = page.locator(".sidebar");
    const seen = await bar.evaluate((el) => {
      const style = getComputedStyle(el);
      const borders =
        Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.borderRightWidth);
      return {
        fits: el.scrollHeight <= el.clientHeight,
        scrollbar: style.scrollbarWidth,
        gutter: (el as HTMLElement).offsetWidth - el.clientWidth - borders,
      };
    });
    expect(seen.fits).toBe(false);
    expect(seen.scrollbar).toBe("none");
    expect(seen.gutter).toBe(0);
    await bar.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    expect(await bar.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  });

  test("an agent's screen shows its A2A card and the tasks it is doing", async ({ page }) => {
    await page.click(`.sidebar [data-agent="${id(1)}"]`);
    const screen = page.locator(`[data-surface="agent:${id(1)}"]`);
    await expect(screen).toBeVisible();
    await expect(screen.locator(".surface-name")).toHaveText("Mira 의 화면");
    await expect(screen.locator(".agent-desc")).toHaveText(
      "Keeps the inbox and the calendar in order.",
    );
    await expect(screen.locator(".skill > span:first-child")).toHaveText([
      "Sort the inbox",
      "Plan the day",
    ]);
    await expect(screen.locator(".agent-caps .tag")).toHaveText(["동시에 2개", "스트리밍"]);
    await expect(screen.locator(".task-list .pop-row")).toHaveText(["Sort the inbox진행 중 · 62%"]);
  });

  test("says so when the directory cannot be read", async ({ page }) => {
    await page.evaluate(async () => {
      const { desk, bridge } = window.__shell;
      bridge.spaces.list = () => Promise.reject(new Error("offline"));
      await desk.refresh();
    });
    await expect(page.getByRole("img", { name: "에이전트 목록을 읽지 못했습니다" })).toBeVisible();
    await expect(page.locator(".sidebar [data-agent]")).toHaveCount(3);
  });
});
