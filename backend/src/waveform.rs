const BIN_COUNT: usize = 200;

/// Downsample interleaved PCM into normalized peak bins for waveform display.
pub fn peaks_from_samples(samples: &[f32], channels: u16) -> Vec<f32> {
    let channels = channels.max(1) as usize;
    let frames = samples.len() / channels;
    if frames == 0 {
        return vec![0.0; BIN_COUNT];
    }

    let mut peaks = vec![0.0f32; BIN_COUNT];
    let frames_per_bin = (frames / BIN_COUNT).max(1);

    for (bin, peak) in peaks.iter_mut().enumerate() {
        let start = bin * frames_per_bin;
        let end = ((bin + 1) * frames_per_bin).min(frames);
        let mut max = 0.0f32;
        for frame in start..end {
            let mut sample = 0.0f32;
            for ch in 0..channels {
                sample += samples[frame * channels + ch].abs();
            }
            sample /= channels as f32;
            if sample > max {
                max = sample;
            }
        }
        *peak = max;
    }

    let max_peak = peaks.iter().copied().fold(0.0f32, f32::max);
    if max_peak > 0.0 {
        for p in &mut peaks {
            *p /= max_peak;
        }
    }
    peaks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peaks_normalized() {
        let samples: Vec<f32> = (0..44100).map(|i| (i as f32 / 44100.0).sin()).collect();
        let peaks = peaks_from_samples(&samples, 1);
        assert_eq!(peaks.len(), BIN_COUNT);
        assert!(peaks.iter().all(|&p| p >= 0.0 && p <= 1.0));
        assert!(peaks.iter().copied().fold(0.0f32, f32::max) > 0.9);
    }
}
