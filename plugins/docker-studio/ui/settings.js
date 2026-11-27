// The studio's settings (the manifest's endue.docker-studio.*): read once, kept current as the
// person changes them in the desk's settings or on the Settings page, each value checked.

/** @typedef {{ path: string, stopTimeout: number, logTail: number, logMax: number, shell: string, confirm: boolean }} Settings */

export const KEYS = /** @type {const} */ ({
  path: "endue.docker-studio.path",
  stopTimeout: "endue.docker-studio.stop-timeout",
  logTail: "endue.docker-studio.log-tail",
  logMax: "endue.docker-studio.log-max",
  shell: "endue.docker-studio.shell",
  confirm: "endue.docker-studio.confirm",
});

/** @type {Settings} */
export const DEFAULTS = {
  path: "",
  stopTimeout: 10,
  logTail: 500,
  logMax: 5000,
  shell: "/bin/sh",
  confirm: true,
};

const int = (
  /** @type {unknown} */ v,
  /** @type {number} */ lo,
  /** @type {number} */ hi,
  /** @type {number} */ d,
) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : d);

/** A setting's value as the studio uses it, or the default when it is not one it accepts. */
export function settle(/** @type {keyof Settings} */ key, /** @type {unknown} */ v) {
  switch (key) {
    case "stopTimeout":
      return int(v, 0, 600, DEFAULTS.stopTimeout);
    case "logTail":
      return int(v, 0, 100_000, DEFAULTS.logTail);
    case "logMax":
      return int(v, 100, 100_000, DEFAULTS.logMax);
    case "confirm":
      return typeof v === "boolean" ? v : DEFAULTS.confirm;
    case "shell":
      return typeof v === "string" && /^[\w./-]+$/.test(v) ? v : DEFAULTS.shell;
    default:
      return typeof v === "string" && !v.includes("\0") ? v : DEFAULTS.path;
  }
}

/** Read every setting into `into`, and keep it current. @param {any} ctx @param {Settings} into @param {() => void} [changed] */
export async function loadSettings(ctx, into, changed = () => {}) {
  for (const [key, id] of Object.entries(KEYS)) {
    let value;
    try {
      value = await ctx.settings?.get?.(id);
    } catch {
      value = undefined;
    }
    /** @type {any} */ (into)[key] = settle(/** @type {keyof Settings} */ (key), value);
  }
  ctx.settings?.onChange?.((/** @type {any} */ e) => {
    const key = /** @type {keyof Settings | undefined} */ (
      Object.keys(KEYS).find((k) => KEYS[/** @type {keyof typeof KEYS} */ (k)] === e?.key)
    );
    if (!key) return;
    /** @type {any} */ (into)[key] = settle(key, e.value);
    changed();
  });
}
