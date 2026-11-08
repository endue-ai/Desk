// What a tool tells an agent of an interface: each element as one compact record (its reference for
// click, its role and words, its centre point), and the points and references an agent hands back.

/** The longest text of an element an agent reads. */
const TEXT = 120;

const cut = (/** @type {string | undefined} */ text) =>
  text && text.length > TEXT ? `${text.slice(0, TEXT - 1)}…` : text;

/**
 * Elements as an agent reads them: `ref` (pid and path) to click, role, label, centre, actions.
 * @param {Array<any>} elements
 * @param {number} pid
 */
export function outline(elements, pid) {
  return elements.map((e) => {
    const label = [e.title, e.description, e.value].find((t) => t?.trim());
    const at = e.frame
      ? {
          x: Math.round(e.frame.x + e.frame.width / 2),
          y: Math.round(e.frame.y + e.frame.height / 2),
        }
      : undefined;
    return {
      element: { pid, path: e.path, role: e.role },
      ...(label ? { label: cut(label) } : {}),
      ...(at ? { at } : {}),
      ...(e.enabled ? {} : { disabled: true }),
      ...(e.focused ? { focused: true } : {}),
      ...(e.actions?.length ? { actions: e.actions } : {}),
      ...(e.childCount ? { children: e.childCount } : {}),
    };
  });
}

/**
 * A point from an agent's args: both coordinates, as numbers.
 * @param {Record<string, unknown>} args
 */
export function point(args) {
  const x = Number(args.x);
  const y = Number(args.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Give x and y in screen points, or an element from look or find.");
  }
  return { x, y };
}

/**
 * An element reference an agent handed back, as computer.ax.perform takes it.
 * @param {unknown} raw
 */
export function refOf(raw) {
  const ref = /** @type {Record<string, unknown>} */ (raw && typeof raw === "object" ? raw : {});
  const pid = Number(ref.pid);
  const path = Array.isArray(ref.path) ? ref.path.map(Number) : null;
  if (!Number.isInteger(pid) || !path || path.some((i) => !Number.isInteger(i) || i < 0)) {
    throw new Error("element is { pid, path, role } as look or find gave it.");
  }
  return { pid, path, ...(typeof ref.role === "string" ? { role: ref.role } : {}) };
}
