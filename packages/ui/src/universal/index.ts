// The universal views without a DOM (ADR 0084): entries read through a map into rows, and each
// presentation's model. `<desk-universal-view>` (@endue-ai/ui/elements) draws them; plugins and tests
// may use them directly.
export {
  type CalendarCell,
  type CalendarEntry,
  type CalendarModel,
  type CalendarRange,
  calendarOf,
  type KanbanColumn,
  kanbanOf,
  type TimelineDay,
  type TimelineModel,
  type TimelineRow,
  timelineOf,
} from "./layout";
export {
  byStart,
  mapOf,
  movedTo,
  rowsOf,
  toneOf,
  UNIVERSAL_ROLES,
  type UniversalRow,
  type UniversalTone,
  valueAt,
  withValueAt,
} from "./rows";
export {
  type AgentModel,
  type AgentStep,
  agentOf,
  type ChatDay,
  type ChatMessage,
  chatOf,
  isMine,
  listOf,
  type TextSection,
  textOf,
} from "./talk";
export {
  addDays,
  addMonths,
  dayLabel,
  dayOf,
  dayStart,
  durationText,
  timeText,
  type UniversalEnv,
  whenOf,
} from "./time";

/** The presentations, in the switcher's default order. */
export const UNIVERSAL_TYPES = [
  "list",
  "kanban",
  "timeline",
  "calendar",
  "text",
  "chat",
  "agent",
] as const;
