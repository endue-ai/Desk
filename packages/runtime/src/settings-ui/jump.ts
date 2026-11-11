/**
 * A row of links to a long list's groups (#158 finding 19): Settings › Keyboard's commands by who
 * provides them and Settings › Plugins by plugin. A link scrolls its group's heading to the top of
 * the pane and gives it the focus, so the keys go on from there.
 */
import { h } from "../shell/dom";

export interface JumpTarget {
  id: string;
  name: string;
}

/** The heading a jump link goes to: `id` names its group. */
export function jumpHeading(level: "h2" | "h3", id: string, name: string): HTMLElement {
  return h(level, { tabindex: "-1", "data-jump": id }, name);
}

/** Links to every group; null for fewer than two, where there is nowhere to jump. */
export function jumpIndex(
  label: string,
  targets: JumpTarget[],
  within: () => ParentNode,
): HTMLElement | null {
  if (targets.length < 2) return null;
  const go = (id: string) => {
    const heading = within().querySelector<HTMLElement>(`[data-jump="${CSS.escape(id)}"]`);
    if (!heading) return;
    heading.scrollIntoView({ block: "start" });
    heading.focus({ preventScroll: true });
  };
  return h(
    "nav",
    { class: "settings-jump", "aria-label": label },
    targets.map((target) =>
      h(
        "button",
        {
          type: "button",
          class: "btn btn-xs btn-outline",
          "data-key": `jump-${target.id}`,
          onClick: () => go(target.id),
        },
        target.name,
      ),
    ),
  );
}
