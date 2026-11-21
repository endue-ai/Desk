//! A million rows in pages: Execute with a row limit on an open portal, one page in memory at a
//! time, resident memory sampled as it reads; then the same rows read whole for comparison, and what
//! pg_stat_activity says of a session whose next page waits.

use std::process::ExitCode;
use std::time::{Duration, Instant};

use desk_pg_session_spike::{Session, expect, line, mib, peak_rss, plain, rss_of, title, verdict};

const SQL: &str = "SELECT g AS id, md5(g::text) AS hash, g * 0.5 AS half, now() AS at FROM generate_series(1, 1000000) g";

async fn paged(s: &mut Session, page_rows: i32) -> (u64, u64, Duration, u64, u64) {
    let me = std::process::id();
    let before = rss_of(me);
    let mut high = before;
    let started = Instant::now();
    let read_before = s.read_bytes;
    let mut page = s.open(SQL, &[], page_rows).await.expect("open");
    let (mut rows, mut pages) = (0u64, 1u64);
    loop {
        rows += page.rows.len() as u64;
        if pages % 50 == 0 {
            high = high.max(rss_of(me));
        }
        if page.tag.is_some() {
            break;
        }
        page = s.more(page_rows).await.expect("next page");
        pages += 1;
    }
    high = high.max(rss_of(me));
    (
        rows,
        pages,
        started.elapsed(),
        high.saturating_sub(before),
        s.read_bytes - read_before,
    )
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let mut failures = Vec::new();
    let info = plain();
    let mut s = Session::connect(&info).await.expect("sign-in");
    let me = std::process::id();
    title("stream: 1,000,000 rows of 4 columns, text form, in pages");
    line("resident before", mib(rss_of(me)));
    for page_rows in [1000, 10000] {
        let (rows, pages, time, grew, wire) = paged(&mut s, page_rows).await;
        line(
            &format!("pages of {page_rows}"),
            format!(
                "{rows} rows in {pages} pages, {:.2} s ({:.0} rows/s), {} on the wire, resident grew {}",
                time.as_secs_f64(),
                rows as f64 / time.as_secs_f64(),
                mib(wire),
                mib(grew)
            ),
        );
        expect(
            &mut failures,
            rows == 1_000_000,
            format!("pages of {page_rows} read {rows} rows"),
        );
        expect(
            &mut failures,
            grew < 64 * 1024 * 1024,
            format!("pages of {page_rows} grew {}", mib(grew)),
        );
    }
    line("peak resident after paging", mib(peak_rss()));

    title("stream: the next page waits");
    let mut observer = Session::connect(&info).await.expect("observer");
    let first = s.open(SQL, &[], 1000).await.expect("open");
    tokio::time::sleep(Duration::from_millis(300)).await;
    let pid = s.pid.to_string();
    let state = observer
        .open(
            "SELECT state, backend_xmin IS NOT NULL FROM pg_stat_activity WHERE pid = $1::int",
            &[Some(&pid)],
            0,
        )
        .await
        .expect("activity");
    line(
        "first page",
        format!(
            "{} rows, more waiting: {}",
            first.rows.len(),
            first.tag.is_none()
        ),
    );
    line(
        "pg_stat_activity of the waiting session (state, holds a snapshot)",
        format!("{:?}", state.rows[0]),
    );
    let status = s.sync().await.expect("close");
    line("Sync closes it; ReadyForQuery", status as char);
    observer.terminate().await.ok();
    let exact = s.open("SELECT 1", &[], 1).await.expect("one row");
    let last = s.more(1).await.expect("the end");
    line(
        "a page that ends on the last row",
        format!(
            "{} row, tag {:?}; the next: {} rows, tag {:?}",
            exact.rows.len(),
            exact.tag,
            last.rows.len(),
            last.tag
        ),
    );

    title("stream: the same rows read whole, for comparison");
    let before = rss_of(me);
    let started = Instant::now();
    let whole = s.open(SQL, &[], 0).await.expect("whole");
    let grew = rss_of(me).saturating_sub(before);
    line(
        "one page of every row",
        format!(
            "{} rows in {:.2} s, resident grew {}",
            whole.rows.len(),
            started.elapsed().as_secs_f64(),
            mib(grew)
        ),
    );
    line("peak resident after reading whole", mib(peak_rss()));
    drop(whole);
    s.terminate().await.ok();
    verdict(&failures)
}
