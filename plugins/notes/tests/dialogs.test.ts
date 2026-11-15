import { expect, it } from "vitest";
import { disk, type Handlers, type Mounted, mount, note } from "./harness";

const FILTERS = [
  { name: "Markdown", extensions: ["md"] },
  { name: "Text", extensions: ["txt"] },
];
// The core answers paths under home as the desk's buffers spell them (`~/…`), so the file Notes then
// visits is the one the dialog granted, not its folder.
const CHOSEN = "~/Documents/plan.md";
const AWAY = "~/Desktop/copy.md";

const readOnly = (path: string) => ({ permission: "fs:read", paths: [path] });
const writeOnly = (path: string) => ({ permission: "fs:write", paths: [path] });

/** Notes over a disk whose desk opens a file by visiting it in Notes, and a person at the dialogs. */
async function notes(files: Record<string, string>, handlers: Handlers) {
  let m: Mounted | undefined;
  m = await mount({
    handlers: { ...disk(files), ...handlers },
    commands: {
      "desk.files.open": async (args) => {
        const { path } = args as { path: string };
        await m?.host.command("desk.files.visit", note(path));
        return note(path).buffer;
      },
    },
  });
  return m;
}

it("Open… asks dialog.open for Markdown and text and opens the chosen file", async () => {
  const files = { [CHOSEN]: "# Plan\n" };
  const m = await notes(files, {
    "dialog.open": () => ({ cancelled: false, paths: [CHOSEN] }),
  });
  await expect(m.host.command("endue.notes.open")).resolves.toBeUndefined();
  expect(m.params("dialog.open")).toEqual([{ title: "Open a note", filters: FILTERS }]);
  expect(m.ran("desk.files.open")).toEqual([{ path: CHOSEN }]);
  // The dialog granted the file itself, so Notes reads and follows it under that scope, not its folder's.
  expect(m.params("fs.read")).toEqual([
    { path: CHOSEN, encoding: "utf8", scope: readOnly(CHOSEN) },
  ]);
  expect(m.params("fs.watch")).toEqual([{ path: CHOSEN, scope: readOnly(CHOSEN) }]);
  expect(m.params("perm.request")).toEqual([]);
  expect(m.view.notes.at(-1)).toMatchObject({ path: CHOSEN, text: "# Plan\n" });
});

it("Save as… asks dialog.save with the note's name and writes the note there", async () => {
  const A = note("~/Notes/a.md");
  const files: Record<string, string> = { [A.path]: "# A\n" };
  const m = await notes(files, {
    "dialog.save": () => ({ cancelled: false, path: AWAY }),
  });
  await m.host.command("desk.files.visit", A);
  m.app.edit("# A\nedited\n");
  await m.settle();
  await expect(m.host.command("endue.notes.save-as")).resolves.toBeUndefined();
  expect(m.params("dialog.save")).toEqual([
    { title: "Save the note as", suggestedName: "a.md", filters: FILTERS },
  ]);
  expect(m.params("fs.write")).toEqual([
    { path: AWAY, content: "# A\nedited\n", encoding: "utf8", scope: writeOnly(AWAY) },
  ]);
  expect(files[AWAY]).toBe("# A\nedited\n");
  expect(files[A.path]).toBe("# A\n");
  // The saved copy opens in Notes, read under the dialog's grant of that file.
  expect(m.ran("desk.files.open")).toEqual([{ path: AWAY }]);
  expect(m.view.notes.at(-1)).toMatchObject({ path: AWAY, text: "# A\nedited\n", modified: false });
  expect(m.params("perm.request")).toEqual([]);

  // Edited and saved again (Mod+S): written under the dialog's grant of that file, with no ask.
  m.app.edit("# A\nedited again\n");
  await m.settle();
  await expect(m.host.command("desk.files.save", note(AWAY))).resolves.toBeUndefined();
  expect(m.params("fs.write").at(-1)).toEqual({
    path: AWAY,
    content: "# A\nedited again\n",
    encoding: "utf8",
    scope: writeOnly(AWAY),
  });
  expect(files[AWAY]).toBe("# A\nedited again\n");
  expect(m.params("perm.request")).toEqual([]);
});

it("a cancelled dialog leaves the note as it was", async () => {
  const A = note("~/Notes/a.md");
  const files: Record<string, string> = { [A.path]: "# A\n" };
  const m = await notes(files, {
    "dialog.open": () => ({ cancelled: true, paths: [] }),
    "dialog.save": () => ({ cancelled: true }),
  });
  await m.host.command("desk.files.visit", A);
  const before = m.view.notes.length;
  await expect(m.host.command("endue.notes.open")).resolves.toBeUndefined();
  await expect(m.host.command("endue.notes.save-as")).resolves.toBeUndefined();
  expect(m.ran("desk.files.open")).toEqual([]);
  expect(m.params("fs.write")).toEqual([]);
  expect(m.view.notes.length).toBe(before);
  expect(m.view.statuses.filter((s) => s !== "")).toEqual([]);
});

it("Save as… with no note open says so and asks nothing", async () => {
  const m = await notes({}, { "dialog.save": () => ({ cancelled: false, path: AWAY }) });
  await expect(m.host.command("endue.notes.save-as")).rejects.toThrow("No note open to save.");
  expect(m.params("dialog.save")).toEqual([]);
});
