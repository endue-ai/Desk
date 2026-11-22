# desk-ssh

SSH tunnels for the core's PostgreSQL sessions (ADR 0359), on `russh` (=0.65.4, ring). A tunnel is
one SSH connection (through a jump host when there is one); each database stream it carries is a
`direct-tcpip` channel, so nothing listens on this computer. Its tasks run on one runtime thread,
`desk-ssh`. The crate knows nothing of plugins, grants or the bridge: `desk-core` checks those,
keeps the trusted host keys and hands the tunnel to `desk-pg` as its `Dial`.
Layer: Rust core. Status: password, key file and agent sign-in; Ed25519, ECDSA and RSA keys.

## Public API

- `open(Plan) -> Result<Tunnel, Failure>`: a `Plan` is the SSH host's `Hop` (host, port, user,
  `Auth`, `Trust`), an optional jump `Hop` and the timeout (`OPEN_TIMEOUT`, 10 s). Blocks the
  calling thread until both hops are signed in.
- `Auth`: `KeyFile { path, passphrase }` (read here, at most `MAX_KEY_FILE` 64 KiB, OpenSSH or PEM),
  `Agent { socket }` (`SSH_AUTH_SOCK`, or the OpenSSH agent's pipe on Windows), `Password`
  (keyboard-interactive when the server wants that). Secrets never reach `Debug` or a message.
- `Trust { known, accepted }`: a key other than `known` is refused as changed; with none known,
  only the `accepted` fingerprint (`SHA256:` and 43 base64 characters) opens.
- `Failure { which, stage, message, host_key, passphrase }`: the hop (`Which::Jump`, `Host`), the
  stage (`Connect`, `HostKey`, `Auth`, `Forward`), a sentence naming the hop, the key presented
  (`HostKey { status, algorithm, fingerprint, known }`) and whether a key's passphrase is
  `Needed` or `Wrong`.
- `Tunnel::dial(host, port)` (async) and `dial_blocking` open a `Stream` (AsyncRead, AsyncWrite)
  to the database as the SSH host reaches it; `presented()` names each hop's key. Dropping the
  tunnel disconnects both hops.
- `testing` (feature `testing`): an in-process SSH server on a loopback port, keys and an echo
  listener, for this crate's and the core's tests.

## Testing

`cargo test -p desk-ssh`: `tests/tunnel.rs` against the in-process server (host keys, key,
password and agent sign-in, an encrypted key, a jump host, closing). The core's
`tests/db_ssh_live.rs` runs a real SSH server and database (`ENDUE_DB_TEST_SSH*`).
