use image::DynamicImage;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SimpleEdit {
    /// Brightness adjustment: -100 to 100
    pub brightness: f32,
    /// Vibrance adjustment: -100 to 100
    pub vibrance: f32,
    pub flip_h: bool,
    pub flip_v: bool,
}

impl SimpleEdit {
    pub fn is_identity(&self) -> bool {
        self.brightness == 0.0 && self.vibrance == 0.0 && !self.flip_h && !self.flip_v
    }
}

pub fn apply_edit(image: &DynamicImage, edit: &SimpleEdit) -> DynamicImage {
    if edit.is_identity() {
        return image.clone();
    }

    let mut img = image.clone();

    // 1. Flipping
    if edit.flip_h {
        img = img.fliph();
    }
    if edit.flip_v {
        img = img.flipv();
    }

    // 2. Brightness (simple linear shift)
    if edit.brightness != 0.0 {
        // Map -100..100 to -255..255
        let amount = (edit.brightness / 100.0 * 255.0) as i32;
        img = img.brighten(amount);
    }

    // 3. Simple Vibrance (Saturation boost)
    if edit.vibrance != 0.0 {
        // Use image crate's built-in adjustments for simplicity and stability
        // Adjust saturation: map -100..100 to -100..100 directly
        // DynamicImage doesn't have a high-level vibrance, so we'll use a basic saturation proxy
        // This is much safer than custom HSL math that might cause NaNs.
        let mut rgba = img.to_rgba8();
        let sat = edit.vibrance / 100.0;
        
        for px in rgba.pixels_mut() {
            let [r8, g8, b8, a8] = px.0;
            let r = r8 as f32 / 255.0;
            let g = g8 as f32 / 255.0;
            let b = b8 as f32 / 255.0;
            
            let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            let nr = (lum + (r - lum) * (1.0 + sat)).clamp(0.0, 1.0);
            let ng = (lum + (g - lum) * (1.0 + sat)).clamp(0.0, 1.0);
            let nb = (lum + (b - lum) * (1.0 + sat)).clamp(0.0, 1.0);
            
            px.0 = [(nr * 255.0) as u8, (ng * 255.0) as u8, (nb * 255.0) as u8, a8];
        }
        img = DynamicImage::ImageRgba8(rgba);
    }

    img
}
