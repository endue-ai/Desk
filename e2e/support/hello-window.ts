// examples/plugin-hello-window in the app e2e (#239, ADR 0226): the app that says how its window
// opens, read in its own page, which is the same page on the canvas and in an OS window of its own.
import { $, browser } from "@wdio/globals";
import { inFrame } from "./desk";
import { byId, type Desk, until, type Window } from "./windows";

export const APP = "example.hello-window";
/** The page its manifest asks for, and the smallest. */
export const PAGE = { w: 480, h: 360 };
export const LEAST = { w: 320, h: 240 };
/** A window on the canvas is its border (1 px a side) and title bar (40 px) larger than its page. */
export const framed = (page: { w: number; h: number }) => ({ w: page.w + 2, h: page.h + 42 });

/** The app's window as desk.windows.list names it, once `test` holds. */
export async function appWindow(test: (w: Window) => boolean, what: string): Promise<Window> {
  const desk: Desk = await until(
    (d) => {
      const w = byId(d, APP);
      return w !== undefined && test(w);
    },
    `${APP}: ${what}`,
    20_000,
  );
  return byId(desk, APP) as Window;
}

const text = (testid: string) => inFrame(APP, () => $(`[data-testid=${testid}]`).getText());

/** The size its page says it has. */
export const pageSize = () => text("size");
export const count = () => text("count");

/** Wait until its page says `size` (a move in or out loads the page again). */
export async function pageIs(size: { w: number; h: number }): Promise<void> {
  const want = `${size.w} × ${size.h}`;
  let last = "";
  await browser
    .waitUntil(
      async () => {
        last = await pageSize().catch((error) => String(error));
        return last === want;
      },
      { timeout: 20_000, interval: 250, timeoutMsg: `its page is not ${want}` },
    )
    .catch((error) => {
      throw new Error(`${String(error)}; it last said ${last}`);
    });
}

/** Press Count in its page `n` times, and wait for the count. */
export async function countTo(n: number): Promise<void> {
  for (let i = Number(await count()); i < n; i++)
    await inFrame(APP, () => browser.execute(() => document.querySelector("desk-button")?.click()));
  await browser.waitUntil(async () => (await count()) === String(n), {
    timeoutMsg: `its count never reached ${n}`,
  });
}
