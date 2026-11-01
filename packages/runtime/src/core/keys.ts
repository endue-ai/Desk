/** Default keymap owned by the runtime, before plugin and personal bindings. */
import type { KeyBinding } from "@endue-ai/bridge";

export const DEFAULT_KEYS: Array<KeyBinding & { owner: string }> = [
  {
    key: "Mod+K",
    command: "desk.palette.open",
    owner: "desk",
  },
  {
    key: "Mod+Shift+P",
    command: "desk.palette.open",
    owner: "desk",
  },
  {
    key: "Escape",
    command: "desk.keys.quit",
    owner: "desk",
  },
  {
    key: "Mod+/",
    command: "desk.settings.keyboard",
    owner: "desk",
  },
  {
    key: "Mod+B",
    command: "desk.buffers.switch",
    owner: "desk",
  },
  {
    key: "Mod+W",
    command: "desk.buffers.close",
    owner: "desk",
  },
  {
    key: "Mod+Alt+ArrowRight",
    command: "desk.buffers.next",
    owner: "desk",
  },
  {
    key: "Mod+Alt+ArrowLeft",
    command: "desk.buffers.previous",
    owner: "desk",
  },
  {
    key: "Control+Tab",
    command: "desk.display.focus-next",
    owner: "desk",
  },
  {
    key: "Control+Shift+Tab",
    command: "desk.display.focus-previous",
    owner: "desk",
  },
  {
    key: "Mod+O",
    command: "desk.files.open",
    owner: "desk",
  },
  {
    key: "Mod+S",
    command: "desk.files.save",
    owner: "desk",
  },
  {
    key: "Mod+Shift+O",
    command: "desk.files.recent",
    owner: "desk",
  },
  {
    key: "Mod+Shift+L",
    command: "desk.theme.toggle",
    owner: "desk",
  },
  {
    key: "Mod+Shift+N",
    command: "desk.notify.history",
    owner: "desk",
  },
  {
    key: "Mod+Shift+D",
    command: "desk.notify.dnd",
    owner: "desk",
  },
  {
    key: "Mod+Shift+M",
    command: "desk.profiles.switch",
    owner: "desk",
  },
  {
    key: "Mod+N",
    command: "desk.display.new-surface",
    owner: "desk",
  },
  {
    key: "Mod+D",
    command: "desk.display.split-right",
    owner: "desk",
  },
  {
    key: "Mod+Alt+D",
    command: "desk.display.split-down",
    owner: "desk",
  },
  {
    key: "Mod+]",
    command: "desk.display.focus-next",
    owner: "desk",
  },
  {
    key: "Mod+[",
    command: "desk.display.focus-previous",
    owner: "desk",
  },
  {
    key: "Control+1",
    command: "desk.shell.desktop-1",
    owner: "desk",
  },
  {
    key: "Control+2",
    command: "desk.shell.desktop-2",
    owner: "desk",
  },
  {
    key: "Control+3",
    command: "desk.shell.desktop-3",
    owner: "desk",
  },
  {
    key: "Control+4",
    command: "desk.shell.desktop-4",
    owner: "desk",
  },
  {
    key: "Mod+,",
    command: "desk.settings.open",
    owner: "desk",
  },
];
