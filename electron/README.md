# Electron / Wayland prototype

This directory contains the replacement desktop UI. It runs alongside the existing Swing application while the migration is being validated.

## Run

```bash
cd electron
npm install
npm start
```

`npm start` verifies and synchronizes yt-dlp, FFmpeg, and Deno for the current
OS/CPU from `../tools-manifest.json`. Run `npm run tools:check` for an offline
checksum check, `npm run tools:sync` to restore the pinned versions, or
`npm run tools:update` to refresh the manifest from upstream and update this
machine. Downloaded binaries stay ignored by Git.

Electron 38.2+ selects Wayland automatically in a Wayland session. The app does not force X11 or XWayland.

The prototype currently supports:

- Direct downloads through checksum-verified yt-dlp, FFmpeg, and Deno binaries.
- Video quality selection from 720p through 2160p or Best, with 1080p as the default.
- MP4 conversion using MKV download, stream copy, then H.264/AAC fallback.
- A built-in temporary Hunting window using Electron `session.webRequest`; no extension or external Chromium installation is required.
- Captured Referer/request headers forwarded to yt-dlp and FFmpeg.
- Native folder selection, clipboard paste, progress, cancel/remove, status messages, and bounded diagnostic logs.

Still to migrate before replacing Swing completely:

- Trim filmstrip/range selection.
- Bulk JSON/playlist import.
- App auto-update UI.
- Phone companion endpoint.
- Release packaging and code signing.
