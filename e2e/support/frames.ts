// Keep the desk drawing while a gesture runs (#82). A desk whose window the OS does not show (a
// locked screen, a covered window) draws no frames, and Chromium hands a pointer move to the page
// at the next frame: chromedriver then waits seconds for each move it sends. While a gesture's
// actions run, this asks the desk's main page for a coarse screenshot again and again over its
// own DevTools connection (the address chromedriver attached to), and each one draws a frame. It
// reads nothing of the page's DOM: the specs learn the windows from desk.windows.list, and from
// the screen what a rect cannot say.
import { browser } from "@wdio/globals";

type Pending = Map<number, () => void>;

let open: Promise<{ ws: WebSocket; pending: Pending }> | undefined;
let next = 0;

/** The DevTools address chromedriver attached to (support/driver.ts sets it). */
function address(): string | undefined {
  const caps = browser.requestedCapabilities as {
    "goog:chromeOptions"?: { debuggerAddress?: string };
  };
  return caps["goog:chromeOptions"]?.debuggerAddress;
}

async function connect(at: string): Promise<{ ws: WebSocket; pending: Pending }> {
  const targets = (await (await fetch(`http://${at}/json`)).json()) as Array<{
    type: string;
    url: string;
    webSocketDebuggerUrl: string;
  }>;
  const main = targets.find((t) => t.type === "page" && t.url === "desk-app://app/index.html");
  if (!main) throw new Error("the desk's main page is not among its DevTools targets");
  const ws = new WebSocket(main.webSocketDebuggerUrl);
  const pending: Pending = new Map();
  ws.onmessage = (message) => {
    const id = (JSON.parse(String(message.data)) as { id?: number }).id;
    if (id !== undefined) pending.get(id)?.();
    if (id !== undefined) pending.delete(id);
  };
  const forget = () => {
    for (const done of pending.values()) done();
    open = undefined;
  };
  ws.onclose = forget;
  ws.onerror = forget;
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    setTimeout(() => reject(new Error("the desk's DevTools did not answer")), 5_000);
  });
  return { ws, pending };
}

/** One frame drawn: a coarse screenshot, or with `whole` a PNG of the page kept for the spec. */
async function frame(whole = false): Promise<Buffer | undefined> {
  const at = address();
  if (!at) return undefined;
  open ??= connect(at);
  const { ws, pending } = await open;
  const id = ++next;
  // Never a clip: a clipped capture changes the page's metrics while it runs, and a WebDriver
  // screenshot taken meanwhile would come out clipped too. A coarse JPEG is quick to make.
  const params = whole ? {} : { format: "jpeg", quality: 1, optimizeForSpeed: true };
  let png: Buffer | undefined;
  await new Promise<void>((resolve) => {
    pending.set(id, resolve);
    const listen = (message: MessageEvent) => {
      const answer = JSON.parse(String(message.data)) as {
        id?: number;
        result?: { data?: string };
      };
      if (answer.id !== id) return;
      ws.removeEventListener("message", listen);
      if (whole && answer.result?.data) png = Buffer.from(answer.result.data, "base64");
    };
    ws.addEventListener("message", listen);
    ws.send(JSON.stringify({ id, method: "Page.captureScreenshot", params }));
    setTimeout(resolve, 5_000);
  });
  return png;
}

/** Run `work` (WebDriver actions) while the desk draws a frame after another. */
export async function drawing<T>(work: () => Promise<T>): Promise<T> {
  return (await filming(work, false)).result;
}

/**
 * Run `work` while the desk draws, keeping every frame (`keep`): what the screen showed while a
 * gesture ran, in order, for a spec to find the states it went through.
 */
export async function filming<T>(
  work: () => Promise<T>,
  keep = true,
): Promise<{ result: T; frames: Buffer[] }> {
  let done = false;
  const frames: Buffer[] = [];
  const pump = (async () => {
    while (!done) {
      const png = await frame(keep).catch(() => undefined);
      if (png) frames.push(png);
      else if (!keep) await browser.pause(16);
      else await browser.pause(50);
    }
  })();
  try {
    return { result: await work(), frames };
  } finally {
    done = true;
    await pump;
  }
}
