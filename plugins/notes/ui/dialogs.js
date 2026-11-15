// Open… and Save as…: the OS's own dialogs (dialog.open, dialog.save). What the person chose is
// granted to notes alone, so notes then works on that file under a scope of the file itself.

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {ReturnType<typeof import("./grants.js").createGrants>} Grants
 * @typedef {{ path: string, name: string, text: string }} Shown
 */

const FILTERS = [
  { name: "Markdown", extensions: ["md"] },
  { name: "Text", extensions: ["txt"] },
];

/**
 * @param {Pick<PluginContext, "bridge" | "commands">} ctx
 * @param {Grants} grants
 * @param {{ answer(name: string, handler: (args: unknown) => unknown): unknown, shown(): Shown | undefined }} notes
 */
export function createDialogs({ bridge, commands }, grants, { answer, shown }) {
  answer("endue.notes.open", async () => {
    const { cancelled, paths } = await bridge.call("dialog.open", {
      title: "Open a note",
      filters: FILTERS,
    });
    if (cancelled) return;
    for (const path of paths) {
      grants.chose("fs:read", path);
      await commands.run("desk.files.open", { path });
    }
  });

  answer("endue.notes.save-as", async () => {
    const note = shown();
    if (!note) throw new Error("No note open to save.");
    const { cancelled, path } = await bridge.call("dialog.save", {
      title: "Save the note as",
      suggestedName: note.name,
      filters: FILTERS,
    });
    if (cancelled || !path) return;
    grants.chose("fs:write", path);
    grants.chose("fs:read", path);
    const content = note.text;
    await grants.withGrant("fs:write", path, (scope) =>
      bridge.call("fs.write", { path, content, encoding: "utf8", scope }),
    );
    await commands.run("desk.files.open", { path });
  });
}
