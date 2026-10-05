# MediaSteru Java App (Original Repository)

![Downloads](https://img.shields.io/github/downloads/notoxus/mediasteru-java-app/total)

[How to install the App](Installation.md)

> **Repository layout.** This repository contains the portable **Swing** desktop app only.
> The other MediaSteru components live in their own repositories:
>
> | Repository | Contents |
> |---|---|
> | [mediasteru-desktop](https://github.com/notoxus/mediasteru-desktop) | Electron / Wayland desktop client, headless daemon, Docker image |
> | [mediasteru-clients](https://github.com/notoxus/mediasteru-clients) | Rust CLI/TUI and Android "Send to PC" companion |
>
> The Swing app and the Electron app/Docker daemon both listen on port `8765`; run only one of them at a time.

---

## Quick Start

### Windows
Extract the archive and double-click **`run.bat`**.

### macOS / Linux
```bash
chmod +x run.sh
./run.sh
```

No Java installation required — a bundled JRE is included.

---

## Features

| Feature | Description |
|---|---|
| **Browser Hunting** | Intercepts HLS/DASH stream URLs as you browse via a Chromium-based browser extension |
| **Direct Download** | YouTube, TikTok, Facebook, Instagram — extracted directly via yt-dlp |
| **Clipboard Monitor** | Background thread watches your clipboard; paste a URL and it auto-queues |
| **Bulk Import** | Import an API JSON with multiple episodes to queue an entire series |
| **Format Choice** | Download as MP4, MKV, or extract audio as MP3 |
| **Concurrent Fragments** | 16 parallel HLS fragment connections for fast stream downloads |
| **Video Titles** | Queue shows the actual video title instead of the raw URL (hover for the full link) |
| **Search & Clear** | Filter the queue with the search bar; clear all pending items in one click |
| **Auto-Update (engine)** | yt-dlp self-updates in the background on every launch, so site extractors stay fresh |
| **Auto-Update (app)** | On launch the app checks GitHub for a newer release and can download the ready-to-use package for your exact OS/architecture |
| **Trim Before Download** | Cut a specific section (e.g. 01:30 → 02:45) and download only that clip — no full download needed |

---

## How to Download?

### Method 1 — Direct URL (YouTube, TikTok, etc.)

1. Paste the video URL into the input field at the top.
2. Press **Enter** or click **Hunt / Download**.
3. The app detects the platform and queues the download automatically.

### Method 2 — Browser Hunting (streaming sites)

Many sites load video streams dynamically without a shareable URL. Hunting mode captures these.

1. Leave the input field **empty** and press **Enter**, or paste the site URL and press **Enter**.
2. A dedicated browser window opens and navigates to the page.
3. Play the intended video. The extension watches for its stream URL (`.m3u8`, DASH, or any `application/x-mpegURL` response).
4. When **Download with MediaSteru** appears, click it, choose the output format and quality, then add that stream to the review queue. The browser remains open.
5. Select the queued row and press **Start Selected**. Remove it instead if it is an advertisement or an unexpected stream.

> The app loads the extension automatically in a disposable Chromium profile; you do not need to find or select `manifest.json`.

### Method 3 — Clipboard Monitor

Just copy a video URL from anywhere. The app detects it and adds it to the queue within 1–2 seconds.

### Trimming a Clip

When the format dialog appears, tick **"Cut a section before downloading"**. The app reads the video length and shows a **dual-handle slider over a thumbnail filmstrip** — just drag the two handles to set the start and end. The live label shows the exact times and the resulting clip length.

- **Fast cut (default):** cuts on the nearest keyframe using a stream copy — nearly as quick as a normal download.
- **Frame-accurate cut:** tick "Frame-accurate cut" to start/end at the exact second. This re-encodes the clip, so it's slower but precise.

Notes:
- The filmstrip preview is best-effort. For DRM-protected or some login-gated streams it may not appear — the slider still works.
- The queue shows a "trim" mark next to the format for trimmed downloads and you can also remove it with "remove" mark.

### Method 4 — Bulk API JSON Import

Click **Import List** and paste a payload in this format:

```json
{
  "movie": { "name": "Series Title" },
  "episodes": [
    {
      "items": [
        { "name": "Episode 1", "m3u8": "https://cdn.example.com/ep1/playlist.m3u8" },
        { "name": "Episode 2", "m3u8": "https://cdn.example.com/ep2/playlist.m3u8" }
      ]
    }
  ]
}
```

All episodes are queued at once. Select them in the table and click **Start Selected**.

---

## Download Queue

The queue table shows all pending and active downloads:

| Column | Meaning |
|---|---|
| **Ord No.** | Position in queue |
| **Link** | Source URL |
| **Format** | MP4 / MKV / MP3 |
| **Status** | Pending / In Queue / Downloading / Done / Failed |
| **Progress** | Live download percentage |
| **×** | Remove from queue (cannot remove active downloads) |

Select one or more rows and click **Start Selected** to start them.

---

## How Swing Hunting Works (Technical)

The app generates a Chromium extension at `~/.MediaSteru/Extension/chromium/` and loads it into a disposable browser profile under the system temporary directory. The extension hooks into the browser's `webRequest` API with two interception layers:

The launcher recognizes common Chromium-family browsers on Windows, macOS, and Linux, including Helium. For an uncommon derivative or a portable build, set `MEDIASTERU_BROWSER` to its executable path. Linux AppImages with a recognized browser name are detected automatically when executable and stored in `~/Applications`, `~/.local/bin`, or `~/Downloads`.

1. **URL Pattern Matching** — fires before each request and checks for `.m3u8`, `.mpd`, HLS query parameters (`format=m3u8`, `type=hls`, etc.), and common path segments (`/hls/`, `/dash/`, `/manifest`).

2. **Content-Type Sniffing** — fires when response headers arrive and checks the `Content-Type` for `application/x-mpegURL`, `application/vnd.apple.mpegurl`, or `application/dash+xml`. This catches streams served from URLs with no file extension.

Captured request headers (including `Referer`) are forwarded to the downloader so streams protected by hotlink checks have the same request context as the browser.

Candidates are stored per browser tab and are not sent to the app merely because
they were detected. Once media has started playing, the extension displays an
app-owned Download label. Clicking it sends the latest candidate and its request
context via HTTP POST to `localhost:8765`, where it enters the review queue.

---

## Requirements

- **OS:** Windows 10+, macOS 12+, or Linux (x64/ARM)
- **Browser (Swing Hunting):** A Chromium-based browser such as Helium, Google Chrome, Chromium, Brave, Microsoft Edge, Vivaldi, Opera, or Thorium. The Electron client ([mediasteru-desktop](https://github.com/notoxus/mediasteru-desktop)) uses its built-in Chromium window instead.
- **Internet:** Required to resolve and download online media. The launcher also needs it once if the bundled JRE must be restored from Adoptium.

---

## Building from Source

### Portable Swing client

Requirements: Java 21 and Maven 3.3+.

```bash
mvn clean package
```

Outputs are in `target/` — platform-specific archives for Windows, macOS (x64/ARM), and Linux (x64/ARM).

> **Note:** The release archives bundle a trimmed JRE built automatically by CI (`jlink`). When building locally, the `tools/jre-*/` directories must be present for the assembly to include them. The launchers (`run.bat` / `run.sh`) will fall back to auto-downloading a JRE from Adoptium if the folder is missing.

## Troubleshooting

The Swing client keeps technical output away from the primary interface. Click **Show details** when you need it. Logs live under `~/.MediaSteru/logs/`. Troubleshooting for the Electron client is documented in the [mediasteru-desktop](https://github.com/notoxus/mediasteru-desktop) repository.

**The Download label does not appear**
- Make sure the app is running before you open the capture browser.
- Start playback of the intended video and reload its page once if the player
  was already running before Hunting mode was enabled.
- Check that port 8765 is not blocked by a firewall.
- Some sites use DRM (Widevine) — encrypted streams cannot be downloaded.

**Download fails with an error**
- In a portable release, restart the app to let its dependency check restore a missing yt-dlp binary.
- Some sites require cookies. Open the site normally in browser (logged in), then use Hunting mode.

**Browser says the extension is invalid**
- Delete `~/.MediaSteru/Extension/` and restart the app to regenerate it.

**yt-dlp warns "No supported JavaScript runtime could be found"**
- Deno is bundled in the Java desktop release with the other engine tools.

---

## Engine dependency automation

`tools-manifest.json` is the single source of truth for yt-dlp, FFmpeg, and
Deno versions, target filenames, download URLs, and SHA-256 hashes.

- `node scripts/update-local-tools.mjs` refreshes the small manifest and downloads only the
  binaries for the current machine. The large binaries remain Git-ignored.
- `.github/workflows/release.yml` downloads every platform binary into its
  temporary runner workspace from the same manifest; no binary is committed.
- `.github/workflows/dependency-check.yml` rejects mismatched app versions or
  Java/JRE versions before a forgotten `pom.xml` update reaches a release tag.
- `.github/workflows/ci.yml` builds Java in a clean container on
  pushes and pull requests.