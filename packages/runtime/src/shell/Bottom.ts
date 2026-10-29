/** The bottom edge, the person's place: drawer, the line you talk on, what is running, the drop zone. */
import { mountComposer } from "./Composer";
import type { ShellCtx } from "./context";
import { mountDrawer } from "./Drawer";
import { h, listen } from "./dom";
import { icon } from "./icons";
import { mountRunning } from "./Running";

export function mountBottom(root: HTMLElement, ctx: ShellCtx): () => void {
  const el = h("footer", { class: "bottom" });
  const drop = h(
    "div",
    { class: "drop-zone", hidden: true, "aria-hidden": "true" },
    icon("sparkle", 20),
    h("span", {}, ctx.tr("dropHere")),
  );
  root.append(el, drop);
  const parts = [mountDrawer(el, ctx), mountComposer(el, ctx), mountRunning(el, ctx)];
  const inBottomThird = (e: DragEvent) => e.clientY > (window.innerHeight * 2) / 3;
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  const offs = [
    listen(window, "dragover", (e) => {
      const d = e as DragEvent;
      if (!hasFiles(d)) return;
      d.preventDefault();
      drop.hidden = !inBottomThird(d);
      drop.classList.toggle("is-over", !drop.hidden);
    }),
    listen(window, "dragleave", (e) => {
      if ((e as DragEvent).relatedTarget === null) drop.hidden = true;
    }),
    listen(window, "drop", (e) => {
      const d = e as DragEvent;
      if (!hasFiles(d)) return;
      d.preventDefault();
      const wasShown = !drop.hidden;
      drop.hidden = true;
      if (!wasShown) return;
      const files = [...(d.dataTransfer?.files ?? [])];
      const now = ctx.now();
      ctx.store.set((s) => ({
        drawer: [
          ...files.map((f, i) => ({
            id: `file-${now}-${i}`,
            kind: "file" as const,
            name: f.name,
            at: now,
          })),
          ...s.drawer,
        ],
      }));
      ctx.eris.say(ctx.tr("received", { n: files.length }));
    }),
  ];
  return () => {
    for (const off of offs) off();
    for (const off of parts) off();
    el.remove();
    drop.remove();
  };
}
