# Electron / Wayland desktop client

This directory contains the modern desktop UI preview. It runs alongside the existing Swing release while the migration is being validated.

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

The project currently uses Electron 41. Electron selects Wayland automatically in a Wayland session; the app does not force X11 or XWayland.

The client currently supports:

- Direct downloads through checksum-verified yt-dlp, FFmpeg, and Deno binaries.
- Video quality selection from 720p through 2160p or Best, with 1080p as the default.
- MP4 conversion using MKV download, stream copy, then H.264/AAC fallback.
- A built-in temporary Hunting window using Electron `session.webRequest`; no extension or external Chromium installation is required.
- Captured Referer/request headers forwarded to yt-dlp and FFmpeg.
- A main-process download queue with two concurrent jobs, retry, cancel, remove,
  progress, and exact final output paths.
- Bulk JSON import and a local-network companion endpoint on port `8765`.
- A local SQLite media library with search, Play, Open Folder, and Copy Path.
- Optional mpv discovery and playback; downloading still works when mpv is absent.
- Native folder selection, clipboard paste, status messages, and bounded diagnostic logs.
- A localhost-only v1 control API used by the Rust CLI/TUI. The existing `/add`, `/capture`, and `/ping` companion routes remain compatible with the Android app.

## Terminal client

Keep Electron running because it owns the download queue, SQLite library, dependency discovery, and mpv adapter. From the repository root:

```bash
cargo build --release --manifest-path cli/Cargo.toml
./cli/target/release/mediasteru status
./cli/target/release/mediasteru tui
```

The control API is available only from loopback addresses. For an additional local authentication layer, launch both processes with the same token:

```bash
MEDIASTERU_CONTROL_TOKEN="choose-a-long-random-value" npm start
MEDIASTERU_CONTROL_TOKEN="choose-a-long-random-value" ./cli/target/release/mediasteru status
```

Protocol endpoints are documented in [`TERMINAL_CLIENT.md`](TERMINAL_CLIENT.md); command usage is in [`../cli/README.md`](../cli/README.md).

## Headless Docker mode

`src/daemon.ts` composes the same downloader, queue, library, and control API without opening an Electron window. The repository Dockerfile packages that daemon together with the Rust CLI and checksum-verified media tools.

```bash
docker compose up -d
alias mediasteru="$PWD/docker/mediasteru"
mediasteru tui
```

Docker persists downloads through `./downloads` and application state through the `mediasteru-data` volume. The desktop Electron app and headless container are alternative hosts for the same client protocol; do not run both on port `8765` simultaneously.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the core/UI split and extension rules.

Still to migrate before replacing Swing completely:

- Trim filmstrip/range selection.
- Playlist expansion from a pasted page URL.
- App auto-update UI.
- Release packaging and code signing.
- Playback-position tracking and resume.
