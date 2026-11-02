//! Reading a trace back: every phase by start, the totals and the five longest, as `desk doctor
//! --trace` prints them. Complete events (`ph: "X"`) are phases and instants (`ph: "i"`) are marks;
//! everything else (metadata, other phases' kinds) is passed over.

use std::fmt;

use serde_json::{Value, json};

use crate::{FIRST_FRAME, READY_LINE};

/// How many of the longest phases the summary names.
const LONGEST: usize = 5;

/// A phase in ms from process start.
#[derive(Clone, Debug, PartialEq)]
pub struct Phase {
    pub name: String,
    /// The event's `cat`: `core`, `webview`, `runtime` or `plugin` in the app's traces.
    pub category: String,
    pub start_ms: f64,
    pub duration_ms: f64,
}

impl Phase {
    pub fn end_ms(&self) -> f64 {
        self.start_ms + self.duration_ms
    }
}

/// A moment: an instant of the trace, or the end of the first interactive frame.
#[derive(Clone, Debug, PartialEq)]
pub struct Mark {
    pub name: String,
    pub at_ms: f64,
}

/// One category's phases added up.
#[derive(Clone, Debug, PartialEq)]
pub struct Total {
    pub category: String,
    pub ms: f64,
    pub count: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Summary {
    /// Every phase, by start.
    pub phases: Vec<Phase>,
    /// Every instant and the first interactive frame's end, by time.
    pub marks: Vec<Mark>,
    /// Per category, in the order the categories first start.
    pub totals: Vec<Total>,
    /// The five longest phases, longest first.
    pub longest: Vec<Phase>,
}

impl Summary {
    /// When the mark `name` happened, in ms from process start.
    pub fn mark(&self, name: &str) -> Option<f64> {
        self.marks.iter().find(|m| m.name == name).map(|m| m.at_ms)
    }

    pub fn to_json(&self) -> Value {
        let phase = |p: &Phase| {
            json!({
                "name": p.name, "category": p.category,
                "startMs": p.start_ms, "durationMs": p.duration_ms,
            })
        };
        json!({
            "phases": self.phases.iter().map(phase).collect::<Vec<_>>(),
            "marks": self.marks.iter()
                .map(|m| json!({ "name": m.name, "atMs": m.at_ms }))
                .collect::<Vec<_>>(),
            "totals": self.totals.iter()
                .map(|t| json!({ "category": t.category, "ms": t.ms, "count": t.count }))
                .collect::<Vec<_>>(),
            "longest": self.longest.iter().map(phase).collect::<Vec<_>>(),
        })
    }
}

/// Summarize a trace: the object form (`{"traceEvents": [...]}`) or a bare array of events.
pub fn summarize(text: &str) -> Result<Summary, String> {
    let value: Value =
        serde_json::from_str(text).map_err(|why| format!("not a trace (not JSON: {why})"))?;
    let events = match &value {
        Value::Array(events) => events,
        Value::Object(trace) => trace
            .get("traceEvents")
            .and_then(Value::as_array)
            .ok_or("not a trace (no traceEvents array)")?,
        _ => return Err("not a trace (neither an object nor an array)".to_owned()),
    };
    let mut phases = Vec::new();
    let mut marks = Vec::new();
    for event in events {
        let event = event
            .as_object()
            .ok_or("not a trace (an event that is not an object)")?;
        let name = event.get("name").and_then(Value::as_str).unwrap_or("?");
        let ms = |key: &str| event.get(key).and_then(Value::as_f64).map(|us| us / 1000.0);
        match event.get("ph").and_then(Value::as_str) {
            Some("X") => {
                let (Some(start_ms), Some(duration_ms)) = (ms("ts"), ms("dur")) else {
                    return Err(format!("the trace's phase {name} has no ts or dur"));
                };
                let category = event.get("cat").and_then(Value::as_str).unwrap_or("other");
                phases.push(Phase {
                    name: name.to_owned(),
                    category: category.to_owned(),
                    start_ms,
                    duration_ms,
                });
            }
            Some("i" | "I") => {
                let at_ms = ms("ts").ok_or(format!("the trace's instant {name} has no ts"))?;
                marks.push(Mark {
                    name: name.to_owned(),
                    at_ms,
                });
            }
            _ => {}
        }
    }
    if phases.is_empty() && marks.is_empty() {
        return Err("not a trace (no phases)".to_owned());
    }
    phases.sort_by(|a, b| a.start_ms.total_cmp(&b.start_ms));
    marks.extend(
        phases
            .iter()
            .filter(|p| p.name == FIRST_FRAME)
            .map(|p| Mark {
                name: p.name.clone(),
                at_ms: p.end_ms(),
            }),
    );
    marks.sort_by(|a, b| a.at_ms.total_cmp(&b.at_ms));
    let mut totals: Vec<Total> = Vec::new();
    for phase in &phases {
        match totals.iter_mut().find(|t| t.category == phase.category) {
            Some(total) => {
                total.ms += phase.duration_ms;
                total.count += 1;
            }
            None => totals.push(Total {
                category: phase.category.clone(),
                ms: phase.duration_ms,
                count: 1,
            }),
        }
    }
    let mut longest = phases.clone();
    longest.sort_by(|a, b| b.duration_ms.total_cmp(&a.duration_ms));
    longest.truncate(LONGEST);
    Ok(Summary {
        phases,
        marks,
        totals,
        longest,
    })
}

impl fmt::Display for Summary {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "phases{:>48}{:>12}", "start ms", "took ms")?;
        for p in &self.phases {
            writeln!(
                f,
                "  {:<9} {:<36}{:>10.1}{:>12.1}",
                p.category, p.name, p.start_ms, p.duration_ms
            )?;
        }
        writeln!(f, "totals")?;
        for name in [READY_LINE, FIRST_FRAME] {
            match self.mark(name) {
                Some(at) => writeln!(f, "  {name:<36}at {at:>10.1} ms")?,
                None => writeln!(f, "  {name:<36}not in the trace")?,
            }
        }
        for m in self
            .marks
            .iter()
            .filter(|m| ![READY_LINE, FIRST_FRAME].contains(&&*m.name))
        {
            writeln!(f, "  {:<36}at {:>10.1} ms", m.name, m.at_ms)?;
        }
        for t in &self.totals {
            let phases = if t.count == 1 { "phase" } else { "phases" };
            writeln!(
                f,
                "  {:<36}   {:>10.1} ms in {} {phases}",
                t.category, t.ms, t.count
            )?;
        }
        writeln!(f, "five longest")?;
        for (n, p) in self.longest.iter().enumerate() {
            writeln!(
                f,
                "  {}. {:<33}   {:>10.1} ms",
                n + 1,
                p.name,
                p.duration_ms
            )?;
        }
        Ok(())
    }
}
