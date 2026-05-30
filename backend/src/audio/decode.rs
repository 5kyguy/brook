use std::io::Cursor;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::audio::SignalSpec;

/// Fully decoded audio kept in memory: original file bytes plus PCM samples.
#[derive(Clone)]
pub struct DecodedAudio {
    pub file_bytes: Vec<u8>,
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u16,
}

impl DecodedAudio {
    pub fn duration_secs(&self) -> f64 {
        if self.sample_rate == 0 || self.channels == 0 {
            return 0.0;
        }
        let frames = self.samples.len() as f64 / self.channels as f64;
        frames / self.sample_rate as f64
    }

    pub fn source_from(&self, start_secs: f64) -> rodio::buffer::SamplesBuffer<f32> {
        let start_secs = start_secs.max(0.0).min(self.duration_secs());
        let start_frame = (start_secs * self.sample_rate as f64).floor() as usize;
        let start_sample = start_frame.saturating_mul(self.channels as usize);
        let samples = self.samples[start_sample..].to_vec();
        rodio::buffer::SamplesBuffer::new(self.channels, self.sample_rate, samples)
    }
}

pub fn decode_from_bytes(file_bytes: Vec<u8>, extension: &str) -> Result<DecodedAudio, String> {
    let mut hint = Hint::new();
    if !extension.is_empty() {
        hint.with_extension(extension);
    }

    let mss = MediaSourceStream::new(Box::new(Cursor::new(file_bytes.clone())), Default::default());

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("Failed to probe audio: {e}"))?;

    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "No default audio track".to_string())?;

    let track_id = track.id;
    let codec = track.codec_params.codec;
    let codec_params = track.codec_params.clone();
    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|e| format!("Failed to create decoder: {e}"))?;

    let mut spec: Option<SignalSpec> = None;
    let mut samples: Vec<f32> = Vec::new();
    let mut sample_buf: Option<SampleBuffer<f32>> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(SymphoniaError::IoError(_)) => break,
            Err(e) => return Err(format!("Read error while decoding: {e}")),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(e) => return Err(format!("Decode error: {e}")),
        };

        if spec.is_none() {
            spec = Some(*decoded.spec());
        }

        if sample_buf.is_none() {
            sample_buf = Some(SampleBuffer::<f32>::new(
                decoded.capacity() as u64,
                *decoded.spec(),
            ));
        }

        if let Some(buf) = &mut sample_buf {
            buf.copy_interleaved_ref(decoded);
            samples.extend_from_slice(buf.samples());
        }
    }

    let spec = spec.ok_or_else(|| "No audio decoded".to_string())?;

    if codec != CODEC_TYPE_NULL && samples.is_empty() {
        return Err("Decoder produced no samples".to_string());
    }

    Ok(DecodedAudio {
        file_bytes,
        samples,
        sample_rate: spec.rate,
        channels: spec.channels.count() as u16,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine_wav_bytes() -> Vec<u8> {
        let sample_rate = 44_100u32;
        let duration_secs = 0.25f32;
        let num_samples = (sample_rate as f32 * duration_secs) as usize;
        let mut data = Vec::with_capacity(num_samples * 2);
        for i in 0..num_samples {
            let t = i as f32 / sample_rate as f32;
            let sample = (t * 440.0 * std::f32::consts::TAU).sin();
            let pcm = (sample * i16::MAX as f32) as i16;
            data.extend_from_slice(&pcm.to_le_bytes());
        }

        let byte_rate = sample_rate * 2;
        let block_align = 2u16;
        let data_size = data.len() as u32;
        let riff_size = 36 + data_size;

        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&riff_size.to_le_bytes());
        wav.extend_from_slice(b"WAVE");
        wav.extend_from_slice(b"fmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&sample_rate.to_le_bytes());
        wav.extend_from_slice(&byte_rate.to_le_bytes());
        wav.extend_from_slice(&block_align.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data_size.to_le_bytes());
        wav.extend_from_slice(&data);
        wav
    }

    #[test]
    fn decodes_wav_to_samples() {
        let bytes = sine_wav_bytes();
        let decoded = decode_from_bytes(bytes, "wav").expect("wav decode");
        assert_eq!(decoded.sample_rate, 44_100);
        assert_eq!(decoded.channels, 1);
        assert!(!decoded.samples.is_empty());
        assert!(decoded.duration_secs() > 0.2);
        assert!(!decoded.file_bytes.is_empty());
    }
}
