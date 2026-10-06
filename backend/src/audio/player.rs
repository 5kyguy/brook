use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use rodio::{OutputStream, OutputStreamHandle, Sink};
use tauri::{AppHandle, Emitter, Manager};

use crate::audio::spectrum::{self, DEFAULT_BIN_COUNT};
use crate::audio::stream::{RingSource, StreamSession};
use crate::db::TrackRow;
use crate::models::{
    PlaybackAdvancedPayload, PlaybackEndedPayload, PlaybackPositionPayload,
    PlaybackSpectrumPayload, PlaybackState, PlaybackStatePayload, PlaybackStatus,
};
use crate::state::AppState;

const TICK_MS: u64 = 250;
const SPECTRUM_MS: u64 = 33;
const POSITION_MS: u64 = 250;
const RESUME_SAVE_MS: u64 = 5000;

fn record_listen(app: &AppHandle, track_id: &str, position_secs: f64, duration_secs: f64) {
    let state = app.state::<AppState>();
    let Ok(mut db) = state.db.lock() else {
        return;
    };
    let _ = db.record_play(track_id, position_secs, duration_secs);
}

/// A track queued for preload. The engine opens and probes it into a second
/// `StreamSession` so the natural-end handoff does not stall on file open.
struct Preload {
    session: StreamSession,
    track_id: String,
    track: crate::models::Track,
    replay_gain_track_db: Option<f64>,
    replay_gain_track_peak: Option<f64>,
}

enum AudioCommand {
    /// Start playing `track` from the beginning. Any current session is stopped.
    Play {
        track_id: String,
        row: TrackRow,
        track: crate::models::Track,
    },
    /// Open `track` paused at `position_secs` (resume-on-launch). Does not
    /// start playback.
    LoadPaused {
        track_id: String,
        row: TrackRow,
        track: crate::models::Track,
        position_secs: f64,
    },
    /// Tell the engine which track is next in the queue, so it can preload it.
    /// `None` means no upcoming track; drop any existing preload.
    SetUpcoming {
        row: Option<TrackRow>,
        track: Option<crate::models::Track>,
    },
    Pause,
    Resume,
    Seek(f64),
    SetVolume(f32),
    SetVisualizerActive(bool),
    Stop,
    Shutdown,
}

struct PlayerContext {
    _output_stream: OutputStream,
    stream_handle: OutputStreamHandle,
    sink: Option<Sink>,
    session: Option<StreamSession>,
    track_id: Option<String>,
    volume: f32,
    /// ReplayGain track gain applied on top of `volume` at the sink. 1.0 means
    /// no gain. Derived from the loaded track's REPLAYGAIN_TRACK_GAIN/PEAK tags
    /// so the UI's `volume` stays the user-facing value.
    replay_gain_scale: f32,
    playing: bool,
    visualizer_active: bool,
    last_spectrum_emit: std::time::Instant,
    last_position_emit: std::time::Instant,
    last_resume_save: std::time::Instant,
    /// True once the current session has signaled natural end and we have
    /// already emitted the ended/advanced event. Prevents duplicate emits.
    ended_emitted: bool,
}

impl PlayerContext {
    fn new() -> Result<Self, String> {
        let (output_stream, stream_handle) =
            OutputStream::try_default().map_err(|e| format!("Audio output unavailable: {e}"))?;
        Ok(Self {
            _output_stream: output_stream,
            stream_handle,
            sink: None,
            session: None,
            track_id: None,
            volume: 1.0,
            replay_gain_scale: 1.0,
            playing: false,
            visualizer_active: false,
            last_spectrum_emit: std::time::Instant::now(),
            last_position_emit: std::time::Instant::now(),
            last_resume_save: std::time::Instant::now(),
            ended_emitted: false,
        })
    }

    fn stop_sink(&mut self) {
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        self.playing = false;
    }

    /// Start a fresh sink pulling from `source`. Stops any existing sink.
    fn start_source(&mut self, source: RingSource, play: bool) -> Result<(), String> {
        self.stop_sink();
        let sink = Sink::try_new(&self.stream_handle)
            .map_err(|e| format!("Failed to create audio sink: {e}"))?;
        sink.set_volume(self.volume * self.replay_gain_scale);
        sink.append(source);
        if play {
            sink.play();
            self.playing = true;
        } else {
            sink.pause();
            self.playing = false;
        }
        self.sink = Some(sink);
        Ok(())
    }

    fn position_secs(&self) -> f64 {
        self.session
            .as_ref()
            .map(|s| s.position_secs())
            .unwrap_or(0.0)
    }

    fn duration_secs(&self) -> f64 {
        self.session
            .as_ref()
            .map(|s| s.duration_secs)
            .unwrap_or(0.0)
    }
}

pub struct Engine {
    cmd_tx: std::sync::mpsc::Sender<AudioCommand>,
    state: Arc<Mutex<PlaybackState>>,
    join: Option<JoinHandle<()>>,
}

impl Engine {
    pub fn new(app: AppHandle) -> Self {
        let (cmd_tx, cmd_rx) = std::sync::mpsc::channel();
        let state = Arc::new(Mutex::new(PlaybackState::default()));
        let state_for_thread = Arc::clone(&state);

        let join = thread::Builder::new()
            .name("brook-audio".into())
            .spawn(move || audio_thread_main(app, cmd_rx, state_for_thread))
            .expect("failed to spawn audio thread");

        Self {
            cmd_tx,
            state,
            join: Some(join),
        }
    }

    pub fn state(&self) -> PlaybackState {
        self.state.lock().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn play(&self, track: &TrackRow, full: &crate::models::Track) -> Result<(), String> {
        self.cmd_tx
            .send(AudioCommand::Play {
                track_id: track.id.clone(),
                row: track.clone(),
                track: full.clone(),
            })
            .map_err(|e| format!("Audio thread unavailable: {e}"))
    }

    pub fn set_upcoming(
        &self,
        row: Option<TrackRow>,
        track: Option<crate::models::Track>,
    ) -> Result<(), String> {
        self.cmd_tx
            .send(AudioCommand::SetUpcoming { row, track })
            .map_err(|e| format!("Audio thread unavailable: {e}"))
    }

    /// Open `track` and seek to `position_secs` without starting playback
    /// (resume-on-launch). The frontend sets the now-playing bar afterwards.
    pub fn load_paused(
        &self,
        row: &TrackRow,
        track: &crate::models::Track,
        position_secs: f64,
    ) -> Result<(), String> {
        self.cmd_tx
            .send(AudioCommand::LoadPaused {
                track_id: row.id.clone(),
                row: row.clone(),
                track: track.clone(),
                position_secs,
            })
            .map_err(|e| format!("Audio thread unavailable: {e}"))
    }

    pub fn pause(&self) -> Result<(), String> {
        self.cmd_tx
            .send(AudioCommand::Pause)
            .map_err(|e| format!("Audio thread unavailable: {e}"))
    }

    pub fn resume(&self) -> Result<(), String> {
        self.cmd_tx
            .send(AudioCommand::Resume)
            .map_err(|e| format!("Audio thread unavailable: {e}"))
    }

    pub fn seek(&self, position_secs: f64) -> Result<(), String> {
        self.cmd_tx
            .send(AudioCommand::Seek(position_secs))
            .map_err(|e| format!("Audio thread unavailable: {e}"))
    }

    pub fn set_volume(&self, volume: f32) -> Result<(), String> {
        self.cmd_tx
            .send(AudioCommand::SetVolume(volume))
            .map_err(|e| format!("Audio thread unavailable: {e}"))
    }

    pub fn set_visualizer_active(&self, active: bool) -> Result<(), String> {
        self.cmd_tx
            .send(AudioCommand::SetVisualizerActive(active))
            .map_err(|e| format!("Audio thread unavailable: {e}"))
    }

    pub fn stop(&self) -> Result<(), String> {
        self.cmd_tx
            .send(AudioCommand::Stop)
            .map_err(|e| format!("Audio thread unavailable: {e}"))
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        let _ = self.cmd_tx.send(AudioCommand::Shutdown);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

fn open_session(row: &TrackRow) -> Result<StreamSession, String> {
    StreamSession::open(
        std::path::Path::new(&row.absolute_path),
        &row.extension,
        row.duration_secs,
    )
}

fn audio_thread_main(
    app: AppHandle,
    cmd_rx: std::sync::mpsc::Receiver<AudioCommand>,
    shared_state: Arc<Mutex<PlaybackState>>,
) {
    let mut ctx = match PlayerContext::new() {
        Ok(ctx) => ctx,
        Err(e) => {
            eprintln!("[brook-audio] {e}");
            return;
        }
    };

    let mut preload: Option<Preload> = None;

    loop {
        let poll_ms = if ctx.visualizer_active && ctx.playing {
            SPECTRUM_MS
        } else {
            TICK_MS
        };
        match cmd_rx.recv_timeout(Duration::from_millis(poll_ms)) {
            Ok(AudioCommand::Play {
                track_id,
                row,
                track,
            }) => {
                handle_play(&app, &shared_state, &mut ctx, &mut preload, track_id, row, track);
            }
            Ok(AudioCommand::LoadPaused {
                track_id,
                row,
                track,
                position_secs,
            }) => {
                handle_load_paused(
                    &app,
                    &shared_state,
                    &mut ctx,
                    &mut preload,
                    track_id,
                    row,
                    track,
                    position_secs,
                );
            }
            Ok(AudioCommand::SetUpcoming { row, track }) => {
                preload = match (row, track) {
                    (Some(row), Some(track)) => {
                        // Avoid preloading the track currently playing
                        // (repeat-one or a one-track queue).
                        if ctx.track_id.as_deref() == Some(&row.id) {
                            None
                        } else {
                            match open_session(&row) {
                                Ok(session) => Some(Preload {
                                    session,
                                    track_id: row.id.clone(),
                                    track,
                                    replay_gain_track_db: row.replay_gain_track_db,
                                    replay_gain_track_peak: row.replay_gain_track_peak,
                                }),
                                Err(e) => {
                                    eprintln!("[brook-audio] preload failed: {e}");
                                    None
                                }
                            }
                        }
                    }
                    _ => None,
                };
            }
            Ok(AudioCommand::Pause) => handle_pause(&app, &shared_state, &mut ctx),
            Ok(AudioCommand::Resume) => handle_resume(&app, &shared_state, &mut ctx),
            Ok(AudioCommand::Seek(position_secs)) => {
                handle_seek(&app, &shared_state, &mut ctx, position_secs)
            }
            Ok(AudioCommand::SetVolume(volume)) => {
                ctx.volume = volume.clamp(0.0, 1.0);
                if let Some(sink) = &ctx.sink {
                    sink.set_volume(ctx.volume * ctx.replay_gain_scale);
                }
                if let Ok(mut state) = shared_state.lock() {
                    state.volume = ctx.volume;
                }
            }
            Ok(AudioCommand::SetVisualizerActive(active)) => {
                ctx.visualizer_active = active;
                ctx.last_spectrum_emit = std::time::Instant::now();
                if !active {
                    emit_spectrum_silence(&app);
                }
            }
            Ok(AudioCommand::Stop) => handle_stop(&app, &shared_state, &mut ctx, &mut preload),
            Ok(AudioCommand::Shutdown) => break,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                handle_tick(&app, &shared_state, &mut ctx, &mut preload);
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn handle_play(
    app: &AppHandle,
    shared_state: &Arc<Mutex<PlaybackState>>,
    ctx: &mut PlayerContext,
    preload: &mut Option<Preload>,
    track_id: String,
    row: TrackRow,
    track: crate::models::Track,
) {
    // If the requested track is already preloaded, swap to it directly for an
    // instant, gapless-feeling skip. Otherwise open a fresh session.
    let session = if let Some(p) = preload.take() {
        if p.track_id == track_id {
            p.session
        } else {
            drop(p);
            match open_session(&row) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[brook-audio] play failed: {e}");
                    return;
                }
            }
        }
    } else {
        match open_session(&row) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[brook-audio] play failed: {e}");
                return;
            }
        }
    };

    let source = session.source();
    ctx.session = Some(session);
    ctx.track_id = Some(track_id.clone());
    ctx.ended_emitted = false;
    ctx.replay_gain_scale =
        replay_gain_scale(row.replay_gain_track_db, row.replay_gain_track_peak);
    if let Err(e) = ctx.start_source(source, true) {
        eprintln!("[brook-audio] play failed: {e}");
        return;
    }
    let duration = ctx.duration_secs();
    update_state(
        shared_state,
        PlaybackStatus::Playing,
        Some(track_id),
        0.0,
        duration,
        ctx.volume,
    );
    emit_state(app, PlaybackStatus::Playing);
    emit_position(app, 0.0, duration);
    let _ = app.emit("playback:track-changed", track);
}

fn save_resume(app: &AppHandle, track_id: Option<&str>, position_secs: f64) {
    let state = app.state::<AppState>();
    let Ok(db) = state.db.lock() else {
        return;
    };
    let resume = crate::models::ResumeState {
        track_id: track_id.map(|s| s.to_string()),
        position_secs,
    };
    if let Err(e) = db.set_resume_state(&resume) {
        eprintln!("[brook-audio] resume save failed: {e}");
    }
}

/// Compute the sink volume scale from read-only ReplayGain tags.
///
/// `track_gain_db` is the track gain in dB (e.g. -7.43). The linear scale is
/// `10^(gain/20)`. We clamp using the track peak so the scaled signal never
/// exceeds full scale (would clip), and cap the boost at +6 dB / 2.0x so a
/// hot tag can't blow out the output. Returns 1.0 when there is no gain.
fn replay_gain_scale(track_gain_db: Option<f64>, track_peak: Option<f64>) -> f32 {
    let Some(gain_db) = track_gain_db else {
        return 1.0;
    };
    // Cap the boost at +6 dB; negative gains (the common case) are unlimited.
    let clamped_db = gain_db.clamp(-60.0, 6.0);
    let mut scale = 10f64.powf(clamped_db / 20.0);
    if let Some(peak) = track_peak {
        if peak > 0.0 {
            // The largest scale that keeps the peak at or below 1.0.
            let max_scale = 1.0 / peak;
            if scale > max_scale {
                scale = max_scale;
            }
        }
    }
    // Floor at 0 (a wildly negative gain shouldn't go negative) and cap.
    scale = scale.clamp(0.0, 2.0);
    scale as f32
}

/// Open a track paused at `position_secs` (resume-on-launch). Opens the
/// session, starts the sink paused, then seeks — `handle_seek` restarts the
/// sink paused because `was_playing` is false here.
fn handle_load_paused(
    app: &AppHandle,
    shared_state: &Arc<Mutex<PlaybackState>>,
    ctx: &mut PlayerContext,
    preload: &mut Option<Preload>,
    track_id: String,
    row: TrackRow,
    track: crate::models::Track,
    position_secs: f64,
) {
    let session = if let Some(p) = preload.take() {
        if p.track_id == track_id {
            p.session
        } else {
            drop(p);
            match open_session(&row) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[brook-audio] load_paused failed: {e}");
                    return;
                }
            }
        }
    } else {
        match open_session(&row) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[brook-audio] load_paused failed: {e}");
                return;
            }
        }
    };

    ctx.session = Some(session);
    ctx.track_id = Some(track_id.clone());
    ctx.ended_emitted = false;
    ctx.replay_gain_scale =
        replay_gain_scale(row.replay_gain_track_db, row.replay_gain_track_peak);
    let duration = ctx.duration_secs();
    handle_seek(app, shared_state, ctx, position_secs);
    let pos = ctx.position_secs();
    update_state(
        shared_state,
        PlaybackStatus::Paused,
        Some(track_id),
        pos,
        duration,
        ctx.volume,
    );
    emit_state(app, PlaybackStatus::Paused);
    emit_position(app, pos, duration);
    let _ = app.emit("playback:track-changed", track);
}

fn handle_pause(app: &AppHandle, shared_state: &Arc<Mutex<PlaybackState>>, ctx: &mut PlayerContext) {
    if let Some(sink) = &ctx.sink {
        sink.pause();
        ctx.playing = false;
        let pos = ctx.position_secs();
        let duration = ctx.duration_secs();
        update_state(
            shared_state,
            PlaybackStatus::Paused,
            ctx.track_id.clone(),
            pos,
            duration,
            ctx.volume,
        );
        emit_state(app, PlaybackStatus::Paused);
        emit_position(app, pos, duration);
        if ctx.visualizer_active {
            emit_spectrum_silence(app);
        }
    }
}

fn handle_resume(app: &AppHandle, shared_state: &Arc<Mutex<PlaybackState>>, ctx: &mut PlayerContext) {
    if let Some(sink) = &ctx.sink {
        sink.play();
        ctx.playing = true;
        let pos = ctx.position_secs();
        update_state(
            shared_state,
            PlaybackStatus::Playing,
            ctx.track_id.clone(),
            pos,
            ctx.duration_secs(),
            ctx.volume,
        );
        emit_state(app, PlaybackStatus::Playing);
    }
}

fn handle_seek(
    app: &AppHandle,
    shared_state: &Arc<Mutex<PlaybackState>>,
    ctx: &mut PlayerContext,
    position_secs: f64,
) {
    let was_playing = ctx.playing;
    // Stop the old sink BEFORE seeking. The old sink's RingSource shares the
    // session's ring, so if it keeps running while `seek` clears and refills
    // the ring from the new position, it drains seek-point samples that the
    // new sink would then replay (a stutter right after seek).
    ctx.stop_sink();
    let Some(session) = ctx.session.as_mut() else {
        return;
    };
    // Also signal the old RingSource to return None immediately. rodio's
    // `Sink::stop` only takes effect on the next ~5ms `periodic_access` tick;
    // until then the old source keeps draining the shared ring. Setting this
    // flag makes it end on the next `next()` call, before the ring is
    // refilled with seek-point audio.
    session.stop_current_source();
    let duration = session.duration_secs;
    let target = position_secs.clamp(0.0, duration);
    if let Err(e) = session.seek(target) {
        eprintln!("[brook-audio] seek failed: {e}");
        return;
    }
    // Restart the sink on the new session source so the ring is drained from
    // the seek point.
    let source = session.source();
    if let Err(e) = ctx.start_source(source, was_playing) {
        eprintln!("[brook-audio] seek restart failed: {e}");
        return;
    }
    ctx.ended_emitted = false;
    if was_playing {
        update_state(
            shared_state,
            PlaybackStatus::Playing,
            ctx.track_id.clone(),
            target,
            duration,
            ctx.volume,
        );
    } else {
        update_state(
            shared_state,
            PlaybackStatus::Paused,
            ctx.track_id.clone(),
            target,
            duration,
            ctx.volume,
        );
        emit_state(app, PlaybackStatus::Paused);
    }
    emit_position(app, target, duration);
}

fn handle_stop(
    app: &AppHandle,
    shared_state: &Arc<Mutex<PlaybackState>>,
    ctx: &mut PlayerContext,
    preload: &mut Option<Preload>,
) {
    ctx.stop_sink();
    if let Some(mut session) = ctx.session.take() {
        session.stop();
    }
    let duration = ctx.duration_secs();
    update_state(
        shared_state,
        PlaybackStatus::Stopped,
        None,
        0.0,
        duration,
        ctx.volume,
    );
    emit_state(app, PlaybackStatus::Stopped);
    emit_position(app, 0.0, duration);
    ctx.track_id = None;
    ctx.ended_emitted = false;
    *preload = None;
    save_resume(app, None, 0.0);
}

fn handle_tick(
    app: &AppHandle,
    shared_state: &Arc<Mutex<PlaybackState>>,
    ctx: &mut PlayerContext,
    preload: &mut Option<Preload>,
) {
    if !ctx.playing {
        return;
    }
    let Some(sink) = &ctx.sink else {
        return;
    };
    if sink.empty() && !ctx.ended_emitted {
        // Natural end. Try a gapless handoff to the preload.
        ctx.ended_emitted = true;
        let finished_id = ctx.track_id.clone();
        let finished_duration = ctx.duration_secs();

        if let Some(p) = preload.take() {
            // Record the finished listen at full duration.
            if let Some(id) = &finished_id {
                record_listen(app, id, finished_duration, finished_duration);
            }
            let new_track = p.track.clone();
            let new_id = p.track_id.clone();
            let source = p.session.source();
            ctx.session = Some(p.session);
            ctx.track_id = Some(new_id.clone());
            ctx.ended_emitted = false;
            ctx.replay_gain_scale =
                replay_gain_scale(p.replay_gain_track_db, p.replay_gain_track_peak);
            if let Err(e) = ctx.start_source(source, true) {
                eprintln!("[brook-audio] gapless swap failed: {e}");
            }
            let duration = ctx.duration_secs();
            update_state(
                shared_state,
                PlaybackStatus::Playing,
                Some(new_id.clone()),
                0.0,
                duration,
                ctx.volume,
            );
            emit_state(app, PlaybackStatus::Playing);
            emit_position(app, 0.0, duration);
            let _ = app.emit("playback:advanced", PlaybackAdvancedPayload { track: new_track });
            return;
        }

        // No preload: stop and emit ended.
        ctx.playing = false;
        ctx.stop_sink();
        if let Some(mut session) = ctx.session.take() {
            session.stop();
        }
        update_state(
            shared_state,
            PlaybackStatus::Stopped,
            None,
            finished_duration,
            finished_duration,
            ctx.volume,
        );
        emit_state(app, PlaybackStatus::Stopped);
        emit_position(app, finished_duration, finished_duration);
        if ctx.visualizer_active {
            emit_spectrum_silence(app);
        }
        if let Some(id) = finished_id {
            record_listen(app, &id, finished_duration, finished_duration);
            let _ = app.emit("playback:ended", PlaybackEndedPayload { track_id: id });
        }
        ctx.track_id = None;
        save_resume(app, None, finished_duration);
        return;
    }
    if ctx.ended_emitted {
        return;
    }
    let pos = ctx.position_secs();
    let duration = ctx.duration_secs();
    update_state(
        shared_state,
        PlaybackStatus::Playing,
        ctx.track_id.clone(),
        pos,
        duration,
        ctx.volume,
    );
    if ctx.last_position_emit.elapsed() >= Duration::from_millis(POSITION_MS) {
        emit_position(app, pos, duration);
        ctx.last_position_emit = std::time::Instant::now();
    }
    if ctx.last_resume_save.elapsed() >= Duration::from_millis(RESUME_SAVE_MS) {
        if let Some(id) = ctx.track_id.as_deref() {
            save_resume(app, Some(id), pos);
        }
        ctx.last_resume_save = std::time::Instant::now();
    }
    maybe_emit_spectrum_mut(app, ctx);
}

fn update_state(
    shared: &Arc<Mutex<PlaybackState>>,
    status: PlaybackStatus,
    track_id: Option<String>,
    position_secs: f64,
    duration_secs: f64,
    volume: f32,
) {
    if let Ok(mut state) = shared.lock() {
        state.status = status;
        state.track_id = track_id;
        state.position_secs = position_secs;
        state.duration_secs = duration_secs;
        state.volume = volume;
    }
}

fn emit_state(app: &AppHandle, status: PlaybackStatus) {
    let _ = app.emit("playback:state", PlaybackStatePayload { status });
}

fn emit_position(app: &AppHandle, position_secs: f64, duration_secs: f64) {
    let _ = app.emit(
        "playback:position",
        PlaybackPositionPayload {
            position_secs,
            duration_secs,
        },
    );
}

fn emit_spectrum(app: &AppHandle, bins: Vec<f32>) {
    let _ = app.emit("playback:spectrum", PlaybackSpectrumPayload { bins });
}

fn emit_spectrum_silence(app: &AppHandle) {
    emit_spectrum(app, vec![0.0; DEFAULT_BIN_COUNT]);
}

fn maybe_emit_spectrum_mut(app: &AppHandle, ctx: &mut PlayerContext) {
    if !ctx.visualizer_active || !ctx.playing {
        return;
    }
    if ctx.last_spectrum_emit.elapsed() < Duration::from_millis(SPECTRUM_MS) {
        return;
    }
    let Some(session) = ctx.session.as_ref() else {
        return;
    };
    let samples = session.recent_samples();
    let bins = spectrum::compute_spectrum_from_samples(
        &samples,
        ctx.session.as_ref().map(|s| s.channels).unwrap_or(2),
        ctx.session.as_ref().map(|s| s.sample_rate).unwrap_or(48_000),
        DEFAULT_BIN_COUNT,
    );
    emit_spectrum(app, bins);
    ctx.last_spectrum_emit = std::time::Instant::now();
}

#[cfg(test)]
mod tests {
    use super::replay_gain_scale;

    #[test]
    fn replay_gain_scale_no_gain_is_unity() {
        assert!((replay_gain_scale(None, None) - 1.0).abs() < 1e-6);
        // A present gain of 0 dB is also unity.
        assert!((replay_gain_scale(Some(0.0), None) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn replay_gain_scale_negative_gain_reduces_volume() {
        // -6 dB ≈ 0.501.
        let scale = replay_gain_scale(Some(-6.0), None);
        assert!(scale < 1.0);
        assert!((scale - 0.5012_f32).abs() < 0.01);
    }

    #[test]
    fn replay_gain_scale_clamped_by_peak() {
        // +6 dB would be ~2.0, but a peak of 0.6 caps the safe scale at
        // 1/0.6 ≈ 1.667, so the peak must win.
        let scale = replay_gain_scale(Some(6.0), Some(0.6));
        assert!((scale - (1.0 / 0.6) as f32).abs() < 1e-3);
    }

    #[test]
    fn replay_gain_scale_caps_boost_at_six_db() {
        // An extreme +24 dB tag is clamped to +6 dB before scaling, so the
        // result is 10^(6/20) ≈ 1.995 and never exceeds 2.0.
        let scale = replay_gain_scale(Some(24.0), None);
        assert!(scale <= 2.0);
        assert!((scale - 1.9953_f32).abs() < 1e-3);
    }
}
