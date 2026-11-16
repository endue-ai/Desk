// Scenes 6 and 7: the desk's frame switches on piece by piece, the person chooses what Eris may look
// at, and endue's agents join the left bar. The folder picker and the connectors are not connected
// yet, so a chosen card connects to sample data (samples.js).

import { AGENT, boot, total } from "./boot.js";
import { $, centre, element } from "./director.js";
import { CALENDAR, findOverlap } from "./samples.js";
import { AGENT_SAY, AGENTS, SAY, SOURCES, SOURCES_NOTE } from "./script.js";

/**
 * The frame, in the order it boots: each piece forms in the middle of the screen (how: `from`; a
 * line draws itself along its long side) and flies out to its place. The desktops' buttons follow
 * their box one at a time, `step` ms after the piece before.
 */
const PIECES = [
  { find: ".mode", from: "scaleX(0)", step: 0 },
  { find: ".desktops", from: "scaleX(0)", step: 600 },
  { find: '.desktops [data-desktop="1"]', step: 600 },
  { find: '.desktops [data-desktop="2"]', step: 420 },
  { find: '.desktops [data-desktop="3"]', step: 420 },
  { find: ".toolbar", from: "scaleY(0)", step: 600 },
  { find: ".dock", from: "scaleX(0)", step: 600 },
  { find: ".bar", from: "scaleY(0)", step: 600 },
];

/**
 * Build the frame: mode name, virtual desktops, status toolbar, dock, the left bar with Eris's slot.
 * It boots piece by piece from `at` (instant: it simply stands); returns when the last piece lands.
 */
export function buildFrame(d, at, { instant = false } = {}) {
  const frame = $("frame");
  const mode = element("div", "mode", "endue");
  const desktops = element("div", "desktops");
  for (const n of ["1", "2", "3"]) {
    const button = element("span", n === "1" ? "on" : "", n);
    button.dataset.desktop = n;
    desktops.append(button);
  }
  const bar = element("div", "bar");
  bar.append(element("div", "slot eris-slot"));
  frame.replaceChildren(mode, desktops, element("div", "toolbar"), element("div", "dock"), bar);
  if (instant) return at;
  let when = at;
  let end = at;
  for (const piece of PIECES) {
    when += piece.step;
    end = Math.max(end, boot(d, frame.querySelector(piece.find), when, { from: piece.from }));
  }
  return end;
}

/** A connected source in the toolbar. */
export function connect(d, id, at) {
  const source = SOURCES.find((s) => s.id === id);
  const chip = element("div", "chip", source?.label ?? id);
  chip.dataset.source = id;
  $("frame").querySelector(".toolbar").append(chip);
  d.move(chip, [{ opacity: 0 }, { opacity: 1 }], at, 300);
}

/** Scene 6: the frame switches on while Eris says what the desk is, then she asks what to look at. */
export function desk(d, at) {
  const booted = buildFrame(d, at);
  const first = d.say(SAY.desk, at + 200);
  // She asks once the frame has booted: the cards come up along an edge that is already there.
  const question = d.say(SAY.world, Math.max(first.out + 300, booted + 200), { stay: true });
  d.timeline.at(Math.max(first.out + 1300, booted + 1200), () => cards(d, question));
}

/** The cards along the edge: a press chooses a source, a second takes it back (issue 161, #19). */
function cards(d, question) {
  const done = () => {
    const now = d.timeline.time;
    $("edge").replaceChildren();
    d.drop(question, now);
    if (d.state.connections.length === 0) return d.advance(now + 600);
    const chosen = d.say(SAY.chosen, now + 300);
    d.advance(chosen.out + 300);
  };
  const choices = SOURCES.map((source) => ({
    label: source.label,
    pressed: false,
    pick: (button) => {
      const chosen = d.state.connections.includes(source.id);
      if (chosen) {
        d.state.connections = d.state.connections.filter((id) => id !== source.id);
        $("frame").querySelector(`.toolbar [data-source="${source.id}"]`)?.remove();
      } else {
        d.state.connections.push(source.id);
        fly(d, button);
        connect(d, source.id, d.timeline.time + 600);
      }
      button.setAttribute("aria-pressed", String(!chosen));
      finished.textContent = d.state.connections.length > 0 ? "Done" : "Later";
    },
  }));
  const buttons = d.edge([...choices, { label: "Later", pick: done }], "card");
  const finished = buttons[buttons.length - 1];
  finished.classList.add("quiet");
  $("edge").append(element("p", "note", SOURCES_NOTE));
  buttons[0]?.focus();
}

/** A chosen card's copy flies into the toolbar, where its source shows as connected. */
function fly(d, button) {
  const from = centre(button);
  const to = centre($("frame").querySelector(".toolbar"));
  const ghost = element("div", "ghost", button.textContent);
  Object.assign(ghost.style, { left: `${from.x}px`, top: `${from.y}px` });
  $("root").append(ghost);
  const now = d.timeline.time;
  d.move(
    ghost,
    [
      { opacity: 1, transform: "translate(-50%, -50%)" },
      {
        opacity: 0,
        transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px)) scale(0.4)`,
      },
    ],
    now,
    600,
  );
  d.timeline.at(now + 700, () => ghost.remove());
}

/** How long an agent takes from the middle of the screen to its circle in the bar. */
export const JOIN = total(AGENT);

/** Put an agent's circle in the left bar: forming in the middle of the screen first, or already there. */
export function placeAgent(d, agent, at, { instant = false, dim = false } = {}) {
  const bar = $("frame").querySelector(".bar");
  const slot = element("div", `slot agent${dim ? " dim" : ""}`);
  slot.dataset.agent = agent.id;
  slot.style.setProperty("--agent", agent.color);
  slot.append(element("span", "initial", agent.name.slice(0, 1)), element("div", "say"));
  bar.append(slot);
  if (instant) return slot;
  boot(d, slot, at, { opacity: dim ? 0.35 : 1, color: agent.color, times: AGENT });
  return slot;
}

/** Scene 7: Tin and Seed join and say one line each next to their circle; Muse waits, dim. */
export function agents(d, at) {
  const first = d.say(SAY.team, at);
  const stopped = { now: false };
  const overlap = Boolean(findOverlap(CALENDAR.events));
  const calendar = d.state.connections.includes("calendar");
  let next = first.out + 600;
  const placed = new Set();
  const join = (agent, when) => {
    d.timeline.at(when, () => {
      if (stopped.now) return;
      placed.add(agent.id);
      const slot = placeAgent(d, agent, when, { dim: !agent.speaks });
      if (!agent.speaks) return;
      const text = AGENT_SAY[agent.id](calendar, overlap);
      d.say(text, when + JOIN, { into: slot.querySelector(".say"), who: agent.name, speak: false });
    });
  };
  for (const agent of AGENTS) {
    join(agent, next);
    next += agent.speaks ? JOIN + 2700 : JOIN;
  }
  d.timeline.at(at, () => {
    d.edge([{ label: "Later", pick: () => later(d, stopped, placed, first.out) }], "btn quiet");
  });
  d.timeline.at(next + 200, () => {
    if (stopped.now) return;
    stopped.now = true;
    $("edge").replaceChildren();
    const waiting = d.say(SAY.waiting, d.timeline.time);
    d.advance(waiting.out + 300);
  });
}

/** "Later": the agents who have not joined yet take their places dim, and Eris moves on. */
function later(d, stopped, placed, teamOut) {
  if (stopped.now) return;
  stopped.now = true;
  const now = d.timeline.time;
  $("edge").replaceChildren();
  for (const agent of AGENTS) {
    if (!placed.has(agent.id)) placeAgent(d, agent, now, { dim: true });
  }
  // One line at a time: if Eris is still saying she brings in the team, this comes after it.
  const line = d.say(SAY.edge, Math.max(now + 300, teamOut + 300));
  d.advance(line.out + 300);
}
