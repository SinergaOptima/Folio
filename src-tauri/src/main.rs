#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use parking_lot::RwLock;

use library_core::{LibraryCache, LibraryIndex, build_index};
use media_core::is_video_path;

#[derive(serde::Serialize)]
struct UiItem {
    path: String,
    width: u32,
    height: u32,
    orientation: u16,
    format: Option<String>,
    is_video: bool,
    size: u64,
    modified: u64,
}

struct AppState {
    cache: LibraryCache,
    index: RwLock<Option<LibraryIndex>>,
}

#[tauri::command]
async fn open_folder_picker(state: State<'_, Arc<AppState>>) -> Result<Option<String>, String> {
    // Use AsyncFileDialog so the main thread stays free
    let folder = rfd::AsyncFileDialog::new()
        .pick_folder()
        .await;

    let Some(folder) = folder else {
        return Ok(None);
    };

    let folder_path = folder.path().to_path_buf();
    let state_arc = state.inner().clone();

    // Heavy work on a blocking thread so the UI stays responsive
    let path_str = tauri::async_runtime::spawn_blocking(move || {
        let index = build_index(&folder_path, &state_arc.cache)
            .map_err(|e| e.to_string())?;
        let path_str = folder_path.to_string_lossy().to_string();
        *state_arc.index.write() = Some(index);
        Ok::<String, String>(path_str)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(Some(path_str))
}

#[tauri::command]
async fn get_folder_items(state: State<'_, Arc<AppState>>) -> Result<Vec<UiItem>, String> {
    let state_arc = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let index_lock = state_arc.index.read();
        if let Some(index) = &*index_lock {
            let items = index.items.iter().map(|item| {
                let meta = std::fs::metadata(&item.path).ok();
                let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                let modified = meta.as_ref()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);

                UiItem {
                    path: item.path.to_string_lossy().to_string(),
                    width: item.metadata.width,
                    height: item.metadata.height,
                    orientation: item.metadata.orientation,
                    format: item.metadata.format.map(|f| format!("{:?}", f)),
                    is_video: item.is_video,
                    size,
                    modified,
                }
            }).collect();
            Ok(items)
        } else {
            Ok(vec![])
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_thumbnail(path: String, max_side: u32, state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let state_arc = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(path);
        let thumb_path = state_arc.cache.ensure_thumbnail(&path, max_side)
            .map_err(|e| e.to_string())?;
        Ok::<String, String>(thumb_path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Parse a Range header like "bytes=0-1023" and return (start, optional_end)
fn parse_range(header: &str, file_len: u64) -> Option<(u64, u64)> {
    let s = header.strip_prefix("bytes=")?;
    let mut parts = s.splitn(2, '-');
    let start_str = parts.next()?;
    let end_str = parts.next()?;

    let start: u64 = if start_str.is_empty() {
        // suffix range like "bytes=-500"
        let suffix: u64 = end_str.parse().ok()?;
        file_len.saturating_sub(suffix)
    } else {
        start_str.parse().ok()?
    };

    let end: u64 = if end_str.is_empty() {
        file_len - 1
    } else {
        end_str.parse().ok()?
    };

    if start <= end && start < file_len {
        Some((start, end.min(file_len - 1)))
    } else {
        None
    }
}

fn main() {
    let cache = LibraryCache::open_default().expect("Failed to open cache");
    let app_state = Arc::new(AppState {
        cache,
        index: RwLock::new(None),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(app_state)
        .register_uri_scheme_protocol("folio", move |_ctx, request| {
            let uri = request.uri().to_string();
            let path_str = uri.strip_prefix("folio://localhost").unwrap_or(&uri);
            let path_str = urlencoding::decode(path_str)
                .unwrap_or(std::borrow::Cow::Borrowed(path_str))
                .to_string();
            let path = PathBuf::from(&path_str);

            // Get file metadata
            let file_meta = match std::fs::metadata(&path) {
                Ok(m) => m,
                Err(_) => {
                    return tauri::http::Response::builder()
                        .status(404)
                        .body(vec![])
                        .unwrap();
                }
            };

            let file_len = file_meta.len();
            let mime = mime_guess::from_path(&path).first_or_octet_stream();
            let is_video = is_video_path(&path);

            // Check for Range header (needed for video streaming)
            let range_header = request.headers().get("range")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            if is_video && file_len > 0 {
                if let Some(ref range_val) = range_header {
                    if let Some((start, end)) = parse_range(range_val, file_len) {
                        let length = end - start + 1;
                        let chunk_size = length.min(4 * 1024 * 1024);

                        use std::io::{Read, Seek, SeekFrom};
                        let mut file = match std::fs::File::open(&path) {
                            Ok(f) => f,
                            Err(_) => {
                                return tauri::http::Response::builder()
                                    .status(500)
                                    .body(vec![])
                                    .unwrap();
                            }
                        };
                        let _ = file.seek(SeekFrom::Start(start));
                        let mut buf = vec![0u8; chunk_size as usize];
                        let bytes_read = file.read(&mut buf).unwrap_or(0);
                        buf.truncate(bytes_read);

                        return tauri::http::Response::builder()
                            .status(206)
                            .header("Content-Type", mime.as_ref())
                            .header("Accept-Ranges", "bytes")
                            .header("Content-Range", format!("bytes {}-{}/{}", start, start + bytes_read as u64 - 1, file_len))
                            .header("Content-Length", bytes_read.to_string())
                            .header("Access-Control-Allow-Origin", "*")
                            .body(buf)
                            .unwrap();
                    }
                }

                if file_len <= 50 * 1024 * 1024 {
                    let data = std::fs::read(&path).unwrap_or_default();
                    return tauri::http::Response::builder()
                        .status(200)
                        .header("Content-Type", mime.as_ref())
                        .header("Accept-Ranges", "bytes")
                        .header("Content-Length", data.len().to_string())
                        .header("Access-Control-Allow-Origin", "*")
                        .body(data)
                        .unwrap();
                } else {
                    use std::io::Read;
                    let mut file = match std::fs::File::open(&path) {
                        Ok(f) => f,
                        Err(_) => {
                            return tauri::http::Response::builder()
                                .status(500)
                                .body(vec![])
                                .unwrap();
                        }
                    };
                    let chunk = 4 * 1024 * 1024u64;
                    let mut buf = vec![0u8; chunk as usize];
                    let n = file.read(&mut buf).unwrap_or(0);
                    buf.truncate(n);

                    return tauri::http::Response::builder()
                        .status(206)
                        .header("Content-Type", mime.as_ref())
                        .header("Accept-Ranges", "bytes")
                        .header("Content-Range", format!("bytes 0-{}/{}", n as u64 - 1, file_len))
                        .header("Content-Length", n.to_string())
                        .header("Access-Control-Allow-Origin", "*")
                        .body(buf)
                        .unwrap();
                }
            }

            // Non-video files (images, GIFs): read fully
            match std::fs::read(&path) {
                Ok(data) => {
                    let cache_val = if path_str.contains("/thumbs/") {
                        "public, max-age=604800, immutable"
                    } else {
                        "public, max-age=3600"
                    };

                    tauri::http::Response::builder()
                        .header("Access-Control-Allow-Origin", "*")
                        .header("Content-Type", mime.as_ref())
                        .header("Cache-Control", cache_val)
                        .header("Content-Length", data.len().to_string())
                        .body(data)
                        .unwrap()
                }
                Err(_) => {
                    tauri::http::Response::builder()
                        .status(404)
                        .body(vec![])
                        .unwrap()
                }
            }
        })
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem, Submenu, PredefinedMenuItem};
            use tauri::Emitter;

            let open_folder = MenuItem::with_id(app, "open-folder", "Open Folder...", true, Some("CmdOrControl+O"))?;
            let settings = MenuItem::with_id(app, "settings", "Settings...", true, Some("CmdOrControl+,"))?;

            let file_menu = Submenu::with_items(app, "File", true, &[&open_folder])?;

            #[cfg(target_os = "macos")]
            let quit = PredefinedMenuItem::quit(app, None)?;

            #[cfg(target_os = "macos")]
            let app_menu = Submenu::with_items(app, "Folio", true, &[&settings, &quit])?;

            #[cfg(not(target_os = "macos"))]
            let app_menu = Submenu::with_items(app, "Folio", true, &[&settings])?;

            let menu = Menu::with_items(app, &[&app_menu, &file_menu])?;
            app.set_menu(menu)?;

            let handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                let id: &str = event.id().as_ref();
                match id {
                    "open-folder" => { let _ = handle.emit("menu-open-folder", ()); }
                    "settings" => { let _ = handle.emit("menu-settings", ()); }
                    _ => {}
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_folder_picker,
            get_folder_items,
            get_thumbnail
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
