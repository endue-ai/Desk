import { describe, expect, it } from "vitest";
import { subprocesses } from "./sandbox";

// `ps -axo pid=,ppid=,args=` while a CEF desk (pid 100) runs on macOS: its helpers live in the
// bundle's Frameworks folder, whose names have spaces; a terminal plugin's shell is its child too.
const app = "/A/endue-desk.app/Contents/Frameworks";
const PS = [
  "  100     1 /A/endue-desk.app/Contents/MacOS/endue-desk",
  `  101   100 ${app}/endue-desk Helper.app/Contents/MacOS/endue-desk Helper --type=gpu-process --seatbelt-client=27`,
  `  102   100 ${app}/endue-desk Helper.app/Contents/MacOS/endue-desk Helper --type=utility --utility-sub-type=network.mojom.NetworkService --service-sandbox-type=network`,
  `  103   100 ${app}/endue-desk Helper (Renderer).app/Contents/MacOS/endue-desk Helper (Renderer) --type=renderer --enable-features=A,B`,
  "  104   100 /bin/zsh -l",
  `  105   999 ${app}/endue-desk Helper (Renderer).app/Contents/MacOS/endue-desk Helper (Renderer) --type=renderer`,
  "not a process line",
].join("\n");

const BASE = "endue-desk Helper.app";

describe("the CEF desk's subprocesses from ps", () => {
  it("lists the children with a --type, their service, its sandbox type and helper app", () => {
    expect(subprocesses(PS, 100)).toEqual([
      { pid: 101, type: "gpu-process", service: undefined, sandbox: undefined, helper: BASE },
      {
        pid: 102,
        type: "utility",
        service: "network.mojom.NetworkService",
        sandbox: "network",
        helper: BASE,
      },
      {
        pid: 103,
        type: "renderer",
        service: undefined,
        sandbox: undefined,
        helper: "endue-desk Helper (Renderer).app",
      },
    ]);
  });

  it("leaves out another desk's helpers and finds none for a pid with no children", () => {
    expect(subprocesses(PS, 999).map((p) => p.pid)).toEqual([105]);
    expect(subprocesses(PS, 42)).toEqual([]);
  });
});
