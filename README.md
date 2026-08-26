# Video Downloader

![Downloads](https://img.shields.io/github/downloads/notoxus/video-downloader/total)

[How to install the App](Installation.md)

A desktop app for capturing and downloading HLS/DASH video streams, with built-in support for YouTube, TikTok, Facebook, Instagram, and many more.

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

## Electron / Wayland Preview

A new Electron desktop client is being developed alongside the Swing application. It uses Chromium's native Wayland backend and contains its own temporary Hunting window, so this preview does not require a browser extension or an installed Chromium-family browser.

```bash
cd electron
npm install
npm start
```

The first start synchronizes the checksum-verified yt-dlp, FFmpeg, and Deno
binaries for the current OS/CPU. They are stored in the ignored `tools/`
directory, so developers do not commit large binaries or update them manually.

```bash
cd electron
npm run tools:sync   # download/update this machine
npm run tools:check  # offline checksum verification
npm run tools:update # refresh manifest + update this machine
```

The same update can be run from the repository root on every platform:

```bash
node scripts/update-local-tools.mjs
```

See [`electron/README.md`](electron/README.md) for implemented features and the remaining migration work. The Swing client remains the release client until feature parity is reached.

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

## How to Download a Video

### Method 1 — Direct URL (YouTube, TikTok, etc.)

1. Paste the video URL into the input field at the top.
2. Press **Enter** or click **Hunt / Download**.
3. The app detects the platform and queues the download automatically.

### Method 2 — Browser Hunting (streaming sites)

Many sites load video streams dynamically without a shareable URL. Hunting mode captures these.

1. Leave the input field **empty** and press **Enter**, or paste the site URL and press **Enter**.
2. A dedicated browser window opens and navigates to the page.
3. Play the video — the extension intercepts the stream URL (`.m3u8`, DASH, or any `application/x-mpegURL` response).
4. The tab closes automatically and the download starts.

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

## How Hunting Works (Technical)

The app generates a Chromium extension at `~/.VideoDownloaderApp/Extension/chromium/` and loads it into a disposable browser profile under the system temporary directory. The extension hooks into the browser's `webRequest` API with two interception layers:

The launcher recognizes common Chromium-family browsers on Windows, macOS, and Linux, including Helium. For an uncommon derivative or a portable build, set `VIDEO_DOWNLOADER_BROWSER` to its executable path. Linux AppImages with a recognized browser name are detected automatically when executable and stored in `~/Applications`, `~/.local/bin`, or `~/Downloads`.

1. **URL Pattern Matching** — fires before each request and checks for `.m3u8`, `.mpd`, HLS query parameters (`format=m3u8`, `type=hls`, etc.), and common path segments (`/hls/`, `/dash/`, `/manifest`).

2. **Content-Type Sniffing** — fires when response headers arrive and checks the `Content-Type` for `application/x-mpegURL`, `application/vnd.apple.mpegurl`, or `application/dash+xml`. This catches streams served from URLs with no file extension.

Captured request headers (including `Referer`) are forwarded to the downloader so streams protected by hotlink checks have the same request context as the browser.

Captured URLs are sent via HTTP POST to the app on `localhost:8765`, then queued for download.

---

## Requirements

- **OS:** Windows 10+, macOS 12+, or Linux (x64/ARM)
- **Browser:** A Chromium-based browser such as Helium, Google Chrome, Chromium, Brave, Microsoft Edge, Vivaldi, Opera, or Thorium (for Hunting mode)
- **Internet:** Required on first launch only if the bundled JRE is missing (auto-downloaded from Adoptium)

---

## Building from Source

Requirements: Java 21, Maven 3.3+

```bash
mvn clean package
```

Outputs are in `target/` — platform-specific archives for Windows, macOS (x64/ARM), and Linux (x64/ARM).

> **Note:** The release archives bundle a trimmed JRE built automatically by CI (`jlink`). When building locally, the `tools/jre-*/` directories must be present for the assembly to include them. The launchers (`run.bat` / `run.sh`) will fall back to auto-downloading a JRE from Adoptium if the folder is missing.

---

## Git Tag & Release Management

The GitHub Actions CI automatically builds multi-platform packages and publishes a GitHub Release whenever a new tag matching `v*.*.*` is pushed.

### 1. Create and Push a New Tag (Release)

Use the `./bump-version.sh` script to automatically bump the version and synchronize all project files:

```bash
# Auto-bump patch version from the latest tag (e.g. v1.0.5 -> v1.0.6):
./bump-version.sh

# Or specify an explicit version:
./bump-version.sh [new version]
# For example:
./bump-version.sh 1.0.6

# Commit the version changes and create the tag:
git commit -am "release: v1.0.6"
git tag v1.0.6

# Push code and tag to GitHub to trigger CI release build:
git push origin main
git push origin v1.0.6
```

### 2. Delete a Tag

When you need to delete an incorrect or broken tag:

- **Delete local tag:**
  ```bash
  git tag -d v1.0.6
  ```
- **Delete remote tag on GitHub:**
  ```bash
  git push origin --delete v1.0.6
  ```
- *(Optional)* If GitHub already created a Release for that tag, go to **Releases** on GitHub and click **Delete release**.

### 3. Overwrite / Force Update a Tag

When you need to update an existing tag to point to a newer commit without changing the version number:

```bash
# 1. Update the local tag to point to the current commit (using -f / --force):
git tag -f v1.0.6

# 2. Force-push the updated tag to GitHub:
git push origin -f v1.0.6
```

---

## Troubleshooting

The main window shows short, user-friendly status messages. Click **Show details** only when you need the technical output. You can copy it for a bug report or open the persistent log folder from there. Logs are stored at `~/.VideoDownloaderApp/logs/` and rotate automatically (2 MB per file, up to three backups), so diagnostics cannot grow without limit.

**The extension tab doesn't close / nothing gets captured**
- Make sure the app is running before you open the capture browser.
- Check that port 8765 is not blocked by a firewall.
- Some sites use DRM (Widevine) — encrypted streams cannot be downloaded.

**Download fails with an error**
- In a development checkout, run `cd electron && npm run tools:sync` to restore the pinned, checksum-verified engine tools.
- In a portable release, restart the app to let its dependency check restore a missing yt-dlp binary.
- Some sites require cookies. Open the site normally in browser (logged in), then use Hunting mode.

**Browser says the extension is invalid**
- Delete `~/.VideoDownloaderApp/Extension/` and restart the app to regenerate it.

**yt-dlp warns "No supported JavaScript runtime could be found"**
- Deno is now bundled in releases and synchronized for development from
  `tools-manifest.json`. Run `npm run tools:sync` inside `electron/` if an old
  checkout still shows this warning.

---

## Engine dependency automation

`tools-manifest.json` is the single source of truth for yt-dlp, FFmpeg, and
Deno versions, target filenames, download URLs, and SHA-256 hashes.

- `npm run tools:update` refreshes the small manifest and downloads only the
  binaries for the current machine. The large binaries remain Git-ignored.
- `.github/workflows/release.yml` downloads every platform binary into its
  temporary runner workspace from the same manifest; no binary is committed.
- `.github/workflows/dependency-check.yml` rejects mismatched app versions or
  Java/JRE versions before a forgotten `pom.xml` update reaches a release tag.
- `.github/workflows/ci.yml` builds Java and Electron in clean containers on
  pushes and pull requests.
