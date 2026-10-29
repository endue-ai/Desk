/// <reference types="vite/client" />
// Development page: the shell on the browser bridge stubs (the core's, kept in localStorage, and the
// shell's) and the real clock. `pnpm dev`.
import type { PluginManifest } from "@endue-ai/bridge";
import "../src/desk.css";
import "../src/shell/styles";
import { browserBridge } from "../src/bridge/browser";
import { browserCore, localStore } from "../src/bridge/core";
import erisReply from "../src/bridge/envelopes/eris-reply.json";
import userHello from "../src/bridge/envelopes/user-hello.json";
import { realClock } from "../src/clock";
import { mountDesk } from "../src/shell/Desk";

const root = document.getElementById("desk");
if (!root) throw new Error("no #desk element");
const clock = realClock();
const bridge = browserBridge({ now: () => clock.now() });
const params = new URLSearchParams(location.search);
const manifests = import.meta.glob<PluginManifest>("../../../plugins/*/plugin.json", {
  eager: true,
  import: "default",
});
const core = browserCore({
  manifests: Object.values(manifests).filter((m) => m.id.startsWith("desk.")),
  store: localStore("desk.core."),
  init: { profile: "morning" },
});
const desk = mountDesk({
  root,
  bridge,
  core: core.client,
  plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
  clock,
  lang: params.get("lang") === "en" ? "en" : "ko",
});

// Shift+U plays a recorded "user speaking" envelope, Shift+E an Eris reply, for trying the rings.
window.addEventListener("keydown", (e) => {
  if (!e.shiftKey || document.activeElement instanceof HTMLInputElement) return;
  if (e.key === "U") {
    desk.eris.setState("listening");
    bridge.fake.play("user", userHello);
  }
  if (e.key === "E") {
    bridge.fake.play("eris", erisReply);
    desk.eris.say("Good morning. Your first meeting is at nine thirty.", [
      { word: "Good", at: 0 },
      { word: "morning.", at: 200 },
      { word: "Your", at: 420 },
      { word: "first", at: 640 },
      { word: "meeting", at: 900 },
      { word: "is", at: 1120 },
      { word: "at", at: 1240 },
      { word: "nine", at: 1340 },
      { word: "thirty.", at: 1500 },
    ]);
  }
});
void desk.ready.then(() => desk.eris.say("Good morning. The desk is yours."));
