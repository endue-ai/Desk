// Builds: docker build from the form, the steps read from BuildKit's plain progress, and the
// starting files the Dockerfile writer makes.
import { describe, expect, it } from "vitest";
import { buildArgs, buildForm, createBuild, summary } from "../ui/build.js";
import { filesFor, scaffoldFor } from "../ui/templates.js";

describe("build", () => {
  it("makes docker build from the form, every part checked", () => {
    const form = {
      ...buildForm("/w/app"),
      tag: "app:dev",
      target: "runtime",
      platform: "linux/arm64",
      args: [{ key: "NODE_ENV", value: "production" }],
      noCache: true,
    };
    expect(buildArgs(form)).toEqual([
      "build",
      "--progress",
      "plain",
      "--tag",
      "app:dev",
      "--target",
      "runtime",
      "--platform",
      "linux/arm64",
      "--build-arg",
      "NODE_ENV=production",
      "--no-cache",
      "--",
      "/w/app",
    ]);
    expect(() => buildArgs({ ...form, context: "app" })).toThrow();
    expect(() => buildArgs({ ...form, tag: "-t" })).toThrow();
    expect(() => buildArgs({ ...form, platform: "linux amd64" })).toThrow();
    expect(() => buildArgs({ ...form, args: [{ key: "A B", value: "" }] })).toThrow();
  });

  it("reads the steps, the cached ones, their times, the output and the failure", () => {
    const b = createBuild();
    for (const line of [
      "#1 [internal] load build definition from Dockerfile",
      "#1 DONE 0.1s",
      "#4 [deps 1/2] COPY package.json ./",
      "#4 CACHED",
      "#5 [deps 2/2] RUN npm ci",
      "#5 3.21 added 412 packages",
      '#5 ERROR: process "/bin/sh -c npm ci" did not complete successfully: exit code: 1',
      'ERROR: failed to solve: process "/bin/sh -c npm ci" did not complete successfully: exit code: 1',
    ])
      b.push(line);
    expect(b.steps.map((s) => [s.id, s.status, s.stage])).toEqual([
      [1, "done", ""],
      [4, "cached", "deps 1/2"],
      [5, "error", "deps 2/2"],
    ]);
    expect(b.steps[0]?.seconds).toBe(0.1);
    expect(b.steps[2]?.output[0]).toBe("added 412 packages");
    expect(b.error).toMatch(/^failed to solve/);
    expect(summary(b)).toBe("3 steps, 1 cached, 0.1 s of work");
  });

  it("writes starting files for a platform", () => {
    const s = { ...scaffoldFor("node", "web"), db: "postgres" as const, cache: true };
    const files = Object.fromEntries(filesFor(s));
    expect(Object.keys(files)).toEqual(["Dockerfile", ".dockerignore", "compose.yaml"]);
    expect(files.Dockerfile).toContain("FROM node:22-alpine AS deps");
    expect(files.Dockerfile).toContain("USER node");
    expect(files.Dockerfile).toContain('CMD ["node", "server.js"]');
    expect(files[".dockerignore"]).toContain("node_modules");
    expect(files["compose.yaml"]).toContain("condition: service_healthy");
    expect(files["compose.yaml"]).toContain("REDIS_URL: redis://cache:6379");
    const go = Object.fromEntries(
      filesFor({ ...scaffoldFor("go"), compose: false, nonRoot: false }),
    );
    expect(go["compose.yaml"]).toBeUndefined();
    expect(go.Dockerfile).not.toContain("USER");
  });
});
