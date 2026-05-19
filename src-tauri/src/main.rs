#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::State;
use parking_lot::RwLock;

use library_core::{LibraryCache, LibraryIndex, build_index, rusqlite};
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
    /// In-memory cache of already resolved thumbnail paths: key is (path_string, max_side), value is thumb_path_string
    resolved_thumbs: RwLock<HashMap<(String, u32), String>>,
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

fn get_recents_path() -> std::path::PathBuf {
    let base = dirs::cache_dir().unwrap_or_else(std::env::temp_dir);
    let root = base.join("folio-app");
    let _ = std::fs::create_dir_all(&root);
    root.join("recents.json")
}

fn load_recent_folders() -> Vec<String> {
    let path = get_recents_path();
    if path.exists() {
        if let Ok(content) = std::fs::read_to_string(path) {
            if let Ok(list) = serde_json::from_str::<Vec<String>>(&content) {
                return list;
            }
        }
    }
    Vec::new()
}

fn save_recent_folders(recents: &[String]) {
    let path = get_recents_path();
    if let Ok(content) = serde_json::to_string(recents) {
        let _ = std::fs::write(path, content);
    }
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
    save_recent_folders(&recents);
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
        *state_arc.index.write() = Some(index.clone());

        // Spawn background thread to pre-warm thumbnails in parallel
        let state_clone = state_arc.clone();
        let paths: Vec<PathBuf> = index.items.iter().map(|item| item.path.clone()).collect();
        std::thread::spawn(move || {
            state_clone.cache.warm_thumbnails(&paths, 0, 320);
        });

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
        *state_arc.index.write() = Some(index.clone());

        // Spawn background thread to pre-warm thumbnails in parallel
        let state_clone = state_arc.clone();
        let paths: Vec<PathBuf> = index.items.iter().map(|item| item.path.clone()).collect();
        std::thread::spawn(move || {
            state_clone.cache.warm_thumbnails(&paths, 0, 320);
        });

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
    // Check in-memory resolved_thumbs cache first
    {
        let cache_key = (path.clone(), max_side);
        if let Some(cached_path) = state.resolved_thumbs.read().get(&cache_key) {
            return Ok(cached_path.clone());
        }
    }

    let state_arc = state.inner().clone();
    let path_clone = path.clone();
    let thumb_path = tauri::async_runtime::spawn_blocking(move || {
        let path_buf = PathBuf::from(&path_clone);
        let thumb_path = state_arc.cache.ensure_thumbnail(&path_buf, max_side).map_err(|e| e.to_string())?;
        let thumb_str = thumb_path.to_string_lossy().to_string();
        
        // Populate in-memory cache
        state_arc.resolved_thumbs.write().insert((path_clone, max_side), thumb_str.clone());
        
        Ok::<String, String>(thumb_str)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(thumb_path)
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

        // On macOS, if sips is supported, generate a 1024px temp JPEG downscaled preview
        // which avoids decoding the full high-resolution image in Rust.
        let img = if media_core::can_use_sips(&p) {
            let temp_preview = std::env::temp_dir().join(format!(
                "folio_preview_{}.jpg",
                blake3::hash(path.as_bytes()).to_hex()
            ));
            
            // Generate 1024px preview using sips
            media_core::sips_output_to_file(&p, &temp_preview, Some(1024), "jpeg")
                .map_err(|e| e.to_string())?;
            
            image::open(&temp_preview).map_err(|e| e.to_string())?
        } else {
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
            img
        };

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

fn copy_jpeg_exif(src_path: &Path, dest_path: &Path) -> Result<(), String> {
    let src_bytes = std::fs::read(src_path).map_err(|e| e.to_string())?;
    let mut dest_bytes = std::fs::read(dest_path).map_err(|e| e.to_string())?;
    
    let mut src_app1 = None;
    let mut i = 2;
    while i < src_bytes.len() - 1 {
        if src_bytes[i] == 0xFF {
            let marker = src_bytes[i + 1];
            if marker == 0xD9 || marker == 0xDA {
                break;
            }
            if i + 3 >= src_bytes.len() {
                break;
            }
            let len = ((src_bytes[i + 2] as usize) << 8) | (src_bytes[i + 3] as usize);
            if marker == 0xE1 {
                if i + 4 + 6 <= src_bytes.len() && &src_bytes[i + 4..i + 10] == b"Exif\0\0" {
                    src_app1 = Some(&src_bytes[i..i + 2 + len]);
                    break;
                }
            }
            i += 2 + len;
        } else {
            i += 1;
        }
    }
    
    if let Some(app1) = src_app1 {
        let mut insert_pos = 2;
        let mut dest_i = 2;
        while dest_i < dest_bytes.len() - 1 {
            if dest_bytes[dest_i] == 0xFF {
                let marker = dest_bytes[dest_i + 1];
                if marker == 0xD9 || marker == 0xDA {
                    break;
                }
                if dest_i + 3 >= dest_bytes.len() {
                    break;
                }
                let len = ((dest_bytes[dest_i + 2] as usize) << 8) | (dest_bytes[dest_i + 3] as usize);
                if marker == 0xE1 {
                    if dest_i + 4 + 6 <= dest_bytes.len() && &dest_bytes[dest_i + 4..dest_i + 10] == b"Exif\0\0" {
                        dest_bytes.drain(dest_i..dest_i + 2 + len);
                        insert_pos = dest_i;
                        break;
                    }
                }
                dest_i += 2 + len;
            } else {
                dest_i += 1;
            }
        }
        
        dest_bytes.splice(insert_pos..insert_pos, app1.iter().cloned());
        std::fs::write(dest_path, dest_bytes).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn export_edited(path: String, dest: String, strip_metadata: bool, state: State<'_, Arc<AppState>>) -> Result<(), String> {
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
        
        if !strip_metadata && fmt == image::ImageFormat::Jpeg {
            let src_ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
            if src_ext == "jpg" || src_ext == "jpeg" {
                let _ = copy_jpeg_exif(&p, &dest_path);
            }
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn update_exif_metadata(
    path: String,
    camera: Option<String>,
    aperture: Option<String>,
    shutter_speed: Option<String>,
    iso: Option<String>,
    focal_length: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state_arc = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = state_arc.cache.connection.lock().unwrap();
        conn.execute(
            "UPDATE image_metadata SET camera = ?, aperture = ?, shutter_speed = ?, iso = ?, focal_length = ? WHERE path = ?",
            rusqlite::params![camera, aperture, shutter_speed, iso, focal_length, path],
        ).map_err(|e| e.to_string())?;

        let mut index_lock = state_arc.index.write();
        if let Some(index) = &mut *index_lock {
            if let Some(item) = index.items.iter_mut().find(|it| it.path.to_string_lossy() == path) {
                if item.metadata.exif.is_none() {
                    item.metadata.exif = Some(media_core::ExifData::default());
                }
                if let Some(exif) = &mut item.metadata.exif {
                    exif.camera = camera;
                    exif.aperture = aperture;
                    exif.shutter_speed = shutter_speed;
                    exif.iso = iso;
                    exif.focal_length = focal_length;
                }
            }
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct TagInfo {
    pub name: String,
    pub color: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct AlbumInfo {
    pub id: i64,
    pub name: String,
}

#[tauri::command]
async fn add_tag_to_image(
    path: String,
    tag_name: String,
    tag_color: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state_arc = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = state_arc.cache.connection.lock().unwrap();
        let color = tag_color.unwrap_or_else(|| "#D4A72C".to_string());
        let _ = conn.execute(
            "INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)",
            rusqlite::params![tag_name, color],
        );
        conn.execute(
            "INSERT OR IGNORE INTO image_tags (image_path, tag_name) VALUES (?, ?)",
            rusqlite::params![path, tag_name],
        ).map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn remove_tag_from_image(
    path: String,
    tag_name: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state_arc = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = state_arc.cache.connection.lock().unwrap();
        conn.execute(
            "DELETE FROM image_tags WHERE image_path = ? AND tag_name = ?",
            rusqlite::params![path, tag_name],
        ).map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_image_tags(path: String, state: State<'_, Arc<AppState>>) -> Result<Vec<TagInfo>, String> {
    let state_arc = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = state_arc.cache.connection.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT it.tag_name, COALESCE(t.color, '#D4A72C') FROM image_tags it LEFT JOIN tags t ON it.tag_name = t.name WHERE it.image_path = ?"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(rusqlite::params![path], |row| {
            Ok(TagInfo {
                name: row.get(0)?,
                color: row.get(1)?,
            })
        }).map_err(|e| e.to_string())?;
        let mut tags = Vec::new();
        for row in rows {
            tags.push(row.map_err(|e| e.to_string())?);
        }
        Ok::<Vec<TagInfo>, String>(tags)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_all_tags(state: State<'_, Arc<AppState>>) -> Result<Vec<TagInfo>, String> {
    let state_arc = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = state_arc.cache.connection.lock().unwrap();
        let mut stmt = conn.prepare("SELECT name, color FROM tags").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| {
            Ok(TagInfo {
                name: row.get(0)?,
                color: row.get(1)?,
            })
        }).map_err(|e| e.to_string())?;
        let mut tags = Vec::new();
        for row in rows {
            tags.push(row.map_err(|e| e.to_string())?);
        }
        Ok::<Vec<TagInfo>, String>(tags)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn create_album(name: String, state: State<'_, Arc<AppState>>) -> Result<i64, String> {
    let state_arc = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = state_arc.cache.connection.lock().unwrap();
        conn.execute(
            "INSERT INTO albums (name) VALUES (?)",
            rusqlite::params![name],
        ).map_err(|e| e.to_string())?;
        Ok::<i64, String>(conn.last_insert_rowid())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn add_image_to_album(album_id: i64, path: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let state_arc = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = state_arc.cache.connection.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO album_images (album_id, image_path) VALUES (?, ?)",
            rusqlite::params![album_id, path],
        ).map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn remove_image_from_album(album_id: i64, path: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let state_arc = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = state_arc.cache.connection.lock().unwrap();
        conn.execute(
            "DELETE FROM album_images WHERE album_id = ? AND image_path = ?",
            rusqlite::params![album_id, path],
        ).map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_all_albums(state: State<'_, Arc<AppState>>) -> Result<Vec<AlbumInfo>, String> {
    let state_arc = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = state_arc.cache.connection.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, name FROM albums").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| {
            Ok(AlbumInfo {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        }).map_err(|e| e.to_string())?;
        let mut albums = Vec::new();
        for row in rows {
            albums.push(row.map_err(|e| e.to_string())?);
        }
        Ok::<Vec<AlbumInfo>, String>(albums)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_dominant_colors(path: String) -> Result<Vec<String>, String> {
    let p = std::path::PathBuf::from(&path);
    if media_core::is_video_path(&p) {
        return Ok(vec![]);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let img = media_core::open_image(&p).map_err(|e| e.to_string())?;
        let colors = media_core::extract_dominant_colors(&img, 5);
        Ok(colors)
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
        recent_folders: RwLock::new(load_recent_folders()),
        resolved_thumbs: RwLock::new(HashMap::new()),
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
            update_exif_metadata,
            add_tag_to_image,
            remove_tag_from_image,
            get_image_tags,
            get_all_tags,
            create_album,
            add_image_to_album,
            remove_image_from_album,
            get_all_albums,
            get_edit,
            set_edit,
            set_window_vibrancy,
            get_recent_folders,
            add_recent_folder,
            trigger_macos_sound,
            get_dominant_colors,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
