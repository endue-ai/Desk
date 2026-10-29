// The first run (docs/ko/first-run-scenario.md), scenes 1-10 on an overlay, which closes itself when
// it is done. A finished first run only says good morning next time; an interrupted one picks up at
// the scene it stopped in, without the arrival.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { buildOrb } from "eris/orb.js";
import { arrival, floor } from "./arrival.js";
import { agents, buildFrame, connect, desk, placeAgent } from "./desk.js";
import { $, ASSETS, Director, FIRST_RUN, reduced } from "./director.js";
import { RESUMABLE, standing } from "./flow.js";
import { greeting, microphone, name, showSkip, signIn } from "./meet.js";
import { AGENTS, SAY, TIMES } from "./script.js";
import { layout, outro, task } from "./work.js";

const SCENES = { microphone, name, "sign-in": signIn, desk, agents, task, layout, outro };

function firstRun(d) {
  d.scene("arrival");
  const shift = arrival(d);
  d.timeline.at(TIMES.skipVisible, () => showSkip(d));
  greeting(d, shift);
}

function welcomeBack(d, saved) {
  d.scene("welcome-back");
  d.orb = buildOrb(document, d.timeline, $("sphere"), { assets: ASSETS, reduced, quick: true });
  d.say(SAY.morning(saved.name), 1200, { stay: true });
  d.timeline.at(4200, () => d.finish());
}

/** A quick assembly, the desk as far as it was built, "Where were we?", and the scene it stopped in. */
function resume(d, saved) {
  d.scene("resume");
  const { done: _done, scene, ...state } = saved;
  Object.assign(d.state, state);
  d.orb = buildOrb(document, d.timeline, $("sphere"), { assets: ASSETS, reduced, quick: true });
  if (!reduced) floor(d, { instant: true });
  const built = standing(scene, d.state);
  if (built.frame) {
    buildFrame(d, 0, { instant: true });
    for (const id of d.state.connections) connect(d, id, 0);
  }
  if (built.agents) {
    for (const agent of AGENTS) placeAgent(d, agent, 0, { instant: true, dim: !agent.speaks });
  }
  if (d.state.listening) d.orb.listen(1200);
  const line = d.say(SAY.resume, 1200);
  d.go(scene, line.out + 300);
}

defineUiPlugin({
  async mount(ctx) {
    const d = new Director(ctx, SCENES);
    const saved = await d.load(FIRST_RUN);
    if (saved?.done) welcomeBack(d, saved);
    else if (RESUMABLE.includes(saved?.scene)) resume(d, saved);
    else firstRun(d);
  },
});
