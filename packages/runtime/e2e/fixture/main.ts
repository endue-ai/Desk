// Test page: the runtime on the browser bridge stub with a manual clock. Never shipped.
import { BridgeClient, browserStub } from "@endue-ai/bridge";
import "../../src/desk.css";
import { createRuntime, ManualClock } from "../../src/index";

const root = document.getElementById("desk");
if (!root) throw new Error("no #desk element");

const clock = new ManualClock();
const stub = browserStub({ "perm.query": () => ({ grants: [] }) });
const runtime = createRuntime({
  root,
  bridge: new BridgeClient(stub),
  clock,
  storage: window.localStorage,
  platform: "other",
});

window.__desk = { clock, runtime, stub, commands: [] };
