import { describe, expect, it } from "vitest";
import { deleteConfirmed, localFacets, localInspector, webStudio } from "../ui/studio.js";
import { localAgents } from "./fixtures";
import { mount, pick, settle } from "./harness";

const STUDIO = { permission: "studio:manage" };

describe("Studio", () => {
  it("shows an endue agent's card with its facets, read at once from studio.agents.facets", async () => {
    const { app, host, studio, params } = await mount();
    app.studio("endue:ag_miso");
    await settle(host);
    expect(params("studio.agents.facets")).toEqual([{ agentId: "ag_miso", scope: STUDIO }]);
    const { card, facets, inspector } = studio();
    // The role came with the facets, so the card says it now.
    expect(card).toMatchObject({
      key: "endue:ag_miso",
      name: "Miso",
      badge: "endue",
      role: "Keeps my calendar",
    });
    expect(facets.map((f) => [f.id, f.place, f.hint])).toEqual([
      ["identity", "head", "Name, role and languages"],
      ["prompt", "card", "Revision 3"],
      ["traits", "card", "1 trait on"],
      ["skills", "card", "1 skill"],
      // endue AI did not answer for the connectors: the cell says so instead of "0".
      ["connectors", "card", "Could not be read"],
      ["channels", "card", "Paired on endue.ai"],
      ["status", "card", "Active"],
      ["settings", "foot", "Private · claude-sonnet-4.5"],
    ]);
    // No facet chosen: no inspector, as the web's canvas opens on the card alone.
    expect(inspector).toBeUndefined();
  });

  it("opens a facet's inspector beside the card; Escape closes it, then leaves Studio", async () => {
    const { app, host, studio, last } = await mount();
    app.studio("endue:ag_miso", "identity");
    await settle(host);
    const identity = studio().inspector;
    expect(identity).toMatchObject({ facet: "identity", save: "Save" });
    expect(identity?.fields.map((f) => [f.id, f.kind, f.value])).toEqual([
      ["name", "text", "Miso"],
      ["handle", "readonly", "@miso"],
      ["role", "textarea", "Keeps my calendar"],
      ["description", "textarea", ""],
      ["languages", "text", "en, ko"],
      ["id", "readonly", "ag_miso"],
    ]);
    app.facet("prompt");
    const prompt = studio().inspector;
    expect(pick(prompt?.fields ?? [])).toMatchObject({ id: "prompt", value: "Answer briefly." });
    expect(prompt?.entries?.map((e) => [e.title, e.state, e.action])).toEqual([
      ["Revision 3", "In force", undefined],
      ["Revision 2", "", "Restore"],
    ]);
    app.facet("connectors");
    expect(studio().inspector?.problem).toBe(
      "endue AI did not answer for this: endue AI did not answer within 15 s.",
    );
    app.back();
    expect(studio().facet).toBeUndefined();
    app.back();
    expect(last().route.page).toBe("home");
  });

  it("saves a facet through studio.agents.update and studio.agents.prompt.update, then reads it again", async () => {
    const { app, host, params, last } = await mount();
    app.studio("endue:ag_miso", "identity");
    await settle(host);
    await app.studioActions.save("ag_miso", "identity", {
      name: " Miso ",
      role: "Keeps my calendar",
      description: "",
      languages: "en, ko",
    });
    await app.studioActions.save("ag_miso", "settings", { visibility: "unlisted", model: "" });
    await app.studioActions.save("ag_miso", "prompt", { prompt: "Answer in one line." });
    await app.studioActions.restore("ag_miso", 2);
    await app.studioActions.act("ag_miso", "disable");
    await settle(host);
    expect(params("studio.agents.update")).toEqual([
      {
        agentId: "ag_miso",
        name: "Miso",
        role: "Keeps my calendar",
        description: "",
        languages: ["en", "ko"],
        scope: STUDIO,
      },
      { agentId: "ag_miso", visibility: "unlisted", model: "", scope: STUDIO },
    ]);
    expect(params("studio.agents.prompt.update")).toEqual([
      { agentId: "ag_miso", content: "Answer in one line.", scope: STUDIO },
      { agentId: "ag_miso", restore: 2, scope: STUDIO },
    ]);
    // Disable asks first (the person said yes here).
    expect(params("studio.agents.setStatus")).toEqual([
      { agentId: "ag_miso", status: "inactive", scope: STUDIO },
    ]);
    expect(params("studio.agents.facets").length).toBeGreaterThanOrEqual(6);
    expect(last().notice).toBe("Disabled.");
  });

  it("gives a local agent the same card with its program, version, model, folder and sessions", () => {
    const claude = pick(localAgents(), 0);
    const codex = pick(localAgents(), 1);
    const facets = localFacets(claude, { model: "", folder: "~/code", total: 2 });
    expect(facets.map((f) => [f.id, f.hint])).toEqual([
      ["identity", "Anthropic"],
      ["program", "Found on this computer"],
      ["version", "2.1.3"],
      ["model", "The program's default"],
      ["folder", "~/code"],
      ["sessions", "2 sessions · 1 archived"],
      ["chat", "Send it a message"],
    ]);
    expect(localFacets(codex).find((f) => f.id === "program")?.hint).toBe(
      "Not found: sessions only",
    );
    expect(pick(localInspector(claude, "program").fields)).toMatchObject({
      value: "/opt/homebrew/bin/claude",
    });
    expect(pick(localInspector(claude, "model", { model: "opus" }).fields)).toMatchObject({
      kind: "text",
      value: "opus",
    });
  });

  it("opens a local agent on its chat, with its sessions in the Sessions inspector", async () => {
    const { app, studio, chat, last } = await mount();
    app.studio("local:claude");
    expect(studio().facet).toBe("chat");
    expect(chat()).toMatchObject({ agent: "claude", runnable: true, phase: "idle" });
    app.facet("sessions");
    expect(studio().inspector?.entries?.map((e) => e.title)).toEqual([
      "Fix the flaky upload test",
      "Explain the bridge",
    ]);
    app.local("claude", "model", { model: "opus" });
    expect(chat().model).toBe("opus");
    expect(studio().facets.find((f) => f.id === "model")?.hint).toBe("opus");
    // On a local agent the chat is the page itself: Escape leaves Studio from it.
    app.facet("chat");
    app.back();
    expect(last().route.page).toBe("home");
  });

  it("deletes an endue agent only once its name is typed exactly", async () => {
    expect(deleteConfirmed("Miso", "Miso")).toBe(true);
    expect(deleteConfirmed("  Miso ", "Miso")).toBe(true);
    expect(deleteConfirmed("miso", "Miso")).toBe(false);
    expect(deleteConfirmed("Mis", "Miso")).toBe(false);
    expect(deleteConfirmed("", "")).toBe(false);

    const { app, host, studio, last, methods, params } = await mount();
    app.studio("endue:ag_miso", "settings");
    await settle(host);
    expect(studio().inspector?.actions?.map((a) => a.id)).toEqual(["open-web", "delete"]);
    await app.studioActions.act("ag_miso", "delete");
    expect(studio().deleting).toBe(true);

    expect(await app.studioActions.confirmDelete("ag_miso", "miso")).toBe(false);
    expect(methods("studio.agents.remove")).toEqual([]);
    expect(last().notice).toBe("Type the agent's name exactly to delete it.");

    expect(await app.studioActions.confirmDelete("ag_miso", "Miso")).toBe(true);
    await settle(host);
    expect(params("studio.agents.remove")).toEqual([{ agentId: "ag_miso", scope: STUDIO }]);
    expect(last().route.page).toBe("home");
    expect(last().notice).toBe("The agent is deleted.");
    expect(last().home?.cards.map((c) => c.key)).not.toContain("endue:ag_miso");
  });

  it("opens an endue agent on endue.ai through shell.open", async () => {
    expect(webStudio("ag_miso")).toBe("https://endue.ai/agent/ag_miso/studio");
    const { app, host, params } = await mount();
    await app.studioActions.act("ag_miso", "open-web");
    await settle(host);
    expect(params("shell.open")).toEqual([
      {
        target: "https://endue.ai/agent/ag_miso/studio",
        scope: { permission: "shell:open", schemes: ["https"] },
      },
    ]);
  });
});
