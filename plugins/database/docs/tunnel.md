# SSH tunnels (PG-10)

A PostgreSQL server that only a bastion host can reach is opened through an SSH tunnel. The desk core
opens the tunnel itself, one SSH connection for each session: no `ssh` program runs and no port is
opened on this computer. ADR 0359 has the why.

- The connection form's **SSH tunnel** section (PostgreSQL only): **SSH host** (empty: no tunnel),
  **SSH port** (22), **SSH user**, **Sign in with** (a key file, the SSH agent, or a password asked when
  connecting), **SSH key file** (a full path, `/` or `~/`) and an optional **Jump host** written
  `user@host:port`. The jump host signs in as the SSH host does: the same key file, or the agent for the
  agent and for a password. Host and port above are the database as the SSH host reaches it.
- `db:connect` is asked for the database and every hop's `host:port` together (`tunnel/open.js`).
- The first connect shows the SSH host's key fingerprint (`ssh-ed25519 SHA256:...`) and connects only on
  yes; the core keeps it for this plugin (`db-ssh-hosts.json`). A key that changes later is refused with
  both fingerprints. **Database: forget the SSH host key** forgets a connection's hops after a yes, and
  the next connect asks again.
- The core reads the key file; its content never reaches the plugin. An encrypted key's passphrase and
  an SSH password are asked with the password prompt, held in memory for the desk's session, forgotten
  when refused, on Disconnect, Forget password and Remove, and never written to the store, the keychain,
  a log or the history. Agents' runs and quiet reads never ask.
- An error names the hop that failed: the jump host or the SSH host (connect, host key, sign-in), the
  SSH host not reaching the database, then the database itself.
- Backups and restores run pg_dump and pg_restore straight to the database: they do not go through the
  tunnel yet. A connections file carries the tunnel's fields and never a secret.

Tests: `tests/tunnel-fields.test.ts` (the form's checks, the jump host, the scope, the file),
`tunnel-open.test.ts` (host keys, secrets, hop errors, quiet runs, grants), `tunnel-command.test.ts`, and
`tunnel-live.test.ts` against a real SSH server (`ENDUE_DB_TEST_SSH*`).
