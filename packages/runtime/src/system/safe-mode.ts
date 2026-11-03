/**
 * The safe-mode badge (ADR 0061): top centre of the system layer, so no mode can hide it, while this
 * start runs only the desk's own policies. "Start normally" runs desk.start.normally: the desk saves
 * the session and the host starts it again without safe mode.
 */
import type { ShellCtx } from "../shell/context";
import { h } from "../shell/dom";
import type { StartInfo } from "../start";

export function mountSafeBadge(
  layer: HTMLElement,
  ctx: ShellCtx,
  safe: StartInfo["safe"],
): () => void {
  if (!safe) return () => {};
  const badge = h(
    "div",
    { class: "safe-badge", role: "status", "data-key": "safe-mode", "data-reason": safe.reason },
    h("span", { class: "safe-badge-label" }, ctx.tr("safeMode")),
    h(
      "button",
      {
        class: "safe-badge-button",
        type: "button",
        "data-key": "start-normally",
        onClick: () => void ctx.runtime.commands.run("desk.start.normally").catch(() => {}),
      },
      ctx.tr("startNormally"),
    ),
  );
  layer.append(badge);
  return () => badge.remove();
}
