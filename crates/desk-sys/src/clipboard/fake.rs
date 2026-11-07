//! A clipboard in memory, for tests here and in the crates above. It follows the same rules as the
//! OS clipboards: every copy advances the count and reading never does, `state` never reads the
//! text, contents that are not text read as `None`, and text holding a NUL is refused before
//! anything changes.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard};

use super::{Clipboard, Marks, State, check_text};
use crate::{Error, ErrorCode};

/// A `Clipboard` holding one text, or none. Starts empty with count 0; `copy` and
/// `copy_without_text` are another app's copies, `write_text` the desk's.
#[derive(Debug, Default)]
pub struct FakeClipboard {
    contents: Mutex<Contents>,
    failures: AtomicUsize,
    text_reads: AtomicUsize,
}

#[derive(Debug, Default)]
struct Contents {
    count: u64,
    text: Option<String>,
    marks: Marks,
}

impl Contents {
    fn replace(&mut self, text: Option<String>, marks: Marks) {
        self.count = self.count.wrapping_add(1);
        self.text = text;
        self.marks = marks;
    }
}

impl FakeClipboard {
    pub fn new() -> Self {
        Self::default()
    }

    /// Another app copies `text` with `marks`, as a password manager marks a password.
    pub fn copy(&self, text: &str, marks: Marks) {
        self.contents().replace(Some(text.to_owned()), marks);
    }

    /// Another app copies something that is not text (an image, files).
    pub fn copy_without_text(&self) {
        self.contents().replace(None, Marks::default());
    }

    /// The next `n` calls (`state`, `read_text` or `write_text`) answer `io_error` and change
    /// nothing; a NUL in `write_text`'s text is refused first.
    pub fn fail_next(&self, n: usize) {
        self.failures.store(n, Ordering::SeqCst);
    }

    /// How many `read_text` calls reached the text.
    pub fn text_reads(&self) -> usize {
        self.text_reads.load(Ordering::SeqCst)
    }

    fn contents(&self) -> MutexGuard<'_, Contents> {
        self.contents.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Spends one of the failures `fail_next` asked for, if any is left.
    fn reach(&self, call: &str) -> Result<(), Error> {
        let failed = self
            .failures
            .try_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
            .is_ok();
        if failed {
            return Err(Error::new(
                ErrorCode::IoError,
                format!("the fake clipboard failed {call} as asked"),
            ));
        }
        Ok(())
    }
}

impl Clipboard for FakeClipboard {
    fn state(&self) -> Result<State, Error> {
        self.reach("state")?;
        let contents = self.contents();
        Ok(State {
            count: contents.count,
            has_text: contents.text.is_some(),
            marks: contents.marks,
        })
    }

    fn read_text(&self) -> Result<Option<String>, Error> {
        self.reach("read_text")?;
        let text = self.contents().text.clone();
        self.text_reads.fetch_add(1, Ordering::SeqCst);
        Ok(text)
    }

    fn write_text(&self, text: &str, marks: Marks) -> Result<(), Error> {
        check_text(text)?;
        self.reach("write_text")?;
        self.contents().replace(Some(text.to_owned()), marks);
        Ok(())
    }
}
