//! COPY through the session: a table of about 100 MB out with `COPY ... TO STDOUT` into a file, and
//! the file back in with `COPY ... FROM STDIN` in 64 KiB CopyData messages, both streamed with flat
//! memory; the copy's rows and hash match the original's.

use std::process::ExitCode;
use std::time::Instant;

use desk_pg_session_spike::{Session, expect, line, mib, plain, rss_of, title, verdict};

const SETUP: &str = "DROP TABLE IF EXISTS spike_big, spike_big_in;
CREATE TABLE spike_big AS SELECT g AS id, repeat(md5(g::text), 3) AS payload, g % 7 = 0 AS seventh
  FROM generate_series(1, 1000000) g;
CREATE TABLE spike_big_in (LIKE spike_big)";

const CHECK: &str = "SELECT count(*), sum(hashtext(id::text || payload || seventh::text)::bigint)";

async fn one(s: &mut Session, sql: &str) -> Vec<Option<String>> {
    s.open(sql, &[], 0).await.expect(sql).rows.remove(0)
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let mut failures = Vec::new();
    let mut s = Session::connect(&plain()).await.expect("sign-in");
    s.simple(SETUP).await.expect("setup");
    let size = one(&mut s, "SELECT pg_size_pretty(pg_table_size('spike_big'))").await;
    let file = std::env::temp_dir().join(format!("pg-session-spike-{}.copy", std::process::id()));
    let me = std::process::id();

    title("copy: COPY spike_big TO STDOUT into a file");
    line("table size", size[0].clone().unwrap_or_default());
    let before = rss_of(me);
    let started = Instant::now();
    let file_out = tokio::fs::File::create(&file).await.expect("file");
    let mut sink = tokio::io::BufWriter::with_capacity(1 << 20, file_out);
    let (bytes, tag) = s
        .copy_out("COPY spike_big TO STDOUT", &mut sink)
        .await
        .expect("copy out");
    drop(sink);
    let time = started.elapsed().as_secs_f64();
    let grew = rss_of(me).saturating_sub(before);
    line(
        "out",
        format!(
            "{tag}: {} in {time:.2} s ({:.0} MiB/s), resident grew {}",
            mib(bytes),
            bytes as f64 / time / 1048576.0,
            mib(grew)
        ),
    );
    expect(
        &mut failures,
        bytes > 100 * 1000 * 1000,
        format!("only {} came out", mib(bytes)),
    );
    expect(
        &mut failures,
        grew < 32 * 1024 * 1024,
        format!("COPY out grew {}", mib(grew)),
    );

    title("copy: the file back with COPY spike_big_in FROM STDIN");
    let before = rss_of(me);
    let started = Instant::now();
    let file_in = tokio::fs::File::open(&file).await.expect("file");
    let mut source = tokio::io::BufReader::with_capacity(1 << 20, file_in);
    let (sent, tag) = s
        .copy_in("COPY spike_big_in FROM STDIN", &mut source, 64 * 1024)
        .await
        .expect("copy in");
    let time = started.elapsed().as_secs_f64();
    let grew = rss_of(me).saturating_sub(before);
    line(
        "in",
        format!(
            "{tag}: {} in {time:.2} s ({:.0} MiB/s), resident grew {}",
            mib(sent),
            sent as f64 / time / 1048576.0,
            mib(grew)
        ),
    );
    let original = one(&mut s, &format!("{CHECK} FROM spike_big")).await;
    let copied = one(&mut s, &format!("{CHECK} FROM spike_big_in")).await;
    line(
        "rows and hash, original and copy",
        format!("{original:?} {copied:?}"),
    );
    expect(&mut failures, original == copied, "the copy differs");

    title("copy: a bad row fails the COPY and the session goes on");
    let mut bad: &[u8] = b"1\tx\tnot a boolean\n";
    match s
        .copy_in("COPY spike_big_in FROM STDIN", &mut bad, 64 * 1024)
        .await
    {
        Err(e) => line("bad row", format!("{e:?}")),
        Ok(_) => failures.push("a bad row was copied".into()),
    }
    let after = one(&mut s, "SELECT 'still here'").await;
    line("next statement", format!("{after:?}"));
    std::fs::remove_file(&file).ok();
    s.simple("DROP TABLE spike_big, spike_big_in").await.ok();
    s.terminate().await.ok();
    verdict(&failures)
}
