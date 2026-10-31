import { describe, expect, it } from "vitest";
import {
  CREATED_BY,
  containerTarget,
  contextName,
  envSpecs,
  imageRef,
  listOf,
  logTarget,
  objectRef,
  portSpec,
  projectName,
  restartPolicy,
  runArgs,
  volumeSpec,
} from "../ui/refs.js";

describe("names", () => {
  it("lets through what docker allows and refuses anything that could read as an option", () => {
    expect(objectRef("shop-web-1")).toBe("shop-web-1");
    expect(objectRef("07879365b0f1")).toBe("07879365b0f1");
    for (const bad of ["", "-rf", "--help", "a b", "a/b", "é", "x".repeat(256), 3])
      expect(() => objectRef(bad), String(bad)).toThrow();
    expect(contextName("desktop-linux+arm")).toBe("desktop-linux+arm");
    for (const bad of ["", "-H", "a b", "tcp://x"]) expect(() => contextName(bad)).toThrow();
    expect(projectName("shop_v2-staging")).toBe("shop_v2-staging");
    for (const bad of ["Shop", "-p", "_x", ""]) expect(() => projectName(bad)).toThrow();
  });

  it("reads image references by the OCI distribution grammar", () => {
    for (const ok of [
      "nginx",
      "nginx:1.27-alpine",
      "library/nginx:latest",
      "ghcr.io/acme/api:v2.1.0",
      "localhost:5000/team/app",
      "[::1]:5000/app:dev",
      "registry.example.com/a/b/c@sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      "sha256:9431865c385c56c50707f2296920e460ca85097d2d3767caf0fc2d776007f8f7",
      "0e4a9e06ad09",
    ])
      expect(imageRef(ok), ok).toBe(ok);
    for (const bad of [
      "",
      "-v",
      "Nginx",
      "nginx:",
      "nginx:-x",
      "a//b",
      "a__-b",
      "nginx@sha256:abc",
      "a b",
      "x".repeat(256),
    ])
      expect(() => imageRef(bad), bad).toThrow();
  });
});

describe("run parts", () => {
  it("checks published ports", () => {
    for (const ok of [
      "80",
      "8080:80",
      "127.0.0.1:8080:80",
      "127.0.0.1::80",
      "[::1]:8080:80",
      "53:53/udp",
      "8000-8010:8000-8010",
      ":80",
    ])
      expect(portSpec(ok), ok).toBe(ok);
    for (const bad of [
      "",
      "0",
      "70000",
      "80:",
      "a:80",
      "80/http",
      "300.1.1.1:80:80",
      "1:2:3:4",
      "9-1",
      "[::1]80",
      "-p",
    ])
      expect(() => portSpec(bad), bad).toThrow();
  });

  it("takes environment as KEY=value lines or an object, never a bare key", () => {
    expect(envSpecs(["A=1", "B_C=x=y"])).toEqual(["A=1", "B_C=x=y"]);
    expect(envSpecs({ PORT: 80, NAME: "web" })).toEqual(["PORT=80", "NAME=web"]);
    expect(envSpecs(undefined)).toEqual([]);
    expect(() => envSpecs(["HOME"])).toThrow(/no value/);
    expect(() => envSpecs(["1A=x"])).toThrow();
    expect(() => envSpecs("A=1")).toThrow();
  });

  it("checks volumes: absolute targets, a path or a volume name as source, known options", () => {
    for (const ok of [
      "/data",
      "db:/var/lib/postgresql/data",
      "/srv/site:/usr/share/nginx/html:ro",
      "cache:/cache:rw,z",
    ])
      expect(volumeSpec(ok), ok).toBe(ok);
    for (const bad of ["", "data", "./src:/app", "~/x:/x", "db:data", "db:/data:exec", "a:/b:ro:x"])
      expect(() => volumeSpec(bad), bad).toThrow();
  });

  it("checks restart policies", () => {
    for (const ok of ["no", "always", "unless-stopped", "on-failure", "on-failure:5"])
      expect(restartPolicy(ok)).toBe(ok);
    for (const bad of ["", "sometimes", "on-failure:x"]) expect(() => restartPolicy(bad)).toThrow();
  });

  it("builds docker run with options first, then -- and the image and its command", () => {
    expect(
      runArgs({
        image: "nginx:1.27",
        name: "site",
        ports: ["8080:80"],
        env: ["MODE=prod"],
        volumes: ["/srv/site:/usr/share/nginx/html:ro"],
        restart: "unless-stopped",
        command: ["nginx", "-g", "daemon off;"],
      }),
    ).toEqual([
      "run",
      "-d",
      "--label",
      CREATED_BY,
      "--name",
      "site",
      "-p",
      "8080:80",
      "-e",
      "MODE=prod",
      "-v",
      "/srv/site:/usr/share/nginx/html:ro",
      "--restart",
      "unless-stopped",
      "--",
      "nginx:1.27",
      "nginx",
      "-g",
      "daemon off;",
    ]);
    expect(runArgs({ image: "alpine", name: "" })).toEqual([
      "run",
      "-d",
      "--label",
      CREATED_BY,
      "--",
      "alpine",
    ]);
    expect(() => runArgs({ image: "alpine", name: "x" })).toThrow(/two characters/);
    expect(() => runArgs({ image: "alpine", ports: "80" as unknown as string[] })).toThrow(/list/);
  });

  it("splits a typed list on commas and spaces", () => {
    expect(listOf(" 8080:80, 443:443  53:53/udp,")).toEqual(["8080:80", "443:443", "53:53/udp"]);
    expect(listOf(undefined)).toEqual([]);
  });
});

describe("targets", () => {
  const container = { kind: "container", id: "abc123", name: "web" };
  const shown = { id: "def456", name: "db" };

  it("takes a container from the args, the selection, then the detail on screen", () => {
    expect(containerTarget({ container: "named" }, container, shown)).toEqual({
      ref: "named",
      name: "named",
    });
    expect(containerTarget({}, container, shown)).toEqual({ ref: "abc123", name: "web" });
    expect(containerTarget({}, undefined, shown)).toEqual({ ref: "def456", name: "db" });
    expect(() => containerTarget({}, { kind: "image" }, null)).toThrow(/Select a container/);
    expect(() => containerTarget({ container: "-x" }, container, null)).toThrow(/not a name/);
  });

  it("takes logs from a project or a container", () => {
    expect(logTarget({ project: "shop" }, container, null)).toEqual({
      kind: "project",
      name: "shop",
    });
    expect(logTarget({}, { kind: "project", name: "shop" }, null)).toEqual({
      kind: "project",
      name: "shop",
    });
    expect(logTarget({}, container, null)).toEqual({
      kind: "container",
      id: "abc123",
      name: "web",
    });
    expect(() => logTarget({}, undefined, null)).toThrow(/container or a Compose project/);
    expect(() => logTarget({ container: "a b" }, undefined, null)).toThrow(/not a name/);
  });
});
