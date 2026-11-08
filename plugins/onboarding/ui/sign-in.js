// Scene 5's decisions, without the DOM, so vitest can test them (plugins/onboarding/tests). The desk
// signs in with endue ID at auth.endue.ai (ADR 0111): account.signIn opens endue ID's page, the same
// Keycloak pages the endue.ai web uses, and account.changed says how it went. The entry copies the
// web's own (refs/auth.md §4.2): its eyebrow, headline and subtitle, and its two entry buttons.
import { SAY } from "./script.js";

/** The scope every account.* call names; the first run's manifest declares it. */
export const ACCOUNT = { permission: "account:manage" };

export const ENTRY = {
  eyebrow: "Your own AI, a world of possibility",
  headline: "A little more you.",
  accent: "A lot more possible.",
  subtitle: "Meet your AI. Give it character, connect your tools, and make things happen.",
  signIn: "Sign in with endue ID",
  create: "Create account",
  note: "Start free. No card required.",
  skip: "Skip for now",
};

export const WAITING = {
  title: "Finish in your browser",
  confirm: "Confirm this code on the endue ID page.",
  signUp: "If the page asks you to sign in, choose “New to Endue? Create an account”.",
  openAgain: "Open browser again",
  cancel: "Cancel",
};

/** What the waiting card says while the code still holds but endue is slow or out of reach. */
const NOTICES = {
  "slow-down": "endue asked me to check less often. Still waiting.",
  offline: "Can't reach endue right now. The code still works; I'll keep checking.",
  unavailable: "endue isn't answering right now. The code still works; I'll keep checking.",
};

/** What Eris says when a sign-in ends without a session, by reason. */
const FAILURES = {
  expired: SAY.failure,
  failed: SAY.failure,
  denied: "You turned it down in the browser. Open it again whenever you like.",
  offline: SAY.offline,
  "slow-down": "endue asked us to slow down. Give it a minute, then try again.",
  unavailable: "endue isn't answering right now. Let's try again in a moment.",
  suspended: "That account is suspended. Write to team@endue.ai, or skip for now.",
};

/** The page where the code is confirmed, as people read it: `auth.endue.ai/realms/endue/device`. */
export function pageOf(signIn) {
  return (signIn?.verificationUri ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/**
 * What a change of the account from `before` (its state) to `next` means for the scene, started on
 * `screen`: the waiting card, a session (a fresh one after Create account), a failure Eris words, or
 * back to the entry after Cancel. `null` changes nothing.
 */
export function step(before, next, screen) {
  if (next.state === "signed-in") {
    if (before === "signed-in") return null;
    return { kind: "signed-in", line: screen === "sign-up" ? SAY.fresh : SAY.success };
  }
  if (next.state === "signing-in") {
    if (!next.signIn) return null;
    return {
      kind: "waiting",
      code: next.signIn.userCode,
      page: pageOf(next.signIn),
      signUp: next.signIn.screen === "sign-up",
      notice: NOTICES[next.reason] ?? null,
    };
  }
  if (before !== "signing-in") return null;
  if (!next.reason) return { kind: "entry" };
  return failure(next.reason);
}

/** A sign-in that ended on `reason`: Eris's line, and what the button that tries again says. */
export function failure(reason) {
  const opensAgain = reason === "expired" || reason === "failed" || reason === "denied";
  return {
    kind: "failed",
    reason,
    line: FAILURES[reason] ?? SAY.failure,
    retry: opensAgain ? "Open it again" : "Try again",
  };
}

/** Three failed sign-ins bring the help line. */
export const needsHelp = (failures) => failures >= 3;
