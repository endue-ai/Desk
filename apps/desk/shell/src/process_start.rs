//! When this process started, by the OS's clock: the start-up trace's origin (`DESK_TRACE=1`,
//! crates/desk-trace), so its "shell start" phase and every time after it count what comes before
//! `main` too. On macOS that is where a start can lose time the desk's own clock never sees: the
//! exec policy's checks of a binary it takes for new ran 1.4 s before `main` in two starts in five
//! (#112), and a trace that began at `main` showed nothing. Elsewhere the origin is `main` until a
//! platform here reads its process's start.

use std::time::{Duration, Instant, SystemTime};

use desk_trace::Origin;

/// A process that started this long before `main` was started by another program that exec'd the
/// desk later (a shell's `exec`): its start is not the desk's, so the origin is `main`.
pub const MAX_BEFORE_MAIN: Duration = Duration::from_secs(60);

/// The trace's origin: when the OS started this process, else now. Call it first thing in `main`.
pub fn origin() -> Origin {
    let (wall, at) = (SystemTime::now(), Instant::now());
    before_main(started(), wall)
        .and_then(|before| {
            Some(Origin::at(
                wall.checked_sub(before)?,
                at.checked_sub(before)?,
            ))
        })
        .unwrap_or_else(|| Origin::at(wall, at))
}

/// How long before `now` the process started at `started`, when that is a start of the desk's own.
pub fn before_main(started: Option<SystemTime>, now: SystemTime) -> Option<Duration> {
    let before = now.duration_since(started?).ok()?;
    (before <= MAX_BEFORE_MAIN).then_some(before)
}

/// When the OS started this process (`proc_pidinfo`'s BSD info, to the microsecond).
#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
pub fn started() -> Option<SystemTime> {
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let size = i32::try_from(std::mem::size_of::<libc::proc_bsdinfo>()).ok()?;
    let pid = i32::try_from(std::process::id()).ok()?;
    // SAFETY: the buffer is a zeroed `proc_bsdinfo` of `size` bytes, which the kernel fills whole
    // for PROC_PIDTBSDINFO, and it answers how many bytes it wrote.
    let wrote = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            size,
        )
    };
    if wrote != size {
        return None;
    }
    // SAFETY: the kernel wrote all `size` bytes; the struct was zeroed before in any case.
    let info = unsafe { info.assume_init() };
    let micros = u32::try_from(info.pbi_start_tvusec).ok()?;
    SystemTime::UNIX_EPOCH.checked_add(Duration::new(info.pbi_start_tvsec, micros * 1000))
}

/// When the OS started this process: not read on this platform yet.
#[cfg(not(target_os = "macos"))]
pub fn started() -> Option<SystemTime> {
    None
}

#[cfg(test)]
mod tests {
    use super::{MAX_BEFORE_MAIN, before_main, origin, started};
    use std::time::{Duration, SystemTime};

    #[test]
    fn the_time_before_main_counts_unless_another_program_started_the_process() {
        let now = SystemTime::now();
        let ms = Duration::from_millis;
        assert_eq!(before_main(Some(now - ms(1400)), now), Some(ms(1400)));
        assert_eq!(before_main(Some(now), now), Some(Duration::ZERO));
        assert_eq!(before_main(Some(now - MAX_BEFORE_MAIN - ms(1)), now), None);
        assert_eq!(
            before_main(Some(now + ms(5)), now),
            None,
            "a start in the future"
        );
        assert_eq!(before_main(None, now), None);
    }

    #[test]
    fn the_origin_is_the_processs_start_where_the_os_says_it() {
        let now = SystemTime::now();
        let origin = origin();
        let wall = SystemTime::UNIX_EPOCH + Duration::from_secs_f64(origin.wall_ms() / 1000.0);
        let started = started();
        assert_eq!(
            started.is_some(),
            cfg!(target_os = "macos"),
            "macOS answers proc_pidinfo"
        );
        // The test binary started a moment before this test (else the origin is now, as on the
        // platforms that do not say).
        let expected = match before_main(started, now) {
            Some(before) => now - before,
            None => now,
        };
        let off = wall
            .duration_since(expected)
            .unwrap_or_else(|e| e.duration());
        assert!(off < Duration::from_millis(5), "{off:?} from {expected:?}");
    }
}
