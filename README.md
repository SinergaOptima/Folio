# Folio

A lightweight photo and video viewer built in rust.

Folio is a high-performance, macOS-native media viewer designed with an editorial aesthetic. It uses Tauri for its architecture, leveraging a native Rust backend for lightning-fast media decoding and a modern Vanilla JS/CSS frontend for a polished, glassmorphic UI.

## Features

- **Blazing Fast I/O**: Multi-threaded metadata extraction and aggressive caching via SQLite WAL mode.
- **Media Support**: Full native support for JPG, PNG, WEBP, AVIF, TIFF, GIF, and chunked streaming for video files (MP4, MOV, MKV).
- **Native macOS Feel**: Draggable regions, custom overlay titlebar, and smooth spring-based animations.
- **Precise Zoom**: Shift+scroll zoom that perfectly tracks the cursor, and a variable HUD slider.

## Troubleshooting

### "App is damaged and can't be opened" (macOS)
Because this app is not distributed through the Mac App Store and isn't cryptographically notarized with a paid Apple Developer account, macOS Gatekeeper will flag the downloaded `.dmg` as quarantined. 

To fix this, install the app by dragging it to your Applications folder, then open your Terminal and run:
```bash
xattr -cr /Applications/Folio.app
```
This simply removes the quarantine flag and allows the app to run normally!


