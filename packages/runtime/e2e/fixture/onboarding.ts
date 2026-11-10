// Test page: the built-in Eris and onboarding plugins on the browser bridge stub. Never shipped.
//   ?plugins=onboarding (default) | eris | both    which plugins plugin.list returns
//   ?mic=grant (default) | deny                    how perm.request answers
//   ?name=<name>                                   a finished first run, as the core would remember it
//   ?resume=<scene>                                an interrupted first run (with ?name, ?connect=a,b)
//   ?brain=echo (default) | offline                how brain.say answers: like brain-echo, or offline
//   ?account=signed-out (default) | signed-in | none   the desk's endue ID; none serves no account.*
// The account follows the account.changed events the tests emit, as the core's would.
import {
  type AccountStatus,
  type BrainTurnKind,
  BridgeClient,
  type BridgeEvent,
  browserStub,
  type PluginInfo,
  type PluginManifest,
  type StubHandlers,
} from "@endue-ai/bridge";
import "../../src/desk.css";
import { createRuntime, ManualClock } from "../../src/index";

const root = document.getElementById("desk");
if (!root) throw new Error("no #desk element");
const query = new URLSearchParams(window.location.search);

const plugin = (manifest: PluginManifest): PluginInfo => ({
  id: manifest.id,
  status: "ready",
  enabled: true,
  builtIn: true,
  revision: 1,
  manifest,
});
const eris = plugin({
  id: "endue.eris",
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  permissions: [{ permission: "brain:converse" }],
  surfaces: [{ id: "main", title: "Eris", placement: "right" }],
});
const onboarding = plugin({
  id: "endue.onboarding",
  version: "0.2.0",
  kind: "ui",
  entry: "ui/index.html",
  permissions: [
    { permission: "audio:capture" },
    { permission: "brain:converse" },
    { permission: "account:manage" },
  ],
  surfaces: [{ id: "main", title: "Welcome", placement: "overlay" }],
});
const which = query.get("plugins") ?? "onboarding";
const plugins = which === "eris" ? [eris] : which === "both" ? [eris, onboarding] : [onboarding];

const store: Record<string, unknown> = {};
const name = query.get("name");
const resume = query.get("resume");
if (resume) {
  store["first-run"] = {
    done: false,
    scene: resume,
    name,
    listening: false,
    micAsked: true,
    connections: query.get("connect")?.split(",") ?? [],
    skipped: false,
    region: true,
  };
} else if (name) store["first-run"] = { done: true, name };
window.__deskStore = store;

const OFFLINE =
  "I can't reach endue right now. Check your connection, and I'll pick up where we left off.";
let turns = 0;

/** Answer like brain-echo on the page clock: started at 50 ms, a word every 50 ms, then completed. */
function brainSay(text: string): { turnId: string } {
  turns += 1;
  const turnId = `t${turns}`;
  const turn = (at: number, kind: BrainTurnKind, said?: string) =>
    setTimeout(
      () =>
        stub.emit({
          event: "brain.turn",
          data: { turnId, kind, ...(said === undefined ? {} : { text: said }) },
        }),
      at,
    );
  if (query.get("brain") === "offline") {
    turn(10, "offline", OFFLINE);
  } else {
    const words = text.match(/\S+\s*/g) ?? [];
    turn(50, "started");
    for (const [i, word] of words.entries()) turn(100 + i * 50, "delta", word);
    turn(100 + words.length * 50, "completed");
  }
  return { turnId };
}

const PAGE = "https://auth.endue.ai/realms/endue/device";
const signedIn: AccountStatus = {
  state: "signed-in",
  profile: { displayName: "Ada Lovelace", email: "ada@example.com" },
};
let account: AccountStatus =
  query.get("account") === "signed-in" ? signedIn : { state: "signed-out" };
const changed = (next: AccountStatus) => {
  account = next;
  // Addressed to the holders of account:manage, as the app delivers the core's (events.rs).
  const event = {
    event: "account.changed" as const,
    data: next,
    to: ["desk", "endue.onboarding"],
  };
  queueMicrotask(() => stub.emit(event as BridgeEvent));
  return next;
};
/** account.* as the core answers it (ADR 0111): a code on endue ID's page, then what tests emit. */
const accountHandlers: StubHandlers = {
  "account.status": () => account,
  "account.signIn": ({ screen }) => {
    if (account.state === "signing-in" && account.signIn) {
      return changed({ ...account, signIn: { ...account.signIn, screen: screen ?? "sign-in" } });
    }
    const complete = `${PAGE}?user_code=WDJB-MJHT${screen === "sign-up" ? "&prompt=create" : ""}`;
    const signIn = {
      userCode: "WDJB-MJHT",
      verificationUri: PAGE,
      verificationUriComplete: complete,
      screen: screen ?? "sign-in",
      expiresAt: "2026-11-07T10:10:00Z",
    };
    return changed({ state: "signing-in", signIn });
  },
  "account.signOut": () => changed({ state: "signed-out" }),
};

const clock = new ManualClock();
const stub = browserStub({
  ...(query.get("account") === "none" ? {} : accountHandlers),
  "perm.query": () => ({ grants: [] }),
  "plugin.list": () => ({ plugins }),
  "perm.request": () => ({ granted: query.get("mic") !== "deny" }),
  "store.get": ({ key }) => (key in store ? { value: store[key] } : {}),
  "store.set": ({ key, value }) => {
    store[key] = value;
    return {};
  },
  "brain.say": ({ text }) => brainSay(text),
});
stub.onEvent((event) => {
  if (event.event === "account.changed") account = event.data;
});
const runtime = createRuntime({
  root,
  bridge: new BridgeClient(stub),
  clock,
  platform: "other",
  plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
});

window.__desk = { clock, runtime, stub, commands: [] };
