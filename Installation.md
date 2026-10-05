# 🚀 Installation Guide

Welcome to the setup guide for the current **MediaSteru Java App**. It is **Plug & Play** — no system Java installation is required because the release archive is self-contained.

## Step 1: Requirements

* **Browser Hunting:** Requires a Chromium-based browser, including Helium, Google Chrome, Chromium, Brave, Microsoft Edge, Vivaldi, Opera, Thorium, and compatible derivatives.

And you don't need anything else to setting it up, because it was packaged by me.

## Step 2: Installing the App

1. Navigate to the **[Releases](https://github.com/notoxus/mediasteru-java-app/releases)** page of this repository.
2. Download the archive that matches your Operating System:
   * **Windows:** `MediaSteru-v1.0.6-Win.zip`
   * **macOS:**
     * `MediaSteru-v1.0.6-Mac-Intel.tar.gz` (Intel x64)
     * `MediaSteru-v1.0.6-Mac-AppleSilicon.tar.gz` (Apple Silicon ARM)
   * **Linux:**
     * `MediaSteru-v1.0.6-Linux-x64.tar.gz` (x64)
     * `MediaSteru-v1.0.6-Linux-ARM.tar.gz` (ARM64)

## 📂 Package Structure (What's Inside)

Once extracted, your installation folder contains:

* **Core App:** `mediasteru-java-app.jar` — the main compiled application.
* **Launcher Script:** `run.bat` (Windows) or `run.sh` (Mac/Linux) — starts the app.
* **Embedded Runtime:** A trimmed JRE 21 tailored for your platform, built automatically by CI using `jlink`.
* **Engine Tools:** checksum-verified `yt-dlp`, `ffmpeg`, and `deno` binaries
  selected specifically for the package's OS and CPU architecture.
* **Dependency Manifest:** `tools-manifest.json`, the exact version and hash
  record used by both local development and GitHub release builds.

---

## Step 3: Run the Application

### For Windows Users

1. Extract `MediaSteru-v1.0.6-Win.zip` to any folder.
2. **Double-click `run.bat`** to launch the app.

> The launcher silently checks for the bundled JRE. If it's missing for any reason, it will download and install it automatically before launching.

### For macOS & Linux Users

Unix-based systems require explicit permission to execute launcher scripts.

1. Extract the downloaded `.tar.gz` archive.
2. Open **Terminal** and navigate to the extracted directory:
   ```bash
   cd /path/to/extracted/folder
   ```
3. Grant execution permission:
   ```bash
   chmod +x run.sh
   ```
4. Launch the application:
   ```bash
   ./run.sh
   ```

> Same as Windows — the launcher auto-detects your OS and architecture, checks for the bundled JRE, and downloads it from Adoptium if missing.

#### Linux display scaling

The app uses a 175% interface scale on Linux because some Wayland compositors do not expose fractional DPI correctly to Swing. To override it, launch with a percentage or decimal value:

```bash
MEDIASTERU_UI_SCALE=150% ./run.sh
# or use 1.0 to restore the unscaled size
```

---

## 🔄 Updating the App

When a new version is available, the app will notify you on launch. You can:
- **Download for my system** — automatically downloads the correct package for your OS/architecture into your Downloads folder.
- **Skip this version** — suppresses the notification for that release.
- **Remind me later** — dismissed until next launch.

After downloading, extract the new archive and replace your old installation folder.
