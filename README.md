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

## Roadmap (Near Term)
We are actively building out Folio's UI/UX to make it the most premium media viewer on macOS. Coming soon:
- **Drag-and-Drop Support:** Open folders or images directly from Finder via drag-and-drop.
- **Double-Click Smart Zoom:** Instantly toggle between "Fit to Screen" and "100% Zoom" at your cursor's location.
- **Cinematic Transitions:** Optional fluid crossfades and sliding animations when navigating between media.
- **Sidebar Enhancements:** Collapsible and resizable sidebar for a truly distraction-free layout.
- **Animated Sorting:** Smooth FLIP animations when re-ordering thumbnails.
- **Scroll Snapping & Centering:** Arrow-key navigation will smoothly center the active thumbnail.
- **Interactive Welcome Screen:** Parallax effects and gradient shifting that reacts to your mouse.
- **Photography Histogram:** A sleek luminance/RGB histogram added to the editorial overlay.
- **Polished Loading States:** Beautiful indeterminate loaders for massive RAW/TIFF files.
- **Settings Tabs:** A categorized, tabbed settings modal for easier navigation.
- **System & Accessibility:** Toggle for the custom magnetic cursor, toast notifications for actions, traffic-light hover handling, and elegant empty states.

## Roadmap (1-2 Months Out)
Beyond immediate UX polish, Folio will expand into a minimal but powerful workflow tool:
- **Photo Color Grading:** Basic non-destructive color adjustments (Exposure, Contrast, Highlights/Shadows).
- **Minimal Photograph Editing:** Crop, rotate, and straighten tools built directly into the viewer.
- **EXIF Editing:** Ability to modify or strip metadata before exporting.
- **Smart Tags & Albums:** Local tagging system to curate mini-collections without moving files on disk.

> **Note:** We are currently investigating an issue with the auto-updater failing to check GitHub releases. Manual updates via downloading the newest `.dmg` may be required in the short term.

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


