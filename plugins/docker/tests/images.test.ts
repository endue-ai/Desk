import { describe, expect, it } from "vitest";
import {
  buildArgs,
  createBuildProgress,
  createPullProgress,
  historyArgs,
  parseHistory,
} from "../ui/images.js";
import { BUILD, HISTORY, PULL } from "./fixtures-more";
import { engine, mount } from "./harness";

const INSPECT_IMAGE = JSON.stringify([
  {
    Id: "sha256:9431865c385c56c50707f2296920e460ca85097d2d3767caf0fc2d776007f8f7",
    Os: "linux",
    Architecture: "arm64",
    Variant: "v8",
    Created: "2026-10-20T04:38:33Z",
    Size: 438000000,
    Config: {
      Env: ["PATH=/usr/local/bin", "PG_MAJOR=17"],
      Cmd: ["postgres"],
      Entrypoint: ["docker-entrypoint.sh"],
      ExposedPorts: { "5432/tcp": {} },
      Labels: { maintainer: "the postgres image" },
    },
    RootFS: { Layers: ["sha256:a", "sha256:b"] },
  },
]);

describe("image history (DOCK-21)", () => {
  it("reads the layers, the instruction each ran and its size", () => {
    expect(historyArgs("postgres:17")).toEqual([
      "image",
      "history",
      "--no-trunc",
      "--format",
      "{{json .}}",
      "--",
      "postgres:17",
    ]);
    const layers = parseHistory(HISTORY);
    expect(layers.map((l) => [l.createdBy, l.bytes])).toEqual([
      ['CMD ["postgres"]', 0],
      ["EXPOSE map[5432/tcp:{}]", 0],
      [
        "RUN /bin/sh -c set -eux; apt-get update; apt-get install -y postgresql # buildkit",
        289_000_000,
      ],
      ["ADD file:6b2d45 in /", 97_200_000],
    ]);
    expect(layers[0]?.id).toMatch(/^sha256:9431/);
    expect(layers[1]?.id).toBe("");
  });

  it("opens an image's pane on its history and answers the command with the layers", async () => {
    const m = await mount({
      script: engine({
        "image history": { stdout: HISTORY },
        "image inspect": { stdout: INSPECT_IMAGE },
      }),
    });
    const layers = (await m.host.invoke("endue.docker.history", {
      image: "postgres:17",
    })) as unknown[];
    expect(layers).toHaveLength(4);
    expect(m.docker.last("image", "history")?.args.at(-1)).toBe("postgres:17");
    expect(m.view.panes.at(-1)).toMatchObject({
      kind: "image",
      title: "postgres:17",
      tab: "history",
      image: { info: { arch: "arm64/v8", cmd: "postgres", ports: ["5432/tcp"], layers: 2 } },
    });
    expect(m.view.shown.at(-1)).toBe("inspect");
    await expect(m.host.invoke("endue.docker.history", { image: "--all" })).rejects.toThrow(
      /not an image reference/,
    );
  });
});

describe("pull with progress", () => {
  it("counts the layers pulled or already there", () => {
    const progress = createPullProgress();
    for (const raw of PULL.slice(0, 4)) progress.feed(raw);
    expect(progress.progress()).toEqual({
      done: 1,
      total: 3,
      status: "1.27: Pulling from library/nginx",
    });
    for (const raw of PULL.slice(4)) progress.feed(raw);
    expect(progress.progress()).toEqual({
      done: 3,
      total: 3,
      status: "Downloaded newer image for nginx:1.27",
    });
  });

  it("shows a pull in an output pane with its progress, without taking the focus", async () => {
    const m = await mount({ script: engine({ pull: { stdout: `${PULL.join("\n")}\n` } }) });
    await m.keys.images?.();
    expect(await m.host.invoke("endue.docker.pull", { image: "nginx:1.27" })).toBe(
      "Pulled nginx:1.27.",
    );
    expect(m.view.panes.at(-1)).toMatchObject({
      kind: "op",
      title: "Pull nginx:1.27",
      op: { state: "done", progress: { done: 3, total: 3 } },
    });
    expect((m.view.panes.at(-1) as { op: { lines: string[] } }).op.lines).toHaveLength(12);
    expect(m.view.shown.at(-1)).toBe("images");
  });
});

describe("build from a Dockerfile (DOCK-20)", () => {
  it("builds in the Dockerfile's folder with plain progress, the tag checked", () => {
    expect(buildArgs({ dockerfile: "/Users/me/shop/Dockerfile", tag: "shop-web:dev" })).toEqual({
      args: [
        "build",
        "--progress",
        "plain",
        "-f",
        "/Users/me/shop/Dockerfile",
        "-t",
        "shop-web:dev",
        "--",
        "/Users/me/shop",
      ],
      cwd: "/Users/me/shop",
    });
    expect(
      buildArgs({ dockerfile: "/a/Dockerfile.dev", context: "/a/b/", pull: true, noCache: true })
        .args,
    ).toEqual([
      "build",
      "--progress",
      "plain",
      "-f",
      "/a/Dockerfile.dev",
      "--pull",
      "--no-cache",
      "--",
      "/a/b",
    ]);
    expect(() => buildArgs({ dockerfile: "Dockerfile" })).toThrow(/absolute path/);
    expect(() => buildArgs({ dockerfile: "/a/Dockerfile", tag: "-q" })).toThrow(/image reference/);
  });

  it("follows BuildKit's steps", () => {
    const progress = createBuildProgress();
    for (const raw of BUILD.slice(0, 6)) progress.feed(raw);
    expect(progress.progress()).toMatchObject({
      done: 1,
      total: 3,
      status: "Step 2/3: COPY package.json .",
    });
    for (const raw of BUILD.slice(6)) progress.feed(raw);
    expect(progress.progress()).toEqual({
      done: 3,
      total: 3,
      status: "Step 3/3: RUN npm install",
      error: "",
    });
    progress.feed(
      '#9 ERROR: process "/bin/sh -c false" did not complete successfully: exit code: 1',
    );
    expect(progress.progress().error).toBe(
      'process "/bin/sh -c false" did not complete successfully: exit code: 1',
    );
  });

  it("streams a build into the output pane, and says why it failed", async () => {
    let fail = false;
    const m = await mount({
      commands: { "desk.palette.pick": (args: unknown) => pickBuild(args) },
      script: engine({
        build: () =>
          fail
            ? {
                code: 1,
                stderr: `${BUILD.slice(0, 8).join("\n")}\n#7 ERROR: process "/bin/sh -c npm install" did not complete successfully: exit code: 1\nERROR: failed to build: failed to solve: exit code: 1\n`,
              }
            : { stderr: `${BUILD.join("\n")}\n` },
      }),
    });
    expect(
      await m.host.invoke("endue.docker.build", {
        dockerfile: "/Users/me/shop/Dockerfile",
        tag: "shop-web:dev",
      }),
    ).toBe("Built shop-web:dev.");
    expect(m.docker.last("build")?.cwd).toBe("/Users/me/shop");
    expect(m.view.panes.at(-1)).toMatchObject({
      kind: "op",
      title: "Build shop-web:dev",
      op: { state: "done", progress: { done: 3, total: 3 } },
    });
    fail = true;
    await m.keys.build?.();
    expect(m.docker.last("build")?.args).toEqual([
      "build",
      "--progress",
      "plain",
      "-f",
      "/Users/me/api/Dockerfile",
      "-t",
      "api:next",
      "--",
      "/Users/me/api",
    ]);
    expect(m.view.panes.at(-1)).toMatchObject({
      op: {
        state: "failed",
        error: 'process "/bin/sh -c npm install" did not complete successfully: exit code: 1',
      },
    });
    expect(m.view.said.at(-1)).toMatch(/^The build failed: process/);
  });
});

/** The palette's answers when the keys ask for a Dockerfile and a tag. */
function pickBuild(args: unknown) {
  const title = (args as { title: string }).title;
  if (/Dockerfile/.test(title)) return "/Users/me/api/Dockerfile";
  if (/tag/.test(title)) return "api:next";
  return "";
}

describe("prune with a preview", () => {
  it("says in the question what goes and how much it frees", async () => {
    const m = await mount({
      commands: { "desk.palette.pick": () => "yes" },
      script: engine({ "image prune": { stdout: "Total reclaimed space: 394MB\n" } }),
    });
    expect(await m.host.invoke("endue.docker.prune-images")).toBe("Freed 394MB.");
    const asked = m.ran("desk.palette.pick").at(-1) as {
      items: Array<{ id: string; detail?: string }>;
    };
    expect(asked.items[0]).toEqual({
      id: "yes",
      label: "Remove them",
      detail: "1 image, 394 MB: 0e4a9e06ad09",
    });
    await m.host.invoke("endue.docker.prune", {});
    const system = m.ran("desk.palette.pick").at(-1) as { items: Array<{ detail?: string }> };
    expect(system.items[0]?.detail).toBe(
      "1 stopped container, 1 dangling image (394 MB), 2 unused networks, 17.7 GB of build cache",
    );
  });
});
