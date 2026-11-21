/** Dotted request, wait and return feedback for a real cloud conversation. */
import type { ShellCtx } from "../shell/context";
import { h } from "../shell/dom";

export function cloudTurns(
  shell: () => HTMLElement,
  ctx: ShellCtx,
): {
  say: ShellCtx["bridge"]["brain"]["say"];
  dispose(): void;
} {
  const signals = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  return {
    async say(text, onStep, desk) {
      const body = shell().querySelector<HTMLElement>(".eris-body");
      if (!body || ctx.store.get().brain.mode !== "cloud")
        return ctx.bridge.brain.say(text, onStep, desk);
      const signal = h("span", { class: "eris-signal", "aria-hidden": "true", "data-leg": "out" });
      const bounds = body.getBoundingClientRect();
      if (bounds.right + 60 > body.ownerDocument.documentElement.clientWidth && bounds.left > 60)
        signal.classList.add("is-left");
      body.append(signal);
      signals.set(
        signal,
        setTimeout(() => {
          signal.dataset.leg = "there";
        }, 320),
      );
      try {
        return await ctx.bridge.brain.say(text, onStep, desk);
      } finally {
        if (signals.has(signal)) {
          clearTimeout(signals.get(signal));
          signal.dataset.leg = "back";
          signals.set(
            signal,
            setTimeout(() => {
              signal.remove();
              signals.delete(signal);
            }, 320),
          );
        }
      }
    },
    dispose() {
      for (const [signal, timer] of signals) {
        clearTimeout(timer);
        signal.remove();
      }
      signals.clear();
    },
  };
}
