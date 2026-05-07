use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use anyhow::{Context, Result};
use media_core::{ImageMetadata, decode_image, is_video_path, read_metadata, scan_supported_images};
use rusqlite::{Connection, OptionalExtension, params};

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
    let mut items = Vec::with_capacity(paths.len());
    for path in paths {
        let metadata = match cache.cached_metadata(&path) {
            Ok(Some(metadata)) => metadata,
            _ => {
                match read_metadata(&path) {
                    Ok(metadata) => {
                        let _ = cache.upsert_metadata(&path, &metadata);
                        metadata
                    }
                    Err(_) => continue, // Skip files that fail
                }
            }
        };
        let video = is_video_path(&path);
        items.push(LibraryItem { path, metadata, is_video: video });
    }
    Ok(LibraryIndex {
        root: root.to_path_buf(),
        items,
    })
}

pub struct LibraryCache {
    connection: std::sync::Mutex<Connection>,
    thumb_dir: PathBuf,
}

impl LibraryCache {
    pub fn open_default() -> Result<Self> {
        let base = dirs::cache_dir().unwrap_or_else(std::env::temp_dir);
        let root = base.join("folio-app");
        fs::create_dir_all(&root)?;
        let db_path = root.join("library.sqlite3");
        let thumb_dir = root.join("thumbs");
        fs::create_dir_all(&thumb_dir)?;
        let connection = Connection::open(db_path)?;

        // Enable WAL mode for better concurrent performance
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;

        let cache = Self {
            connection: std::sync::Mutex::new(connection),
            thumb_dir,
        };
        cache.ensure_schema()?;
        Ok(cache)
    }

    fn ensure_schema(&self) -> Result<()> {
        self.connection.lock().unwrap().execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS image_metadata (
                path TEXT PRIMARY KEY,
                modified_secs INTEGER NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                orientation INTEGER NOT NULL,
                format TEXT
            );
            "#,
        )?;
        Ok(())
    }

    pub fn upsert_metadata(&self, path: &Path, metadata: &ImageMetadata) -> Result<()> {
        let modified = modified_secs(path)?;
        self.connection.lock().unwrap().execute(
            r#"
            INSERT INTO image_metadata(path, modified_secs, width, height, orientation, format)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(path) DO UPDATE SET
                modified_secs = excluded.modified_secs,
                width = excluded.width,
                height = excluded.height,
                orientation = excluded.orientation,
                format = excluded.format
            "#,
            params![
                path.to_string_lossy(),
                modified,
                i64::from(metadata.width),
                i64::from(metadata.height),
                i64::from(metadata.orientation),
                metadata.format.map(|f| format!("{f:?}")),
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
                SELECT width, height, orientation, format, modified_secs
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
                    ))
                },
            )
            .optional()?;

        let Some((width, height, orientation, format_name, cached_modified)) = row else {
            return Ok(None);
        };
        if cached_modified != modified {
            return Ok(None);
        }
        let format = format_name.as_deref().and_then(parse_image_format);
        Ok(Some(ImageMetadata {
            width: width as u32,
            height: height as u32,
            orientation: orientation as u16,
            format,
        }))
    }

    pub fn thumbnail_path(&self, path: &Path, max_side: u32) -> Result<PathBuf> {
        let fingerprint = image_fingerprint(path)?;
        Ok(self.thumb_dir.join(format!("{fingerprint}_{max_side}.png")))
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
        let decoded = decode_image(path, Some(max_side))
            .with_context(|| format!("failed to decode thumbnail input {}", path.display()))?;
        let rgba = image::RgbaImage::from_raw(decoded.width, decoded.height, decoded.rgba)
            .context("failed to construct RGBA thumbnail image")?;
        image::DynamicImage::ImageRgba8(rgba)
            .save(&thumb_path)
            .with_context(|| format!("failed to save thumbnail {}", thumb_path.display()))?;
        Ok(thumb_path)
    }

    pub fn warm_thumbnails(&self, paths: &[PathBuf], max_side: u32) {
        for path in paths {
            let _ = self.ensure_thumbnail(path, max_side);
        }
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
    let key = format!("{}::{stamp}", path.to_string_lossy());
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
