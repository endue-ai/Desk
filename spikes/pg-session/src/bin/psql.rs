//! The third way: one psql per session, statements on its standard input after `\restrict <key>`
//! (psql 17.6 and later), which refuses every meta-command but `\unrestrict <key>`. Measured: what
//! the restriction stops, a transaction across runs, what a result keeps of its types, a
//! notification while idle, a cancel (SIGINT), an error's fields, a million rows and COPY.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, ExitCode, Stdio};
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};

use desk_pg_session_spike::{Session, expect, line, mib, plain, rss_of, title, verdict};

struct Psql {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<(bool, String)>,
    marks: u32,
}

impl Psql {
    fn start(info: &desk_pg_session_spike::ConnInfo) -> Psql {
        let mut child = Command::new("psql")
            .args([
                "-X",
                "-w",
                "-q",
                "--csv",
                "-P",
                "null=<null-7f3a>",
                "-v",
                "ON_ERROR_STOP=0",
            ])
            .args(["-v", "FETCH_COUNT=1000", "-v", "VERBOSITY=verbose"])
            .env("PGHOST", &info.host)
            .env("PGPORT", info.port.to_string())
            .env("PGUSER", &info.user)
            .env("PGPASSWORD", &info.password)
            .env("PGDATABASE", &info.database)
            .env("PGSSLMODE", info.sslmode.to_string())
            .env("PGCLIENTENCODING", "UTF8")
            .env("PGDATESTYLE", "ISO")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("psql");
        let (tx, lines) = channel();
        for (err, stream) in [
            (
                false,
                child
                    .stdout
                    .take()
                    .map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
            ),
            (
                true,
                child
                    .stderr
                    .take()
                    .map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
            ),
        ] {
            let tx = tx.clone();
            let stream = stream.unwrap();
            std::thread::spawn(move || {
                for text in BufReader::new(stream).lines().map_while(Result::ok) {
                    if tx.send((err, text)).is_err() {
                        break;
                    }
                }
            });
        }
        let stdin = child.stdin.take().unwrap();
        let mut p = Psql {
            child,
            stdin,
            lines,
            marks: 0,
        };
        p.write("\\restrict k-5d1c9e");
        p
    }

    fn write(&mut self, text: &str) {
        writeln!(self.stdin, "{text}").unwrap();
        self.stdin.flush().unwrap();
    }

    /// Send `sql` and a marker statement, and answer every line until the marker's.
    fn run(&mut self, sql: &str) -> Vec<(bool, String)> {
        self.marks += 1;
        let mark = format!("mark-{}", self.marks);
        self.write(sql);
        self.write(&format!("SELECT '{mark}' AS mark;"));
        let mut out = Vec::new();
        while let Ok((err, text)) = self.lines.recv_timeout(Duration::from_secs(40)) {
            if !err && text == mark {
                return out;
            }
            if !(text == "mark" && !err) {
                out.push((err, text));
            }
        }
        out
    }
}

fn show(name: &str, lines: &[(bool, String)]) {
    let text: Vec<String> = lines
        .iter()
        .map(|(e, t)| format!("{}{t}", if *e { "stderr: " } else { "" }))
        .collect();
    line(name, text.join(" | "));
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let mut failures = Vec::new();
    let version = Command::new("psql")
        .arg("--version")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned());
    let Ok(version) = version else {
        println!("== psql: no psql on PATH, skipped");
        return ExitCode::SUCCESS;
    };
    title("psql: a session over standard input, restricted");
    line("client", version.trim());
    let info = plain();
    let mut p = Psql::start(&info);
    let out = p.run("\\! echo escaped");
    show("\\! echo escaped", &out);
    expect(
        &mut failures,
        !out.iter().any(|(_, t)| t == "escaped"),
        "a meta-command ran",
    );
    let out = p.run("\\q");
    show("\\q", &out);

    let first = p.run("BEGIN; CREATE TEMP TABLE spike_psql (a int); INSERT INTO spike_psql VALUES (1); SELECT txid_current() AS tx;");
    let second = p.run("SELECT count(*) AS n, txid_current() AS tx FROM spike_psql; ROLLBACK;");
    show("run 1", &first);
    show("run 2 (the same transaction)", &second);
    expect(
        &mut failures,
        second
            .iter()
            .any(|(_, t)| t.ends_with(&first.last().map(|l| l.1.clone()).unwrap_or_default())),
        "the transaction did not span runs",
    );

    let out = p.run("SELECT 1::int AS i, 'x'::text AS t, NULL::date AS d, ''::text AS e, '12.50'::numeric AS n;");
    show("a result (CSV: names, no types, no table)", &out);

    title("psql: a notification while idle");
    p.run("LISTEN spike_psql_channel;");
    let mut talker = Session::connect(&info).await.expect("talker");
    talker
        .simple("NOTIFY spike_psql_channel, 'hello'")
        .await
        .expect("notify");
    let sent = Instant::now();
    let idle: Vec<_> =
        std::iter::from_fn(|| p.lines.recv_timeout(Duration::from_secs(2)).ok()).collect();
    line(
        "printed in the 2 s after the NOTIFY",
        format!("{} lines", idle.len()),
    );
    let out = p.run("SELECT 1 AS next;");
    show("the next statement", &out);
    line(
        "the notification surfaced after",
        format!(
            "{:.1} s, with the next statement",
            sent.elapsed().as_secs_f64()
        ),
    );
    expect(
        &mut failures,
        idle.is_empty(),
        "psql printed a notification while idle",
    );

    title("psql: cancel from a second connection (pg_cancel_backend)");
    let backend = p
        .run("SELECT pg_backend_pid() AS pid;")
        .last()
        .map(|l| l.1.clone())
        .unwrap_or_default();
    p.write("SELECT pg_sleep(30);");
    std::thread::sleep(Duration::from_millis(500));
    let started = Instant::now();
    talker
        .simple(&format!("SELECT pg_cancel_backend({backend})"))
        .await
        .expect("pg_cancel_backend");
    let out = p.run("SELECT 'after' AS after;");
    show("after pg_cancel_backend", &out);
    line(
        "psql",
        format!(
            "{}, {:.2} s later",
            if p.child.try_wait().ok().flatten().is_none() {
                "still running"
            } else {
                "exited"
            },
            started.elapsed().as_secs_f64()
        ),
    );
    expect(
        &mut failures,
        out.iter().any(|(_, t)| t == "after"),
        "the session did not go on after pg_cancel_backend",
    );

    title("psql: an error's fields, as text lines (VERBOSITY verbose)");
    p.run("CREATE TEMP TABLE spike_psql_err (id int PRIMARY KEY); INSERT INTO spike_psql_err VALUES (1);");
    let out = p.run("INSERT INTO spike_psql_err VALUES (1);");
    show("duplicate key", &out);

    title("psql: 1,000,000 rows with FETCH_COUNT=1000, and COPY inline");
    let pid = p.child.id();
    let before = rss_of(pid);
    let started = Instant::now();
    p.marks += 1;
    p.write("SELECT g AS id, md5(g::text) AS hash, g * 0.5 AS half, now() AS at FROM generate_series(1, 1000000) g;");
    p.write(&format!("SELECT 'mark-{}' AS mark;", p.marks));
    let (mut count, mut high) = (0u64, before);
    while let Ok((_, text)) = p.lines.recv_timeout(Duration::from_secs(60)) {
        if text == format!("mark-{}", p.marks) {
            break;
        }
        count += 1;
        if count % 20000 == 0 {
            high = high.max(rss_of(pid));
        }
    }
    line(
        "rows",
        format!(
            "{count} lines in {:.2} s; psql resident {} before, {} at most",
            started.elapsed().as_secs_f64(),
            mib(before),
            mib(high)
        ),
    );
    let copy = (1..=1000)
        .map(|i| format!("{i}"))
        .collect::<Vec<_>>()
        .join("\n");
    let out = p.run(&format!("CREATE TEMP TABLE spike_psql_copy (a int);\nCOPY spike_psql_copy FROM STDIN;\n{copy}\n\\.\nSELECT count(*) AS copied FROM spike_psql_copy;"));
    show("COPY FROM STDIN inline", &out);
    title("psql: SIGINT during SELECT pg_sleep(30)");
    p.write("SELECT pg_sleep(30);");
    std::thread::sleep(Duration::from_millis(500));
    let started = Instant::now();
    // SAFETY: a signal to the child this process started.
    unsafe { libc::kill(p.child.id() as i32, libc::SIGINT) };
    let out = p.run("SELECT 'after' AS after;");
    let gone = p.child.try_wait().ok().flatten();
    show("after SIGINT", &out);
    line(
        "psql",
        format!(
            "{} {:.2} s later",
            gone.map_or("still running".to_owned(), |s| format!("exited, {s}")),
            started.elapsed().as_secs_f64()
        ),
    );

    let mut p = Psql::start(&info);
    p.run("SELECT 1;");
    drop(p.stdin);
    let status = p.child.wait().expect("psql exits");
    line(
        "a new psql, standard input closed",
        format!("psql exited, {status}"),
    );
    talker.terminate().await.ok();
    verdict(&failures)
}
