// Scenes 8-10: the first task builds a screen that did not exist a second ago, the person names the
// layout and it folds into the dock, and Eris settles into her slot at the top of the left bar.
import { $, centre, element, FIRST_RUN, LAYOUTS } from "./director.js";
import { examplesFor, layoutName, matchExample } from "./flow.js";
import { answer, folder, row, tomorrow, week } from "./panels.js";
import { moveAfter } from "./samples.js";
import { EXAMPLES, SAY } from "./script.js";

const CONVERSE = { permission: "brain:converse" };
const FAILED = "Something went wrong on my side. Try that again in a moment.";

/** Scene 8. Examples sit at the bottom edge; only those whose source is connected are offered. */
export function task(d, at) {
  const question = d.say(SAY.work, at, { stay: true });
  const offered = examplesFor(d.state.connections, EXAMPLES);
  const start = (value) => {
    const text = value.trim();
    if (!text) return;
    const now = d.timeline.time;
    d.answered();
    $("edge").replaceChildren();
    d.drop(question, now);
    d.rise(text, now);
    // The examples are built from what was connected; anything else needs endue.
    const kind = matchExample(text, offered) ?? "answer";
    if (kind !== "answer") return build(d, kind, text, now);
    d.whenOnline(now + 1500, (when, waited) => build(d, kind, text, waited ? when - 1500 : now));
  };
  d.timeline.at(at + 600, () => {
    d.edge(
      offered.map((example) => ({ label: example.text, pick: () => start(example.text) })),
      "btn example",
    );
  });
  d.ask(at, { question, label: "Type a task", placeholder: "Or say it", answer: start });
}

const SCREENS = { tomorrow, folder, week, answer };

/** Polygons break off the orb's rim, fly to the canvas and open into panels; Eris steps aside. */
function build(d, kind, text, now) {
  const screen = SCREENS[kind](text);
  d.screen = { kind, text, ...screen };
  $("canvas").replaceChildren(...screen.panels);
  const compose = now + 1500;
  shards(d, screen.panels, compose);
  d.pose("aside", compose + 300);
  screen.panels.forEach((piece, i) => {
    d.move(
      piece,
      [
        { opacity: 0, transform: "scale(0.6)" },
        { opacity: 1, transform: "none" },
      ],
      compose + 700 + i * 200,
      600,
    );
  });
  if (kind === "answer") converse(d, text, screen.body);
  const built = d.say(SAY.built, compose + 1700);
  if (screen.overlap) discord(d, screen, built.out + 300);
  else d.advance(built.out + 600);
}

function shards(d, panels, at) {
  const sphere = centre($("sphere"));
  panels.forEach((piece, p) => {
    const to = centre(piece);
    for (let i = 0; i < 3; i++) {
      const angle = ((-60 + p * 40 + i * 25) * Math.PI) / 180;
      const x = Math.round(sphere.x + 150 * Math.cos(angle));
      const y = Math.round(sphere.y + 150 * Math.sin(angle));
      const shard = element("div", "shard loose");
      Object.assign(shard.style, { left: `${x - 13}px`, top: `${y - 13}px` });
      $("root").append(shard);
      d.move(
        shard,
        [
          { opacity: 1, transform: "none" },
          { offset: 0.8, opacity: 1 },
          {
            opacity: 0,
            transform: `translate(${to.x - x}px, ${to.y - y}px) rotate(${90 + i * 60}deg) scale(3)`,
          },
        ],
        at + i * 80,
        800,
      );
      d.timeline.at(at + 1000, () => shard.remove());
    }
  });
}

/** Anything else goes to the brain; its answer streams into the panel, offline waits are said. */
function converse(d, text, body) {
  let turn = null;
  let notice = null;
  d.ctx.bridge.onEvent((event) => {
    if (event.event !== "brain.turn") return;
    const { turnId, kind, text: said } = event.data;
    turn ??= turnId; // Desk sends a plugin only its own turns
    if (turnId !== turn) return;
    if (kind === "delta") body.textContent += said ?? "";
    if (kind === "offline") notice = d.say(said ?? SAY.offline, d.timeline.time, { stay: true });
    if (kind === "online") d.drop(notice, d.timeline.time);
    if (kind === "error") body.textContent = said ?? FAILED;
  });
  d.ctx.bridge
    .call("brain.say", { text, scope: CONVERSE })
    .then((answer) => {
      turn ??= answer.turnId;
    })
    .catch(() => {
      body.textContent = FAILED;
    });
}

/** Two events overlap: the gold face lifts and Eris asks whether to move one. */
function discord(d, screen, at) {
  const [first, second] = screen.overlap;
  const line = d.say(SAY.discord(first.start, second.start), at, { stay: true });
  d.orb.headsUp(at);
  const resolve = (move) => {
    const now = d.timeline.time;
    $("edge").replaceChildren();
    d.drop(line, now);
    d.orb.headsUp(now, false);
    if (move) {
      const moved = moveAfter(second, first);
      Object.assign(second, moved);
      screen.list.querySelector(`[data-title="${second.title}"]`)?.replaceWith(row(moved));
      const card = screen.panels[1];
      if (card) d.move(card, [{ opacity: 1 }, { opacity: 0 }], now, 400);
    }
    d.advance(now + 1200);
  };
  d.timeline.at(at + 600, () => {
    d.edge([
      { label: `Move ${second.start}`, pick: () => resolve(true) },
      { label: "Leave it", pick: () => resolve(false) },
    ]);
  });
}

/** Scene 9. The named layout folds into a card in the dock and is kept in the current mode. */
export function layout(d, at) {
  let question = d.say(SAY.keep, at, { stay: true });
  const close = (now) => {
    d.answered();
    $("edge").replaceChildren();
    d.drop(question, now);
  };
  const notNow = () => {
    const now = d.timeline.time;
    close(now);
    fold(d, now, null);
    d.pose("centre", now + 600);
    d.advance(now + 1600);
  };
  const named = (value) => {
    const given = layoutName(value);
    const now = d.timeline.time;
    if (!given) {
      d.drop(question, now);
      question = d.say(SAY.again, now + 200, { stay: true });
      return;
    }
    close(now);
    d.rise(given, now);
    const saved = d.say(SAY.saved(given), now + 1300);
    fold(d, now + 1600, given);
    void keep(d, given);
    d.pose("centre", saved.out + 300);
    d.advance(saved.out + 1300);
  };
  d.timeline.at(at + 600, () => d.edge([{ label: "Not now", pick: notNow }], "btn quiet"));
  d.ask(at, { question, label: "Name this layout", placeholder: "Morning", answer: named });
}

/** The screen shrinks into a card that drops into the dock (or just fades, unnamed). */
function fold(d, at, name) {
  const canvas = $("canvas");
  const dock = $("frame").querySelector(".dock");
  const from = centre(canvas);
  const to = centre(dock);
  const frames = name
    ? [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(0.1)` },
      ]
    : [{ opacity: 1 }, { opacity: 0 }];
  d.move(canvas, frames, at, 800);
  d.timeline.at(at + 800, () => {
    canvas.replaceChildren();
    if (!name) return;
    const card = element("div", "saved", name);
    dock.append(card);
    d.move(card, [{ opacity: 0 }, { opacity: 1 }], at + 800, 300);
  });
}

/** Saved layouts belong to a mode; the first run's is the default mode, endue. */
async function keep(d, name) {
  const layouts = (await d.load(LAYOUTS)) ?? {};
  const mode = (layouts.endue ?? []).filter((saved) => saved.name !== name);
  mode.push({ name, screen: d.screen?.kind ?? "answer", text: d.screen?.text ?? "" });
  await d.store(LAYOUTS, { ...layouts, endue: mode });
}

/** Scene 10. The orb moves into its slot; "Hey Eris" stays two seconds, then follows her there. */
export function outro(d, at) {
  const first = d.say(SAY.tour, at);
  const sphere = $("sphere");
  const slot = $("frame").querySelector(".eris-slot");
  const from = centre(sphere);
  const to = centre(slot);
  const into = `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(${40 / 360})`;
  d.move(sphere, [{ transform: "none" }, { transform: into }], at + 600, 1200);
  d.timeline.at(at + 1800, () => slot.classList.add("filled"));
  const heyAt = first.out + 300;
  const hey = d.say(SAY.hey, heyAt, { stay: true });
  const leave = heyAt + SAY.hey.length * 55 + 2000;
  d.timeline.at(leave, () => {
    const line = hey.element;
    if (!line) return;
    const here = centre(line);
    d.move(
      line,
      [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: `translate(${to.x - here.x}px, ${to.y - here.y}px) scale(0.1)` },
      ],
      leave,
      700,
    );
  });
  d.timeline.at(leave + 800, async () => {
    await d.store(FIRST_RUN, { done: true, ...d.state });
    d.finish();
  });
}
