/**
 * The rail's Listening button (Hey Eris). It says she listens only once the person allows the
 * microphone (issue 161, finding 11): a press asks first and the button stays off while the
 * question is open, and after a no; one question at a time. Turning it off asks nothing.
 */
import type { ShellCtx } from "../shell/context";

/** The desks whose microphone question is open now. */
const asking = new WeakSet<ShellCtx>();

export async function toggleListening(ctx: ShellCtx): Promise<void> {
  if (ctx.store.get().listening) {
    ctx.store.set({ listening: false });
    return;
  }
  if (asking.has(ctx)) return;
  asking.add(ctx);
  try {
    const granted = await ctx.bridge.perm.request("mic").catch(() => false);
    if (granted) ctx.store.set({ listening: true });
  } finally {
    asking.delete(ctx);
  }
}
