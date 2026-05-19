# Folio

A lightweight photo and video viewer built in rust.

Folio is a high-performance, macOS-native media viewer. It uses Tauri for its architecture, leveraging a native Rust backend for lightning-fast media decoding and a modern Vanilla JS/CSS frontend for a polished UI.

## Features

- **Blazing Fast I/O**: Multi-threaded metadata extraction and aggressive caching via SQLite WAL mode.
- **Media Support**: Full native support for JPG, PNG, WEBP, AVIF, TIFF, GIF, and chunked streaming for video files (MP4, MOV, MKV).
- **Editorial Metadata Overlay**: Press `I` to bring up a beautiful frosted glass overlay with EXIF data (Aperture, Shutter, ISO, Focal Length).
- **Customizable Keybindings**: Fully customizable shortcuts and mouse modifiers via the Settings menu.
- **Native macOS Feel**: Cinematic hardware-accelerated mesh gradient backgrounds, dynamic color tinting based on the active image, and custom magnetic cursors.
- **Precise Zoom**: Buttery smooth, customizable `Shift+Scroll` variable zoom that perfectly tracks the cursor with drag panning.
- **Simple Photo Editing**: Non-destructive adjustments for Brightness and Vibrance, plus instant Horizontal/Vertical flipping.

## Roadmap (Upcoming High-Fidelity Phases)

We are actively developing Folio into the most premium, high-performance media viewer and workflow tool for macOS. Our curated upcoming development phases include:

### 🎨 Visual & Aesthetic Elegance (macOS Native)
- **Dynamic App Vibrancy**: Reactively shift window backdrop transparency and tinting based on the active image's dominant HSL triad.
- **Bilinear/Lanczos GPU downscaling**: GPU-accelerated scaling shaders that maintain ultra-crisp, sharp image rendering for high-megapixel assets when zoomed out.
- **Cinematic Crossfades**: Seamless, smooth crossfading animations during automatic slideshow navigation.
- **Haptic Trackpad Zoom Snapping**: Trigger native macOS haptic trackpad ticks when zooming boundaries cross 100%, 200%, or fit-to-screen thresholds.
- **Full-Screen Zoomable Media Grid**: A dedicated full-screen catalog viewport utilizing `Cmd` + `+`/`-` key combinations to dynamically zoom grid layouts, with right-click options to directly create, rename, and manage physical directories on disk.

### ⚡ Blazing Performance (Apple Silicon Optimization)
- **Apple Silicon Neon Resizer**: Native Rust SIMD/NEON-assisted image scaling to speed up heavy RAW and TIFF loading times by 400%.
- **Filesystem Hot-Watcher**: Real-time folder syncing that instantly updates Folio when files are added, removed, or edited in Finder.
- **Zero-Lag Predictive Caching**: Multi-threaded preloader that decodes the next three adjacent images in the background.
- **LruMemory Auto-Shrinker**: Smart buffer manager that automatically purges memory caches under system pressure events.
- **Featherweight App Footprint**: Dynamic code-stripping and compact dependency audits to keep the Tauri binary size exceptionally small.

### 📸 Professional Photography Workflow
- **Frosted MapKit GPS Popup**: Tapping location coordinates inside the EXIF overlay (`I`) launches a beautiful inline Apple Maps snippet.
- **Double-Pane Before/After Compare**: A sliding comparative viewport to inspect original vs. edited versions side-by-side.
- **Dynamic SERIF Watermarking**: Custom typographic serine-style signature overrides applied dynamically on image export.
- **Intelligent Visual Similarity Finder**: Local perceptual visual hashing (dHash) to flag duplicates or blurry frames inside a directory.
- **Accessibility Color Simulator**: Real-time filters (Protanopia, Deuteranopia, Tritanopia) for designers auditing assets.
- **Format Transcode HUD**: Quick-action batch converter pill at the bottom of the grid view (supporting lossless conversions to and from WebP, PNG, JPEG, AVIF, TIFF, etc.).

### 🔒 Privacy, Tagging, & System Integrations
- **AES-256 Secure Vault**: Encrypted private folder galleries locked securely behind TouchID/FaceID.
- **Gestural Flick-to-Trash**: Swipe or flick thumbnails upwards with physics-based spring acceleration to quickly trash files.
- **Apple Live Photos Playback**: Support playing Live Photo HEIC + MOV combinations by holding click on the media viewport.
- **Advanced Trackpad Gestures**: Buttery smooth multi-touch gestures for navigation swipe-paging, viewport scaling, and direct panning.

> **Note:** The auto-updater is currently on hold due to signature and certificate issues. Please download manual updates from the GitHub Releases page.

### "App is damaged and can't be opened" (macOS)
Because Folio is a free, open-source app, it is not cryptographically "notarized" using a paid Apple Developer account ($99/year). Because of this, modern macOS Gatekeeper intentionally marks the downloaded app as "damaged" to force developers into their paid ecosystem, completely hiding the "Open Anyway" button.

**The ONLY way to bypass Apple's block for free apps is a one-time terminal command:**
1. Drag the **Folio** app from the `.dmg` into your **Applications** folder.
2. Open your Mac's **Terminal** app.
3. Copy and paste this exact command and press Enter:
```bash
xattr -cr /Applications/Folio.app
```
This simply strips Apple's "quarantine" flag from the file. You will now be able to open Folio normally forever!
