# Terminal client direction

The terminal edition is a TUI rather than merely a collection of shell flags.
It also keeps a small conventional CLI for scripts while `mediasteru tui`
provides an rmpc-like interactive workspace.

## Product shape

```text
mediasteru get <url>                 download and wait
mediasteru add <url>                 add to the running queue
mediasteru status                    compact queue status
mediasteru library [query]           search local media
mediasteru play <id>                 play through mpv
mediasteru player                    show Now Playing
mediasteru toggle|next|previous|stop control the active player
mediasteru cancel|retry <id>         control a queue item
mediasteru tui                       interactive terminal interface
```

The TUI should use `ratatui`, `crossterm`, and `clap`, following the same broad
tool choices as rmpc. Rust is a good fit here because the result is one small
binary with low idle memory and no Electron/Node runtime requirement.

## Do not build a second downloader core

The terminal client must not independently interpret yt-dlp output, schedule a
second queue, and write directly to the SQLite database while Electron is open.
That would immediately create divergent behavior and locking problems.

Instead, grow the existing companion endpoint into a versioned local control
protocol:

```text
Electron UI ─┐
             ├── local control protocol ── queue/library/tool adapters
Rust TUI ────┘
```

Implemented protocol operations:

- `POST /v1/downloads`
- `GET /v1/downloads`
- `POST /v1/downloads/:id/cancel`
- `POST /v1/downloads/:id/pause`
- `POST /v1/downloads/:id/resume`
- `POST /v1/downloads/:id/retry`
- `GET /v1/library`
- `POST /v1/library/:id/play`
- `GET /v1/player`
- `POST /v1/player/:toggle|next|previous|stop`
- Server-Sent Events at `/v1/events` for queue, library, and player state

The current `/add`, `/capture`, and `/ping` routes remain compatibility endpoints
for the phone companion. The v1 control routes reject non-loopback connections.
Setting `MEDIASTERU_CONTROL_TOKEN` on Electron additionally requires the same
bearer token from terminal clients.

## Delivery order

1. [x] Stabilize the versioned local protocol and add an opt-in access token.
2. [x] Implement the non-interactive `mediasteru` commands as a protocol client.
3. [x] Add a TUI for queue and library navigation.
4. [x] Add enqueue, cancel, retry, search, and mpv actions.
5. [x] Add shared Now Playing state and mpv transport controls.
6. Only then consider moving the headless core into a dedicated daemon. Electron
   can remain the core host until the daemon provides a clear maintenance or
   resource advantage.

## TUI layout

```text
┌ MediaSteru ─ local ─ 2 slots ─────────────────────────────┐
│ [1 Downloads] [2 Library] [3 Activity]              ? help     │
├──────────────────────────────────────────────────────────────────┤
│ URL › https://…                                    [d] download │
├──────────────────────────────────────────────────────────────────┤
│ Name                         Format  Status       Progress        │
│ Linux tutorial              MP4     downloading  63%  8.2MiB/s  │
│ Music video                 MP3     queued        —              │
├──────────────────────────────────────────────────────────────────┤
│ Now Playing  01:24 ━━━━━━━━━╺━━━━ 03:52  Space pause · n/N skip │
├──────────────────────────────────────────────────────────────────┤
│ j/k navigate · c cancel · r retry · p play · s stop · q quit    │
└──────────────────────────────────────────────────────────────────┘
```

The first TUI implementation polls the versioned API every 750 ms for a simple,
recoverable baseline. The SSE endpoint is available for a later push-based event
loop when that added complexity has a measurable benefit.

The key idea borrowed from rmpc is not its exact colors. It is the predictable
screen hierarchy, dense state display, keyboard-first navigation, configurable
bindings, and strict separation between the client view and the service it
controls.
