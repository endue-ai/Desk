// Images without DOM: layers from image history, a pull's progress, and the Run form's docker run.
import { describe, expect, it } from "vitest";
import {
  formFor,
  parseHistory,
  progressLine,
  progressOf,
  runArgs,
  shellLine,
  words,
} from "../ui/images.js";

describe("images", () => {
  it("reads image history oldest first, without the shell's noise", () => {
    const out = [
      '{"CreatedBy":"CMD [\\"node\\" \\"server.js\\"]","ID":"sha256:abc","Size":"0B","CreatedAt":"2026-11-16T10:00:00Z"}',
      '{"CreatedBy":"RUN /bin/sh -c npm ci --omit=dev # buildkit","ID":"<missing>","Size":"236MB","CreatedAt":"2026-11-16T09:00:00Z"}',
      '{"CreatedBy":"/bin/sh -c #(nop) ADD file:5b1e0a in / ","ID":"<missing>","Size":"8.8MB","CreatedAt":"2026-11-01T09:00:00Z"}',
    ].join("\n");
    const layers = parseHistory(out);
    expect(layers.map((l) => l.by)).toEqual([
      "ADD file:5b1e0a in /",
      "RUN npm ci --omit=dev",
      'CMD ["node" "server.js"]',
    ]);
    expect(layers[1]?.size).toBe(236e6);
    expect(layers[2]?.empty).toBe(true);
  });

  it("follows a pull's layers to the end", () => {
    const layers = new Map();
    for (const line of [
      "latest: Pulling from library/nginx",
      "a1b2c3d4e5f6: Pulling fs layer",
      "0f0e0d0c0b0a: Pulling fs layer",
      "a1b2c3d4e5f6: Downloading  10MB/20MB",
    ])
      progressLine(layers, line);
    expect(layers.get("a1b2c3d4e5f6")).toMatchObject({ done: 10e6, total: 20e6 });
    expect(progressOf(layers)).toBeCloseTo(0.5);
    progressLine(layers, "a1b2c3d4e5f6: Pull complete");
    progressLine(layers, "0f0e0d0c0b0a: Already exists");
    expect(progressOf(layers)).toBe(1);
    expect(progressLine(layers, "Status: Downloaded newer image for nginx:latest")).toMatch(
      /^Status/,
    );
  });

  it("makes docker run from the form, every part checked", () => {
    const form = formFor("nginx:1.27", ["80/tcp"]);
    form.name = "web";
    form.volumes.push({ source: "site", target: "/usr/share/nginx/html", readOnly: true });
    form.env.push({ key: "A", value: "b c" });
    form.restart = "unless-stopped";
    form.command = 'nginx -g "daemon off;"';
    const args = runArgs(form);
    expect(args).toEqual([
      "run",
      "--detach",
      "--name",
      "web",
      "--publish",
      "80:80",
      "--volume",
      "site:/usr/share/nginx/html:ro",
      "--env",
      "A=b c",
      "--restart",
      "unless-stopped",
      "--",
      "nginx:1.27",
      "nginx",
      "-g",
      "daemon off;",
    ]);
    expect(shellLine(args)).toContain("--env 'A=b c'");
    expect(words("a 'b c' \"d e\"")).toEqual(["a", "b c", "d e"]);
    form.name = "-x";
    expect(() => runArgs(form)).toThrow();
    form.name = "";
    form.ports.push({ host: "99999", container: "80", proto: "tcp" });
    expect(() => runArgs(form)).toThrow();
  });
});
