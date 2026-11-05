/**
 * The shell's own parts as the default providers of their roles (ADR 0104): its rail fills
 * `role:rail`, its agent bar `role:agents`, its bottom edge `role:dock`. A part is mounted once and
 * shown only while the `desk.roles` setting leaves its role to the shell; naming another provider
 * hides it at once (`data-role-yielded`, shell.css), and naming the shell (or nobody) again brings it
 * back where it was.
 */
import { chosenOf, ownsRole, ROLES_SETTING, type Role } from "../roles";

/** What a part's role needs of the desk: the setting and its changes. */
export interface RoleSettings {
  get<T = unknown>(key: string, fallback?: T): T;
  onChange(listener: (keys: string[]) => void): () => void;
}

/**
 * Mount a part into `root` and show the elements it added only while the shell holds `role`.
 * Returns the part's own off, after the setting's listener.
 */
export function byRole(
  root: HTMLElement,
  role: Role,
  settings: RoleSettings,
  mount: (root: HTMLElement) => () => void,
): () => void {
  const before = new Set(Array.from(root.children));
  const off = mount(root);
  const added = Array.from(root.children).filter((child) => !before.has(child)) as HTMLElement[];
  // An attribute, not `hidden`: the part shows and hides its own pieces (a tooltip) as it did.
  const apply = () => {
    const owned = ownsRole(role, chosenOf(settings.get(ROLES_SETTING)));
    for (const el of added) el.toggleAttribute("data-role-yielded", !owned);
  };
  apply();
  const stop = settings.onChange((keys) => {
    if (keys.includes(ROLES_SETTING)) apply();
  });
  return () => {
    stop();
    off();
  };
}
