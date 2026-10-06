use tauri::AppHandle;

use crate::models::QueueSnapshot;
use crate::session;
use crate::state::AppState;

#[tauri::command]
pub fn get_queue(state: tauri::State<'_, AppState>) -> Result<QueueSnapshot, String> {
    state.session.snapshot()
}

#[tauri::command]
pub fn play_queue(
    app: AppHandle,
    ids: Vec<String>,
    current_id: String,
) -> Result<QueueSnapshot, String> {
    session::replace_queue_and_play(&app, &ids, &current_id)
}

#[tauri::command]
pub fn queue_insert_next(app: AppHandle, id: String) -> Result<QueueSnapshot, String> {
    session::insert_next(&app, &id)
}

#[tauri::command]
pub fn queue_append(app: AppHandle, id: String) -> Result<QueueSnapshot, String> {
    session::append(&app, &id)
}

#[tauri::command]
pub fn queue_remove(app: AppHandle, id: String) -> Result<QueueSnapshot, String> {
    session::remove(&app, &id)
}

#[tauri::command]
pub fn queue_reorder(
    app: AppHandle,
    from_index: usize,
    to_index: usize,
) -> Result<QueueSnapshot, String> {
    session::reorder(&app, from_index, to_index)
}

#[tauri::command]
pub fn queue_jump(app: AppHandle, id: String) -> Result<QueueSnapshot, String> {
    session::jump(&app, &id)
}

#[tauri::command]
pub fn queue_clear(app: AppHandle) -> Result<QueueSnapshot, String> {
    session::clear(&app)
}

#[tauri::command]
pub fn queue_toggle_shuffle(app: AppHandle) -> Result<QueueSnapshot, String> {
    session::toggle_shuffle(&app)
}

#[tauri::command]
pub fn queue_cycle_repeat(app: AppHandle) -> Result<QueueSnapshot, String> {
    session::cycle_repeat(&app)
}

#[tauri::command]
pub fn queue_next(app: AppHandle) -> Result<QueueSnapshot, String> {
    session::go_next(&app)
}

#[tauri::command]
pub fn queue_previous(app: AppHandle) -> Result<QueueSnapshot, String> {
    session::go_previous(&app)
}

#[tauri::command]
pub fn play_current(app: AppHandle) -> Result<(), String> {
    session::play_current(&app)
}
