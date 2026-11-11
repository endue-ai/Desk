// A permission question always reaches the person (#161 findings 1, 2, 11; #162 findings 5, 6, 16;
// #158 finding 13). endue.permissions is a hidden overlay, not a window the person can close (ADR
// 0190): a perm.request shows its question in front of every window and bar, whole at the app's
// 1280x800, with the keys, so Escape refuses it and Tab and Enter answer it; a refusal is listed,
// and Allow there takes it back. The asking caller is `cli` on a desk socket connection of its own
// (a request waits for its answer, and one connection answers one line at a time); it asks for the
// network, which none of its grants (ADR 0030) covers.
import { $, browser, expect } from "@wdio/globals";
import { DeskSocket, socketPath } from "../perf/support/socket";
import { feed, inputState, keyPress, shellCommand } from "../support/compositor";
import { inFrame, press, shellReady } from "../support/desk";
import { HOME_VAR } from "../support/driver";
import { deskNow, run } from "../support/windows";

const PERMISSIONS = "endue.permissions";

interface Stats {
  surfaces: Record<string, { plugin: string; rect: number[] | null; pieces: number[][] }>;
}

type Answer = { granted: boolean; grant?: { duration: string }; reason?: string };

const network = (host: string) => ({ permission: "net:fetch", hosts: [host] });

/** Ask for `host` as `cli` on a connection of its own; the answer once the person gives it. */
async function ask(host: string): Promise<Answer> {
  const home = process.env[HOME_VAR];
  if (!home) throw new Error(`${HOME_VAR} is not set: run the spec through just test-app-e2e`);
  const socket = await DeskSocket.connect(socketPath(home));
  try {
    const params = { permission: network(host), reason: `To check ${host}` };
    return (await socket.call("perm.request", params)) as Answer;
  } finally {
    socket.close();
  }
}

/** The permissions overlay as the compositor places it. */
async function overlay(): Promise<{ host: string; rect: number[] | null; shown: boolean }> {
  const { surfaces } = await shellCommand<Stats>("compositor_stats");
  const [host, placed] =
    Object.entries(surfaces).find(([, s]) => s.plugin === PERMISSIONS) ?? ([] as never[]);
  if (!host || !placed) throw new Error(`${PERMISSIONS} has no surface`);
  return { host, rect: placed.rect, shown: placed.pieces.length > 0 };
}

const until = (what: string, check: () => Promise<boolean>) =>
  browser.waitUntil(check, { timeout: 15_000, timeoutMsg: what });

/** Every shown button of `panel` and the page's viewport, read in the overlay's page. */
const buttonsOf = (panel: string) =>
  inFrame(PERMISSIONS, () =>
    browser.execute((selector: string) => {
      const buttons = [...document.querySelectorAll<HTMLElement>(`${selector} button`)];
      return {
        viewport: [innerWidth, innerHeight],
        buttons: buttons
          .filter((b) => b.offsetParent !== null)
          .map((b) => {
            const r = b.getBoundingClientRect();
            return { text: b.textContent ?? "", rect: [r.left, r.top, r.right, r.bottom] };
          }),
        focused: document.activeElement?.textContent ?? "",
      };
    }, panel),
  );

describe("a permission question always reaches the person", () => {
  before(async () => {
    await shellReady();
    await feed([{ type: "windowFocused", focused: true }]);
  });

  it("is asked by an overlay that is no window, so no window close ends it", async () => {
    const { windows } = await deskNow();
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.map((w) => w.id)).not.toContain(PERMISSIONS);
    expect((await overlay()).shown).toBe(false);
  });

  it("comes in front, whole at 1280x800, with the keys; Escape refuses it", async () => {
    // The keys are elsewhere (the desk's page or a window) when the question comes.
    const before = (await inputState()).focused;
    const asked = ask("example.com");
    await until("the question never showed", async () => (await overlay()).shown);
    const { host, rect } = await overlay();
    expect(rect).toEqual([0, 0, 1280, 800]);
    const { viewport, buttons, focused } = await buttonsOf("#prompt");
    expect(viewport).toEqual([1280, 800]);
    expect(buttons.map((b) => b.text)).toEqual([
      "Allow once",
      "Allow this session",
      "Always allow",
      "Don't allow",
    ]);
    for (const { text, rect } of buttons) {
      const [left = -1, top = -1, right = 1281, bottom = 801] = rect;
      expect([text, left >= 0 && top >= 0 && right <= 1280 && bottom <= 800]).toEqual([text, true]);
    }
    expect(focused).toBe("Don't allow");
    expect(before).not.toBe(host);
    await until(
      "the question never took the keys",
      async () => (await inputState()).focused === host,
    );

    await feed(keyPress("Escape", "Escape"));
    expect(await asked).toMatchObject({ granted: false });
    await until("the overlay stayed up", async () => !(await overlay()).shown);
  });

  it("answers from the keys: Tab reaches Allow once, Enter presses it", async () => {
    const asked = ask("example.org");
    await until("the question never showed", async () => (await overlay()).shown);
    const { host } = await overlay();
    await until(
      "the question never took the keys",
      async () => (await inputState()).focused === host,
    );
    await feed(keyPress("Tab", "Tab"));
    expect((await buttonsOf("#prompt")).focused).toBe("Allow once");
    await feed(keyPress("Enter", "Enter", "\r"));
    expect(await asked).toMatchObject({ granted: true, grant: { duration: "once" } });
  });

  it("lists a refusal, and Allow there takes it back without a restart", async () => {
    // Refused in the first case: asked again, it is refused at once.
    expect(await ask("example.com")).toMatchObject({
      granted: false,
      reason: "refused-earlier",
    });
    await run("desk.plugins.open", { plugin: PERMISSIONS });
    await until("the list never showed", async () => (await overlay()).shown);
    await inFrame(PERMISSIONS, async () => {
      await expect($("#refused")).toBeDisplayed();
      await expect($("#refused-list")).toHaveText(expect.stringContaining("example.com"));
      await press("#refused-list button.allow");
      await expect($("#refused")).not.toBeDisplayed();
    });
    expect(await ask("example.com")).toMatchObject({ granted: true });
    const { host } = await overlay();
    await until("the list never took the keys", async () => (await inputState()).focused === host);
    await feed(keyPress("Escape", "Escape"));
    await until("Escape left the list up", async () => !(await overlay()).shown);
  });
});
