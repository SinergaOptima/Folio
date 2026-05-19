use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub use rusqlite;
use anyhow::{Context, Result};
use media_core::{ImageMetadata, decode_image, is_video_path, read_metadata, scan_supported_images};
use rusqlite::{Connection, OptionalExtension, params};
use rayon::prelude::*;

#[derive(Debug, Clone)]
pub struct LibraryItem {
    pub path: PathBuf,
    pub metadata: ImageMetadata,
    pub is_video: bool,
}

#[derive(Debug, Clone, Default)]
pub struct LibraryIndex {
    pub root: PathBuf,
    pub items: Vec<LibraryItem>,
}

impl LibraryIndex {
    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

/// Build index — skips files that fail metadata reads instead of aborting
pub fn build_index(root: &Path, cache: &LibraryCache) -> Result<LibraryIndex> {
    let paths = scan_supported_images(root)?;
    
    let items: Vec<LibraryItem> = paths
        .par_iter()
        .filter_map(|path| {
            let metadata = match cache.cached_metadata(path) {
                Ok(Some(metadata)) => Some(metadata),
                _ => {
                    match read_metadata(path) {
                        Ok(metadata) => {
                            let _ = cache.upsert_metadata(path, &metadata);
                            Some(metadata)
                        }
                        Err(_) => None, // Skip files that fail
                    }
                }
            }?;
            let video = is_video_path(path);
            Some(LibraryItem {
                path: path.clone(),
                metadata,
                is_video: video,
            })
        })
        .collect();

    Ok(LibraryIndex {
        root: root.to_path_buf(),
        items,
    })
}

pub struct LibraryCache {
    pub connection: std::sync::Mutex<Connection>,
    thumb_dir: PathBuf,
    decoded_dir: PathBuf,
}

impl LibraryCache {
    pub fn open_default() -> Result<Self> {
        let base = dirs::cache_dir().unwrap_or_else(std::env::temp_dir);
        let root = base.join("folio-app");
        fs::create_dir_all(&root)?;
        let db_path = root.join("library.sqlite3");
        let thumb_dir = root.join("thumbs");
        fs::create_dir_all(&thumb_dir)?;
        let decoded_dir = root.join("decoded");
        fs::create_dir_all(&decoded_dir)?;
        let connection = Connection::open(db_path)?;

        // Enable WAL mode for better concurrent performance
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;

        let cache = Self {
            connection: std::sync::Mutex::new(connection),
            thumb_dir,
            decoded_dir,
        };
        cache.ensure_schema()?;
        Ok(cache)
    }

    fn ensure_schema(&self) -> Result<()> {
        let conn = self.connection.lock().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS image_metadata (
                path TEXT PRIMARY KEY,
                modified_secs INTEGER NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                orientation INTEGER NOT NULL,
                format TEXT,
                camera TEXT,
                aperture TEXT,
                shutter_speed TEXT,
                iso TEXT,
                focal_length TEXT,
                latitude REAL,
                longitude REAL
            );
            CREATE TABLE IF NOT EXISTS albums (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL
            );
            CREATE TABLE IF NOT EXISTS album_images (
                album_id INTEGER,
                image_path TEXT,
                PRIMARY KEY (album_id, image_path),
                FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                color TEXT
            );
            CREATE TABLE IF NOT EXISTS image_tags (
                image_path TEXT,
                tag_name TEXT,
                PRIMARY KEY (image_path, tag_name)
            );
            "#,
        )?;
        let _ = conn.execute("ALTER TABLE image_metadata ADD COLUMN latitude REAL", []);
        let _ = conn.execute("ALTER TABLE image_metadata ADD COLUMN longitude REAL", []);

        // Simple migration for existing DBs
        let _ = conn.execute("ALTER TABLE image_metadata ADD COLUMN camera TEXT;", []);
        let _ = conn.execute("ALTER TABLE image_metadata ADD COLUMN aperture TEXT;", []);
        let _ = conn.execute("ALTER TABLE image_metadata ADD COLUMN shutter_speed TEXT;", []);
        let _ = conn.execute("ALTER TABLE image_metadata ADD COLUMN iso TEXT;", []);
        let _ = conn.execute("ALTER TABLE image_metadata ADD COLUMN focal_length TEXT;", []);

        Ok(())
    }

    pub fn upsert_metadata(&self, path: &Path, metadata: &ImageMetadata) -> Result<()> {
        let modified = modified_secs(path)?;
        let (camera, aperture, shutter_speed, iso, focal_length, latitude, longitude) = match &metadata.exif {
            Some(e) => (
                e.camera.clone(),
                e.aperture.clone(),
                e.shutter_speed.clone(),
                e.iso.clone(),
                e.focal_length.clone(),
                e.latitude,
                e.longitude,
            ),
            None => (None, None, None, None, None, None, None),
        };

        self.connection.lock().unwrap().execute(
            r#"
            INSERT INTO image_metadata(path, modified_secs, width, height, orientation, format, camera, aperture, shutter_speed, iso, focal_length, latitude, longitude)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            ON CONFLICT(path) DO UPDATE SET
                modified_secs = excluded.modified_secs,
                width = excluded.width,
                height = excluded.height,
                orientation = excluded.orientation,
                format = excluded.format,
                camera = excluded.camera,
                aperture = excluded.aperture,
                shutter_speed = excluded.shutter_speed,
                iso = excluded.iso,
                focal_length = excluded.focal_length,
                latitude = excluded.latitude,
                longitude = excluded.longitude
            "#,
            params![
                path.to_string_lossy(),
                modified,
                i64::from(metadata.width),
                i64::from(metadata.height),
                i64::from(metadata.orientation),
                metadata.format.map(|f| format!("{f:?}")),
                camera,
                aperture,
                shutter_speed,
                iso,
                focal_length,
                latitude,
                longitude,
            ],
        )?;
        Ok(())
    }

    pub fn cached_metadata(&self, path: &Path) -> Result<Option<ImageMetadata>> {
        let modified = modified_secs(path)?;
        let row = self
            .connection.lock().unwrap()
            .query_row(
                r#"
                SELECT width, height, orientation, format, modified_secs, camera, aperture, shutter_speed, iso, focal_length, latitude, longitude
                FROM image_metadata
                WHERE path = ?1
                "#,
                params![path.to_string_lossy()],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, Option<String>>(7)?,
                        row.get::<_, Option<String>>(8)?,
                        row.get::<_, Option<String>>(9)?,
                        row.get::<_, Option<f64>>(10)?,
                        row.get::<_, Option<f64>>(11)?,
                    ))
                },
            )
            .optional()?;

        let Some((width, height, orientation, format_name, cached_modified, camera, aperture, shutter_speed, iso, focal_length, latitude, longitude)) = row else {
            return Ok(None);
        };
        if cached_modified != modified {
            return Ok(None);
        }
        let format = format_name.as_deref().and_then(parse_image_format);
        
        let has_exif = camera.is_some() || aperture.is_some() || shutter_speed.is_some() || iso.is_some() || focal_length.is_some() || latitude.is_some() || longitude.is_some();
        let exif = if has_exif {
            Some(media_core::ExifData {
                camera,
                aperture,
                shutter_speed,
                iso,
                focal_length,
                latitude,
                longitude,
            })
        } else {
            None
        };

        Ok(Some(ImageMetadata {
            width: width as u32,
            height: height as u32,
            orientation: orientation as u16,
            format,
            exif,
        }))
    }

    pub fn thumbnail_path(&self, path: &Path, max_side: u32) -> Result<PathBuf> {
        let fingerprint = image_fingerprint(path)?;
        Ok(self.thumb_dir.join(format!("{fingerprint}_{max_side}.jpg")))
    }

    pub fn ensure_thumbnail(&self, path: &Path, max_side: u32) -> Result<PathBuf> {
        // Video files cannot be thumbnailed by the image crate
        if is_video_path(path) {
            anyhow::bail!("cannot generate thumbnail for video: {}", path.display());
        }

        let thumb_path = self.thumbnail_path(path, max_side)?;
        if thumb_path.exists() {
            return Ok(thumb_path);
        }
        let tmp_path = thumb_path.with_extension("tmp");

        if media_core::can_use_sips(path) {
            // High-performance native thumbnailing
            media_core::sips_output_to_file(path, &tmp_path, Some(max_side), "jpeg")
                .with_context(|| format!("native sips thumbnail failed for {}", path.display()))?;
        } else {
            let decoded = decode_image(path, Some(max_side))
                .with_context(|| format!("failed to decode thumbnail input {}", path.display()))?;
            let rgba = image::RgbaImage::from_raw(decoded.width, decoded.height, decoded.rgba)
                .context("failed to construct RGBA thumbnail image")?;
            let mut file = std::fs::File::create(&tmp_path)
                .with_context(|| format!("failed to create temp thumbnail file: {}", tmp_path.display()))?;
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut file, 85);
            image::DynamicImage::ImageRgba8(rgba)
                .write_with_encoder(encoder)
                .with_context(|| format!("failed to write JPEG thumbnail {}", tmp_path.display()))?;
        }

        std::fs::rename(&tmp_path, &thumb_path)
            .with_context(|| format!("failed to finalize thumbnail {}", thumb_path.display()))?;
        Ok(thumb_path)
    }

    /// Decode a non-native-format image (RAW, exotic TIFF, HEIC, etc.) via sips,
    /// cache the result as a high-quality JPEG, and return the cached path.
    /// On subsequent calls the cached file is returned immediately.
    pub fn ensure_decoded(&self, path: &Path) -> Result<PathBuf> {
        let fingerprint = image_fingerprint(path)?;
        let cached = self.decoded_dir.join(format!("{fingerprint}.jpg"));
        if cached.exists() {
            return Ok(cached);
        }
        let tmp_path = cached.with_extension("tmp");

        if media_core::needs_sips_decode(path) {
            // High-performance native decode directly to the cached file
            media_core::sips_output_to_file(path, &tmp_path, None, "jpeg")
                .with_context(|| format!("native sips decode failed for {}", path.display()))?;
        } else {
            let img = media_core::open_image(path)?;
            let img = media_core::apply_exif_orientation(&img, path);
            // Encode as high-quality JPEG (q95) — much smaller than 16-bit PNG, lossless enough
            let rgb8 = img.to_rgb8();
            let mut file = std::fs::File::create(&tmp_path)
                .with_context(|| format!("failed to create decoded cache file: {}", tmp_path.display()))?;
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut file, 95);
            image::DynamicImage::ImageRgb8(rgb8)
                .write_with_encoder(encoder)
                .with_context(|| format!("failed to encode decoded image: {}", path.display()))?;
        }

        std::fs::rename(&tmp_path, &cached)
            .with_context(|| format!("failed to finalize decoded image: {}", cached.display()))?;
        Ok(cached)
    }

    pub fn warm_thumbnails(&self, paths: &[PathBuf], active_index: usize, max_side: u32) {
        let mut sorted_paths = paths.to_vec();
        sorted_paths.sort_by_key(|path| {
            let orig_idx = paths.iter().position(|p| p == path).unwrap_or(0);
            (orig_idx as isize - active_index as isize).abs()
        });
        sorted_paths.par_iter().for_each(|path| {
            let _ = self.ensure_thumbnail(path, max_side);
        });
    }
}

fn modified_secs(path: &Path) -> Result<i64> {
    let modified = fs::metadata(path)?
        .modified()
        .with_context(|| format!("missing modified time for {}", path.display()))?;
    let secs = modified
        .duration_since(UNIX_EPOCH)
        .with_context(|| format!("invalid modified time for {}", path.display()))?
        .as_secs();
    Ok(secs as i64)
}

fn image_fingerprint(path: &Path) -> Result<String> {
    let stamp = modified_secs(path)?;
    let key = format!("{}::{stamp}_v3", path.to_string_lossy());
    Ok(blake3::hash(key.as_bytes()).to_hex().to_string())
}

fn parse_image_format(name: &str) -> Option<image::ImageFormat> {
    match name {
        "Jpeg" => Some(image::ImageFormat::Jpeg),
        "Png" => Some(image::ImageFormat::Png),
        "Gif" => Some(image::ImageFormat::Gif),
        "WebP" => Some(image::ImageFormat::WebP),
        "Tiff" => Some(image::ImageFormat::Tiff),
        "Bmp" => Some(image::ImageFormat::Bmp),
        "Avif" => Some(image::ImageFormat::Avif),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn parse_known_image_format() {
        assert_eq!(parse_image_format("Png"), Some(image::ImageFormat::Png));
        assert_eq!(parse_image_format("Unknown"), None);
    }

    #[test]
    fn index_default_is_empty() {
        let index = LibraryIndex::default();
        assert!(index.is_empty());
        assert_eq!(index.len(), 0);
        assert_eq!(index.root, Path::new(""));
    }
}
