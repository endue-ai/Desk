/**
 * The browser stub's fixture connector, `desk.fixtures`, and the items its `default` instance brings
 * in: a Friday morning's events, tasks, notes and messages around a fixed today, so views render the
 * same way in every test (specs/item/v0).
 */
import type {
  ConnectorInstance,
  ConnectorResource,
  ConnectorSetting,
  Item,
  ItemSource,
} from "./generated";

/** The stub's clock for items and connectors: Friday 30 October 2026, 9 in the morning in Seoul. */
export const FIXTURE_NOW = "2026-10-30T09:00:00+09:00";
export const FIXTURE_CONNECTOR = "desk.fixtures";

/** An installed connector as the stub keeps it: what it brings in, what an instance takes. */
export interface FixtureConnector {
  id: string;
  resources: ConnectorResource[];
  instanceSettings: Record<string, ConnectorSetting>;
  instances: ConnectorInstance[];
}

/** `desk.fixtures` as the stub installs it, with its `default` instance connected. */
export function fixtureConnector(): FixtureConnector {
  return {
    id: FIXTURE_CONNECTOR,
    resources: [{ kind: "event" }, { kind: "task" }, { kind: "note" }, { kind: "message" }],
    instanceSettings: {
      folder: { kind: "string", title: "Folder" },
      token: { kind: "string", title: "Access token", secret: true },
    },
    instances: [
      {
        connector: FIXTURE_CONNECTOR,
        instance: "default",
        title: "Fixtures",
        settings: {},
        status: { state: "connected", lastSyncAt: "2026-10-30T08:55:00+09:00" },
      },
    ],
  };
}

const source: ItemSource = { connector: FIXTURE_CONNECTOR, instance: "default" };
/** An item of any kind without its source, which every fixture shares. */
type Unsourced<T = Item> = T extends Item ? Omit<T, "source"> : never;
const at = (day: number, time: string) => `2026-10-${day}T${time}:00+09:00`;
const mina = { name: "Mina", email: "mina@example.com" };
const work = { labels: ["work"] };

/** Twelve items of `desk.fixtures/default`, newest `updatedAt` first; a fresh copy every call. */
export function fixtureItems(): Item[] {
  const items: Unsourced[] = [
    {
      kind: "task",
      id: "task-report",
      title: "Send the weekly report",
      updatedAt: at(30, "08:40"),
      status: "open",
      due: at(30, "17:00"),
      priority: 1,
      project: "Work",
      raw: work,
    },
    {
      kind: "event",
      id: "ev-review",
      title: "Design review",
      updatedAt: at(30, "08:30"),
      start: at(30, "16:00"),
      end: at(30, "17:00"),
      location: "Room 1",
      calendar: "Work",
      raw: work,
    },
    {
      kind: "message",
      id: "msg-mina",
      title: "Lunch today?",
      updatedAt: at(30, "08:12"),
      from: mina,
      receivedAt: at(30, "08:12"),
      unread: true,
      snippet: "Still on for 12:30 at the bistro?",
      thread: "mina",
    },
    {
      kind: "message",
      id: "msg-build",
      title: "Build 1042 passed",
      updatedAt: at(30, "07:45"),
      from: { name: "CI", email: "ci@example.com" },
      receivedAt: at(30, "07:45"),
      unread: false,
      snippet: "All 312 tests passed on main.",
      raw: work,
    },
    {
      kind: "task",
      id: "task-groceries",
      title: "Buy groceries",
      updatedAt: at(29, "21:00"),
      status: "open",
      due: at(31, "12:00"),
      priority: 3,
      project: "Home",
    },
    {
      kind: "event",
      id: "ev-lunch",
      title: "Lunch with Mina",
      updatedAt: at(29, "20:15"),
      start: at(30, "12:30"),
      end: at(30, "13:30"),
      location: "Bistro Seoul",
      attendees: [mina],
      calendar: "Personal",
    },
    {
      kind: "task",
      id: "task-invoice",
      title: "Pay the internet invoice",
      updatedAt: at(29, "18:05"),
      status: "done",
      due: at(29, "23:59"),
      completedAt: at(29, "18:05"),
      project: "Home",
    },
    {
      kind: "message",
      id: "msg-landlord",
      title: "Boiler check on Monday",
      updatedAt: at(29, "17:20"),
      from: { name: "Mr. Park" },
      receivedAt: at(29, "17:20"),
      unread: true,
      snippet: "The technician comes on Monday at 10.",
    },
    {
      kind: "event",
      id: "ev-standup",
      title: "Team standup",
      updatedAt: at(28, "18:00"),
      start: at(30, "10:00"),
      end: at(30, "10:15"),
      location: "Room 3",
      attendees: [mina, { name: "Jun" }],
      recurrence: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      calendar: "Work",
      raw: work,
    },
    {
      kind: "event",
      id: "ev-hike",
      title: "Hike at Bukhansan",
      updatedAt: at(27, "09:00"),
      start: at(31, "00:00"),
      end: "2026-11-01T00:00:00+09:00",
      allDay: true,
      calendar: "Personal",
    },
    {
      kind: "note",
      id: "note-offsite",
      title: "Ideas for the offsite",
      updatedAt: at(26, "14:00"),
      body: "- A hike on Saturday\n- Lunch by the river\n- One short talk each",
      path: "Work/offsite.md",
      raw: work,
    },
    {
      kind: "note",
      id: "note-stew",
      title: "Kimchi stew",
      updatedAt: at(24, "19:30"),
      body: "Kimchi, pork belly, tofu and a spoon of gochugaru. Simmer for 20 minutes.",
      path: "Home/recipes/kimchi-stew.md",
    },
  ];
  return items.map((item) => structuredClone({ ...item, source }) as Item);
}
