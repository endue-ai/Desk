// The plugin mounted for the connections file's tests (PG-15): the save and open dialogs answering
// fixed places, fs.write and fs.read over files in memory, and the feature dialogs answered by the
// test (undefined: cancelled), each model recorded.
import type { Connection } from "../ui/engines/common.js";
import { type Mounted, mount } from "./harness";

export interface Files {
  m: Mounted;
  files: Record<string, string>;
  /** The models each feature dialog was shown with, by type. */
  shown: Array<{ type: string; model: any }>;
  /** The store's connections, as kept. */
  stored(): Connection[];
}

type Options = NonNullable<Parameters<typeof mount>[0]>;

export async function mounted(
  options: Omit<Options, "dialog" | "handlers"> & {
    connections?: unknown[];
    files?: Record<string, string>;
    /** The path the open dialog answers (asked each time when a function); cancelled when absent. */
    open?: string | (() => string);
    answer?: (type: string, model: any) => unknown;
  } = {},
): Promise<Files> {
  const files: Record<string, string> = { ...options.files };
  const shown: Files["shown"] = [];
  const { connections, files: _files, open, answer, ...rest } = options;
  const m = await mount({
    ...rest,
    store: { connections: connections ?? [], ...options.store },
    handlers: {
      "dialog.save": ({ suggestedName }) => ({
        cancelled: false,
        path: `~/Transfer/${suggestedName}`,
      }),
      "dialog.open": () => {
        const path = typeof open === "function" ? open() : open;
        return path ? { cancelled: false, paths: [path] } : { cancelled: true, paths: [] };
      },
      "fs.write": ({ path, content }) => {
        files[path] = content;
        return { bytesWritten: content.length };
      },
      "fs.read": ({ path, length }) => {
        const text = files[path];
        if (text === undefined) throw new Error(`${path}: no such file`);
        const size = new TextEncoder().encode(text).length;
        return {
          content: length === undefined ? text : text.slice(0, length),
          encoding: "utf8",
          size,
        };
      },
    },
    dialog: (type, model) => {
      shown.push({ type, model: structuredClone(model) });
      return answer?.(type, model);
    },
  });
  return {
    m,
    files,
    shown,
    stored: () => (m.store.connections ?? []) as Connection[],
  };
}

/** Answer the export dialog with every ticked id, and the import dialog with every ticked row. */
export const tickAsShown = (type: string, model: any) =>
  type === "connectionsExport"
    ? { ids: model.ticked }
    : { ticked: model.rows.flatMap((r: { ticked: boolean }, i: number) => (r.ticked ? [i] : [])) };
