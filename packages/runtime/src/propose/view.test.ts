import {
  type ConnectorInfo,
  FIXTURE_NOW,
  fixtureConnector,
  type PluginManifest,
  type View,
} from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { browserCore } from "../bridge/core";
import { BOARD } from "./fixtures";
import { proposalOf } from "./talk";
import { slugOf, viewKind } from "./view";

const VIEWS = { permission: "view:manage" } as const;
const manifests: PluginManifest[] = [
  { id: "desk.views", version: "0.1.0", kind: "ui", entry: "ui/index.html" },
  { id: "desk.palette", version: "0.1.0", kind: "ui", entry: "ui/index.html" },
  { id: "endue.notes", version: "0.1.0", kind: "ui", entry: "ui/index.html" },
];
const kindOn = (core: ReturnType<typeof browserCore>) =>
  viewKind({
    bridge: core.client,
    commands: { run: async () => ({}) },
    now: () => Date.parse(FIXTURE_NOW),
    profile: () => "morning",
  });
const request = { text: "show my events this week as a board", corrections: [] };

describe("the view kind", () => {
  it("the talk line hands make, build, show me and /make sentences to desk.propose and keeps the rest for brain.say", () => {
    expect(proposalOf("make a board of my tasks")).toEqual({
      kind: "view",
      text: "make a board of my tasks",
    });
    expect(proposalOf("  Build me a reading list ")).toEqual({
      kind: "view",
      text: "Build me a reading list",
    });
    expect(proposalOf("Show me my unread mail")).toEqual({
      kind: "view",
      text: "Show me my unread mail",
    });
    expect(proposalOf("/make show my events this week as a board")).toEqual({
      kind: "view",
      text: "show my events this week as a board",
    });
    for (const kept of [
      "show my events this week",
      "makes sense, thanks",
      "/make",
      "what did I build yesterday?",
      "/maker",
    ])
      expect(proposalOf(kept), kept).toBeNull();
  });

  it("the context names the kinds and sources (catalog.get and connector.list), the enabled plugins and the profile in force", async () => {
    const jira: ConnectorInfo = {
      id: "example.jira",
      resources: [{ kind: "task" }],
      instances: [
        {
          connector: "example.jira",
          instance: "work",
          title: "Jira",
          settings: {},
          status: { state: "connected" },
        },
      ],
    };
    const core = browserCore({
      manifests,
      off: ["endue.notes"],
      handlers: {
        // The app's runtime has no data:read: the catalog names no connector, connector.list does.
        "catalog.get": () => ({
          components: ["list", "agenda"],
          connectors: [
            {
              id: "desk.fixtures",
              instances: ["default"],
              kinds: [{ kind: "event", fields: ["start"] }],
            },
          ],
          commands: [],
        }),
        "connector.list": () => {
          const { id, resources, instances } = fixtureConnector();
          return { connectors: [{ id, resources, instances }, jira] };
        },
      },
    });
    expect(await kindOn(core).context(request)).toEqual({
      components: ["list", "agenda"],
      sources: [
        {
          connector: "desk.fixtures",
          instances: ["default"],
          kinds: [
            { kind: "event", fields: ["start"] },
            { kind: "task" },
            { kind: "note" },
            { kind: "message" },
          ],
        },
        { connector: "example.jira", instances: ["work"], kinds: [{ kind: "task" }] },
      ],
      plugins: ["desk.palette", "desk.views"],
      profile: "morning",
    });
  });

  it("the id is eris.<slug of the title>, taken ids get -2, and the desk writes version and provenance", async () => {
    expect(slugOf("Events this week")).toBe("events-this-week");
    expect(slugOf("  Q4: Sales & {params.region} ")).toBe("q4-sales-region");
    expect(slugOf("이번 주 일정")).toBe("view");
    expect(slugOf("2026 plans")).toBe("view-2026-plans");
    const core = browserCore({ manifests, brain: { answer: () => "" } });
    const taken: View = { ...BOARD, id: "eris.events-this-week", version: "0.1.0" } as View;
    await core.client.call("view.save", { view: taken, scope: VIEWS });
    const checked = await kindOn(core).check(
      { ...BOARD, id: "brain.chose-this", provenance: { author: "brain" } },
      request,
    );
    expect(checked).toEqual({
      value: {
        ...BOARD,
        id: "eris.events-this-week-2",
        version: "0.1.0",
        provenance: {
          author: "eris",
          createdAt: "2026-10-30T00:00:00.000Z",
          words: request.text,
          brain: "scripted",
        },
      },
    });
    const broken = await kindOn(core).check(
      {
        ...BOARD,
        layout: { type: "list", title: "{params.days} days", binding: { sources: ["$mail"] } },
      },
      request,
    );
    expect(broken).toEqual({
      problems: [
        "/layout/binding/sources/0: $mail is not one of the view's requires",
        "/layout/title: {params.days} reads a param the view does not declare",
      ],
    });
    expect(await kindOn(core).check("a view", request)).toEqual({
      problems: ["/: the answer is not a JSON object"],
    });
  });
});
