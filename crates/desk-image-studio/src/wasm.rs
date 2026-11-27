//! The worker copies RGBA/JSON into buffers owned by Rust and reads the answer before the next call.

// Only the Wasm export names are unsafe attributes. Rust does not dereference a raw pointer.
#![allow(unsafe_code)]

use std::cell::RefCell;
use std::fmt::Write;

use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::{Document, Image, MAX_PIXELS, Operation};

const PREVIEW_EDGE: usize = 1200;
const REQUEST_LIMIT: usize = 1024 * 1024;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
enum Request {
    Apply {
        operations: Vec<Operation>,
    },
    Replay {
        batches: Vec<Vec<Operation>>,
        undo: usize,
    },
    Undo,
    Redo,
    Preview,
    Export,
}

#[derive(Default)]
struct State {
    document: Option<Document>,
    input: Vec<u8>,
    answer: Vec<u8>,
    binary: Vec<u8>,
}

impl State {
    fn respond(&mut self, result: Result<Value, String>) -> u32 {
        let value = result.unwrap_or_else(|error| json!({ "error": error }));
        self.answer = serde_json::to_vec(&value).expect("a JSON value serializes");
        self.answer.len() as u32
    }

    fn call(&mut self) -> Result<Value, String> {
        self.binary = Vec::new();
        if self.input.len() > REQUEST_LIMIT {
            return Err("The edit request is too large.".into());
        }
        let request = serde_json::from_slice(&self.input).map_err(|error| error.to_string())?;
        let document = self.document.as_mut().ok_or("Open an image first.")?;
        match request {
            Request::Apply { operations } => document.apply(&operations)?,
            Request::Replay { batches, undo } => document.replay(&batches, undo)?,
            Request::Undo => document.undo()?,
            Request::Redo => document.redo()?,
            Request::Preview => {}
            Request::Export => {
                self.binary = document.image().png().map_err(|error| error.to_string())?;
                return Ok(json!({ "bytes": self.binary.len() }));
            }
        }
        self.preview()
    }

    fn preview(&mut self) -> Result<Value, String> {
        let document = self.document.as_ref().ok_or("Open an image first.")?;
        let image = document.image();
        let (width, height) = image.size();
        let longest = width.max(height);
        let (w, h) = if longest > PREVIEW_EDGE {
            (
                (width * PREVIEW_EDGE / longest).max(1),
                (height * PREVIEW_EDGE / longest).max(1),
            )
        } else {
            (width, height)
        };
        self.binary = if (w, h) == (width, height) {
            image.pixels.to_vec()
        } else {
            image.resize(w, h)?.pixels
        };
        Ok(
            json!({ "details": document.details(), "preview": { "width": w, "height": h, "bytes": self.binary.len() } }),
        )
    }
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

#[unsafe(no_mangle)]
extern "C" fn input(length: u32) -> *mut u8 {
    let length = length as usize;
    if length > MAX_PIXELS * 4 {
        return std::ptr::null_mut();
    }
    STATE.with_borrow_mut(|state| {
        state.input.resize(length, 0);
        state.input.as_mut_ptr()
    })
}

#[unsafe(no_mangle)]
extern "C" fn load(width: u32, height: u32) -> u32 {
    STATE.with_borrow_mut(|state| {
        state.binary = Vec::new();
        let input = std::mem::take(&mut state.input);
        let result = Image::new(width as usize, height as usize, input)
            .map_err(String::from)
            .and_then(|image| {
                state.document = Some(Document::new(image));
                state.preview()
            });
        state.respond(result)
    })
}

#[unsafe(no_mangle)]
extern "C" fn call() -> u32 {
    STATE.with_borrow_mut(|state| {
        let result = state.call();
        state.respond(result)
    })
}

#[unsafe(no_mangle)]
extern "C" fn digest() -> u32 {
    STATE.with_borrow_mut(|state| {
        let mut hash = String::with_capacity(64);
        for byte in Sha256::digest(&state.input) {
            write!(hash, "{byte:02x}").expect("writing to a string succeeds");
        }
        state.respond(Ok(json!({ "digest": hash })))
    })
}

#[unsafe(no_mangle)]
extern "C" fn answer() -> *const u8 {
    STATE.with_borrow(|state| state.answer.as_ptr())
}

#[unsafe(no_mangle)]
extern "C" fn binary() -> *const u8 {
    STATE.with_borrow(|state| state.binary.as_ptr())
}
