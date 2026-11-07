// The market as the views page answers it (ADR 0107): this repository's market/views entries from the
// endue index, a view and a code plugin from another market (not verified), and an installed theme.
// plugin.install and plugin.remove change the state the next market.list answers. Never shipped.
import type { MarketListing, StubHandlers } from "@endue-ai/bridge";
import views from "../../../../market/views/index.json";

const ENDUE = "https://raw.githubusercontent.com/endue-ai/Desk/main/market/views/index.json";
const ACME = "https://market.acme.test/index.json";

export function marketHandlers(): StubHandlers {
  const entry = (more: Partial<MarketListing["entry"]>): MarketListing["entry"] => ({
    id: "acme.x",
    kind: "view",
    name: "X",
    version: "1.0.0",
    publisher: "Acme",
    license: "Apache-2.0",
    url: "https://market.acme.test/x.desk-plugin",
    sha256: "0".repeat(64),
    size: 1000,
    ...more,
  });
  const read = { permission: "data:read" as const, kinds: ["task" as const] };
  const fetch = { permission: "net:fetch" as const, hosts: ["api.acme.test"] };
  const listings: MarketListing[] = [
    ...(views.entries as MarketListing["entry"][]).map((e) => ({
      market: ENDUE,
      entry: { ...e, url: `${ENDUE.replace("index.json", "")}${e.url}` },
      verified: true,
      state: "available" as const,
      added: [],
    })),
    {
      market: ACME,
      entry: entry({
        id: "acme.sprint-board",
        name: "Sprint board",
        description: "Open tasks by status, as columns.",
        permissions: [read],
      }),
      verified: false,
      state: "available",
      added: [read],
    },
    {
      market: ACME,
      entry: entry({
        id: "acme.tracker",
        kind: "plugin",
        name: "Acme Tracker",
        description: "Tickets from Acme Tracker as tasks, with commands to move them.",
        permissions: [fetch],
      }),
      verified: false,
      state: "available",
      added: [fetch],
    },
    {
      market: ENDUE.replace("views", "themes"),
      entry: entry({
        id: "market.lagoon",
        kind: "theme",
        name: "Lagoon",
        publisher: "Team endue",
        license: "CC0-1.0",
      }),
      verified: true,
      state: "installed",
      installed: "1.0.0",
      added: [],
    },
  ];
  return {
    "market.list": () => ({ entries: structuredClone(listings), problems: [] }),
    "plugin.install": ({ id }) => {
      const found = listings.find((l) => l.entry.id === id);
      if (found)
        Object.assign(found, { state: "installed", installed: found.entry.version, added: [] });
      return { plugin: { id, status: "ready", enabled: true, builtIn: false, revision: 1 } };
    },
    "plugin.remove": ({ plugin }) => {
      const found = listings.find((l) => l.entry.id === plugin);
      if (found) Object.assign(found, { state: "available", installed: undefined });
      return {};
    },
  };
}
