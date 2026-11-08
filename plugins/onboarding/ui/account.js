// Scene 5: endue ID (ADR 0111). Eris asks the person to sign in; the entry offers Sign in, Create
// account and Skip for now, the way the endue.ai web's entry does. Signing in opens endue ID's own
// pages at auth.endue.ai in the browser, where the person signs in or signs up and confirms the
// code; Eris moves up and waits with the code, and the desk finishes by itself on account.changed.
// Every failure has Eris's line and a way to try again; three bring the help line.
import { $, element } from "./director.js";
import { SAY } from "./script.js";
import { ACCOUNT, ENTRY, failure, needsHelp, step, WAITING } from "./sign-in.js";

const HELP = "Still stuck? Write to team@endue.ai.";
const PATIENCE = 20000;

/** Scene 5 from `at`. */
export function signIn(d, at) {
  d.timeline.at(at, () => {
    $("skip").hidden = true;
  });
  const yours = d.say(SAY.yours(d.state.name), at);
  const scene = {
    d,
    line: d.say(SAY.signIn, yours.out + 300, { stay: true }),
    said: null,
    screen: "sign-in",
    state: "signed-out",
    shown: "",
    failures: 0,
    waits: 0,
    up: false,
    patient: false,
    done: false,
    off: null,
  };
  d.timeline.at(yours.out + 1300, () => void begin(scene));
}

const call = (d, method, params = {}) => d.ctx.bridge.call(method, { scope: ACCOUNT, ...params });

/** Ask how the account stands: a desk without endue ID goes on locally, a signed-in one goes on. */
async function begin(scene) {
  const { d } = scene;
  let now;
  try {
    now = await call(d, "account.status");
  } catch {
    return stayLocal(scene);
  }
  if (d.current !== "sign-in" || scene.done) return;
  scene.off = d.ctx.bridge.onEvent((event) => {
    if (event.event === "account.changed") heard(scene, event.data);
  });
  if (now.state === "signed-in") return finish(scene, SAY.success);
  if (now.state === "signing-in") return heard(scene, now);
  entry(scene);
}

function button(label, primary, run) {
  const node = element(
    "button",
    `btn desk-btn${primary ? " primary desk-btn-primary" : ""}`,
    label,
  );
  node.type = "button";
  node.addEventListener("click", run);
  return node;
}

const leave = (scene, key, at) => {
  scene.d.drop(scene[key], at);
  scene[key] = null;
};

/** The web's entry: eyebrow, headline, subtitle, Sign in and Create account; Skip on the edge. */
function entry(scene) {
  const { d } = scene;
  scene.shown = "entry";
  const card = element("div", "entry");
  card.setAttribute("role", "group");
  card.setAttribute("aria-labelledby", "entry-title");
  const title = element("h2", "entry-title", `${ENTRY.headline} `);
  title.id = "entry-title";
  title.append(element("span", "entry-accent", ENTRY.accent));
  const actions = element("div", "entry-actions");
  actions.append(
    button(ENTRY.signIn, true, () => open(scene, "sign-in")),
    button(ENTRY.create, false, () => open(scene, "sign-up")),
  );
  card.append(
    element("p", "entry-eyebrow", ENTRY.eyebrow),
    title,
    element("p", "entry-sub", ENTRY.subtitle),
    actions,
    element("p", "entry-note", ENTRY.note),
  );
  $("formslot").replaceChildren(card);
  d.edge([{ label: ENTRY.skip, pick: () => stayLocal(scene) }], "btn quiet");
}

/** Offline, the browser is not opened: Eris says so, and the entry comes back with the connection. */
function open(scene, screen) {
  const { d } = scene;
  const now = d.timeline.time;
  scene.screen = screen;
  scene.shown = "";
  $("formslot").replaceChildren();
  $("edge").replaceChildren();
  if (!navigator.onLine) leave(scene, "line", now);
  d.whenOnline(now, (at, waited) => (waited ? entry(scene) : void start(scene, at)));
}

async function start(scene, at) {
  leave(scene, "line", at);
  let status;
  try {
    status = await call(scene.d, "account.signIn", { screen: scene.screen });
  } catch {
    return failed(scene, failure("failed"));
  }
  // A sign-in that could not start answers why; the event after it changes nothing more.
  if (status.state === "signed-out" && status.reason) {
    scene.state = status.state;
    return failed(scene, failure(status.reason));
  }
  heard(scene, status);
}

function heard(scene, status) {
  if (scene.done) return;
  const change = step(scene.state, status, scene.screen);
  scene.state = status.state;
  if (!change) return;
  if (change.kind === "waiting") return waiting(scene, change);
  if (change.kind === "signed-in") return finish(scene, change.line);
  if (change.kind === "entry") {
    rest(scene, scene.d.timeline.time);
    return entry(scene);
  }
  failed(scene, change);
}

/** Eris down from waiting, the patience line put away. */
function rest(scene, now) {
  scene.waits += 1;
  if (scene.up) scene.d.pose("centre", now);
  scene.up = false;
}

/** The browser is open: Eris moves up and waits; once, after 20 s, she says she is patient. */
function waiting(scene, change) {
  const { d } = scene;
  const now = d.timeline.time;
  if (!scene.up) {
    scene.up = true;
    d.pose("up", now);
    const wait = ++scene.waits;
    d.timeline.at(now + PATIENCE, () => {
      if (scene.waits !== wait || scene.patient || scene.done) return;
      scene.patient = true;
      d.say(SAY.patient, d.timeline.time);
    });
  }
  const shown = `waiting|${change.code}|${change.signUp}|${change.notice}`;
  if (scene.shown === shown) return;
  scene.shown = shown;
  const card = element("div", "entry entry-waiting");
  card.setAttribute("aria-live", "polite");
  const code = element("p", "entry-code", change.code);
  code.dataset.key = "code";
  card.append(
    element("p", "entry-eyebrow", WAITING.title),
    element("p", "entry-sub", WAITING.confirm),
    code,
    element("p", "entry-page", change.page),
  );
  if (change.signUp) card.append(element("p", "entry-note", WAITING.signUp));
  if (change.notice) card.append(element("p", "entry-notice", change.notice));
  const actions = element("div", "entry-actions");
  actions.append(
    // Asked again, the desk opens the same code's page again.
    button(WAITING.openAgain, true, () => void start(scene, d.timeline.time)),
    button(WAITING.cancel, false, () => void call(d, "account.signOut").catch(() => {})),
  );
  card.append(actions);
  $("formslot").replaceChildren(card);
  $("edge").replaceChildren();
}

function failed(scene, change) {
  const { d } = scene;
  const now = d.timeline.time;
  scene.failures += 1;
  scene.shown = "";
  rest(scene, now);
  $("formslot").replaceChildren();
  $("edge").replaceChildren();
  if (scene.said) leave(scene, "said", now);
  scene.said = d.say(change.line, now + 300, { stay: true });
  d.timeline.at(now + 300, () => {
    if (scene.done) return;
    const again = button(change.retry, true, () => {
      leave(scene, "said", d.timeline.time);
      open(scene, scene.screen);
    });
    const actions = element("div", "entry-actions");
    actions.append(again);
    $("formslot").replaceChildren(actions);
    if (needsHelp(scene.failures)) $("formslot").append(element("p", "help", HELP));
    d.edge([{ label: ENTRY.skip, pick: () => stayLocal(scene) }], "btn quiet");
  });
}

function end(scene, now) {
  scene.done = true;
  scene.off?.();
  rest(scene, now);
  $("formslot").replaceChildren();
  $("edge").replaceChildren();
  if (scene.line) leave(scene, "line", now);
  if (scene.said) leave(scene, "said", now);
}

/** Signed in: Eris comes back down, welcomes the person (a fresh account, even better) and goes on. */
function finish(scene, line) {
  const { d } = scene;
  const now = d.timeline.time;
  end(scene, now);
  d.state.local = false;
  const welcome = d.say(line, now + 300);
  d.advance(welcome.out + 300);
}

/** Skip for now: the desk works without an account, and endue's agents wait for one. */
function stayLocal(scene) {
  const { d } = scene;
  const now = d.timeline.time;
  if (scene.state === "signing-in") void call(d, "account.signOut").catch(() => {});
  end(scene, now);
  d.state.local = true;
  const said = d.say(SAY.local, now + 300);
  d.advance(said.out + 300);
}
