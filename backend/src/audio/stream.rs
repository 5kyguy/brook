//! Bounded streaming decoder.
//!
//! A background decoder thread owns the Symphonia `FormatReader` and `Decoder`,
//! pulls packets, and pushes interleaved `f32` samples into a bounded ring. A
//! rodio `Source` ([`RingSource`]) drains that ring on the audio output thread,
//! so playback starts the moment the first frames are decoded instead of
//! waiting for the whole file.
//!
//! Seek reopens the file, seeks the new format reader, and starts a fresh
//! decoder thread. The decoder keeps a small tail of recent output samples so
//! the spectrum visualizer can read the last 2048 frames without holding the
//! whole track in memory.

use std::fs::File;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use rodio::Source;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time as SymphoniaTime;

/// Two seconds of stereo `f32` at 48 kHz is ~384 KiB. Enough to absorb decode
/// jitter without holding the track in memory.
const RING_FRAMES: usize = 96_000;

/// Tail kept for the spectrum visualizer (2048 frames * 2 channels).
const TAIL_FRAMES: usize = 2048;

/// A decoded track session: the live ring plus stream metadata.
pub struct StreamSession {
    pub sample_rate: u32,
    pub channels: u16,
    pub duration_secs: f64,
    ring: Arc<Ring>,
    decoder: Option<std::thread::JoinHandle<()>>,
    cancel: Arc<AtomicBool>,
    /// Frames the output has consumed since the current seek base.
    consumed: Arc<AtomicU64>,
    /// Absolute offset (seconds) of the current seek base. Position is
    /// `seek_base_secs + consumed / sample_rate`, so it stays correct after a
    /// seek instead of restarting from zero.
    seek_base_secs: f64,
    /// Recent output samples for the spectrum visualizer (interleaved).
    tail: Arc<Mutex<Vec<f32>>>,
    /// Stop flag for the most recently created [`RingSource`]. Setting it
    /// makes that source return `None` immediately, so it stops draining the
    /// ring before rodio's ~5ms `stoppable` wrapper would. Used on seek to
    /// prevent the old source from playing seek-point samples out of the
    /// refilled ring (a "replay" stutter).
    current_stop: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    /// Path for reopen-on-seek. None when opened from bytes (tests).
    path: Option<std::path::PathBuf>,
    extension: String,
}

impl StreamSession {
    /// Open `path`, probe it, and start the decoder thread. Returns once the
    /// stream is open and its format is known; decoding continues in the
    /// background.
    pub fn open(
        path: &std::path::Path,
        extension: &str,
        duration_hint: Option<f64>,
    ) -> Result<Self, String> {
        let file = File::open(path)
            .map_err(|e| format!("Failed to open audio file {}: {e}", path.display()))?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        let (format, track_id, codec_params, sample_rate, channels, duration_secs) =
            probe_stream(mss, extension)?;

        let duration_secs = duration_secs.or(duration_hint).unwrap_or(0.0);

        let ring = Arc::new(Ring::new(RING_FRAMES, channels as usize));
        let cancel = Arc::new(AtomicBool::new(false));
        let consumed = Arc::new(AtomicU64::new(0));
        let tail = Arc::new(Mutex::new(Vec::with_capacity(
            TAIL_FRAMES * channels as usize,
        )));

        let decoder = spawn_decoder(
            format,
            track_id,
            codec_params,
            Arc::clone(&ring),
            Arc::clone(&cancel),
        )?;

        Ok(Self {
            sample_rate,
            channels,
            duration_secs,
            ring,
            decoder: Some(decoder),
            cancel,
            consumed,
            tail,
            path: Some(path.to_path_buf()),
            extension: extension.to_string(),
            seek_base_secs: 0.0,
            current_stop: Arc::new(Mutex::new(None)),
        })
    }

    /// A rodio `Source` that drains the ring.
    pub fn source(&self) -> RingSource {
        let stop = Arc::new(AtomicBool::new(false));
        if let Ok(mut guard) = self.current_stop.lock() {
            *guard = Some(Arc::clone(&stop));
        }
        RingSource {
            ring: Arc::clone(&self.ring),
            tail: Arc::clone(&self.tail),
            consumed: Arc::clone(&self.consumed),
            channels: self.channels,
            sample_rate: self.sample_rate,
            buf: Vec::with_capacity(CHUNK),
            pos: 0,
            stop,
        }
    }

    /// Make the most recently created [`RingSource`] return `None` immediately
    /// so it stops draining the ring. Call before clearing/refilling the ring
    /// (e.g. on seek) so the old source doesn't play samples the new decoder
    /// pushes.
    pub fn stop_current_source(&self) {
        if let Ok(mut guard) = self.current_stop.lock() {
            if let Some(flag) = guard.take() {
                flag.store(true, Ordering::SeqCst);
            }
        }
    }

    /// Position in seconds, based on frames the output has consumed since
    /// the current seek base.
    pub fn position_secs(&self) -> f64 {
        if self.sample_rate == 0 {
            return self.seek_base_secs;
        }
        let frames = self.consumed.load(Ordering::Relaxed);
        self.seek_base_secs + (frames as f64 / self.sample_rate as f64)
    }

    /// Seek to `secs`. Reopens the file, seeks the new format reader, and
    /// restarts the decoder thread. Clears the ring and the consumed counter.
    pub fn seek(&mut self, secs: f64) -> Result<(), String> {
        let path = self
            .path
            .clone()
            .ok_or_else(|| "seek requires a file-backed session".to_string())?;

        self.stop();

        let file = File::open(&path)
            .map_err(|e| format!("Failed to reopen audio file {}: {e}", path.display()))?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        let (mut format, track_id, codec_params, sample_rate, channels, duration_secs) =
            probe_stream(mss, &self.extension)?;

        let target = secs.max(0.0);
        if target > 0.0 {
            let seek_time = SymphoniaTime {
                seconds: target as u64,
                frac: target - target.floor(),
            };
            format
                .seek(
                    SeekMode::Accurate,
                    SeekTo::Time {
                        time: seek_time,
                        track_id: None,
                    },
                )
                .map_err(|e| format!("Seek failed: {e}"))?;
        }

        self.ring.reopen();
        self.ring.clear();
        self.consumed.store(0, Ordering::Relaxed);
        self.seek_base_secs = target;
        {
            let mut tail = self.tail.lock().expect("tail lock");
            tail.clear();
        }

        let cancel = Arc::new(AtomicBool::new(false));
        let decoder = spawn_decoder(
            format,
            track_id,
            codec_params,
            Arc::clone(&self.ring),
            Arc::clone(&cancel),
        )?;
        self.cancel = cancel;
        self.decoder = Some(decoder);

        self.sample_rate = sample_rate;
        self.channels = channels;
        if let Some(d) = duration_secs {
            self.duration_secs = d;
        }

        Ok(())
    }

    /// Stop decoding and clear the ring. Called on drop; exposed for explicit
    /// teardown before a new session opens.
    pub fn stop(&mut self) {
        self.cancel.store(true, Ordering::SeqCst);
        // Close the ring BEFORE joining: the decoder may be blocked in `push`
        // waiting for space, and `close()` is what wakes it. Closing first lets
        // the decoder see `closed`/`cancel` and exit so `join` can complete.
        self.ring.close();
        if let Some(handle) = self.decoder.take() {
            let _ = handle.join();
        }
        self.ring.clear();
    }

    /// The most recent output samples (interleaved), up to `TAIL_FRAMES` frames.
    pub fn recent_samples(&self) -> Vec<f32> {
        self.tail.lock().expect("tail lock").clone()
    }

    /// Samples currently buffered in the ring (test/diagnostic use).
    #[cfg(test)]
    pub(crate) fn buffered_samples(&self) -> usize {
        self.ring.len()
    }
}

impl Drop for StreamSession {
    fn drop(&mut self) {
        self.stop();
    }
}

#[allow(clippy::type_complexity)]
fn probe_stream(
    mss: MediaSourceStream,
    extension: &str,
) -> Result<
    (
        Box<dyn FormatReader>,
        u32,
        symphonia::core::codecs::CodecParameters,
        u32,
        u16,
        Option<f64>,
    ),
    String,
> {
    let mut hint = Hint::new();
    if !extension.is_empty() {
        hint.with_extension(extension);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions {
                enable_gapless: true,
                ..Default::default()
            },
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("Failed to probe audio: {e}"))?;

    let format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "No default audio track".to_string())?;
    let track_id = track.id;
    let codec_params = track.codec_params.clone();

    let sample_rate = codec_params.sample_rate.unwrap_or(48_000);
    let channels = codec_params
        .channels
        .map(|c| c.count() as u16)
        .unwrap_or(2);
    let duration_secs = duration_from_params(&codec_params);

    Ok((format, track_id, codec_params, sample_rate, channels, duration_secs))
}

fn duration_from_params(codec_params: &symphonia::core::codecs::CodecParameters) -> Option<f64> {
    let tb = codec_params.time_base?;
    let n_frames = codec_params.n_frames?;
    if tb.denom == 0 {
        return None;
    }
    Some(n_frames as f64 * tb.numer as f64 / tb.denom as f64)
}

fn spawn_decoder(
    mut format: Box<dyn FormatReader>,
    track_id: u32,
    codec_params: symphonia::core::codecs::CodecParameters,
    ring: Arc<Ring>,
    cancel: Arc<AtomicBool>,
) -> Result<std::thread::JoinHandle<()>, String> {
    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|e| format!("Failed to create decoder: {e}"))?;

    let channels = codec_params.channels.map(|c| c.count()).unwrap_or(2);

    let handle = std::thread::Builder::new()
        .name("brook-decode".into())
        .spawn(move || {
            let mut sample_buf: Option<SampleBuffer<f32>> = None;
            loop {
                if cancel.load(Ordering::SeqCst) {
                    ring.close();
                    return;
                }
                let packet = match format.next_packet() {
                    Ok(p) => p,
                    Err(SymphoniaError::IoError(_)) => {
                        ring.close();
                        return;
                    }
                    Err(SymphoniaError::ResetRequired) => {
                        let _ = decoder.reset();
                        continue;
                    }
                    Err(e) => {
                        eprintln!("[brook-decode] packet error: {e}");
                        ring.close();
                        return;
                    }
                };

                if packet.track_id() != track_id {
                    continue;
                }

                let decoded = match decoder.decode(&packet) {
                    Ok(d) => d,
                    Err(SymphoniaError::DecodeError(_)) => continue,
                    Err(e) => {
                        eprintln!("[brook-decode] decode error: {e}");
                        continue;
                    }
                };

                let spec = *decoded.spec();
                let n_channels = spec.channels.count();

                if sample_buf.is_none() {
                    sample_buf = Some(SampleBuffer::<f32>::new(decoded.capacity() as u64, spec));
                }
                let Some(buf) = &mut sample_buf else {
                    continue;
                };
                buf.copy_interleaved_ref(decoded);
                let raw = buf.samples();

                let out: Vec<f32> = if n_channels == channels {
                    raw.to_vec()
                } else if n_channels == 1 && channels == 2 {
                    raw.iter().flat_map(|&s| [s, s]).collect()
                } else if n_channels == 2 && channels == 1 {
                    raw.chunks(2).map(|c| (c[0] + c[1]) * 0.5).collect()
                } else {
                    raw.to_vec()
                };

                ring.push(&out);
            }
        })
        .map_err(|e| format!("Failed to spawn decoder thread: {e}"))?;
    Ok(handle)
}

/// A bounded ring of interleaved `f32` samples shared between the decoder
/// thread (producer) and the audio output thread (consumer).
pub struct Ring {
    buf: Mutex<Vec<f32>>,
    cond: Condvar,
    closed: AtomicBool,
    capacity: usize,
}

impl Ring {
    fn new(frames: usize, channels: usize) -> Self {
        Self {
            buf: Mutex::new(Vec::with_capacity(frames * channels)),
            cond: Condvar::new(),
            closed: AtomicBool::new(false),
            capacity: frames * channels,
        }
    }

    /// Push a chunk of interleaved samples. Blocks until there is room so the
    /// decoder is paced to the consumer's realtime drain rate. Without this
    /// backpressure the decoder (many times realtime for local files) would
    /// overflow the ring, drop samples, and playback would skip forward through
    /// the track.
    fn push(&self, samples: &[f32]) {
        if samples.is_empty() {
            return;
        }
        let mut buf = self.buf.lock().expect("ring lock");
        while buf.len() + samples.len() > self.capacity {
            if self.closed.load(Ordering::SeqCst) {
                return; // tearing down; discard the rest
            }
            // A single chunk larger than the whole ring can never fit even
            // when empty. Clear and push in place rather than deadlock. This
            // does not happen for normal audio packets.
            if samples.len() >= self.capacity {
                buf.clear();
                break;
            }
            let (guard, _timeout) = self
                .cond
                .wait_timeout(buf, Duration::from_millis(50))
                .expect("ring wait");
            buf = guard;
        }
        buf.extend_from_slice(samples);
        self.cond.notify_one();
    }

    /// Fill `out` with up to `out.len()` samples. Returns the number copied.
    /// Returns 0 on underflow (caller emits silence) or when closed and empty.
    fn pop(&self, out: &mut [f32]) -> usize {
        let mut buf = self.buf.lock().expect("ring lock");
        while buf.is_empty() {
            if self.closed.load(Ordering::SeqCst) {
                return 0;
            }
            let (guard, timeout) = self
                .cond
                .wait_timeout(buf, Duration::from_millis(20))
                .expect("ring wait");
            buf = guard;
            if timeout.timed_out() && buf.is_empty() {
                if self.closed.load(Ordering::SeqCst) {
                    return 0;
                }
                return 0; // underflow this tick
            }
        }

        let take = buf.len().min(out.len());
        out[..take].copy_from_slice(&buf[..take]);
        buf.drain(..take);
        // Wake a producer blocked waiting for space.
        self.cond.notify_one();
        take
    }

    fn clear(&self) {
        self.buf.lock().expect("ring lock").clear();
    }

    fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.cond.notify_all();
    }

    /// Reset the closed flag so a reused ring can accept a fresh decoder.
    fn reopen(&self) {
        self.closed.store(false, Ordering::SeqCst);
        self.cond.notify_all();
    }

    fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.buf.lock().expect("ring lock").len()
    }
}

/// Rodio source backed by the ring. Pops samples from the ring in chunks to
/// amortize ring locking/condvar wakeups (rodio still calls `next()` per
/// sample, but each lock acquisition drains up to `CHUNK` samples).
pub struct RingSource {
    ring: Arc<Ring>,
    tail: Arc<Mutex<Vec<f32>>>,
    consumed: Arc<AtomicU64>,
    channels: u16,
    sample_rate: u32,
    buf: Vec<f32>,
    pos: usize,
    /// When set, `next()` returns `None` immediately so this source stops
    /// draining the ring without waiting for rodio's ~5ms `stoppable` wrapper.
    stop: Arc<AtomicBool>,
}

/// Samples pulled per ring lock. ~94 lock acquisitions/sec at 48 kHz mono, far
/// fewer than the per-sample locking a naive `next()` would do.
const CHUNK: usize = 1024;

impl Iterator for RingSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if self.stop.load(Ordering::Relaxed) {
            return None;
        }
        if self.pos >= self.buf.len() {
            self.buf.clear();
            self.buf.resize(CHUNK, 0.0);
            let n = self.ring.pop(&mut self.buf);
            self.buf.truncate(n);
            self.pos = 0;
            if n == 0 {
                if self.ring.is_closed() {
                    return None;
                }
                return Some(0.0); // underflow: brief silence
            }
        }
        let sample = self.buf[self.pos];
        self.pos += 1;
        self.push_tail(sample);
        Some(sample)
    }
}

impl Source for RingSource {
    #[inline]
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    #[inline]
    fn channels(&self) -> u16 {
        self.channels
    }

    #[inline]
    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    #[inline]
    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

impl RingSource {
    fn push_tail(&self, sample: f32) {
        let mut tail = self.tail.lock().expect("tail lock");
        tail.push(sample);
        let max = TAIL_FRAMES * self.channels as usize;
        if tail.len() > max {
            let drop = tail.len() - max;
            tail.drain(..drop);
        }
        if tail.len() % self.channels as usize == 0 {
            self.consumed.fetch_add(1, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

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

    fn write_temp_wav(bytes: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("brook-test-{}.wav", uuid::Uuid::new_v4()));
        let mut f = File::create(&path).expect("create temp wav");
        f.write_all(bytes).expect("write temp wav");
        path
    }

    #[test]
    fn opens_and_reports_duration_without_retaining_file() {
        let bytes = sine_wav_bytes();
        let path = write_temp_wav(&bytes);
        let session = StreamSession::open(&path, "wav", None).expect("open session");
        assert_eq!(session.sample_rate, 44_100);
        assert_eq!(session.channels, 1);
        assert!(session.duration_secs > 0.2);
        // Drain a few samples to confirm the decoder produces output.
        let src = session.source();
        let got: Vec<f32> = src.take(64).filter(|s| *s != 0.0 || true).collect();
        assert!(got.iter().any(|s| s.abs() > 0.01));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn seek_restarts_decoder() {
        let bytes = sine_wav_bytes();
        let path = write_temp_wav(&bytes);
        let mut session = StreamSession::open(&path, "wav", None).expect("open session");
        session.seek(0.1).expect("seek");
        assert!(session.duration_secs > 0.2);
        let src = session.source();
        let got: Vec<f32> = src.take(32).collect();
        assert!(!got.is_empty());
        let _ = std::fs::remove_file(path);
    }

    /// Regression: the decoder (many times realtime for local files) must block
    /// when the ring is full instead of dropping samples. Without backpressure
    /// playback skips forward through the track and "ends" in seconds. With no
    /// consumer draining, the ring fills to capacity and the decoder parks —
    /// it never exceeds capacity.
    #[test]
    fn decoder_backpressure_caps_ring() {
        // 5 s of mono audio — longer than the 2 s ring (RING_FRAMES).
        let sample_rate = 44_100u32;
        let duration_secs = 5.0f32;
        let num_samples = (sample_rate as f32 * duration_secs) as usize;
        let mut data = Vec::with_capacity(num_samples * 2);
        for i in 0..num_samples {
            let t = i as f32 / sample_rate as f32;
            let sample = (t * 440.0 * std::f32::consts::TAU).sin();
            let pcm = (sample * i16::MAX as f32) as i16;
            data.extend_from_slice(&pcm.to_le_bytes());
        }
        let byte_rate = sample_rate * 2;
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
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data_size.to_le_bytes());
        wav.extend_from_slice(&data);

        let path = write_temp_wav(&wav);
        let session = StreamSession::open(&path, "wav", None).expect("open session");

        // Give the decoder time to overrun the ring if backpressure were
        // missing. With backpressure it parks at capacity and never exceeds it.
        std::thread::sleep(std::time::Duration::from_millis(200));
        let capacity = RING_FRAMES * session.channels as usize;
        let buffered = session.buffered_samples();
        assert!(
            buffered <= capacity,
            "ring overflowed: {buffered} > capacity {capacity}; backpressure missing"
        );
        // The decoder should have filled the ring nearly to capacity (5 s of
        // audio >> 2 s ring). It parks just under capacity because the next
        // packet would overflow; allow one packet of slack.
        assert!(
            buffered >= capacity.saturating_sub(4096),
            "ring not filled: {buffered} < capacity {capacity}; decoder didn't run"
        );

        let _ = std::fs::remove_file(path);
    }
}
