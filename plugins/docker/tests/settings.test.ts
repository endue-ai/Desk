import { describe, expect, it } from "vitest";
import { DEFAULTS, fromValues } from "../ui/settings.js";

describe("fromValues", () => {
  it("takes values of the right type and range, and keeps the default otherwise", () => {
    expect(fromValues({})).toEqual(DEFAULTS);
    expect(
      fromValues({
        "endue.docker.context": "build",
        "endue.docker.path": "/opt/tools/bin:/usr/bin",
        "endue.docker.stop-timeout": 30,
        "endue.docker.log-max": 50,
        "endue.docker.stats-interval": 2.5,
        "endue.docker.notify": "always",
        "endue.docker.shell": "/bin/bash -l",
        "endue.docker.confirm": "no",
        "endue.docker.reveal-env": true,
      }),
    ).toEqual({
      ...DEFAULTS,
      context: "build",
      path: "/opt/tools/bin:/usr/bin",
      stopTimeout: 30,
      revealEnv: true,
    });
    expect(
      fromValues({ "endue.docker.shell": "/bin/bash", "endue.docker.notify": "none" }),
    ).toMatchObject({
      shell: "/bin/bash",
      notify: "none",
    });
  });
});
