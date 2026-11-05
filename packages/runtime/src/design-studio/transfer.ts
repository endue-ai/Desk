/**
 * Design systems in and out of the studio as `.desk-design` files (DS-04): Import from a file or by
 * dropping one on the studio, Export the selected one, Remove the person's own or a market one. All go
 * through the core's theme.* methods (ADR 0091).
 */
import type { RuntimeDesigns } from "../policies/design";
import { h } from "../shell/dom";
import type { DesignCopy } from "./copy";

export interface DesignTransferDeps {
  designs: RuntimeDesigns;
  selected(): string;
  tr(key: DesignCopy): string;
  /** A design system came in or went: select it (or the endue one). */
  changed(id: string): void;
}

const said = (deps: DesignTransferDeps, note: HTMLElement, error: unknown) => {
  note.textContent = `${deps.tr("failed")}: ${error instanceof Error ? error.message : String(error)}`;
};

async function importFile(file: File, deps: DesignTransferDeps, note: HTMLElement): Promise<void> {
  try {
    const id = await deps.designs.io().importBundle(JSON.parse(await file.text()) as unknown);
    note.textContent = `${deps.tr("imported")}: ${id}`;
    deps.changed(id);
  } catch (error) {
    said(deps, note, error);
  }
}

/** The Import, Export and Remove controls; `note` reports them (kept across redraws). */
export function designTransfer(deps: DesignTransferDeps, note: HTMLElement): HTMLElement[] {
  const selected = deps.selected();
  const user = /^(local|market)\./.test(selected);
  const picker = h("input", {
    type: "file",
    accept: ".desk-design,application/json",
    class: "sr-only",
    tabindex: "-1",
    "aria-hidden": "true",
    onChange: () => {
      const file = picker.files?.[0];
      picker.value = "";
      if (file) void importFile(file, deps, note);
    },
  });
  const button = (key: DesignCopy, disabled: boolean, onClick: () => void) =>
    h(
      "button",
      { type: "button", class: "btn btn-outline", "data-key": `design-${key}`, disabled, onClick },
      deps.tr(key),
    );
  return [
    button("import", false, () => picker.click()),
    button("export", selected === "", async () => {
      try {
        note.textContent = `${deps.tr("exported")}: ${await deps.designs.io().exportDesign(selected)}`;
      } catch (error) {
        said(deps, note, error);
      }
    }),
    button("remove", !user, async () => {
      try {
        if (deps.designs.active() === selected) deps.designs.apply("");
        await deps.designs.io().remove(selected);
        note.textContent = `${deps.tr("removed")}: ${selected}`;
        deps.changed("");
      } catch (error) {
        said(deps, note, error);
      }
    }),
    picker,
  ];
}

/** Accept `.desk-design` files dropped anywhere on `target`; returns a function that stops it. */
export function acceptDesignDrops(
  target: HTMLElement,
  deps: DesignTransferDeps,
  note: HTMLElement,
): () => void {
  const over = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const drop = (event: DragEvent) => {
    const file = [...(event.dataTransfer?.files ?? [])].find((f) => /\.desk-design$/i.test(f.name));
    if (!file) return;
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
