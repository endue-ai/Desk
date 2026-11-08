// Scenes 6 and 7: the desk's frame switches on piece by piece, the person chooses what Eris may look
// at, and endue's agents join the left bar. The folder picker and the connectors are not connected
// yet, so a chosen card connects to sample data (samples.js).
import { $, centre, EASE, element, reduced } from "./director.js";
import { CALENDAR, findOverlap } from "./samples.js";
import { AGENT_SAY, AGENTS, SAY, SOURCES } from "./script.js";

/** The frame, in the order it switches on: where it sits, and the edge its line is drawn from. */
const PIECES = [
  { id: "mode", origin: "0 50%", from: "scaleX(0)" },
  { id: "desktops", origin: "100% 50%", from: "scaleX(0)" },
  { id: "toolbar", origin: "100% 50%", from: "scaleY(0)" },
  { id: "dock", origin: "50% 100%", from: "scaleX(0)" },
  { id: "bar", origin: "0 50%", from: "scaleY(0)" },
];

/** Build the frame: mode name, virtual desktops, status toolbar, dock, the left bar with Eris's slot. */
export function buildFrame(d, at, { instant = false } = {}) {
  const frame = $("frame");
  const mode = element("div", "mode", "endue");
  const desktops = element("div", "desktops");
  for (const n of ["1", "2", "3"]) desktops.append(element("span", n === "1" ? "on" : "", n));
  const bar = element("div", "bar");
  bar.append(element("div", "slot eris-slot"));
  frame.replaceChildren(mode, desktops, element("div", "toolbar"), element("div", "dock"), bar);
  PIECES.forEach((piece, i) => {
    const node = frame.querySelector(`.${piece.id}`);
    node.style.transformOrigin = piece.origin;
    const when = instant ? at : at + i * 500;
    d.timeline.add(
      node.animate(
        [
          { opacity: 0, transform: piece.from },
          { offset: 0.6, opacity: 1 },
          { opacity: 1, transform: "none" },
        ],
        { delay: when, duration: instant || reduced ? 0 : 600, easing: EASE, fill: "both" },
      ),
    );
    if (!instant) d.timeline.at(when, () => d.sound.click());
  });
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
  buildFrame(d, at);
  const first = d.say(SAY.desk, at + 200);
  const question = d.say(SAY.world, first.out + 300, { stay: true });
  d.timeline.at(first.out + 1300, () => cards(d, question));
}

function cards(d, question) {
  const note = "Pickers and connectors are not connected yet: a card connects to sample data.";
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
      if (d.state.connections.includes(source.id)) return;
      d.state.connections.push(source.id);
      button.setAttribute("aria-pressed", "true");
      button.disabled = true;
      fly(d, button);
      connect(d, source.id, d.timeline.time + 600);
      finished.textContent = "Done";
    },
  }));
  const buttons = d.edge([...choices, { label: "Later", pick: done }], "card");
  const finished = buttons[buttons.length - 1];
  finished.classList.add("quiet");
  $("edge").append(element("p", "note", note));
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

/** Put an agent's circle in the left bar: flying in from deep in the screen, or already there. */
export function placeAgent(d, agent, at, { instant = false, dim = false } = {}) {
  const bar = $("frame").querySelector(".bar");
  const slot = element("div", `slot agent${dim ? " dim" : ""}`);
  slot.dataset.agent = agent.id;
  slot.style.setProperty("--agent", agent.color);
  slot.append(element("span", "initial", agent.name.slice(0, 1)), element("div", "say"));
  bar.append(slot);
  if (instant) return slot;
  const target = centre(slot);
  const root = $("root");
  const dx = root.offsetWidth / 2 - target.x;
  const dy = root.offsetHeight / 2 - target.y;
  d.timeline.add(
    slot.animate(
      [
        { opacity: 0, filter: "blur(8px)", transform: `translate(${dx}px, ${dy}px) scale(0.2)` },
        { opacity: dim ? 0.35 : 1, filter: "blur(0px)", transform: "none" },
      ],
      { delay: at, duration: reduced ? 200 : 900, easing: EASE, fill: "both" },
    ),
  );
  d.timeline.at(at + 900, () => d.sound.click());
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
      d.say(text, when + 900, { into: slot.querySelector(".say"), who: agent.name, speak: false });
    });
  };
  for (const agent of AGENTS) {
    join(agent, next);
    next += agent.speaks ? 3600 : 900;
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
