//! Native operations in a controlled web view. History inspection and its final check both
//! run on the CEF UI thread, where CEF visits the current navigation entries synchronously.

use std::sync::{Arc, Mutex};

use cef::*;
use desk_bridge::WebStep;
use desk_core::{WebError, WebHistoryTarget};

use super::{WebHost, web_rules, web_views::missing};

#[derive(Default)]
struct Entries {
    current: Option<i32>,
    entries: Vec<WebHistoryTarget>,
}

wrap_navigation_entry_visitor! {
    struct HistoryVisitor {
        history: Arc<Mutex<Entries>>,
    }

    impl NavigationEntryVisitor {
        fn visit(&self, entry: Option<&mut NavigationEntry>, current: i32, index: i32, _total: i32) -> i32 {
            let mut history = self.history.lock().unwrap_or_else(|e| e.into_inner());
            if current != 0 {
                history.current = Some(index);
            }
            if let Some(entry) = entry.filter(|entry| entry.is_valid() != 0) {
                history.entries.push(WebHistoryTarget {
                    url: CefString::from(&entry.url()).to_string(),
                    current: 0,
                    index,
                    completion: entry.completion_time().val,
                    has_post_data: entry.has_post_data() != 0,
                    entry_id: None,
                });
            }
            1
        }
    }
}

fn history_changed() -> WebError {
    WebError::Changed("the Browser history changed; read the page and try again".into())
}

impl WebHost {
    fn web_browser_at(&self, view: &str, at: &str) -> Result<Browser, WebError> {
        let browser = self.web_browser(view)?;
        if browser
            .main_frame()
            .is_some_and(|frame| CefString::from(&frame.url()).to_string() == at)
        {
            return Ok(browser);
        }
        Err(WebError::Changed(
            "the Browser page changed; read it again".into(),
        ))
    }

    pub fn web_history_target(
        &self,
        view: &str,
        at: &str,
        step: WebStep,
    ) -> Result<Option<WebHistoryTarget>, WebError> {
        let browser = self.web_browser_at(view, at)?;
        let offset = match step {
            WebStep::Back => -1,
            WebStep::Forward => 1,
            WebStep::Reload => 0,
            _ => return Ok(None),
        };
        if browser.is_loading() != 0 {
            return Err(history_changed());
        }
        let host = browser.host().ok_or_else(|| missing(view))?;
        let history = Arc::new(Mutex::new(Entries::default()));
        let mut visitor = HistoryVisitor::new(history.clone());
        host.navigation_entries(Some(&mut visitor), 0);
        let mut history = history.lock().unwrap_or_else(|e| e.into_inner());
        let current = history.current.ok_or_else(history_changed)?;
        let Some(target) = history
            .entries
            .iter_mut()
            .find(|entry| entry.index == current + offset)
        else {
            return Ok(None);
        };
        if target.completion == 0 {
            return Err(history_changed());
        }
        target.current = current;
        Ok(Some(target.clone()))
    }

    pub fn web_check_history(
        &self,
        view: &str,
        at: &str,
        step: WebStep,
        expected: &WebHistoryTarget,
    ) -> Result<(), WebError> {
        if !self
            .web_history_target(view, at, step)?
            .is_some_and(|target| target.same_position(expected))
        {
            return Err(history_changed());
        }
        self.web_check_destination(view, &expected.url)
    }

    fn web_check_destination(&self, view: &str, url: &str) -> Result<(), WebError> {
        let host = self
            .inner()
            .web
            .host_of(view)
            .ok_or_else(|| missing(view))?;
        if web_rules::address(url) && self.web_may_visit(&web_rules::surface_of(&host), url) {
            return Ok(());
        }
        Err(WebError::Invalid(
            "the Browser may not load that address".into(),
        ))
    }

    pub fn web_follow_ref(&self, view: &str, at: &str, url: &str) -> Result<(), WebError> {
        self.web_browser_at(view, at)?;
        self.web_check_destination(view, url)?;
        self.web_load(view, url)
    }

    pub fn web_find(&self, view: &str, at: &str, text: &str) -> Result<(), WebError> {
        if text.is_empty() || text.chars().count() > 1000 {
            return Err(WebError::Invalid("find needs 1 to 1000 characters".into()));
        }
        let browser = self.web_browser_at(view, at)?;
        let host = browser.host().ok_or_else(|| missing(view))?;
        let completion = host
            .visible_navigation_entry()
            .map_or(0, |entry| entry.completion_time().val);
        let mut inner = self.inner();
        let surface = inner.web.host_of(view).ok_or_else(|| missing(view))?;
        let web = inner
            .web
            .by_host
            .get_mut(&surface)
            .ok_or_else(|| missing(view))?;
        let previous = web.last_find.replace((text.to_owned(), completion));
        let next = previous.is_some_and(|(last, stamp)| last == text && stamp == completion);
        drop(inner);
        host.find(Some(&text.into()), 1, 0, i32::from(next));
        Ok(())
    }

    pub fn web_zoom(&self, view: &str, at: &str, level: f64) -> Result<(), WebError> {
        if !(0.25..=5.0).contains(&level) {
            return Err(WebError::Invalid(
                "zoom needs a scale from 0.25 to 5".into(),
            ));
        }
        let browser = self.web_browser_at(view, at)?;
        let host = browser.host().ok_or_else(|| missing(view))?;
        // Chromium uses logarithmic zoom levels with a 1.2 scale per step.
        host.set_zoom_level(level.log(1.2));
        Ok(())
    }
}
