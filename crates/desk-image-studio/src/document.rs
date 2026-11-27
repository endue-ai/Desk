use std::collections::{HashSet, VecDeque};
use std::sync::Arc;

use serde::Serialize;

use super::{
    Image, MAX_BATCH, Operation,
    layers::{Canvas, LayerInfo},
};

const HISTORY_BYTES: usize = 128 * 1024 * 1024;
const HISTORY_STEPS: usize = 12;

#[derive(Clone)]
pub struct Document {
    canvas: Canvas,
    composite: Arc<Image>,
    past: VecDeque<Canvas>,
    future: Vec<Canvas>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Details<'a> {
    width: usize,
    height: usize,
    can_undo: bool,
    can_redo: bool,
    layers: Vec<LayerInfo<'a>>,
}

impl Document {
    pub fn new(image: Image) -> Self {
        let composite = Arc::new(image);
        Self {
            canvas: Canvas::new(Arc::clone(&composite)),
            composite,
            past: VecDeque::new(),
            future: Vec::new(),
        }
    }

    pub fn image(&self) -> &Image {
        &self.composite
    }

    pub fn details(&self) -> Details<'_> {
        let (width, height) = self.composite.size();
        Details {
            width,
            height,
            can_undo: !self.past.is_empty(),
            can_redo: !self.future.is_empty(),
            layers: self.canvas.layer_info(),
        }
    }

    pub fn apply(&mut self, operations: &[Operation]) -> Result<(), &'static str> {
        self.apply_step(operations)?;
        self.composite = self.canvas.composite();
        Ok(())
    }

    pub fn replay(&mut self, batches: &[Vec<Operation>], undo: usize) -> Result<(), &'static str> {
        if batches.iter().map(Vec::len).sum::<usize>() > 2048 || undo > batches.len() {
            return Err("The draft's edit history is invalid.");
        }
        let mut candidate = self.clone();
        for operations in batches {
            candidate.apply_step(operations)?;
        }
        for _ in 0..undo {
            candidate.undo_step()?;
        }
        candidate.composite = candidate.canvas.composite();
        *self = candidate;
        Ok(())
    }

    fn apply_step(&mut self, operations: &[Operation]) -> Result<(), &'static str> {
        if !(1..=MAX_BATCH).contains(&operations.len()) {
            return Err("Apply one to sixteen operations in a batch.");
        }
        let mut canvas = self.canvas.clone();
        for operation in operations {
            canvas.apply(operation)?;
        }
        self.future.clear();
        self.past
            .push_back(std::mem::replace(&mut self.canvas, canvas));
        while self.past.len() > HISTORY_STEPS || self.history_size() > HISTORY_BYTES {
            self.past.pop_front();
        }
        Ok(())
    }

    pub fn undo(&mut self) -> Result<(), &'static str> {
        self.undo_step()?;
        self.composite = self.canvas.composite();
        Ok(())
    }

    fn undo_step(&mut self) -> Result<(), &'static str> {
        let previous = self
            .past
            .pop_back()
            .ok_or("There are no earlier edits to undo.")?;
        self.future
            .push(std::mem::replace(&mut self.canvas, previous));
        Ok(())
    }

    pub fn redo(&mut self) -> Result<(), &'static str> {
        let next = self
            .future
            .pop()
            .ok_or("There are no later edits to redo.")?;
        self.past
            .push_back(std::mem::replace(&mut self.canvas, next));
        self.composite = self.canvas.composite();
        Ok(())
    }

    fn history_size(&self) -> usize {
        let mut seen: HashSet<_> = self.canvas.buffers().map(Arc::as_ptr).collect();
        self.past
            .iter()
            .flat_map(Canvas::buffers)
            .filter(|image| seen.insert(Arc::as_ptr(image)))
            .map(|image| image.pixels.len())
            .sum()
    }
}
