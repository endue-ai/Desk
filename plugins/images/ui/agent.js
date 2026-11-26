// Agent words for the image already held by this pane. The controller and view own the operations.

/** @typedef {import("./keep.js").ViewPlace} ViewPlace */

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginContext["commands"], "on">} commands
 * @param {{
 *   ready(): Promise<unknown> | undefined,
 *   state(): import("./images.js").ImagesState,
 *   exif(): { label: string, value: string }[],
 *   go: ReturnType<typeof import("./folder.js").createWalk>,
 *   compare(path: string | null, ask: boolean): Promise<unknown>,
 *   view: { place?(): ViewPlace | null, setZoom?(level: number | "fit"): void,
 *     turn?(degrees?: number, flip?: boolean): void },
 * }} parts
 */
export function installAgentCommands(commands, { ready, state, exif, go, compare, view }) {
  /**
   * @param {string} name
   * @param {(args: Record<string, unknown>, active: ReturnType<typeof state>) => unknown} run
   */
  const answer = (name, run) =>
    commands.on(`endue.images.${name}`, async (raw) => {
      await ready();
      const active = state();
      if (!active.image) throw new Error("No image is open in this pane.");
      const args = /** @type {Record<string, unknown>} */ (raw ?? {});
      return run(args, active);
    });

  answer("details", (_args, { image, position, partner }) => ({
    path: image?.path,
    name: image?.name,
    format: image?.format,
    width: image?.width ?? null,
    height: image?.height ?? null,
    exif: exif(),
    position,
    comparedWith: partner?.path ?? null,
    reason: image?.reason,
    ...view.place?.(),
  }));
  answer("zoom", ({ level }, { image }) => {
    if (image?.kind === "details" || !view.setZoom) throw new Error("This image cannot be zoomed.");
    if (level !== "fit" && (typeof level !== "number" || !Number.isFinite(level) || level <= 0))
      throw new Error('Give a positive zoom level or "fit".');
    view.setZoom(level);
    return view.place?.();
  });
  answer("turn", ({ rotate, flip }, { image }) => {
    if (image?.kind === "details" || !view.turn) throw new Error("This image cannot be turned.");
    if (
      (rotate === undefined && flip === undefined) ||
      (rotate !== undefined &&
        (typeof rotate !== "number" || !Number.isFinite(rotate) || rotate % 90 !== 0)) ||
      (flip !== undefined && typeof flip !== "boolean")
    )
      throw new Error("Give a rotation in quarter turns (degrees) or a flip state.");
    view.turn(rotate, flip);
    return view.place?.();
  });
  answer("step", ({ to }) => {
    switch (to) {
      case "next":
        return go((i) => i + 1);
      case "previous":
        return go((i) => i - 1);
      case "first":
        return go(() => 0);
      case "last":
        return go((_, count) => count - 1);
      default:
        throw new Error("Choose next, previous, first or last.");
    }
  });
  answer("compare", ({ path }) => {
    if (path === null) return compare(null, false);
    if (
      typeof path !== "string" ||
      !/^(?:~\/|\$\{home\}\/|\/(?!\/)|[A-Za-z]:\/).+/.test(path) ||
      /[\\*?\0]/.test(path) ||
      path.split("/").includes("..")
    )
      throw new Error("Give the exact path of the comparison image, or null to end it.");
    return compare(path, false);
  });
}
