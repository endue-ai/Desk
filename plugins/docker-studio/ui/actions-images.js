// What changes images: remove (asked first, the containers that use one named), remove every unused
// one, pull and push with their progress, tag, and run a container from the Run form.

import { h } from "./dom.js";
import { bytes } from "./format.js";
import { progressLine } from "./images.js";
import { imageName, imageUse } from "./model.js";
import { imageRef } from "./refs.js";

/** @typedef {import("./studio.js").App} App @typedef {import("./parse.js").Image} Image */

/** @param {App} app */
export function createImageActions(app) {
  const say = (/** @type {unknown} */ error) =>
    app.toast(String(/** @type {any} */ (error)?.message ?? error), "danger");

  /** Remove images; one used by a container (even a stopped one) is said, not forced. */
  const removeImages = async (/** @type {Image[]} */ list) => {
    if (list.length === 0) return false;
    const use = imageUse(app.store.state.containers);
    const used = list.filter((i) => (use.get(i.id) ?? 0) > 0);
    const total = list.reduce((s, i) => s + i.size, 0);
    if (app.settings.confirm) {
      const yes = await app.overlay.confirm({
        title:
          list.length === 1
            ? `Remove ${imageName(/** @type {Image} */ (list[0]))}?`
            : `Remove ${list.length} images?`,
        text: `${bytes(total)} of disk come back.${used.length ? ` ${used.length === list.length ? "Containers use them" : `Containers use ${used.length} of them`}: remove those containers first, or docker refuses.` : ""}`,
        ok: "Remove",
        danger: true,
      });
      if (!yes) return false;
    }
    let failed = 0;
    for (const image of list) {
      const refs = image.refs.length ? image.refs : [image.id];
      try {
        await app.docker(["image", "rm", "--", ...refs.map((r) => imageRef(r))]);
      } catch (error) {
        failed += 1;
        say(error);
      }
    }
    void app.engine.load("images");
    void app.engine.load("disk");
    if (!failed)
      app.toast(
        list.length === 1
          ? `Removed ${imageName(/** @type {Image} */ (list[0]))}.`
          : `Removed ${list.length} images.`,
        "success",
      );
    return failed === 0;
  };

  /** Remove every image no container uses, after showing which. */
  const pruneImages = async () => {
    const use = imageUse(app.store.state.containers);
    const unused = app.store.state.images.filter((i) => !(use.get(i.id) ?? 0));
    if (unused.length === 0) return app.toast("Every image is in use.", "info");
    const yes = await app.overlay.confirm({
      title: `Remove ${unused.length} unused images?`,
      text: `No container uses them; ${bytes(unused.reduce((s, i) => s + i.size, 0))} of disk come back. Pull or build them again when you need them.`,
      ok: "Remove unused",
      danger: true,
      detail: h(
        "ul.confirm-list",
        null,
        unused
          .slice(0, 12)
          .map((i) =>
            h("li", null, h("span", null, imageName(i)), h("small", null, bytes(i.size))),
          ),
        unused.length > 12 ? h("li.muted", null, `and ${unused.length - 12} more`) : null,
      ),
    });
    if (!yes) return;
    try {
      const { stdout } = await app.docker(["image", "prune", "--all", "--force"], { timeoutMs: 0 });
      const freed = /Total reclaimed space:\s*(.+)/.exec(stdout)?.[1] ?? "";
      app.toast(`Removed the unused images${freed ? `: ${freed} came back` : ""}.`, "success");
    } catch (error) {
      say(error);
    } finally {
      void app.engine.load("images");
      void app.engine.load("disk");
    }
  };

  /**
   * Pull or push with its progress; resolves true when docker finished.
   * @param {"pull" | "push"} verb @param {string} ref
   * @param {(layers: Map<string, import("./images.js").LayerProgress>, said: string) => void} onProgress
   */
  const transfer = async (verb, ref, onProgress) => {
    /** @type {Map<string, import("./images.js").LayerProgress>} */
    const layers = new Map();
    try {
      await app.docker(["image", verb, "--", imageRef(ref)], {
        timeoutMs: 0,
        onLine: (_stream, line) => {
          const said = progressLine(layers, line);
          onProgress(layers, said);
        },
      });
      void app.engine.load("images");
      return true;
    } catch (error) {
      say(error);
      return false;
    }
  };

  const tag = async (/** @type {Image} */ image, /** @type {string} */ target) => {
    try {
      await app.docker(["image", "tag", "--", image.id, imageRef(target)]);
      app.toast(`Tagged ${imageName(image)} as ${target}.`, "success");
      void app.engine.load("images");
      return true;
    } catch (error) {
      say(error);
      return false;
    }
  };

  /** Run a container from checked args; opens its page when it starts. */
  const run = async (/** @type {string[]} */ args, /** @type {string} */ label) => {
    try {
      const { stdout } = await app.docker(args, { timeoutMs: 0 });
      const id = stdout.trim().split("\n").at(-1) ?? "";
      app.toast(`Started ${label}.`, "success");
      await app.engine.load("containers");
      if (/^[0-9a-f]{12,64}$/.test(id)) app.open({ kind: "container", id });
      return true;
    } catch (error) {
      say(error);
      return false;
    }
  };

  return { removeImages, pruneImages, transfer, tag, run };
}
