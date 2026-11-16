// AI: what a suggested command may do before it runs, and what a prompt never carries.
import { describe, expect, it } from "vitest";
import { checkSuggested } from "../ui/ai-commands.js";
import { containerFacts, diagnosePrompt, engineFacts, TOOLS } from "../ui/ai-prompts.js";
import * as parse from "../ui/parse.js";

describe("suggested commands", () => {
  it("runs docker's own reads and changes, asking first", () => {
    expect(checkSuggested(["stop", "ollama"])).toMatchObject({
      ok: true,
      changes: true,
      destructive: false,
      line: "docker stop ollama",
    });
    expect(checkSuggested(["docker", "stats", "--no-stream"])).toMatchObject({
      ok: true,
      changes: false,
    });
    expect(checkSuggested(["compose", "--project-name", "shop", "start", "migrate"])).toMatchObject(
      { ok: true, changes: true },
    );
    expect(checkSuggested(["image", "prune", "--all", "--force"])).toMatchObject({
      ok: true,
      destructive: true,
    });
    expect(checkSuggested(["rm", "-f", "web"])).toMatchObject({ ok: true, destructive: true });
  });

  it("refuses what reaches into this computer or is not docker's", () => {
    expect(checkSuggested(["run", "--privileged", "alpine"]).ok).toBe(false);
    expect(checkSuggested(["run", "--network", "host", "alpine"]).ok).toBe(false);
    expect(checkSuggested(["run", "-v", "/:/host", "alpine"]).ok).toBe(false);
    expect(
      checkSuggested(["run", "-v", "/var/run/docker.sock:/var/run/docker.sock", "alpine"]).ok,
    ).toBe(false);
    expect(checkSuggested(["context", "rm", "prod"]).ok).toBe(false);
    expect(checkSuggested(["swarm", "leave"]).ok).toBe(false);
    expect(checkSuggested("rm -rf /").ok).toBe(false);
    expect(checkSuggested([]).ok).toBe(false);
  });
});

describe("prompts", () => {
  const c = parse.container({
    Id: "a".repeat(64),
    Name: "/shop-api-1",
    State: { Status: "exited", ExitCode: 1 },
    Config: {
      Image: "shop-api:dev",
      Env: [
        "DATABASE_URL=postgres://shop:s3cr3t@db/shop",
        "JWT_SECRET=hunter2",
        "NODE_ENV=production",
      ],
    },
  });

  it("names variables but never sends their values", () => {
    const facts = containerFacts(c);
    expect(facts).toContain("DATABASE_URL, JWT_SECRET, NODE_ENV");
    expect(facts).not.toContain("s3cr3t");
    expect(facts).not.toContain("hunter2");
    expect(diagnosePrompt(c, ["boom"])).not.toContain("hunter2");
    const state = {
      engine: { info: null },
      containers: [c],
      images: [],
      volumes: [],
      networks: [],
      disk: [],
      context: "",
    };
    expect(engineFacts(state)).not.toContain("s3cr3t");
  });

  it("gives every tool an object schema with what it requires", () => {
    for (const tool of Object.values(TOOLS)) {
      expect(tool.schema.type).toBe("object");
      expect(Array.isArray(tool.schema.required)).toBe(true);
      expect(tool.name).toMatch(/^[a-z_]+$/);
    }
  });
});
