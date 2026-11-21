// Forgetting a password the keychain remembers (ADR 0311): Disconnect and forget. The session's
// password, the keychain's and the connection's choice go; the rest of the keychain flow (keeping,
// the choice in the form and the prompt, forgetting with the connection) is the manager's.

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "keychain",
  commands: (deps) => ({
    "endue.database.forget-password": ({ connection }) => deps.manager.forgetPassword(connection),
  }),
};
