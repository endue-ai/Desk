import { describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { validateBuild } from "../ui/create.js";
import { mount, settle } from "./harness";

const STUDIO = { permission: "studio:manage" };

describe("New agent", () => {
  it("Build from scratch takes a name of 1 to 100 characters and a role", () => {
    expect(validateBuild({ name: "Miso", role: "Schedules" })).toEqual({ ok: true, invalid: {} });
    expect(validateBuild({ name: "  ", role: "Schedules" }).invalid).toEqual({
      name: "Give it a name.",
    });
    expect(validateBuild({ name: "x".repeat(100), role: "r" }).ok).toBe(true);
    expect(validateBuild({ name: "x".repeat(101), role: "r" }).invalid.name).toBe(
      "A name is at most 100 characters (this one is 101).",
    );
    // Characters, not UTF-16 units: 100 Hangul syllables or emoji are a valid name.
    expect(validateBuild({ name: "미".repeat(100), role: "r" }).ok).toBe(true);
    expect(validateBuild({ name: "🦊".repeat(100), role: "r" }).ok).toBe(true);
    expect(validateBuild({ name: "Miso", role: "" }).invalid).toEqual({
      role: "Say what it does.",
    });
  });

  it("Build from scratch refuses a bad name without calling endue AI, then creates and opens it in Studio", async () => {
    const { app, host, last, create, methods, params } = await mount();
    app.create();
    await settle(host);
    expect(last().route.page).toBe("create");
    app.flow.mode("build");
    await app.flow.build({ name: "x".repeat(101), role: "Mail" });
    expect(create().invalid.name).toMatch(/at most 100/);
    expect(methods("studio.agents.create")).toEqual([]);

    await app.flow.build({ name: " Joon ", role: " Answers mail " });
    await settle(host);
    expect(params("studio.agents.create")).toEqual([
      { name: "Joon", role: "Answers mail", languages: ["en"], scope: STUDIO },
    ]);
    expect(last().route).toMatchObject({ page: "studio", key: "endue:ag_new" });
    expect(last().studio?.card.name).toBe("Joon");
  });

  it("Find shows the catalog, then calls studio.catalog.recommend with what the person wants", async () => {
    const { app, host, create, params } = await mount();
    app.create();
    await settle(host);
    // Before a search: every published catalog agent, in the person's language, three strengths.
    expect(create().catalog.map((c) => [c.slug, c.name, c.role])).toEqual([
      ["mail-helper", "Mailie", "Support mail"],
      ["planner", "Planner", "Keeps the calendar"],
    ]);
    expect(create().catalog[0]?.strengths).toEqual(["Polite", "Fast", "Your tone"]);
    await app.flow.find("  help me answer customer mail  ");
    await settle(host);
    expect(params("studio.catalog.recommend")).toEqual([
      { query: "help me answer customer mail", locale: "en", scope: STUDIO },
    ]);
    expect(create()).toMatchObject({ source: "llm", phase: "idle" });
    // A slug the catalog no longer publishes is left out.
    expect(create().matches).toEqual([
      expect.objectContaining({ slug: "mail-helper", name: "Mailie", reason: "It answers mail" }),
    ]);
  });

  it("Use calls studio.catalog.use and opens the new agent in Studio, saying what did not apply", async () => {
    const { app, host, last, create, params } = await mount();
    app.create();
    await settle(host);
    app.flow.select("mail-helper");
    expect(create().selected).toBe("mail-helper");
    await app.flow.use("mail-helper");
    await settle(host);
    expect(params("studio.catalog.use")).toEqual([
      { slug: "mail-helper", locale: "en", scope: STUDIO },
    ]);
    expect(last().route).toMatchObject({ page: "studio", key: "endue:ag_new" });
    expect(last().notice).toBe("Some settings did not apply: model: MODEL_NOT_ALLOWED.");
  });

  it("a failed search says why and keeps the flow usable", async () => {
    const { app, host, create } = await mount({
      studio: {
        "studio.catalog.recommend": () => {
          throw new StubError("timeout", "the catalog did not answer");
        },
      },
    });
    app.create();
    await settle(host);
    await app.flow.find("mail");
    await settle(host);
    expect(create()).toMatchObject({
      phase: "idle",
      error: expect.stringContaining("did not answer"),
    });
  });
});
