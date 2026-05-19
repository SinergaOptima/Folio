fn main() {
    let img = image::DynamicImage::ImageRgba8(image::RgbaImage::new(10, 10));
    let out = std::path::Path::new("test.webp");
    match img.save_with_format(out, image::ImageFormat::WebP) {
        Ok(_) => println!("Saved webp successfully"),
        Err(e) => println!("Error saving webp: {:?}", e),
    }
}
