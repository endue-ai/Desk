/**
 * account.* on the browser stub (the fixtures, unit tests and the dev page; never shipped): the
 * desk's endue ID and the account's own settings on endue (ADR 0111, ADR 0130), kept in memory as
 * desk-core and endue keep them, so Settings, endue account can be drawn and driven without a core.
 * Signing in waits for `approve()`; a changed name reaches account.status and goes out as
 * account.changed, as the core's does. Fixture data only.
 * Mount it with `browserCore({ handlers: accountStub(emit).handlers })`.
 */
import {
  type AccountSettings,
  type AccountSettingsPart,
  type AccountStatus,
  type BridgeEvent,
  type ErrorCode,
  StubError,
  type StubHandlers,
} from "@endue-ai/bridge";

export interface AccountStubOptions {
  /** Start signed in (the default) or signed out. */
  signedIn?: boolean;
  /** Parts endue does not answer for, and the code they fail with. */
  failing?: Partial<Record<AccountSettingsPart, ErrorCode>>;
}

export interface AccountStub {
  handlers: StubHandlers;
  /** The settings endue keeps; tests read and edit them. */
  settings: AccountSettings;
  status(): AccountStatus;
  /** Finish the sign-in under way, as the browser would. */
  approve(): void;
  /** The next account.settings.update fails with `code`. */
  failNext(code: ErrorCode, message: string): void;
}

const DEVICE_PAGE = "https://auth.endue.ai/realms/endue/device";
const PROFILE = { displayName: "Ada Lovelace", email: "ada@example.com" };

export function sampleAccountSettings(): AccountSettings {
  return {
    user: {
      id: "usr_00000000-0000-4000-8000-000000000001",
      email: PROFILE.email,
      displayName: PROFILE.displayName,
      status: "active",
      joinedAt: "2026-03-14T09:00:00Z",
    },
    language: "en-US",
    timeZone: "Asia/Seoul",
    notifications: [
      { kind: "conversation-reply", inApp: true },
      { kind: "routine-completed", inApp: false },
      { kind: "routine-failed", inApp: true },
      { kind: "routine-skipped", inApp: true },
      { kind: "agent-notice", inApp: true },
    ],
    problems: [],
  };
}

const copy = <T>(value: T): T => structuredClone(value);

export function accountStub(
  emit: (event: BridgeEvent) => void,
  options: AccountStubOptions = {},
): AccountStub {
  let status: AccountStatus =
    options.signedIn === false
      ? { state: "signed-out" }
      : { state: "signed-in", profile: { ...PROFILE } };
  const settings = sampleAccountSettings();
  let failure: StubError | undefined;
  const changed = (next: AccountStatus) => {
    status = next;
    queueMicrotask(() => emit({ event: "account.changed", data: copy(status) }));
    return copy(status);
  };
  const answer = (): AccountSettings => {
    const now = copy(settings);
    for (const [part, code] of Object.entries(options.failing ?? {})) {
      if (part === "preferences") {
        delete now.language;
        delete now.timeZone;
      } else now.notifications = [];
      now.problems.push({
        part: part as AccountSettingsPart,
        code: code as ErrorCode,
        message: "endue did not answer",
      });
    }
    return now;
  };
  const signedIn = () => {
    if (status.state !== "signed-in")
      throw new StubError("signed_out", "Sign in to endue to see your account's settings.");
  };

  const handlers: StubHandlers = {
    "account.status": () => copy(status),
    "account.signIn": ({ screen }) =>
      changed({
        state: "signing-in",
        signIn: {
          userCode: "WDJB-MJHT",
          verificationUri: DEVICE_PAGE,
          verificationUriComplete: `${DEVICE_PAGE}?user_code=WDJB-MJHT`,
          screen: screen ?? "sign-in",
          expiresAt: "2026-11-09T09:10:00Z",
        },
      }),
    "account.signOut": () => changed({ state: "signed-out" }),
    "account.settings.get": () => {
      signedIn();
      return answer();
    },
    "account.settings.update": (params) => {
      signedIn();
      if (failure) {
        const error = failure;
        failure = undefined;
        throw error;
      }
      const name = params.displayName?.trim();
      if (name !== undefined) {
        if (!name || name.length > 200)
          throw new StubError("invalid_params", "the name must be 1 to 200 characters");
        settings.user.displayName = name;
      }
      if (params.avatarUrl !== undefined) {
        const url = params.avatarUrl.trim();
        if (url) settings.user.avatarUrl = url;
        else delete settings.user.avatarUrl;
      }
      if (params.language) settings.language = params.language;
      if (params.timeZone) settings.timeZone = params.timeZone;
      for (const change of params.notifications ?? []) {
        const known = settings.notifications.find((n) => n.kind === change.kind);
        if (known) known.inApp = change.inApp;
      }
      if (name !== undefined && status.state === "signed-in")
        changed({ ...status, profile: { ...status.profile, displayName: name } });
      return answer();
    },
  };
  return {
    handlers,
    settings,
    status: () => copy(status),
    approve() {
      if (status.state === "signing-in") changed({ state: "signed-in", profile: { ...PROFILE } });
    },
    failNext(code, message) {
      failure = new StubError(code, message);
    },
  };
}
