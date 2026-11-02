// The framework-free elements. Their shadow CSS reads only the `--desk-*` custom properties, so a
// page that sets them (tokens.css, or a theme) styles every element without code changes.
import { DeskAgenda } from "./agenda";
import { DeskButton } from "./button";
import { DeskCard } from "./card";
import { DeskDialog } from "./dialog";
import { DeskEditTier, EDIT_TIERS, type EditTier } from "./edit-tier";
import { DeskInput } from "./input";
import { DeskList } from "./list";
import { DeskMarkdown } from "./markdown";
import { DeskMenu } from "./menu";
import { DeskProgress } from "./progress";
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
export type { EditTier };
export {
  DeskAgenda,
  DeskButton,
  DeskCard,
  DeskDialog,
  DeskEditTier,
  DeskInput,
  DeskList,
  DeskMarkdown,
  DeskMenu,
  DeskProgress,
  DeskStat,
  DeskTable,
  DeskToast,
  EDIT_TIERS,
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
  "desk-progress": DeskProgress,
  "desk-edit-tier": DeskEditTier,
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
    "desk-progress": DeskProgress;
    "desk-edit-tier": DeskEditTier;
  }
}
