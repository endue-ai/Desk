//! `web.read` and `web.act` for the core (ADR 0272): what a view's page says and what is done in
//! it. A call runs on the bridge's own thread as steps, each sent to the view's browser on the
//! event loop and waited for here: the page script is asked in the desk's world of the page
//! (`web_host/web_page.rs`), then what takes a person's input follows, a press of the pointer
//! where the script found the element, text as typed, a key. The page takes them without the
//! view taking the desk's keys: what the person types meanwhile goes where it went.

use std::sync::mpsc;
use std::time::Duration;

use desk_bridge::{WebActResult, WebAction, WebReadResult, WebStep};
use desk_core::{WebError, WebHistoryTarget};
use serde_json::{Value, json};

use super::web::Web;
use crate::web_host::web_page::{self, Answer, WORLD};

/// How long one step waits for the page.
const WAIT: Duration = Duration::from_secs(10);

/// What an act that answers nothing of its own answers.
const DONE: WebActResult = WebActResult { moved: None };

impl Web {
    /// One DevTools call on the browser of view `view`: what it answered (a refusal is an answer),
    /// or why none came: the view is gone, or the page took too long.
    fn step(&self, view: &str, method: &'static str, params: Value) -> Result<Answer, WebError> {
        let (sent, queued) = mpsc::channel();
        let name = view.to_owned();
        self.pump.run(move |shell, _| {
            let answer = match shell.compositor.as_mut() {
                Some(compositor) => compositor.host.web_call(&name, method, params),
                None => Err(WebError::Failed("the desk has no compositor window".into())),
            };
            let _ = sent.send(answer);
        });
        let slow = || WebError::Failed(format!("the page did not answer {method} in time"));
        let answer: mpsc::Receiver<Answer> = queued.recv_timeout(WAIT).map_err(|_| slow())??;
        answer.recv_timeout(WAIT).map_err(|_| slow())
    }

    /// A DevTools call whose refusal is a failure.
    fn devtools(&self, view: &str, method: &'static str, params: Value) -> Result<Value, WebError> {
        let said = self.step(view, method, params)?;
        said.map_err(|why| WebError::Failed(format!("{method}: {why}")))
    }

    /// Run the page script's `request` in the desk's world of the view's main document: what
    /// the evaluation answered, or the refusal of a step (the frame or the world went with the
    /// document the page was leaving).
    fn evaluate(&self, view: &str, request: &Value) -> Result<Answer, WebError> {
        let tree = match self.step(view, "Page.getFrameTree", json!({}))? {
            Ok(tree) => tree,
            refused => return Ok(refused),
        };
        let Some(frame) = tree.pointer("/frameTree/frame/id") else {
            return Ok(Err("the page has no frame".into()));
        };
        let world = json!({ "frameId": frame, "worldName": WORLD });
        let made = match self.step(view, "Page.createIsolatedWorld", world)? {
            Ok(made) => made,
            refused => return Ok(refused),
        };
        let Some(context) = made.get("executionContextId") else {
            return Ok(Err("the page has no world for the desk".into()));
        };
        let evaluate = json!({
            "expression": web_page::asks(request),
            "contextId": context,
            "returnByValue": true,
        });
        self.step(view, "Runtime.evaluate", evaluate)
    }

    /// Ask the page script of view `view`, whose page the core allowed at `at`. A page that
    /// was changing documents as it was asked refuses the call, and its new document is asked
    /// once more. A call that got no answer is not sent again: the page may have done it.
    fn ask_page(&self, view: &str, at: &str, mut request: Value) -> Result<Value, WebError> {
        request["at"] = json!(at);
        let evaluated = match self.evaluate(view, &request)? {
            Ok(evaluated) => evaluated,
            Err(_) => (self.evaluate(view, &request)?)
                .map_err(|why| WebError::Failed(format!("the page was not asked: {why}")))?,
        };
        web_page::answered(&evaluated)
    }

    /// Press the page of view `view` at `(x, y)` with the pointer.
    fn press(&self, view: &str, x: f64, y: f64) -> Result<(), WebError> {
        let view = view.to_owned();
        self.ask(move |c| c.host.web_press(&view, x, y))
    }

    /// The page keeps a caret and takes typed text and keys while the desk's keys stay where
    /// the person has them.
    fn caret(&self, view: &str) {
        let on = json!({ "enabled": true });
        let _ = self.devtools(view, "Emulation.setFocusEmulationEnabled", on);
    }

    pub(super) fn read_page(
        &self,
        view: &str,
        at: &str,
        from: u64,
        max: u64,
    ) -> Result<WebReadResult, WebError> {
        let read = json!({ "do": "read", "from": from, "max": max });
        let page = self.ask_page(view, at, read)?;
        serde_json::from_value(page)
            .map_err(|why| WebError::Failed(format!("the page read as no page: {why}")))
    }

    pub(super) fn inspect_history(
        &self,
        view: &str,
        at: &str,
        step: WebStep,
    ) -> Result<Option<WebHistoryTarget>, WebError> {
        let (name, at) = (view.to_owned(), at.to_owned());
        let Some(mut target) = self.ask(move |c| c.host.web_history_target(&name, &at, step))?
        else {
            return Ok(None);
        };
        // Chromium's toolbar can skip entries. Selecting the inspected entry by id keeps the
        // traversal bound to the target and POST flag the core checked.
        if matches!(step, WebStep::Back | WebStep::Forward) {
            let history = self.devtools(view, "Page.getNavigationHistory", json!({}))?;
            let entry = &history["entries"][target.index as usize];
            if history["currentIndex"].as_i64() != Some(i64::from(target.current))
                || entry["url"].as_str() != Some(&target.url)
            {
                return Err(WebError::Changed(
                    "the Browser history changed; read it again".into(),
                ));
            }
            let id = entry["id"]
                .as_i64()
                .ok_or_else(|| WebError::Changed("the history entry has no id".into()))?;
            target.entry_id = Some(id);
        }
        Ok(Some(target))
    }

    pub(super) fn go_history_entry(
        &self,
        view: &str,
        at: &str,
        step: WebStep,
        expected: &WebHistoryTarget,
    ) -> Result<(), WebError> {
        let (view, at, expected) = (view.to_owned(), at.to_owned(), expected.clone());
        let answer = self.ask(move |c| {
            c.host.web_check_history(&view, &at, step, &expected)?;
            if let Some(id) = expected.entry_id {
                return c
                    .host
                    .web_call(
                        &view,
                        "Page.navigateToHistoryEntry",
                        json!({ "entryId": id }),
                    )
                    .map(Some);
            }
            if step != WebStep::Reload {
                return Err(WebError::Changed("the history entry has no id".into()));
            }
            c.host.web_go(&view, WebStep::Reload)?;
            Ok(None)
        })?;
        if let Some(answer) = answer {
            answer
                .recv_timeout(WAIT)
                .map_err(|_| WebError::Failed("the browser did not navigate in time".into()))?
                .map_err(WebError::Failed)?;
        }
        Ok(())
    }

    pub(super) fn act_in(
        &self,
        view: &str,
        at: &str,
        action: &WebAction,
    ) -> Result<WebActResult, WebError> {
        match action {
            WebAction::WebScroll(scroll) => {
                let ask = json!({ "do": "scroll", "to": scroll.to, "pages": scroll.pages });
                let said = self.ask_page(view, at, ask)?;
                let moved = said.get("moved").and_then(Value::as_bool);
                Ok(WebActResult { moved })
            }
            WebAction::WebShow(show) => {
                self.ask_page(view, at, json!({ "do": "show", "ref": show.r#ref }))?;
                Ok(DONE)
            }
            WebAction::WebPress(press) => {
                let found =
                    self.ask_page(view, at, json!({ "do": "point", "ref": press.r#ref }))?;
                let covered = found.get("covered").and_then(Value::as_bool) != Some(false);
                let point = (found["x"].as_f64()).zip(found["y"].as_f64());
                match point {
                    Some((x, y)) if !covered => self.press(view, x, y)?,
                    // Something lies over it where the pointer would press: the page presses it.
                    _ => {
                        self.ask_page(view, at, json!({ "do": "click", "ref": press.r#ref }))?;
                    }
                }
                Ok(DONE)
            }
            WebAction::WebType(typed) => {
                self.caret(view);
                let ready = json!({ "do": "ready", "field": true, "ref": typed.r#ref,
                    "replace": typed.replace != Some(false), "text": typed.text });
                let said = self.ask_page(view, at, ready)?;
                // A date, a colour and their like take their value whole: the script set it.
                let set = said.get("done").and_then(Value::as_bool) == Some(true);
                if !set && !typed.text.is_empty() {
                    self.devtools(view, "Input.insertText", json!({ "text": typed.text }))?;
                }
                if typed.submit == Some(true) {
                    self.keys(view, desk_bridge::WebKeyName::Enter)?;
                }
                Ok(DONE)
            }
            WebAction::WebKey(key) => {
                self.caret(view);
                let ready = json!({ "do": "ready", "field": false, "ref": key.r#ref });
                self.ask_page(view, at, ready)?;
                self.keys(view, key.key)?;
                Ok(DONE)
            }
            WebAction::WebChoose(choose) => {
                let ask = json!({ "do": "choose", "ref": choose.r#ref, "option": choose.option });
                self.ask_page(view, at, ask)?;
                Ok(DONE)
            }
            WebAction::WebFollow(follow) => {
                let link =
                    self.ask_page(view, at, json!({ "do": "follow", "ref": follow.r#ref }))?;
                let (Some(url), Some(at)) = (link["url"].as_str(), link["at"].as_str()) else {
                    return Err(WebError::Invalid("the link has no address".into()));
                };
                let (view, at, url) = (view.to_owned(), at.to_owned(), url.to_owned());
                self.ask(move |c| c.host.web_follow_ref(&view, &at, &url))?;
                Ok(DONE)
            }
            WebAction::WebFind(find) => {
                let (view, at, text) = (view.to_owned(), at.to_owned(), find.text.clone());
                self.ask(move |c| c.host.web_find(&view, &at, &text))?;
                Ok(DONE)
            }
            WebAction::WebZoom(zoom) => {
                let (view, at, level) = (view.to_owned(), at.to_owned(), zoom.level);
                self.ask(move |c| c.host.web_zoom(&view, &at, level))?;
                Ok(DONE)
            }
            WebAction::WebHistory(_) => Err(WebError::Invalid(
                "history needs a native target check".into(),
            )),
        }
    }

    /// Press `key` in the page: down, then up.
    fn keys(&self, view: &str, key: desk_bridge::WebKeyName) -> Result<(), WebError> {
        for event in web_page::key_events(key) {
            self.devtools(view, "Input.dispatchKeyEvent", event)?;
        }
        Ok(())
    }
}
