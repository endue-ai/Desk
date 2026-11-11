// "Validate with…": pick a JSON Schema for the file on screen with the palette (the .json files
// beside it, or any path typed), keep the choice for that file in the store (schemas.js pickedKey),
// and check the file against it.
import { CHECKED, folderOf, join, nameOf, pickedKey } from "./schemas.js";

/**
 * @typedef {import("./data.js").File} File
 * @typedef {import("./data.js").View} View
 */

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginContext, "bridge" | "commands">} ctx
 * @param {{ current(): File | undefined, view: View, say(text: string): void,
 *   check(file: File): Promise<void>, scopeOf(path: string): unknown }} hooks check: run the
 *   file's schema check and show it
 */
export function createValidateWith({ bridge, commands }, { current, view, say, check, scopeOf }) {
  return async () => {
    const file = current();
    if (!file) return say("Open a JSON, YAML or TOML file first.");
    if (!CHECKED.has(file.opened.format) || !file.opened.doc)
      return say(`${file.opened.label} files are not checked against a JSON Schema.`);
    const folder = folderOf(file.path);
    const listed = await bridge
      .call("fs.list", { path: folder, scope: /** @type {*} */ (scopeOf(file.path)) })
      .catch(() => ({ entries: [] }));
    const items = listed.entries
      .filter((e) => e.kind === "file" && /\.json$/i.test(e.name) && e.name !== file.name)
      .map((e) => ({ id: `${folder}/${e.name}`, label: e.name, detail: folder }));
    let picked;
    try {
      picked = await commands.run("desk.palette.pick", {
        title: `Validate ${file.name} with which JSON Schema?`,
        items,
        free: true,
        placeholder: "~/path/to/schema.json",
      });
    } catch (error) {
      if (codeOf(error) !== "cancelled") say("Cannot ask: the palette is off.");
      return;
    }
    if (typeof picked !== "string" || picked.trim() === "") return;
    const schema = join(folder, picked.trim());
    const value = { file: file.path, schema };
    await bridge.call("store.set", { key: pickedKey(file.path), value }).catch(() => {});
    view.schema(file.buffer, { state: "loading", how: "picked", source: schema, errors: [] });
    await check(file);
    const result = file.schema.state === "valid" ? "matches" : "was checked against";
    say(`${file.name} ${result} ${nameOf(schema)}.`);
  };
}
