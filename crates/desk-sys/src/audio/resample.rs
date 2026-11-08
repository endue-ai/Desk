//! Sample rate conversion for any pair of rates: a windowed-sinc low-pass interpolator (Smith's
//! bandlimited interpolation) with its cutoff below the lower of the two Nyquist frequencies.
//!
//! Output sample `n` sits at input time `t = n · from / to`, kept exact with integers so a long
//! capture never drifts. It sums the input around `t`, each sample weighted by a Blackman-windowed
//! sinc read from one shared table with linear interpolation, and divides by the sum of the weights,
//! so a constant passes unchanged. Input before the start is silence; `flush` pads the end with it.

use std::sync::OnceLock;

/// Zero crossings of the sinc on each side of `t`: the filter's length and so its transition band.
const ZEROS: usize = 24;
/// Table entries per zero crossing.
const RESOLUTION: usize = 512;
/// The cutoff as a fraction of the lower Nyquist frequency; the stop band starts near the Nyquist.
const ROLLOFF: f64 = 0.9;

/// One converter per stretch of contiguous input.
pub(super) struct Resampler {
    from: u64,
    to: u64,
    /// The sinc's scale: its zero crossings fall `1 / scale` input samples apart.
    scale: f32,
    /// How many input samples on each side of `t` can carry weight.
    half: i64,
    /// Input samples from absolute index `base` on.
    history: Vec<f32>,
    base: i64,
    /// Input samples received so far.
    received: u64,
    /// Output samples produced so far.
    produced: u64,
}

impl Resampler {
    pub(super) fn new(from: u32, to: u32) -> Self {
        let scale = ROLLOFF * (f64::from(to) / f64::from(from)).min(1.0);
        let half = (ZEROS as f64 / scale).ceil() as i64;
        Self {
            from: u64::from(from),
            to: u64::from(to),
            scale: scale as f32,
            half,
            // Silence before the first sample, so the first outputs have a full window.
            history: vec![0.0; half as usize],
            base: -half,
            received: 0,
            produced: 0,
        }
    }

    /// Take `input` and append every output sample whose window it completes.
    pub(super) fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        self.history.extend_from_slice(input);
        self.received += input.len() as u64;
        self.produce(None, out);
    }

    /// Append the outputs that fall before the end of the input, as if silence followed it.
    pub(super) fn flush(&mut self, out: &mut Vec<f32>) {
        let total = (self.received * self.to).div_ceil(self.from);
        self.history
            .resize(self.history.len() + self.half as usize + 1, 0.0);
        self.produce(Some(total), out);
    }

    fn produce(&mut self, limit: Option<u64>, out: &mut Vec<f32>) {
        let available = self.base + self.history.len() as i64;
        while limit.is_none_or(|limit| self.produced < limit) {
            let position = self.produced * self.from;
            let at = (position / self.to) as i64;
            if at + self.half >= available {
                break;
            }
            let fraction = (position % self.to) as f32 / self.to as f32;
            out.push(self.interpolate(at, fraction));
            self.produced += 1;
        }
        // Keep only what the next output's window reaches.
        let next = ((self.produced * self.from) / self.to) as i64;
        let unused = (next - self.half + 1 - self.base).clamp(0, self.history.len() as i64);
        self.history.drain(..unused as usize);
        self.base += unused;
    }

    /// The output at input time `at + fraction`, from the inputs `at - half + 1 ..= at + half`.
    fn interpolate(&self, at: i64, fraction: f32) -> f32 {
        let table = table();
        let start = (at - self.half + 1 - self.base) as usize;
        let window = &self.history[start..start + 2 * self.half as usize];
        let (mut sum, mut weights) = (0.0f32, 0.0f32);
        for (m, &sample) in window.iter().enumerate() {
            let distance = ((self.half - 1 - m as i64) as f32 + fraction).abs();
            let weight = lookup(table, distance * self.scale);
            sum += sample * weight;
            weights += weight;
        }
        if weights > 0.0 { sum / weights } else { 0.0 }
    }
}

/// The windowed sinc at `u` zero crossings from its centre, interpolated from the table.
fn lookup(table: &[f32], u: f32) -> f32 {
    let position = u * RESOLUTION as f32;
    let index = position as usize;
    if index >= ZEROS * RESOLUTION {
        return 0.0;
    }
    let fraction = position - index as f32;
    table[index] + fraction * (table[index + 1] - table[index])
}

/// `sinc(u) · blackman(u / ZEROS)` for `u` from 0 to `ZEROS`, `RESOLUTION` entries per unit.
fn table() -> &'static [f32] {
    static TABLE: OnceLock<Box<[f32]>> = OnceLock::new();
    TABLE.get_or_init(|| {
        use std::f64::consts::PI;
        let len = ZEROS * RESOLUTION + 2;
        (0..len)
            .map(|i| {
                let u = (i as f64 / RESOLUTION as f64).min(ZEROS as f64);
                let sinc = if u == 0.0 {
                    1.0
                } else {
                    (PI * u).sin() / (PI * u)
                };
                let x = PI * u / ZEROS as f64;
                let window = 0.42 + 0.5 * x.cos() + 0.08 * (2.0 * x).cos();
                (sinc * window) as f32
            })
            .collect()
    })
}
