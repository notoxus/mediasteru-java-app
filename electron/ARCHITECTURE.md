# Electron architecture

The Electron client follows the same broad design lesson as rmpc: keep domain
state and external-process orchestration outside the presentation layer. The
renderer should be a projection of application state, not the owner of that
state.

This is an architectural reference only. No rmpc source code is copied into the
application.

## Layers

```text
Renderer views
    │ IPC commands / state snapshots
    ▼
Main-process application core
    ├── DownloadQueue       queue state and concurrency
    ├── LibraryRepository   persistent SQLite catalog
    ├── PlayerService       mpv process adapter
    └── CompanionServer     phone capture + localhost control boundary
             │
             ▼
External tool adapters
    ├── yt-dlp              extraction and downloads
    ├── FFmpeg              remuxing and conversion
    └── mpv                 playback
```

## Design rules

1. **The main process owns durable state.** Closing or reloading a renderer must
   not create a second download engine or lose the in-memory queue.
2. **The renderer receives snapshots.** UI code may filter and format state, but
   it does not schedule downloads or infer process lifecycle from console text.
3. **External programs are adapters.** yt-dlp, FFmpeg and mpv are detected and
   launched behind small services so they can be replaced and tested without
   rewriting the UI.
4. **Domain contracts are explicit.** IPC uses the types in `src/types.ts`.
   Every queue item has an ID and a finite status; completed downloads expose the
   exact final path reported by yt-dlp/FFmpeg.
5. **Persistence is local-first.** The media library is stored in SQLite under
   Electron's `userData` directory. There is no required account or hosted
   backend.
6. **Diagnostics are implementation detail.** Detailed logs remain available for
   support, while the default UI presents actionable states such as Preparing,
   Downloading, Processing, Complete, and Failed.

## Download lifecycle

```text
enqueue
  → waiting (desktop review)
  → Start Selected
  → queued
  → preparing
  → downloading
       ├─ Pause → pausing → paused → Resume → queued
       └─ Cancel → canceled (retained until Remove)
  → processing (merge/remux/transcode when needed)
  → completed ──→ SQLite library
       └─ error → failed → retry
```

The desktop stages direct and imported requests in `waiting`. Hunter keeps
network candidates scoped to the `WebContents` that detected them. Chromium's
Network debugger reads suspected HLS/DASH response bodies, including iframe,
Service Worker, and MSE traffic; a URL or MIME match alone is never enough.
Playback selects the intended contents over later popup traffic and is required
before **Download video** becomes available. Child OOPIF targets are attached to
the same debugger, so an embedded player does not have to be opened as the main
tab. The action first collects format and quality, then moves the validated
candidate into `waiting`, so detection never starts a download by itself. The
loopback API keeps auto-start behavior for CLI, TUI, and companion compatibility.

At that explicit Download action, the main process reads cookies scoped to the
candidate URL from the temporary Hunter session. The downloader keeps this
browser context internally. For HLS it also keeps the response body and exposes
the rewritten, quality-filtered manifest to FFmpeg through a short-lived
localhost-only endpoint,
avoiding a second request to a one-shot or oversized token URL. Cookie,
authorization, and manifest bodies are removed from every queue snapshot sent
to the renderer or companion API.

Pause terminates the current downloader process at a resumable checkpoint and
retains yt-dlp's partial file. Resume launches the same request again, allowing
yt-dlp to continue it across Windows, macOS, and Linux. Cancel also stops the
process but moves the retained row to `canceled`; Remove is the only queue
action that deletes the row.

`DownloadQueue` currently permits two active jobs. This avoids the previous
single large file blocking every later item while still keeping CPU and disk
contention bounded. Concurrency is deliberately a core policy rather than a UI
setting.

## Module map

- `src/core/download-queue.ts` — task lifecycle, pause/resume, cancellation,
  removal, retry, and bounded concurrency.
- `src/core/library-repository.ts` — SQLite schema and library queries.
- `src/core/player-service.ts` — mpv discovery, JSON IPC, playback queue, Now
  Playing state, and transport controls.
- `src/core/companion-server.ts` — LAN-compatible phone capture endpoints plus
  the localhost-only v1 control API used by the Rust terminal client.
- `src/downloader.ts` — yt-dlp/FFmpeg adapter and structured progress events.
- `src/main.ts` — composition root and IPC boundary.
- `src/renderer.ts` — DOM rendering and user commands only.

## Next boundaries

The next features should preserve these boundaries:

- Trimming belongs in a media-processing service; the renderer only selects the
  time range.
- Application updates and dependency updates should be separate services with
  visible progress and rollback-safe state.
- Direct playback should resolve a playable URL through yt-dlp, then pass it to
  `PlayerService`; it should not embed player logic in the renderer.
- The Rust TUI/CLI calls the same application core through the v1 local protocol
  instead of reimplementing queue and library behavior.

The proposed commands, local protocol, and staged Rust/ratatui implementation
are described in [TERMINAL_CLIENT.md](TERMINAL_CLIENT.md).

## Headless container composition

`src/daemon.ts` composes the same downloader, queue, library, player adapter, and
control server without creating an Electron window. The Docker image runs this
entry point and bundles the Rust terminal client. `/downloads` is the media
volume and `/data` contains SQLite state plus bounded logs.

The headless process is a second deployment mode, not a second implementation of
the downloader. Desktop Electron and the Docker daemon should not be pointed at
the same data directory or port at the same time.
