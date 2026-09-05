# MediaSteru — Product Evolution Ideas

## Overview

The current **MediaSteru** project already goes beyond being a simple `yt-dlp` wrapper.

It supports features such as:

- Direct downloads through `yt-dlp`
- HLS/DASH stream detection
- Browser hunting
- Clipboard monitoring
- Download queues
- Format selection
- Video trimming
- Bulk imports
- FFmpeg-based conversion and processing
- Cross-platform dependency management
- Electron/Wayland migration

A natural next step is to evolve the project from a pure downloader into a lightweight, local-first **media manager and player**.

The main inspiration is not to copy tools such as `rmpc`, but to adopt the same architectural idea:

> Separate the media engine, library, and user interface.

---

## Proposed Architecture

```text
                    MediaSteru
                           │
          ┌────────────────┼────────────────┐
          │                │                │
       Sources          Library          Player
          │                │                │
      yt-dlp             SQLite            mpv
     HLS / DASH             │                │
   Hunting window       Metadata       Local / Stream
          │                │
          └────────── Download Engine ──────┘
                          │
                       FFmpeg
```

Each component has a clear responsibility.

### yt-dlp

Use `yt-dlp` for:

- Source extraction
- Metadata retrieval
- Direct downloads
- Stream URL resolution
- Platform support

### FFmpeg

Use FFmpeg for:

- Muxing
- Format conversion
- Audio extraction
- Trimming
- Re-encoding when necessary

### mpv

Use `mpv` as the playback engine instead of implementing a custom video player.

This keeps the project focused on media management rather than playback internals.

### SQLite

Use SQLite as the persistent media library.

The database can store downloaded media, metadata, history, playlists, and playback progress.

---

## Main Application Sections

The Electron UI could gradually evolve toward something like:

```text
󰈔  Downloads
󰐎  Library
󰑓  Playlists
󰋜  History

────────────────

Downloading
  ├─ Video A       73%
  ├─ Video B       21%
  └─ Video C       queued
```

### Downloads

The existing download workflow remains the main feature.

Possible states:

```text
Pending
Queued
Downloading
Processing
Done
Failed
```

### Library

Downloaded media becomes part of a persistent local library.

Example:

```text
┌──────────────────────────────────────────────┐
│ Search...                                    │
├──────────────────────────────────────────────┤
│ thumbnail │ Linux Rice Setup     │ 1080p │ ▶ │
│ thumbnail │ NixOS Guide          │ 1440p │ ▶ │
│ thumbnail │ Networking Lecture   │ 1080p │ ▶ │
└──────────────────────────────────────────────┘
```

### History

Track recently watched or downloaded media.

Possible sections:

- Recently downloaded
- Recently played
- Continue watching

### Playlists

Allow users to organize local or downloaded media into playlists.

---

## Watch Without Downloading

One of the most useful extensions would be a direct playback mode.

Instead of always downloading first:

```text
URL
 ↓
yt-dlp
 ↓
Resolve playable stream
 ↓
mpv
```

The interface could offer:

```text
[ Download ]   [ Watch Now ]
```

This creates two workflows.

### Download Mode

```text
URL
 ↓
yt-dlp
 ↓
Download
 ↓
FFmpeg processing
 ↓
Library
 ↓
mpv
```

### Watch Mode

```text
URL
 ↓
yt-dlp
 ↓
Stream URL
 ↓
mpv
```

No permanent file is required.

While watching, the user could later choose:

```text
↓ Save this video
```

The existing downloader engine would then take over.

---

## Media Library Database

A possible SQLite schema could contain fields similar to:

```text
media
├── id
├── source_url
├── title
├── uploader
├── thumbnail
├── duration
├── local_path
├── format
├── resolution
├── downloaded_at
├── last_played_at
├── playback_position
└── status
```

This enables several useful features without significantly changing the download engine.

Examples:

```text
Recently Downloaded
Continue Watching
Recently Played
Favorites
Playlists
Downloaded
Audio Only
```

---

## Playback Resume

A particularly useful feature would be persistent playback position.

Example:

```text
NixOS Tutorial

01:17:32 / 02:31:20

[ Continue ]
```

When `mpv` closes, the application stores the current playback position.

The next time the user opens the media, playback resumes automatically.

---

## Download Queue → Media Queue

The existing download queue could eventually evolve into a broader media queue.

Example:

```text
Queue
───────────────────────

↓ Downloading
  Linux Tutorial    63%

⏳ Waiting
  NixOS Part 2
  NixOS Part 3

▶ Up Next
  Music Video
  Conference Talk
```

This introduces two related concepts:

- Download queue
- Playback queue

They can remain separate internally while sharing a consistent user experience.

---

## Small First Step: Play with mpv

Before implementing a complete media library, the smallest useful experiment is simply adding playback after a download finishes.

Example:

```text
Download complete

[ Open Folder ] [ Play ] [ Copy Path ]
                    │
                    └── mpv file.mkv
```

This feature is small, but it validates whether integrating playback into the project is useful.

If it works well, the project can naturally grow into a media manager.

---

## Suggested Roadmap

### Implementation Status — 2026-09-04

The first architecture slice is now implemented in the Electron client. The
design borrows rmpc's separation of core state, protocol boundaries, and views:
the renderer projects state owned by the main-process core instead of owning the
download lifecycle itself.

- [x] Main-process download queue with bounded concurrency, retry, cancel, and
  remove
- [x] Bulk JSON media-list import
- [x] Phone companion endpoint
- [x] mpv detection and local-file playback actions
- [x] SQLite-backed Library view with search and playback timestamps
- [x] Open Folder and Copy Path actions based on the exact final output path
- [x] Versioned localhost control API with optional bearer token
- [x] Rust CLI commands for download, queue, library, cancel, retry, and mpv
- [x] Keyboard-first Ratatui client sharing the Electron-owned core
- [x] Headless Docker/Podman deployment reusing the same queue and media engine
- [x] Multi-architecture GHCR image workflow and TTY-aware `mediasteru` wrapper
- [ ] Trim filmstrip/range selection in Electron
- [ ] Playlist expansion from pasted page URLs
- [ ] Application auto-update UI
- [ ] Release packaging and code signing for Electron
- [ ] Playback-position tracking and resume
- [ ] Watch Without Downloading

The implementation boundaries and rules are documented in
`electron/ARCHITECTURE.md`. Later phases remain incremental; this status list
does not mark the full roadmap as complete.

### Phase 1 — Finish the Electron Migration

Complete the features that still need to reach parity with the existing application.

Examples:

- Trim filmstrip/range selection
- Bulk JSON / playlist import
- Application auto-update UI
- Phone companion endpoint
- Release packaging
- Code signing

The downloader should remain stable before expanding its scope.

---

### Phase 2 — mpv Integration

Add basic playback features.

Possible tasks:

- Detect whether `mpv` is installed
- Launch downloaded files with `mpv`
- Add a **Play** button after successful downloads
- Add **Open Folder**
- Add **Copy File Path**

This phase should require minimal architectural changes.

---

### Phase 3 — Persistent Media Library

Introduce SQLite.

Store:

- Metadata
- Local file paths
- Download timestamps
- Playback timestamps
- Playback positions

Add a new **Library** view in the Electron UI.

---

### Phase 4 — Watch Without Downloading

Add direct stream playback.

Workflow:

```text
URL → yt-dlp → playable stream → mpv
```

Expose the choice:

```text
[ Download ]   [ Watch Now ]
```

This turns the project into both a downloader and a lightweight streaming frontend.

---

### Phase 5 — History, Resume, and Playlists

Once the library is stable, add:

- Continue Watching
- Recently Played
- Favorites
- User playlists
- Playback queue
- Search/filtering

---

### Phase 6 — Optional Terminal Interface

Only after the underlying architecture is stable, consider a TUI.

**Current design decision:** target a small Rust client built with ratatui,
crossterm, and clap. It should consume a versioned local control protocol rather
than create another download queue or write to SQLite independently. See
`electron/TERMINAL_CLIENT.md` for the proposed commands and delivery order.

The TUI could interact with the same core library and download engine instead of becoming a separate implementation.

Possible interface:

```text
mediasteru tui
```

or a dedicated binary later.

This would make the application usable in terminal-first environments such as:

- Niri
- Hyprland
- Sway
- SSH sessions
- Minimal Linux installations

---

## Project Identity

The project does not need an immediate rename.

**MediaSteru** is simple, understandable, and accurately describes the core feature.

The scope can expand gradually:

```text
MediaSteru
       ↓
Media Downloader
       ↓
Local Media Manager
```

The name can be reconsidered only if media management eventually becomes as important as downloading.

---

## Long-Term Vision

A possible long-term architecture is:

```text
               Sources
                  │
       ┌──────────┼──────────┐
       │          │          │
    YouTube     HLS/DASH   Websites
       │          │          │
       └──────────┼──────────┘
                  │
               yt-dlp
                  │
        ┌─────────┴─────────┐
        │                   │
     Download              Watch
        │                   │
      FFmpeg               mpv
        │                   │
        └──────────┬────────┘
                   │
                Library
                   │
                 SQLite
                   │
       ┌───────────┼───────────┐
       │           │           │
    Electron      TUI       External CLI
```

The goal would be a lightweight, local-first media application built around mature Unix tools instead of replacing them.

The project would primarily act as the orchestration layer:

```text
yt-dlp  → acquisition and metadata
FFmpeg  → media processing
mpv     → playback
SQLite  → persistence
Electron → desktop UI
```

This keeps the codebase focused, modular, and easier to maintain while giving the project a much stronger identity than a simple graphical wrapper around `yt-dlp`.
