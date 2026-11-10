// The window manager of a page without the compositor (#83): desk-wm as WebAssembly, which the
// fixture server and the dev page's serve at /desk-wm.wasm (e2e/vite.config.ts), on an app the
// window's size. Never shipped.
import { type LocalWindowManager, localWindowManager } from "../../src/wm/local";

export async function pageWindowManager(win: Window = window): Promise<LocalWindowManager> {
  const module = await WebAssembly.compileStreaming(win.fetch("/desk-wm.wasm"));
  const wm = localWindowManager(module, { w: win.innerWidth, h: win.innerHeight });
  win.addEventListener("resize", () => wm.resize(win.innerWidth, win.innerHeight));
  return wm;
}
