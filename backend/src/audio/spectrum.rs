use std::f32::consts::PI;

use num_complex::Complex;
use rustfft::FftPlanner;

use super::decode::DecodedAudio;

pub const DEFAULT_BIN_COUNT: usize = 64;
const FFT_SIZE: usize = 2048;

/// Magnitude spectrum bins (0..1) from PCM around `position_secs`.
pub fn compute_spectrum(decoded: &DecodedAudio, position_secs: f64, bin_count: usize) -> Vec<f32> {
    let bin_count = bin_count.clamp(8, 128);
    if decoded.sample_rate == 0 || decoded.channels == 0 || decoded.samples.is_empty() {
        return vec![0.0; bin_count];
    }

    let channels = decoded.channels as usize;
    let sample_rate = decoded.sample_rate as f64;
    let center_frame = (position_secs * sample_rate).floor() as usize;
    let half = FFT_SIZE / 2;
    let start_frame = center_frame.saturating_sub(half);

    let mut window = vec![0.0f32; FFT_SIZE];
    for i in 0..FFT_SIZE {
        let frame = start_frame + i;
        let base = frame * channels;
        if base + channels <= decoded.samples.len() {
            let mut sum = 0.0f32;
            for ch in 0..channels {
                sum += decoded.samples[base + ch];
            }
            let sample = sum / channels as f32;
            let hann = 0.5 * (1.0 - (2.0 * PI * i as f32 / FFT_SIZE as f32).cos());
            window[i] = sample * hann;
        }
    }

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FFT_SIZE);
    let mut buffer: Vec<Complex<f32>> = window
        .into_iter()
        .map(|sample| Complex { re: sample, im: 0.0 })
        .collect();
    fft.process(&mut buffer);

    let usable_bins = FFT_SIZE / 2;
    let mut magnitudes = vec![0.0f32; usable_bins];
    for (idx, bin) in buffer.iter().take(usable_bins).enumerate() {
        magnitudes[idx] = bin.norm();
    }

    let mut out = vec![0.0f32; bin_count];
    let group = (usable_bins / bin_count).max(1);
    for (i, slot) in out.iter_mut().enumerate().take(bin_count) {
        let start = i * group;
        let end = ((i + 1) * group).min(usable_bins);
        let peak = magnitudes[start..end]
            .iter()
            .copied()
            .fold(0.0f32, f32::max);
        *slot = peak;
    }

    normalize_bins(&mut out);
    out
}

fn normalize_bins(bins: &mut [f32]) {
    let max = bins.iter().copied().fold(0.0f32, f32::max);
    if max <= f32::EPSILON {
        bins.fill(0.0);
        return;
    }
    let scale = 1.0 / max;
    for value in bins.iter_mut() {
        *value = (*value * scale).clamp(0.0, 1.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::decode::DecodedAudio;

    #[test]
    fn sine_produces_non_zero_spectrum() {
        let sample_rate = 44_100u32;
        let duration = 1.0f64;
        let freq = 440.0f32;
        let frames = (sample_rate as f64 * duration) as usize;
        let mut samples = Vec::with_capacity(frames);
        for i in 0..frames {
            let t = i as f32 / sample_rate as f32;
            samples.push((t * freq * 2.0 * PI).sin() * 0.8);
        }
        let decoded = DecodedAudio {
            file_bytes: Vec::new(),
            samples,
            sample_rate,
            channels: 1,
        };
        let bins = compute_spectrum(&decoded, 0.5, DEFAULT_BIN_COUNT);
        assert_eq!(bins.len(), DEFAULT_BIN_COUNT);
        assert!(bins.iter().copied().fold(0.0f32, f32::max) > 0.2);
    }
}
