use crate::dev_log;

#[tauri::command]
pub fn dev_log_append(source: String, message: String) -> Result<(), String> {
    dev_log::append(&source, &message);
    Ok(())
}
