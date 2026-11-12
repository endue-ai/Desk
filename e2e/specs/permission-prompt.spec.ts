// A permission question always reaches the person (#161 findings 1, 2, 11; #162 findings 5, 6, 16;
// #158 finding 13). endue.permissions is a hidden overlay, not a window the person can close (ADR
// 0190): a perm.request shows its question in front of every window and bar, whole at the app's
// 1280x800, with the keys, so Escape refuses it and Tab and Enter answer it; a refusal is listed,
// and Allow there takes it back. The asking caller is `cli` on a desk socket connection of its own
// (a request waits for its answer, and one connection answers one line at a time); it asks for the
// network, which none of its grants (ADR 0030) covers.
//
// Every card answers, the first or the seventh: a press on its button, Escape, Tab and Enter,
// with a window's edge under its buttons (a press there went to the page alone, which gave the keys
// to the window in use), after the palette opened and closed, over the palette (which has the keys
// again once it is answered), two at once, and one right after the last one hid.
import { $, browser, expect } from "@wdio/globals";
import { DeskSocket, socketPath } from "../perf/support/socket";
import { click, feed, inputState, keyPress, shellCommand } from "../support/compositor";
import { inFrame, press, shellReady } from "../support/desk";
import { HOME_VAR } from "../support/driver";
import { drag, titleAt } from "../support/gestures";
import { deskNow, inUse, rectOf, run, windowUntil } from "../support/windows";

const PERMISSIONS = "endue.permissions";
const PALETTE = "main.desk-palette";
const MOD = process.platform === "darwin" ? { meta: true } : { ctrl: true };

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

/** A chord through the compositor: `mods` held around one key. */
const chord = (mods: Record<string, boolean>, key: string, code: string, text?: string) =>
  feed([{ type: "modifiers", ...mods }, ...keyPress(key, code, text), { type: "modifiers" }]);

const focused = async () => (await inputState()).focused;

/** What the card in front asks for and what it says waits behind it, as its page shows them. */
const asking = () =>
  inFrame(PERMISSIONS, () =>
    browser.execute(() => {
      const prompt = document.querySelector<HTMLElement>("#prompt");
      const text = (id: string) => document.getElementById(id)?.textContent ?? "";
      return prompt?.hidden === false ? `${text("prompt-what")} ${text("prompt-waiting")}` : "";
    }),
  );

/** Ask for `host` and wait for its card in front with the keys; the answer the person gives. */
async function card(host: string): Promise<{ answer: Promise<Answer> }> {
  const answer = ask(host);
  await until(`${host}: its card never showed`, async () => (await asking()).includes(host));
  await until(`${host}: its card is not drawn`, async () => (await overlay()).shown);
  const { host: surface } = await overlay();
  await until(`${host}: its card never had the keys`, async () => (await focused()) === surface);
  return { answer };
}

/** `answer`, or a failure saying `what` when none comes: a card that heard nothing waits for ever. */
async function within<T>(answer: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error(what)), 10_000);
  });
  try {
    return await Promise.race([answer, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The middle of the card's `text` button. */
async function middleOf(text: string): Promise<[number, number]> {
  const found = (await buttonsOf("#prompt")).buttons.find((b) => b.text === text);
  const [left = 0, top = 0, right = 0, bottom = 0] = found?.rect ?? [];
  if (!found) throw new Error(`the card has no ${text} button`);
  return [(left + right) / 2, (top + bottom) / 2];
}

/** Whether `at` is on window `w`'s left grip: 6 px inside its 1 px border, clear of its corners. */
const onLeftGrip = (w: { x: number; y: number; h: number }, [x, y]: [number, number]) =>
  x >= w.x + 1 && x < w.x + 7 && y >= w.y + 17 && y < w.y + w.h - 17;

describe("every card answers, the first or the seventh, by pointer and by keys", () => {
  /** The window whose left edge runs under the card's buttons. */
  let edge = { id: "", x: 0, y: 0, h: 0 };

  /** Press the card's `text` button where the window's left grip lies under it. */
  async function pressOverEdge(text: string): Promise<void> {
    const [, y] = await middleOf(text);
    const at: [number, number] = [edge.x + 4, y];
    expect([text, onLeftGrip(edge, at)]).toEqual([text, true]);
    await click(at);
  }

  it("a window's edge runs under the card's buttons", async () => {
    // A first card says where its buttons are; Escape refuses it.
    const { answer: first } = await card("one.example");
    const [x, top] = await middleOf("Allow once");
    const [, bottom] = await middleOf("Don't allow");
    await feed(keyPress("Escape", "Escape"));
    expect(await within(first, "Escape never answered")).toMatchObject({ granted: false });
    await until("the overlay stayed up", async () => !(await overlay()).shown);
    // The window in use, dragged by its title until its left edge runs under both buttons.
    const w = inUse(await deskNow());
    if (!w) throw new Error("no window in use");
    const from = titleAt(rectOf(w));
    const [dx, dy] = [x - 4 - w.x, (top + bottom) / 2 - w.h / 2 - w.y];
    await drag(from, { x: from.x + dx, y: from.y + dy });
    const moved = await windowUntil(w.id, (n) => Math.abs(n.x - (x - 4)) < 2, "dragged there");
    edge = { id: moved.id, x: moved.x, y: moved.y, h: moved.h };
  });

  it("a press on a button over the window's edge answers the card", async () => {
    const { answer } = await card("two.example");
    await pressOverEdge("Allow once");
    expect(await within(answer, "the press never reached the card")).toMatchObject({
      granted: true,
      grant: { duration: "once" },
    });
    await until("the overlay stayed up", async () => !(await overlay()).shown);
  });

  it("after the palette opened and closed, Tab and Enter answer the next card", async () => {
    await chord(MOD, "k", "KeyK", "k");
    await until("the palette never had the keys", async () => (await focused()) === PALETTE);
    await feed(keyPress("Escape", "Escape"));
    await until("the palette kept the keys", async () => (await focused()) !== PALETTE);
    const { answer } = await card("three.example");
    await feed(keyPress("Tab", "Tab"));
    expect((await buttonsOf("#prompt")).focused).toBe("Allow once");
    await feed(keyPress("Enter", "Enter", "\r"));
    expect(await within(answer, "Enter never answered")).toMatchObject({ granted: true });
  });

  it("a card over the palette is in front with the keys; answered, the palette has them", async () => {
    await chord(MOD, "k", "KeyK", "k");
    await until("the palette never had the keys", async () => (await focused()) === PALETTE);
    const { answer } = await card("four.example");
    await pressOverEdge("Don't allow");
    expect(await within(answer, "the press never reached the card")).toMatchObject({
      granted: false,
    });
    await until("the palette never had the keys again", async () => (await focused()) === PALETTE);
    await feed(keyPress("Escape", "Escape"));
    await until("Escape never closed the palette", async () => (await focused()) !== PALETTE);
  });

  it("two cards at once, then one right after the last one hid", async () => {
    const { answer: fifth } = await card("five.example");
    const sixth = ask("six.example");
    await until("the sixth never waited", async () => (await asking()).includes("1 more"));
    await pressOverEdge("Allow once");
    expect(await within(fifth, "the press never reached the card")).toMatchObject({
      granted: true,
    });
    // The sixth comes up while the overlay is: it has the keys, and Escape refuses it.
    await until("the sixth never showed", async () => (await asking()).includes("six.example"));
    const { host } = await overlay();
    await until("the sixth never had the keys", async () => (await focused()) === host);
    await feed(keyPress("Escape", "Escape"));
    expect(await within(sixth, "Escape never answered")).toMatchObject({ granted: false });
    const { answer: seventh } = await card("seven.example");
    await pressOverEdge("Don't allow");
    expect(await within(seventh, "the press never reached the card")).toMatchObject({
      granted: false,
    });
    await until("the overlay stayed up", async () => !(await overlay()).shown);
    // Answered, the keys are with the window in use again.
    await until("the keys stayed with the answered card", async () => (await focused()) !== host);
    expect(inUse(await deskNow())?.id).toBe(edge.id);
  });
});
