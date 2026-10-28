<p align="center"><img src="build/icon-512.png" width="112" alt="ImgViewer icon"></p>

<h1 align="center">ImgViewer</h1>
<p align="center">A simple, fast, modern image viewer for Windows.</p>

<p align="center"><a href="https://github.com/ppcharcoal/ImgViewer/releases/latest"><b>⬇ Download the latest installer</b></a></p>

## Features

- **Opens almost anything** — JPG, PNG, **WebP**, AVIF, GIF (animated), APNG, BMP, ICO, SVG, **HEIC/HEIF** (iPhone photos), **TIFF**, **JPEG XL**, and camera **RAW** files (DNG, CR2/CR3, NEF, ARW, ORF, RW2, RAF, …).
- **Browse the folder** — open one photo and flip through the rest with ← → (or the on-screen arrows, mouse back/forward buttons, or a swipe on touch screens).
- **Smooth zoom** — scroll to zoom toward the cursor, double-click to jump between fit and 100%, drag to move, pinch on touchpads and touch screens.
- **Recent files** — the start screen shows what you opened lately, with thumbnails.
- **First-time setup** — offers to make ImgViewer your default image viewer on Windows.
- Rotate, full screen, copy image, show in folder, move to Recycle Bin.

## Keyboard

| Key | Action |
| --- | --- |
| ← / → (or Space, PgUp/PgDn) | Previous / next image |
| Scroll, + / − | Zoom |
| 0 | Fit to window |
| 1 | Actual size (100%) |
| Double-click | Toggle fit ↔ 100% |
| R / Shift+R | Rotate |
| F or F11 | Full screen |
| Ctrl+O | Open |
| Ctrl+C | Copy image |
| Delete | Move to Recycle Bin |
| Esc | Leave full screen / back to start |

## Making it the default viewer

Windows doesn't let apps make themselves the default silently. ImgViewer registers itself (for your user only, no admin needed), then opens **Settings → Default apps → ImgViewer**, where one click on **Set default** finishes the job. You can do this from the welcome screen or later from Settings (gear icon).

## Building

```bash
npm install
npm start          # run in development
npm run dist       # build the Windows installer into dist/
```

Pushing a tag like `v1.0.1` makes GitHub Actions build the installer and publish it as a release.

The installer isn't code-signed, so Windows SmartScreen may warn on first run — choose **More info → Run anyway**.
