// The Edit menu as desk commands (ADR 0296): desk.edit.copy, .cut, .paste, .paste-and-match-style,
// .select-all, .undo and .redo. They have no keys of their own, so ⌘C and the rest still reach the
// page as typed (`edit_keys.rs`); a person who binds another key to one (desk.keys.bindings, Emacs's
// M-w, Ctrl+Insert…) gets the same edit wherever the keys are: the CEF shell runs it in the focused
// frame of the window with the keys (`compositor_edit_command`, `edit_command.rs`).
type Invoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;

/** What these need of the runtime's command registry. */
interface Define {
  define(
    id: string,
    spec: { title: string; keywords: string[]; owner: string; run: () => Promise<void> },
  ): () => void;
}

export const EDIT_COMMANDS = [
  { name: "copy", title: "Copy", keywords: ["copy", "clipboard", "복사"] },
  { name: "cut", title: "Cut", keywords: ["cut", "clipboard", "잘라내기"] },
  { name: "paste", title: "Paste", keywords: ["paste", "clipboard", "붙여넣기"] },
  {
    name: "paste-and-match-style",
    title: "Paste and match style",
    keywords: ["paste", "plain", "style", "붙여넣기"],
  },
  { name: "select-all", title: "Select all", keywords: ["select", "all", "전체 선택"] },
  { name: "undo", title: "Undo typing", keywords: ["undo", "되돌리기"] },
  { name: "redo", title: "Redo typing", keywords: ["redo", "다시 실행"] },
] as const;

export function installEditCommands(commands: Define, invoke: Invoke): () => void {
  const offs = EDIT_COMMANDS.map(({ name, title, keywords }) =>
    commands.define(`desk.edit.${name}`, {
      title,
      keywords: [...keywords],
      owner: "desk",
      run: async () => {
        await invoke("compositor_edit_command", { command: name });
      },
    }),
  );
  return () => {
    for (const off of offs) off();
  };
}
