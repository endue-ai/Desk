import { describe, expect, it } from "vitest";
import type { ConnectorInfo, ConnectorState, View } from "../../../packages/bridge/src/index";
import { bindQuery, candidates, choose, reach } from "../ui/resolve.js";

const instance = (connector: string, id: string, state: ConnectorState = "connected") => ({
  connector,
  instance: id,
  title: `${connector} ${id}`,
  status: state === "error" ? { state, error: { message: "Down." } } : { state },
});
const connector = (id: string, kinds: string[], ids: string[]): ConnectorInfo =>
  ({
    id,
    instances: ids.map((i) => instance(id, i)),
    resources: kinds.map((kind) => ({ kind })),
  }) as ConnectorInfo;

const fixtures = connector("desk.fixtures", ["event", "task", "note", "message"], ["default"]);
const mail = connector("example.mail", ["message"], ["work"]);
const jira = connector("example.jira", ["task"], ["work", "home"]);

const view = (requires: View["requires"]): View => ({
  id: "test.view",
  version: "0.1.0",
  title: "Test",
  requires,
  layout: { type: "list" },
});

describe("requires", () => {
  it("binds the one instance whose connector serves every kind a require names", () => {
    const today = { kinds: ["event" as const, "task" as const] };
    expect(candidates(today, [mail, fixtures])).toEqual([fixtures.instances[0]]);
    expect(candidates({ kinds: ["message"] }, [mail, fixtures]).map((i) => i.connector)).toEqual([
      "example.mail",
      "desk.fixtures",
    ]);
    const chosen = choose(view({ day: today }), [mail, fixtures], {});
    expect(chosen).toEqual({
      bound: { day: { connector: "desk.fixtures", instance: "default" } },
      pick: {},
      none: [],
    });
  });

  it("honours the connector a require names and the bindings open passes", () => {
    const tasks = { kinds: ["task" as const], connector: "example.jira" };
    expect(candidates(tasks, [fixtures, jira]).map((i) => i.instance)).toEqual(["work", "home"]);
    expect(choose(view({ tasks }), [fixtures, jira], { tasks: "example.jira/home" }).bound).toEqual(
      {
        tasks: { connector: "example.jira", instance: "home" },
      },
    );
    expect(
      choose(view({ tasks }), [fixtures, jira], {
        tasks: { connector: "example.jira", instance: "work" },
      }).bound,
    ).toEqual({ tasks: { connector: "example.jira", instance: "work" } });
    // A binding that is not a candidate is not taken: desk.fixtures is not example.jira.
    expect(choose(view({ tasks }), [fixtures, jira], { tasks: "desk.fixtures/default" })).toEqual({
      bound: {},
      pick: { tasks: jira.instances },
      none: [],
    });
  });

  it("offers several candidates for a pick and leaves none unbound", () => {
    const requires = {
      tasks: { kinds: ["task" as const] },
      builds: { kinds: ["metric" as const], connector: "example.ci" },
    };
    const chosen = choose(view(requires), [fixtures, jira], {});
    expect(chosen.bound).toEqual({});
    expect(chosen.pick.tasks?.map((i) => `${i.connector}/${i.instance}`)).toEqual([
      "desk.fixtures/default",
      "example.jira/work",
      "example.jira/home",
    ]);
    expect(chosen.none).toEqual(["builds"]);
    // Candidates come in any status: an instance in error can still be picked and reconnected.
    const broken = { ...fixtures, instances: [instance("desk.fixtures", "default", "error")] };
    expect(choose(view({ tasks: requires.tasks }), [broken], {}).bound).toEqual({
      tasks: { connector: "desk.fixtures", instance: "default" },
    });
  });

  it("replaces $require in a binding's sources with the chosen instance", () => {
    const bound = { calendar: { connector: "desk.fixtures", instance: "default" } };
    const query = { kinds: ["event" as const], sources: ["$calendar", "example.other"], limit: 5 };
    expect(bindQuery(query, bound)).toEqual({
      kinds: ["event"],
      sources: ["desk.fixtures/default", "example.other"],
      limit: 5,
    });
    expect(query.sources).toEqual(["$calendar", "example.other"]);
    expect(bindQuery({ sources: ["$tasks"] }, bound)).toBeUndefined();
    expect(bindQuery({ kinds: ["note"] }, bound)).toEqual({ kinds: ["note"] });
  });

  it("an unbound binding names the installed connectors that could serve it, or the require none can", () => {
    // connector.list lists installed connectors with no instance too: those are the ones to connect.
    const github = connector("desk.github", ["task"], []);
    const requires = {
      tasks: { kinds: ["task" as const] },
      inbox: { kinds: ["message" as const] },
      work: { kinds: ["task" as const], connector: "desk.github" },
    };
    const tasks = { kinds: ["task" as const], sources: ["$tasks"] };
    expect(reach(view(requires), tasks, {}, [mail, github, jira])).toEqual({
      connectors: [github, jira],
      kinds: ["task"],
    });
    // A bound require needs nothing.
    const bound = { tasks: { connector: "example.jira", instance: "work" } };
    expect(reach(view(requires), tasks, bound, [jira])).toEqual({ connectors: [], kinds: [] });
    const inbox = { kinds: ["message" as const], sources: ["$inbox"] };
    expect(reach(view(requires), inbox, {}, [github, jira])).toEqual({
      connectors: [],
      kinds: ["message"],
      missing: requires.inbox,
    });
    const work = { kinds: ["task" as const], sources: ["$work"] };
    expect(reach(view(requires), work, {}, [github])).toEqual({
      connectors: [github],
      kinds: ["task"],
    });
    expect(reach(view(requires), work, {}, [jira])).toEqual({
      connectors: [],
      kinds: ["task"],
      missing: requires.work,
    });
  });
});
