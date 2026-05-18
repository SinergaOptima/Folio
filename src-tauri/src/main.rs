#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use parking_lot::RwLock;

use library_core::{LibraryCache, LibraryIndex, build_index};
use media_core::{SimpleEdit, apply_edit, is_video_path};
use image::GenericImageView;

#[derive(serde::Serialize)]
struct UiExif {
    camera: Option<String>,
    aperture: Option<String>,
    shutter_speed: Option<String>,
    iso: Option<String>,
    focal_length: Option<String>,
}

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
    exif: Option<UiExif>,
}

struct AppState {
    cache: LibraryCache,
    index: RwLock<Option<LibraryIndex>>,
    /// Per-path simple edits — keyed by absolute path string
    edits: RwLock<HashMap<String, SimpleEdit>>,
    /// In-memory cache for downscaled preview images (un-edited)
    preview_cache: RwLock<HashMap<String, image::DynamicImage>>,
    /// List of recently opened folder paths
    recent_folders: RwLock<Vec<String>>,
}

#[tauri::command]
async fn set_window_vibrancy(window: tauri::Window, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
        if enabled {
            apply_vibrancy(&window, NSVisualEffectMaterial::UnderWindowBackground, None, None)
                .map_err(|e| e.to_string())?;
        } else {
            // There isn't a direct "remove_vibrancy" in the crate that restores defaults easily,
            // but we can apply a transparent or "none" style if supported, 
            // or just let the user know it requires a restart for now if it's too buggy.
            // For macOS, we can just not apply it.
        }
    }
    Ok(())
}

#[tauri::command]
async fn get_recent_folders(state: State<'_, Arc<AppState>>) -> Result<Vec<String>, String> {
    Ok(state.recent_folders.read().clone())
}

#[tauri::command]
async fn add_recent_folder(path: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let mut recents = state.recent_folders.write();
    if let Some(pos) = recents.iter().position(|p| p == &path) {
        recents.remove(pos);
    }
    recents.insert(0, path);
    if recents.len() > 10 {
        recents.pop();
    }
    // In a real app we'd persist this to a file here
    Ok(())
}

#[tauri::command]
async fn trigger_macos_sound(name: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let sound_path = match name.as_str() {
            "success" => "/System/Library/Sounds/Glass.aiff",
            "error" => "/System/Library/Sounds/Sosumi.aiff",
            "load" => "/System/Library/Sounds/Purr.aiff",
            _ => "/System/Library/Sounds/Pop.aiff",
        };
        let _ = std::process::Command::new("afplay").arg("-v").arg("0.4").arg(sound_path).spawn();
    }
    Ok(())
}

#[tauri::command]
async fn open_folder_picker(state: State<'_, Arc<AppState>>) -> Result<Option<String>, String> {
    let folder = rfd::AsyncFileDialog::new().pick_folder().await;
    let Some(folder) = folder else { return Ok(None); };
    let folder_path = folder.path().to_path_buf();
    let state_arc = state.inner().clone();
    let path_str = tauri::async_runtime::spawn_blocking(move || {
        let index = build_index(&folder_path, &state_arc.cache).map_err(|e| e.to_string())?;
        let path_str = folder_path.to_string_lossy().to_string();
        *state_arc.index.write() = Some(index);
        Ok::<String, String>(path_str)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Some(path_str))
}

#[tauri::command]
async fn open_specific_folder(path: String, state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let folder_path = PathBuf::from(&path);
    let state_arc = state.inner().clone();
    let path_str = tauri::async_runtime::spawn_blocking(move || {
        let index = build_index(&folder_path, &state_arc.cache).map_err(|e| e.to_string())?;
        let path_str = folder_path.to_string_lossy().to_string();
        *state_arc.index.write() = Some(index);
        Ok::<String, String>(path_str)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(path_str)
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
                let exif = item.metadata.exif.as_ref().map(|e| UiExif {
                    camera: e.camera.clone(),
                    aperture: e.aperture.clone(),
                    shutter_speed: e.shutter_speed.clone(),
                    iso: e.iso.clone(),
                    focal_length: e.focal_length.clone(),
                });
                UiItem {
                    path: item.path.to_string_lossy().to_string(),
                    width: item.metadata.width,
                    height: item.metadata.height,
                    orientation: item.metadata.orientation,
                    format: item.metadata.format.map(|f| format!("{:?}", f)),
                    is_video: item.is_video,
                    size,
                    modified,
                    exif,
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
        let thumb_path = state_arc.cache.ensure_thumbnail(&path, max_side).map_err(|e| e.to_string())?;
        Ok::<String, String>(thumb_path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_full_image(path: String, state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let state_arc = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = PathBuf::from(&path);
        let cached = state_arc.cache.ensure_decoded(&p).map_err(|e| e.to_string())?;
        Ok::<String, String>(cached.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn prepare_edit_preview(path: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let state_arc = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if state_arc.preview_cache.read().contains_key(&path) {
            return Ok(());
        }

        let source = {
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
            let native = matches!(ext.as_str(), "jpg"|"jpeg"|"png"|"webp"|"gif"|"bmp");
            if native {
                p.clone()
            } else {
                state_arc.cache.ensure_decoded(&p).map_err(|e| e.to_string())?
            }
        };

        let mut img = media_core::open_image(&source).map_err(|e| e.to_string())?;
        img = media_core::apply_exif_orientation(&img, &p);

        let (w, h) = img.dimensions();
        let max_side = 1024;
        let longest = w.max(h);
        if longest > max_side {
            let scale = max_side as f32 / longest as f32;
            let nw = (w as f32 * scale).round() as u32;
            let nh = (h as f32 * scale).round() as u32;
            img = img.resize(nw, nh, image::imageops::FilterType::Triangle);
        }

        state_arc.preview_cache.write().insert(path, img);
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn edit_image(path: String, edit: SimpleEdit, state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let state_arc = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state_arc.edits.write().insert(path.clone(), edit.clone());
        let preview_cache = state_arc.preview_cache.read();
        let img = preview_cache.get(&path).ok_or_else(|| "preview not prepared".to_string())?;
        let edited = apply_edit(img, &edit);
        let mut buf = Vec::new();
        let rgb = edited.into_rgb8();
        let mut cursor = Cursor::new(&mut buf);
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 85);
        image::DynamicImage::ImageRgb8(rgb).write_with_encoder(encoder).map_err(|e| e.to_string())?;
        Ok::<String, String>(base64_encode(&buf))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn export_edited(path: String, dest: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let state_arc = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let edit = state_arc.edits.read().get(&path).cloned().unwrap_or_default();
        let p = PathBuf::from(&path);
        let mut img = media_core::open_image(&p).map_err(|e| e.to_string())?;
        img = media_core::apply_exif_orientation(&img, &p);
        let edited = apply_edit(&img, &edit);
        let dest_path = PathBuf::from(&dest);
        let fmt = image::ImageFormat::from_path(&dest_path).unwrap_or(image::ImageFormat::Jpeg);
        edited.save_with_format(&dest_path, fmt).map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_edit(path: String, state: State<'_, Arc<AppState>>) -> Result<SimpleEdit, String> {
    let edit = state.edits.read().get(&path).cloned().unwrap_or_default();
    Ok(edit)
}

#[tauri::command]
async fn set_edit(path: String, edit: SimpleEdit, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.edits.write().insert(path, edit);
    Ok(())
}

fn base64_encode(data: &[u8]) -> String {
    use std::fmt::Write;
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };
        let _ = write!(out, "{}{}{}{}", 
            CHARS[b0 >> 2] as char,
            CHARS[((b0 & 3) << 4) | (b1 >> 4)] as char,
            if chunk.len() > 1 { CHARS[((b1 & 0xf) << 2) | (b2 >> 6)] as char } else { '=' },
            if chunk.len() > 2 { CHARS[b2 & 0x3f] as char } else { '=' },
        );
    }
    out
}

fn parse_range(header: &str, file_len: u64) -> Option<(u64, u64)> {
    let s = header.strip_prefix("bytes=")?;
    let mut parts = s.splitn(2, '-');
    let start_str = parts.next()?;
    let end_str = parts.next()?;
    let start: u64 = if start_str.is_empty() {
        let suffix: u64 = end_str.parse().ok()?;
        file_len.saturating_sub(suffix)
    } else {
        start_str.parse().ok()?
    };
    let end: u64 = if end_str.is_empty() { file_len - 1 } else { end_str.parse().ok()? };
    if start <= end && start < file_len { Some((start, end.min(file_len - 1))) } else { None }
}

fn main() {
    let cache = LibraryCache::open_default().expect("Failed to open cache");
    let app_state = Arc::new(AppState {
        cache,
        index: RwLock::new(None),
        edits: RwLock::new(HashMap::new()),
        preview_cache: RwLock::new(HashMap::new()),
        recent_folders: RwLock::new(Vec::new()),
    });

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state);

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_plugin_macos_fps::init());
    }

    builder
        .register_uri_scheme_protocol("folio", move |_ctx, request| {
            let path_str = request.uri().path();
            let mut decoded = urlencoding::decode(path_str).unwrap_or(std::borrow::Cow::Borrowed(path_str)).to_string();
            
            // Clean redundant leading slashes: //Users/... -> /Users/...
            while decoded.starts_with("//") {
                decoded.remove(0);
            }
            // Ensure absolute path
            if !decoded.starts_with('/') {
                decoded.insert(0, '/');
            }

            let path = std::path::PathBuf::from(&decoded);
            let file_meta = match std::fs::metadata(&path) {
                Ok(m) => m,
                Err(_) => return tauri::http::Response::builder().status(404).body(vec![]).unwrap(),
            };
            let file_len = file_meta.len();
            let mime = mime_guess::from_path(&path).first_or_octet_stream();
            let is_video = is_video_path(&path);
            let range_header = request.headers().get("range").and_then(|v| v.to_str().ok()).map(|s| s.to_string());

            if is_video && file_len > 0 {
                if let Some(ref range_val) = range_header {
                    if let Some((start, end)) = parse_range(range_val, file_len) {
                        let length = end - start + 1;
                        let chunk_size = length.min(4 * 1024 * 1024);
                        use std::io::{Read, Seek, SeekFrom};
                        let mut file = match std::fs::File::open(&path) {
                            Ok(f) => f,
                            Err(_) => return tauri::http::Response::builder().status(500).body(vec![]).unwrap(),
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
                            .body(buf).unwrap();
                    }
                }
            }

            match std::fs::read(&path) {
                Ok(data) => {
                    let cache_val = if path_str.contains("/thumbs/") || path_str.contains("/decoded/") { "public, max-age=604800, immutable" } else { "public, max-age=3600" };
                    tauri::http::Response::builder()
                        .header("Access-Control-Allow-Origin", "*")
                        .header("Content-Type", mime.as_ref())
                        .header("Cache-Control", cache_val)
                        .header("Content-Length", data.len().to_string())
                        .body(data).unwrap()
                }
                Err(_) => tauri::http::Response::builder().status(404).body(vec![]).unwrap(),
            }
        })
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem, Submenu, PredefinedMenuItem};
            use tauri::tray::{TrayIconBuilder, TrayIconEvent};
            use tauri::Emitter;
            use tauri::Manager;

            // Tray Icon
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

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
            open_specific_folder,
            get_folder_items,
            get_thumbnail,
            get_full_image,
            prepare_edit_preview,
            edit_image,
            export_edited,
            get_edit,
            set_edit,
            set_window_vibrancy,
            get_recent_folders,
            add_recent_folder,
            trigger_macos_sound,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
