//! The tunnel against an SSH server in the test process (`desk_ssh::testing`): host keys trusted on
//! first use and refused when changed, the sign-ins, encrypted key files, a jump host first, and
//! the connection ending with the tunnel. Each failure names its hop.

use std::path::PathBuf;
use std::time::Duration;

use desk_ssh::testing::{self, Account, Server};
use desk_ssh::{Auth, Hop, KeyStatus, Passphrase, Plan, Stage, Trust, Which};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("desk-ssh-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A server that signs in `deploy` with `key` or the password `secret`.
fn server(client: &russh::keys::PrivateKey) -> Server {
    let account = Account {
        user: "deploy".to_owned(),
        password: Some("secret".to_owned()),
        keys: vec![client.public_key().clone()],
    };
    Server::start(testing::key(), account)
}

fn hop(server: &Server, auth: Auth, trust: Trust) -> Hop {
    Hop {
        host: "127.0.0.1".to_owned(),
        port: server.port,
        user: "deploy".to_owned(),
        auth,
        trust,
    }
}

fn accepted(server: &Server) -> Trust {
    Trust {
        known: None,
        accepted: Some(testing::fingerprint(&server.host_key)),
    }
}

fn plan(host: Hop) -> Plan {
    Plan {
        jump: None,
        host,
        timeout: Duration::from_secs(10),
    }
}

fn password(text: &str) -> Auth {
    Auth::Password(text.to_owned())
}

/// Bytes written through a dialled stream come back from the echo target.
fn echoes(tunnel: &desk_ssh::Tunnel, port: u16) {
    let mut stream = tunnel.dial_blocking("127.0.0.1", port).unwrap();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        stream.write_all(b"ping through the tunnel").await.unwrap();
        let mut back = [0u8; 23];
        stream.read_exact(&mut back).await.unwrap();
        assert_eq!(&back, b"ping through the tunnel");
    });
}

#[test]
fn an_unknown_host_key_is_answered_with_its_fingerprint() {
    let client = testing::key();
    let server = server(&client);
    let failure =
        desk_ssh::open(plan(hop(&server, password("secret"), Trust::default()))).unwrap_err();
    assert_eq!(
        (failure.which, failure.stage),
        (Which::Host, Stage::HostKey)
    );
    let key = failure.host_key.clone().unwrap();
    assert_eq!(key.status, KeyStatus::Unknown);
    assert_eq!(key.fingerprint, testing::fingerprint(&server.host_key));
    assert_eq!(key.algorithm, "ssh-ed25519");
    assert!(
        failure.message.starts_with("The SSH host 127.0.0.1:"),
        "{}",
        failure.message
    );
    assert!(
        failure.message.contains(&key.fingerprint),
        "{}",
        failure.message
    );
    assert_eq!(server.forwarded(), 0);
}

#[test]
fn an_accepted_key_opens_and_a_stream_reaches_the_target() {
    let client = testing::key();
    let server = server(&client);
    let echo = testing::echo();
    let tunnel = desk_ssh::open(plan(hop(&server, password("secret"), accepted(&server)))).unwrap();
    echoes(&tunnel, echo);
    // A second stream on the same connection, as a cancel request opens one.
    echoes(&tunnel, echo);
    assert_eq!(server.forwarded(), 2);
    assert_eq!(server.live(), 1);
    // The SSH host cannot reach the target: said with both ends.
    let refused = tunnel
        .dial_blocking("db.unreachable.test", 5432)
        .err()
        .unwrap();
    let text = refused.to_string();
    assert!(
        text.contains("The SSH host 127.0.0.1:") && text.contains("db.unreachable.test:5432"),
        "{text}"
    );
}

#[test]
fn a_changed_host_key_is_refused_with_both_fingerprints() {
    let client = testing::key();
    let server = server(&client);
    let before = testing::fingerprint(&testing::key());
    let trust = Trust {
        known: Some(before.clone()),
        accepted: Some(testing::fingerprint(&server.host_key)),
    };
    let failure = desk_ssh::open(plan(hop(&server, password("secret"), trust))).unwrap_err();
    assert_eq!(
        (failure.which, failure.stage),
        (Which::Host, Stage::HostKey)
    );
    let key = failure.host_key.clone().unwrap();
    assert_eq!(key.status, KeyStatus::Changed);
    assert_eq!(key.known.as_deref(), Some(before.as_str()));
    assert_eq!(key.fingerprint, testing::fingerprint(&server.host_key));
    assert!(failure.message.contains("refused"), "{}", failure.message);
    // The trusted key itself opens.
    let trust = Trust {
        known: Some(testing::fingerprint(&server.host_key)),
        accepted: None,
    };
    desk_ssh::open(plan(hop(&server, password("secret"), trust))).unwrap();
}

#[test]
fn key_password_and_agent_sign_ins_say_the_hop() {
    let dir = dir("auth");
    let client = testing::key();
    let server = server(&client);
    let path = testing::write_key(&dir, "id_ed25519", &client, None);
    let key = Auth::KeyFile {
        path: path.clone(),
        passphrase: None,
    };
    desk_ssh::open(plan(hop(&server, key, accepted(&server)))).unwrap();
    desk_ssh::open(plan(hop(&server, password("secret"), accepted(&server)))).unwrap();

    let wrong = testing::write_key(&dir, "other", &testing::key(), None);
    let key = Auth::KeyFile {
        path: wrong,
        passphrase: None,
    };
    let failure = desk_ssh::open(plan(hop(&server, key, accepted(&server)))).unwrap_err();
    assert_eq!((failure.which, failure.stage), (Which::Host, Stage::Auth));
    assert!(
        failure.message.starts_with("The SSH host 127.0.0.1:"),
        "{}",
        failure.message
    );
    assert!(
        failure.message.contains("refused the key") && failure.message.contains("deploy"),
        "{}",
        failure.message
    );

    let failure =
        desk_ssh::open(plan(hop(&server, password("not it"), accepted(&server)))).unwrap_err();
    assert_eq!(failure.stage, Stage::Auth);
    assert!(
        failure.message.contains("refused the password for deploy"),
        "{}",
        failure.message
    );

    let missing = Auth::Agent {
        socket: Some(dir.join("no-agent.sock")),
    };
    let failure = desk_ssh::open(plan(hop(&server, missing, accepted(&server)))).unwrap_err();
    assert_eq!(failure.stage, Stage::Auth);
    assert!(
        failure.message.contains("SSH agent does not answer"),
        "{}",
        failure.message
    );
    agent(&server, &dir, &path);
    let _ = std::fs::remove_dir_all(&dir);
}

/// With the system's `ssh-agent` holding the key, the agent signs in; skipped without one.
#[cfg(unix)]
fn agent(server: &Server, dir: &std::path::Path, key: &std::path::Path) {
    use std::process::{Command, Stdio};
    let socket = dir.join("agent.sock");
    let Ok(mut agent) = Command::new("ssh-agent")
        .arg("-D")
        .arg("-a")
        .arg(&socket)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    else {
        eprintln!("no ssh-agent: the agent sign-in is not tested here");
        return;
    };
    for _ in 0..100 {
        if socket.exists() {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let added = Command::new("ssh-add")
        .arg(key)
        .env("SSH_AUTH_SOCK", &socket)
        .stderr(Stdio::null())
        .status();
    assert!(added.is_ok_and(|s| s.success()), "ssh-add took no key");
    let auth = Auth::Agent {
        socket: Some(socket.clone()),
    };
    desk_ssh::open(plan(hop(server, auth, accepted(server)))).unwrap();
    let _ = agent.kill();
    let _ = agent.wait();
}

#[cfg(not(unix))]
fn agent(_: &Server, _: &std::path::Path, _: &std::path::Path) {}

#[test]
fn an_encrypted_key_needs_its_passphrase() {
    let dir = dir("passphrase");
    let client = testing::key();
    let server = server(&client);
    let path = testing::write_key(&dir, "id_ed25519", &client, Some("open sesame"));
    let with = |passphrase: Option<&str>| Auth::KeyFile {
        path: path.clone(),
        passphrase: passphrase.map(str::to_owned),
    };
    let failure = desk_ssh::open(plan(hop(&server, with(None), accepted(&server)))).unwrap_err();
    assert_eq!(
        (failure.stage, failure.passphrase),
        (Stage::Auth, Some(Passphrase::Needed))
    );
    // Nothing connected: the key file is read first.
    assert_eq!(server.live(), 0);
    let failure =
        desk_ssh::open(plan(hop(&server, with(Some("wrong")), accepted(&server)))).unwrap_err();
    assert_eq!(failure.passphrase, Some(Passphrase::Wrong));
    desk_ssh::open(plan(hop(
        &server,
        with(Some("open sesame")),
        accepted(&server),
    )))
    .unwrap();

    let not_a_key = dir.join("notes.txt");
    std::fs::write(&not_a_key, "a secret line that is not a key").unwrap();
    let auth = Auth::KeyFile {
        path: not_a_key,
        passphrase: None,
    };
    let failure = desk_ssh::open(plan(hop(&server, auth, accepted(&server)))).unwrap_err();
    assert!(
        failure.message.contains("holds no SSH private key"),
        "{}",
        failure.message
    );
    assert!(
        !failure.message.contains("a secret line"),
        "{}",
        failure.message
    );
    let auth = Auth::KeyFile {
        path: dir.join("missing"),
        passphrase: None,
    };
    let failure = desk_ssh::open(plan(hop(&server, auth, accepted(&server)))).unwrap_err();
    assert!(
        failure.message.contains("cannot be read"),
        "{}",
        failure.message
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_jump_host_goes_first() {
    let client = testing::key();
    let jump = server(&client);
    let host = server(&client);
    let echo = testing::echo();
    let through = |jump_auth: Auth, host_trust: Trust| Plan {
        jump: Some(hop(&jump, jump_auth, accepted(&jump))),
        host: hop(&host, password("secret"), host_trust),
        timeout: Duration::from_secs(10),
    };
    let tunnel = desk_ssh::open(through(password("secret"), accepted(&host))).unwrap();
    echoes(&tunnel, echo);
    // The jump host forwarded the SSH host's connection, the SSH host the stream.
    assert_eq!((jump.forwarded(), host.forwarded()), (1, 1));

    let failure = desk_ssh::open(through(password("not it"), accepted(&host))).unwrap_err();
    assert_eq!((failure.which, failure.stage), (Which::Jump, Stage::Auth));
    assert!(
        failure.message.starts_with("The jump host 127.0.0.1:"),
        "{}",
        failure.message
    );

    let failure = desk_ssh::open(through(password("secret"), Trust::default())).unwrap_err();
    assert_eq!(
        (failure.which, failure.stage),
        (Which::Host, Stage::HostKey)
    );

    let mut unreachable = through(password("secret"), accepted(&host));
    unreachable.host.host = "ssh.unreachable.test".to_owned();
    let failure = desk_ssh::open(unreachable).unwrap_err();
    assert_eq!(
        (failure.which, failure.stage),
        (Which::Jump, Stage::Forward)
    );
    assert!(
        failure
            .message
            .contains("could not reach the SSH host ssh.unreachable.test"),
        "{}",
        failure.message
    );
}

#[test]
fn the_tunnel_closes_when_dropped() {
    let client = testing::key();
    let server = server(&client);
    let echo = testing::echo();
    let tunnel = desk_ssh::open(plan(hop(&server, password("secret"), accepted(&server)))).unwrap();
    let stream = tunnel.dial_blocking("127.0.0.1", echo).unwrap();
    assert_eq!(server.live(), 1);
    drop(tunnel);
    assert!(
        server.wait_live(0),
        "the SSH connection outlived its tunnel"
    );
    // A stream that outlives its tunnel is dropped without a runtime of its own.
    drop(stream);

    let refused = Hop {
        port: closed_port(),
        ..hop(&server, password("secret"), Trust::default())
    };
    let failure = desk_ssh::open(plan(refused)).unwrap_err();
    assert_eq!(
        (failure.which, failure.stage),
        (Which::Host, Stage::Connect)
    );
    assert!(
        failure
            .message
            .starts_with("Could not reach the SSH host 127.0.0.1:"),
        "{}",
        failure.message
    );
}

/// A loopback port nothing listens on.
fn closed_port() -> u16 {
    let socket = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    socket.local_addr().unwrap().port()
}
