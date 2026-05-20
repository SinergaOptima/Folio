use std::sync::Arc;
use tauri::State;
use crate::AppState;

#[tauri::command]
pub async fn get_recent_folders(state: State<'_, Arc<AppState>>) -> Result<Vec<String>, String> {
    Ok(state.recent_folders.read().clone())
}

#[tauri::command]
pub async fn add_recent_folder(path: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let mut recents = state.recent_folders.write();
    if let Some(pos) = recents.iter().position(|p| p == &path) {
        recents.remove(pos);
    }
    recents.insert(0, path);
    if recents.len() > 10 {
        recents.pop();
    }
    crate::save_recent_folders(&recents);
    Ok(())
}
