use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use exif::{In, Reader, Tag};
use image::ImageReader;
use image::{DynamicImage, GenericImageView};
use thiserror::Error;
use walkdir::WalkDir;

#[derive(Debug, Clone, Default)]
pub struct ExifData {
    pub camera: Option<String>,
    pub aperture: Option<String>,
    pub shutter_speed: Option<String>,
    pub iso: Option<String>,
    pub focal_length: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ImageMetadata {
    pub width: u32,
    pub height: u32,
    pub orientation: u16,
    pub format: Option<image::ImageFormat>,
    pub exif: Option<ExifData>,
}

#[derive(Debug, Clone)]
pub struct DecodedImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

#[derive(Debug, Error)]
pub enum MediaError {
    #[error("unsupported image format: {0}")]
    Unsupported(PathBuf),
}

pub fn supported_image_extensions() -> &'static [&'static str] {
    &[
        "jpg", "jpeg", "png", "webp", "avif", "tif", "tiff", "bmp", "gif",
    ]
}

pub fn supported_video_extensions() -> &'static [&'static str] {
    &["mp4", "mov", "mkv", "webm"]
}

pub fn is_supported_media_path(path: &Path) -> bool {
    path.extension()
        .and_then(std::ffi::OsStr::to_str)
        .map(str::to_ascii_lowercase)
        .is_some_and(|ext| {
            supported_image_extensions().contains(&ext.as_str())
                || supported_video_extensions().contains(&ext.as_str())
        })
}

pub fn is_video_path(path: &Path) -> bool {
    path.extension()
        .and_then(std::ffi::OsStr::to_str)
        .map(str::to_ascii_lowercase)
        .is_some_and(|ext| supported_video_extensions().contains(&ext.as_str()))
}

pub fn is_supported_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(std::ffi::OsStr::to_str)
        .map(str::to_ascii_lowercase)
        .is_some_and(|ext| supported_image_extensions().contains(&ext.as_str()))
}

pub fn scan_supported_media(root: &Path) -> Result<Vec<PathBuf>> {
    let mut paths = WalkDir::new(root)
        .follow_links(true)
        .max_depth(1) // Only scan the selected folder, not deep recursion
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .map(walkdir::DirEntry::into_path)
        .filter(|path| is_supported_media_path(path))
        .collect::<Vec<_>>();
    paths.sort_unstable();
    Ok(paths)
}

// Keep old name for backwards compat
pub fn scan_supported_images(root: &Path) -> Result<Vec<PathBuf>> {
    scan_supported_media(root)
}

/// Fast metadata read — uses image header dimensions only, avoids full decode
pub fn read_metadata_fast(path: &Path) -> Result<ImageMetadata> {
    if is_video_path(path) {
        // For video files we can't easily get dimensions without ffprobe,
        // so return a placeholder
        return Ok(ImageMetadata {
            width: 1920,
            height: 1080,
            orientation: 1,
            format: None,
            exif: None,
        });
    }

    if !is_supported_image_path(path) {
        return Err(MediaError::Unsupported(path.to_path_buf()).into());
    }

    let reader = ImageReader::open(path)
        .with_context(|| format!("failed to open image: {}", path.display()))?
        .with_guessed_format()
        .with_context(|| format!("failed to guess format: {}", path.display()))?;
    let format = reader.format();

    // Try to read just dimensions from the header without full decode
    let (width, height) = match reader.into_dimensions() {
        Ok(dims) => dims,
        Err(_) => {
            // Fallback: full decode
            let img = image::open(path)
                .with_context(|| format!("failed to decode image: {}", path.display()))?;
            img.dimensions()
        }
    };

    let (orientation, exif_data) = read_full_exif(path).unwrap_or((1, None));

    Ok(ImageMetadata {
        width,
        height,
        orientation,
        format,
        exif: exif_data,
    })
}

pub fn read_metadata(path: &Path) -> Result<ImageMetadata> {
    read_metadata_fast(path)
}

pub fn decode_image(path: &Path, max_side: Option<u32>) -> Result<DecodedImage> {
    let mut image =
        image::open(path).with_context(|| format!("failed to decode image: {}", path.display()))?;
    let orientation = read_exif_orientation(path).unwrap_or(1);
    image = apply_orientation(image, orientation);

    if let Some(max_side) = max_side {
        image = downscale_if_needed(image, max_side);
    }

    let rgba8 = image.to_rgba8();
    let (width, height) = image.dimensions();
    Ok(DecodedImage {
        width,
        height,
        rgba: rgba8.into_vec(),
    })
}

fn downscale_if_needed(image: DynamicImage, max_side: u32) -> DynamicImage {
    let (width, height) = image.dimensions();
    let current_max = width.max(height);
    if current_max <= max_side || max_side == 0 {
        return image;
    }

    let scale = max_side as f32 / current_max as f32;
    let target_w = (width as f32 * scale).round().max(1.0) as u32;
    let target_h = (height as f32 * scale).round().max(1.0) as u32;
    image.resize(target_w, target_h, image::imageops::FilterType::Triangle)
}

fn read_exif_orientation(path: &Path) -> Result<u16> {
    let (orientation, _) = read_full_exif(path)?;
    Ok(orientation)
}

fn read_full_exif(path: &Path) -> Result<(u16, Option<ExifData>)> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let exif = match Reader::new().read_from_container(&mut reader) {
        Ok(e) => e,
        Err(_) => return Ok((1, None)),
    };

    let orientation = exif
        .get_field(Tag::Orientation, In::PRIMARY)
        .and_then(|field| field.value.get_uint(0))
        .map(|v| v as u16)
        .unwrap_or(1);

    let camera = exif
        .get_field(Tag::Model, In::PRIMARY)
        .map(|f| f.display_value().with_unit(&exif).to_string());
    
    let aperture = exif
        .get_field(Tag::FNumber, In::PRIMARY)
        .map(|f| f.display_value().with_unit(&exif).to_string());
    
    let shutter_speed = exif
        .get_field(Tag::ExposureTime, In::PRIMARY)
        .map(|f| f.display_value().with_unit(&exif).to_string());

    let iso = exif
        .get_field(Tag::PhotographicSensitivity, In::PRIMARY)
        .map(|f| f.display_value().with_unit(&exif).to_string());

    let focal_length = exif
        .get_field(Tag::FocalLength, In::PRIMARY)
        .map(|f| f.display_value().with_unit(&exif).to_string());

    let has_exif = camera.is_some() || aperture.is_some() || shutter_speed.is_some() || iso.is_some() || focal_length.is_some();
    
    let exif_data = if has_exif {
        Some(ExifData {
            camera,
            aperture,
            shutter_speed,
            iso,
            focal_length,
        })
    } else {
        None
    };

    Ok((orientation, exif_data))
}

fn apply_orientation(image: DynamicImage, orientation: u16) -> DynamicImage {
    match orientation {
        2 => image.fliph(),
        3 => image.rotate180(),
        4 => image.flipv(),
        5 => image.rotate90().fliph(),
        6 => image.rotate90(),
        7 => image.rotate270().fliph(),
        8 => image.rotate270(),
        _ => image,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_supported_extensions() {
        assert!(is_supported_image_path(Path::new("a.JPG")));
        assert!(is_supported_image_path(Path::new("a.avif")));
        assert!(!is_supported_image_path(Path::new("a.txt")));
    }

    #[test]
    fn detects_video_extensions() {
        assert!(is_video_path(Path::new("a.mp4")));
        assert!(is_video_path(Path::new("a.MOV")));
        assert!(!is_video_path(Path::new("a.jpg")));
    }

    #[test]
    fn detects_supported_media() {
        assert!(is_supported_media_path(Path::new("a.jpg")));
        assert!(is_supported_media_path(Path::new("a.mp4")));
        assert!(!is_supported_media_path(Path::new("a.txt")));
    }

    #[test]
    fn rotates_for_orientation_6() {
        let image = DynamicImage::new_rgba8(100, 50);
        let rotated = apply_orientation(image, 6);
        assert_eq!(rotated.dimensions(), (50, 100));
    }
}
