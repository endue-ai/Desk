// The six framework-free elements. Their shadow CSS reads only the `--desk-*` custom properties, so
// a page that sets them (tokens.css, or a theme) styles every element without code changes.
import { DeskButton } from "./button";
import { DeskDialog } from "./dialog";
import { DeskInput } from "./input";
import { DeskList } from "./list";
import { DeskMenu } from "./menu";
import { DeskToast } from "./toast";

export type { DeskSelectDetail } from "./base";
export { DeskButton, DeskDialog, DeskInput, DeskList, DeskMenu, DeskToast };

/** The elements by tag name. */
export const elements = {
  "desk-button": DeskButton,
  "desk-input": DeskInput,
  "desk-list": DeskList,
  "desk-dialog": DeskDialog,
  "desk-menu": DeskMenu,
  "desk-toast": DeskToast,
} as const;

/** Define every element that is not defined yet; safe to call more than once. */
export function defineElements(registry: CustomElementRegistry = customElements): void {
  for (const [name, element] of Object.entries(elements)) {
    if (!registry.get(name)) registry.define(name, element);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "desk-button": DeskButton;
    "desk-input": DeskInput;
    "desk-list": DeskList;
    "desk-dialog": DeskDialog;
    "desk-menu": DeskMenu;
    "desk-toast": DeskToast;
  }
}
