# Folio

A lightweight photo and video viewer built in rust.

Folio is a high-performance, macOS-native media viewer designed with an editorial aesthetic. It uses Tauri for its architecture, leveraging a native Rust backend for lightning-fast media decoding and a modern Vanilla JS/CSS frontend for a polished, glassmorphic UI.

## Features

- **Blazing Fast I/O**: Multi-threaded metadata extraction and aggressive caching via SQLite WAL mode.
- **Media Support**: Full native support for JPG, PNG, WEBP, AVIF, TIFF, GIF, and chunked streaming for video files (MP4, MOV, MKV).
- **Native macOS Feel**: Draggable regions, custom overlay titlebar, and smooth spring-based animations.
- **Precise Zoom**: Shift+scroll zoom that perfectly tracks the cursor, and a variable HUD slider.

## Building

```bash
# Install frontend dependencies
cd frontend
npm install
npm run build

# Build the macOS app bundle
cd ../src-tauri
npx @tauri-apps/cli build
```
