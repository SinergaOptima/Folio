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
Because Folio is an indie, open-source app and isn't cryptographically "notarized" by Apple, macOS Gatekeeper may flag the downloaded `.dmg` as untrusted. 

**To easily bypass this without using the terminal:**
1. Drag the **Folio** app from the downloaded `.dmg` into your **Applications** folder.
2. Open your **Applications** folder in Finder.
3. **Right-click** (or Control-click) on the `Folio` app.
4. Click **Open** from the context menu.
5. A dialog will pop up giving you an **"Open"** button. Click it.

You only have to do this once. macOS will remember that you trust the app, and you can open it normally from Launchpad forever after!

*(If you don't see the Open button, try opening the app normally, then go to your Mac's **System Settings > Privacy & Security**. Scroll down to the Security section and click **"Open Anyway"** next to the Folio warning.)*


