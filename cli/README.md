# MediaSteru CLI / TUI

`mediasteru` is a small Rust terminal client for the Electron desktop core. It offers script-friendly commands plus an interactive, keyboard-first TUI inspired by rmpc's clear separation between service state and presentation.

The CLI does not run `yt-dlp`, FFmpeg, SQLite, or mpv itself. Keep the Electron app running; both interfaces then share exactly one download queue and media library through the localhost-only control API on port `8765`.

## Build

Rust 1.88 or newer is required by Ratatui 0.30.

```bash
cargo build --release --manifest-path cli/Cargo.toml
./cli/target/release/mediasteru --help
```

On Windows the binary is `cli\target\release\mediasteru.exe`.

## Commands

```text
mediasteru get <URL> [--output DIR] [--format mp4|mkv|mp3] [--quality 720|1080|1440|2160|best]
mediasteru add <URL> [options]   queue without waiting
mediasteru status                show the download queue
mediasteru library [QUERY]       search downloaded media
mediasteru play <ID>             open a library item in mpv
mediasteru player                show Now Playing and progress
mediasteru toggle                toggle play/pause
mediasteru next                  play the next queued media item
mediasteru previous              restart or play the previous item
mediasteru stop                  stop playback
mediasteru cancel <ID>           cancel queued/active work
mediasteru retry <ID>            retry failed/canceled work
mediasteru tui                   open the interactive interface
```

`get` waits and prints live progress; `add` returns as soon as the item is queued. If `--output` is omitted, Electron uses the operating system's Downloads folder. MP4 and 1080p are the defaults.

Run `mediasteru` with no subcommand to open the TUI.

## TUI keys

| Key | Action |
|---|---|
| `1`, `2` | Downloads / Library |
| `a` or `d` | Enter a URL and queue an MP4 1080p download |
| `j`, `k` or arrows | Move selection |
| `/` | Search/filter the Library |
| `c` | Cancel the selected download |
| `r` | Retry the selected failed/canceled download |
| `p` | Play the selected library item through mpv |
| `Space` | Toggle play/pause |
| `n`, `N` | Next / previous media item |
| `s` | Stop playback |
| `Esc` | Close URL input |
| `q` | Quit |

The display refreshes from the Electron-owned state every 750 ms. The v1 API also exposes Server-Sent Events for future push-based clients.

## Connection and token

The default endpoint is `127.0.0.1:8765`. Override it with global `--host` and `--port` options. The Electron control routes reject non-loopback clients even though the compatibility endpoint for the Android companion remains available on the LAN.

An access token is optional. When `MEDIASTERU_CONTROL_TOKEN` is set for Electron, every `/v1/*` request must provide the same value:

```bash
MEDIASTERU_CONTROL_TOKEN="choose-a-long-random-value" ./cli/target/release/mediasteru tui
```

You can also pass `--token`, but the environment variable avoids placing the secret in shell history.

## Docker

The container image includes this exact CLI binary. Run it inside the active service without installing anything on the host:

```bash
docker compose up -d
docker exec mediasteru mediasteru status
docker exec mediasteru mediasteru get "https://example.com/video"
docker exec -it mediasteru mediasteru
```

`docker exec` calls the bundled client in the existing container; `-it` only provides the interactive terminal required by the TUI. In the headless container, downloads and library commands work normally, while browser-window Hunting and host mpv playback are intentionally unavailable.
