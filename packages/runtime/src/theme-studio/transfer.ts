/**
 * Themes in and out of the studio as `.desk-theme` files (TS-05): Import from a file or by dropping
 * one on the studio, Export the selected theme (built-in ones too). Both go through the core's
 * theme.* methods (`ThemeIo`), and are off until the runtime has them.
 */
import { h } from "../shell/dom";
import type { StudioCopy } from "./copy";
import type { ThemeIo } from "./editor";

export interface TransferDeps {
  io(): ThemeIo | undefined;
  selected(): string;
  tr(key: StudioCopy): string;
  /** A theme came in: select and preview it. */
  imported(id: string): void;
}

/** Read a dropped or picked file as a bundle and import it; says what happened in `note`. */
async function importFile(file: File, deps: TransferDeps, note: HTMLElement): Promise<void> {
  const io = deps.io();
  if (!io) return;
  try {
    const bundle = JSON.parse(await file.text()) as unknown;
    const id = await io.importBundle(bundle);
    note.textContent = `${deps.tr("imported")}: ${id}`;
    deps.imported(id);
  } catch (error) {
    note.textContent = `${deps.tr("failed")}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** The Import and Export controls; `note` is the line that reports them (kept across redraws). */
export function transferControls(deps: TransferDeps, note: HTMLElement): HTMLElement[] {
  const io = deps.io();
  const picker = h("input", {
    type: "file",
    accept: ".desk-theme,application/json",
    class: "sr-only",
    tabindex: "-1",
    "aria-hidden": "true",
    onChange: () => {
      const file = picker.files?.[0];
      picker.value = "";
      if (file) void importFile(file, deps, note);
    },
  });
  const importButton = h(
    "button",
    {
      type: "button",
      class: "btn btn-outline",
      "data-key": "import-theme",
      disabled: !io,
      onClick: () => picker.click(),
    },
    deps.tr("import"),
  );
  const exportButton = h(
    "button",
    {
      type: "button",
      class: "btn btn-outline",
      "data-key": "export-theme",
      disabled: !io || deps.selected() === "",
      onClick: async () => {
        const current = deps.io();
        if (!current) return;
        try {
          note.textContent = `${deps.tr("exported")}: ${await current.exportTheme(deps.selected())}`;
        } catch (error) {
          note.textContent = `${deps.tr("failed")}: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
    deps.tr("export"),
  );
  return [importButton, exportButton, picker];
}

/** Accept `.desk-theme` files dropped anywhere on `target`; returns a function that stops it. */
export function acceptDrops(
  target: HTMLElement,
  deps: TransferDeps,
  note: HTMLElement,
): () => void {
  const over = (event: DragEvent) => {
    if (!deps.io() || !event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const drop = (event: DragEvent) => {
    const file = [...(event.dataTransfer?.files ?? [])].find((f) => /\.desk-theme$/i.test(f.name));
    if (!file || !deps.io()) return;
    event.preventDefault();
    void importFile(file, deps, note);
  };
  target.addEventListener("dragover", over);
  target.addEventListener("drop", drop);
  return () => {
    target.removeEventListener("dragover", over);
    target.removeEventListener("drop", drop);
  };
}
