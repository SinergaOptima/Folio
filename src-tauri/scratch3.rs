fn main() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let paths = vec!["/Users/lei/Pictures/FolioTest/test.png".to_string()];
        let fmt = "webp".to_string();
        // Just inline the batch_transcode logic to test
        let count = paths.len();
        let target = fmt.to_lowercase();
        let format = image::ImageFormat::WebP;
        
        for path_str in paths {
            let path = std::path::Path::new(&path_str);
            if !path.exists() { println!("File does not exist: {}", path_str); continue; }
            match image::open(path) {
                Ok(img) => {
                    let parent = path.parent().unwrap();
                    let dir = parent.join("Transcoded");
                    std::fs::create_dir_all(&dir).unwrap();
                    let out = dir.join("test.webp");
                    let img_rgba = image::DynamicImage::ImageRgba8(img.into_rgba8());
                    match img_rgba.save_with_format(&out, format) {
                        Ok(_) => println!("Saved OK!"),
                        Err(e) => println!("Error: {:?}", e),
                    }
                }
                Err(e) => println!("Open Error: {:?}", e),
            }
        }
    });
}
