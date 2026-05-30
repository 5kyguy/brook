use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use rodio::{OutputStream, OutputStreamHandle, Sink};
use tauri::{AppHandle, Emitter};

use crate::db::TrackRow;
use crate::audio::decode::DecodedAudio;
use crate::models::{
    PlaybackEndedPayload, PlaybackPositionPayload, PlaybackState, PlaybackStatePayload,
    PlaybackStatus,
};

const TICK_MS: u64 = 250;

enum AudioCommand {
    Play {
        track_id: String,
        decoded: DecodedAudio,
        start_secs: f64,
    },
    Pause,
    Resume,
    Stop,
    Seek(f64),
    SetVolume(f32),
    Shutdown,
}

struct PlayerContext {
    _output_stream: OutputStream,
    stream_handle: OutputStreamHandle,
    sink: Option<Sink>,
    decoded: Option<Arc<DecodedAudio>>,
    track_id: Option<String>,
    seek_base_secs: f64,
    volume: f32,
    playing: bool,
}

impl PlayerContext {
    fn new() -> Result<Self, String> {
        let (output_stream, stream_handle) =
            OutputStream::try_default().map_err(|e| format!("Audio output unavailable: {e}"))?;
        Ok(Self {
            _output_stream: output_stream,
            stream_handle,
            sink: None,
            decoded: None,
            track_id: None,
            seek_base_secs: 0.0,
            volume: 1.0,
            playing: false,
        })
    }

    fn stop_sink(&mut self) {
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        self.playing = false;
    }

    fn start_at(&mut self, decoded: Arc<DecodedAudio>, start_secs: f64) -> Result<(), String> {
        self.stop_sink();
        let sink = Sink::try_new(&self.stream_handle)
            .map_err(|e| format!("Failed to create audio sink: {e}"))?;
        sink.set_volume(self.volume);
        sink.append(decoded.source_from(start_secs));
        sink.play();
        self.seek_base_secs = start_secs;
        self.sink = Some(sink);
        self.playing = true;
        Ok(())
    }

    fn position_secs(&self) -> f64 {
        let Some(sink) = &self.sink else {
            return 0.0;
        };
        self.seek_base_secs + sink.get_pos().as_secs_f64()
    }

    fn duration_secs(&self) -> f64 {
        self.decoded
            .as_ref()
            .map(|d| d.duration_secs())
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

    pub fn play(&self, track: &TrackRow) -> Result<(), String> {
        let bytes = std::fs::read(&track.absolute_path).map_err(|e| {
            format!(
                "Failed to read audio file {}: {e}",
                track.absolute_path
            )
        })?;
        let decoded = crate::audio::decode::decode_from_bytes(bytes, &track.extension)?;
        self.cmd_tx
            .send(AudioCommand::Play {
                track_id: track.id.clone(),
                decoded,
                start_secs: 0.0,
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

    pub fn stop(&self) -> Result<(), String> {
        self.cmd_tx
            .send(AudioCommand::Stop)
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
}

impl Drop for Engine {
    fn drop(&mut self) {
        let _ = self.cmd_tx.send(AudioCommand::Shutdown);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
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

    loop {
        match cmd_rx.recv_timeout(Duration::from_millis(TICK_MS)) {
            Ok(AudioCommand::Play {
                track_id,
                decoded,
                start_secs,
            }) => {
                let decoded = Arc::new(decoded);
                ctx.decoded = Some(Arc::clone(&decoded));
                ctx.track_id = Some(track_id.clone());
                if let Err(e) = ctx.start_at(decoded, start_secs) {
                    eprintln!("[brook-audio] play failed: {e}");
                    continue;
                }
                update_state(
                    &shared_state,
                    PlaybackStatus::Playing,
                    Some(track_id),
                    start_secs,
                    ctx.duration_secs(),
                    ctx.volume,
                );
                emit_state(&app, PlaybackStatus::Playing);
                emit_position(&app, start_secs, ctx.duration_secs());
            }
            Ok(AudioCommand::Pause) => {
                if let Some(sink) = &ctx.sink {
                    sink.pause();
                    ctx.playing = false;
                    let pos = ctx.position_secs();
                    update_state(
                        &shared_state,
                        PlaybackStatus::Paused,
                        ctx.track_id.clone(),
                        pos,
                        ctx.duration_secs(),
                        ctx.volume,
                    );
                    emit_state(&app, PlaybackStatus::Paused);
                    emit_position(&app, pos, ctx.duration_secs());
                }
            }
            Ok(AudioCommand::Resume) => {
                if let Some(sink) = &ctx.sink {
                    sink.play();
                    ctx.playing = true;
                    let pos = ctx.position_secs();
                    update_state(
                        &shared_state,
                        PlaybackStatus::Playing,
                        ctx.track_id.clone(),
                        pos,
                        ctx.duration_secs(),
                        ctx.volume,
                    );
                    emit_state(&app, PlaybackStatus::Playing);
                }
            }
            Ok(AudioCommand::Stop) => {
                let track_id = ctx.track_id.clone();
                ctx.stop_sink();
                ctx.decoded = None;
                ctx.track_id = None;
                ctx.seek_base_secs = 0.0;
                update_state(
                    &shared_state,
                    PlaybackStatus::Stopped,
                    None,
                    0.0,
                    0.0,
                    ctx.volume,
                );
                emit_state(&app, PlaybackStatus::Stopped);
                if let Some(id) = track_id {
                    let _ = app.emit("playback:ended", PlaybackEndedPayload { track_id: id });
                }
            }
            Ok(AudioCommand::Seek(position_secs)) => {
                let Some(decoded) = ctx.decoded.clone() else {
                    continue;
                };
                let was_playing = ctx.playing;
                let duration = decoded.duration_secs();
                let target = position_secs.clamp(0.0, duration);
                if let Err(e) = ctx.start_at(decoded, target) {
                    eprintln!("[brook-audio] seek failed: {e}");
                    continue;
                }
                if !was_playing {
                    if let Some(sink) = &ctx.sink {
                        sink.pause();
                    }
                    ctx.playing = false;
                    update_state(
                        &shared_state,
                        PlaybackStatus::Paused,
                        ctx.track_id.clone(),
                        target,
                        duration,
                        ctx.volume,
                    );
                    emit_state(&app, PlaybackStatus::Paused);
                } else {
                    update_state(
                        &shared_state,
                        PlaybackStatus::Playing,
                        ctx.track_id.clone(),
                        target,
                        duration,
                        ctx.volume,
                    );
                }
                emit_position(&app, target, duration);
            }
            Ok(AudioCommand::SetVolume(volume)) => {
                ctx.volume = volume.clamp(0.0, 1.0);
                if let Some(sink) = &ctx.sink {
                    sink.set_volume(ctx.volume);
                }
                if let Ok(mut state) = shared_state.lock() {
                    state.volume = ctx.volume;
                }
            }
            Ok(AudioCommand::Shutdown) => break,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if !ctx.playing {
                    continue;
                }
                let Some(sink) = &ctx.sink else {
                    continue;
                };
                if sink.empty() {
                    let track_id = ctx.track_id.clone();
                    ctx.playing = false;
                    ctx.stop_sink();
                    let duration = ctx.duration_secs();
                    update_state(
                        &shared_state,
                        PlaybackStatus::Stopped,
                        None,
                        duration,
                        duration,
                        ctx.volume,
                    );
                    emit_state(&app, PlaybackStatus::Stopped);
                    emit_position(&app, duration, duration);
                    if let Some(id) = track_id {
                        let _ = app.emit("playback:ended", PlaybackEndedPayload { track_id: id });
                    }
                    ctx.track_id = None;
                    ctx.decoded = None;
                    ctx.seek_base_secs = 0.0;
                    continue;
                }
                let pos = ctx.position_secs();
                let duration = ctx.duration_secs();
                update_state(
                    &shared_state,
                    PlaybackStatus::Playing,
                    ctx.track_id.clone(),
                    pos,
                    duration,
                    ctx.volume,
                );
                emit_position(&app, pos, duration);
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
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
    let _ = app.emit(
        "playback:state",
        PlaybackStatePayload { status },
    );
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
