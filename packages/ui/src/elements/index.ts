// The framework-free elements. Their shadow CSS reads only the `--desk-*` custom properties, so a
// page that sets them (tokens.css, or a theme) styles every element without code changes.
import { DeskAgenda } from "./agenda";
import { DeskButton } from "./button";
import { DeskCard } from "./card";
import { DeskDialog } from "./dialog";
import { DeskInput } from "./input";
import { DeskList } from "./list";
import { DeskMarkdown } from "./markdown";
import { DeskMenu } from "./menu";
import { DeskStat } from "./stat";
import { DeskTable } from "./table";
import { DeskToast } from "./toast";

export type { DeskAgendaEvent, DeskAgendaSelectDetail } from "./agenda";
export type { DeskSelectDetail } from "./base";
export type { DeskLinkDetail } from "./markdown";
export type {
  DeskSortDetail,
  DeskSortDirection,
  DeskTableColumn,
  DeskTableRow,
  DeskTableSelectDetail,
} from "./table";
export {
  DeskAgenda,
  DeskButton,
  DeskCard,
  DeskDialog,
  DeskInput,
  DeskList,
  DeskMarkdown,
  DeskMenu,
  DeskStat,
  DeskTable,
  DeskToast,
};

/** The elements by tag name. */
export const elements = {
  "desk-button": DeskButton,
  "desk-input": DeskInput,
  "desk-list": DeskList,
  "desk-dialog": DeskDialog,
  "desk-menu": DeskMenu,
  "desk-toast": DeskToast,
  "desk-table": DeskTable,
  "desk-agenda": DeskAgenda,
  "desk-stat": DeskStat,
  "desk-markdown": DeskMarkdown,
  "desk-card": DeskCard,
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
    "desk-table": DeskTable;
    "desk-agenda": DeskAgenda;
    "desk-stat": DeskStat;
    "desk-markdown": DeskMarkdown;
    "desk-card": DeskCard;
  }
}
