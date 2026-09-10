# Launcher

Desktop app (Tauri 2 + Preact) and `s2pipe` CLI. Both wrap the same core: fetch FFmpeg, MediaMTX and Deno, then run the
whole stack detached.

## Install

Download from [Releases](https://github.com/8borane8/s2pipe/releases):

| File                     | What it is                                                            |
| ------------------------ | --------------------------------------------------------------------- |
| `s2pipe-<version>.*`     | GUI installer (`.msi`/`.exe` on Windows, `.deb`/`.AppImage` on Linux) |
| `s2pipe-cli-<version>.*` | Single CLI binary, no install                                         |

Nothing else is required. The Deno apps (`apps/`, `shared/`, `deno.json`) are baked into the binary at compile time with
`include_dir`, so a bare `.exe` carries the full stack.

## Run

Pick a capture card and a Pico port in the GUI, then press **Start s2pipe**. On Windows, install the UART adapter driver
first (CP2102: [Silicon Labs](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers)) or the Pico port never
appears.

Or headless:

```sh
s2pipe start
s2pipe stop
```

`start` relaunches if the stack is already up. Any config field can be overridden for one run:

```sh
s2pipe start --capture-source dshow --capture-device "USB Video" --capture-fps 60
```

Flags overlay `~/.s2pipe/config.json`, they are not written back. The GUI writes that file.

## What start does

1. Unpacks the embedded workspace to `~/.s2pipe/app` (rewritten every start, so it always matches the binary).
2. Downloads FFmpeg, MediaMTX and Deno into `~/.s2pipe/bins` if missing.
3. Writes `~/.s2pipe/mediamtx.yml` from the config (ICE IP and port).
4. Starts MediaMTX and waits for RTSP `:8554` to accept a connection.
5. Starts FFmpeg video, then FFmpeg audio if a mic is selected.
6. Starts the Deno node and client, then waits for `/health`.

PIDs land in `~/.s2pipe/stack.json`. Every child is spawned detached in its own process group, so closing the launcher
leaves the stack running and `s2pipe stop` kills it from any process. If any step fails, everything already started is
killed and the error is surfaced.

FFmpeg is the fragile part, so every launch is a list of attempts: the first process still alive after 1.5 s wins. Video
walks the encoder backends, then retries them with size, framerate and pixel format dropped. Audio asks for a short
capture buffer first and falls back to the device default. Both write to `~/.s2pipe/logs`, and the last 30 lines are
included in the error message.

## Encoders

| Setting | Encoder                     |
| ------- | --------------------------- |
| Auto    | NVENC, then AMF, then CPU   |
| CPU     | `libx264` / `libx265`       |
| NVIDIA  | `h264_nvenc` / `hevc_nvenc` |
| AMD     | `h264_amf` / `hevc_amf`     |

Auto costs about 100 ms on a machine with no GPU encoder: the driver refuses immediately and the next backend is tried.
H.265 halves the bitrate, but browser support for it over WebRTC is patchy, so H.264 stays the default.

All backends are configured for low latency: no B-frames, one keyframe per second, CBR, and no lookahead.

## Files

Everything lives in `~/.s2pipe`:

| Path           | Contents                                    |
| -------------- | ------------------------------------------- |
| `config.json`  | Saved GUI settings                          |
| `stack.json`   | PIDs of the running processes               |
| `mediamtx.yml` | Generated on every start, do not edit       |
| `bins/`        | Downloaded FFmpeg, MediaMTX, Deno           |
| `app/`         | Deno workspace extracted from the binary    |
| `logs/`        | `ffmpeg-video.log`, `ffmpeg-audio.log`, ... |

## Ports

| Port   | Who                          |
| ------ | ---------------------------- |
| `5000` | Client (browser)             |
| `5050` | Node (HTTP + WebSocket)      |
| `8554` | MediaMTX RTSP, loopback only |
| `8889` | MediaMTX WHEP                |
| `8189` | WebRTC ICE (UDP)             |

Only `8189` needs to be reachable by players; the rest follows from the exposure choice in the GUI. There is no
authentication anywhere.

## Development

```sh
cd launcher
deno task dev          # Tauri + Vite, hot reload
deno task build        # tsc + vite build
cargo run -p s2pipe -- start
```

The Rust side is a Cargo workspace under `src-tauri`:

| Crate         | Role                                                                     |
| ------------- | ------------------------------------------------------------------------ |
| `s2pipe-core` | Everything real: config, runtime downloads, spawning, device enumeration |
| `s2pipe-gui`  | Tauri shell, commands, autostart                                         |
| `s2pipe`      | CLI                                                                      |

`core` has no Tauri dependency, which is what lets the CLI exist. Device enumeration is per-OS: nokhwa and WASAPI on
Windows, `/dev/video*` and `/proc/asound/pcm` on Linux (no `alsa-utils` needed). Capture itself always goes through
DirectShow on Windows; FFmpeg has no WASAPI demuxer.

`runtime/ffmpeg` is split by concern: `input.rs` builds the capture arguments, `encoder.rs` the codec arguments,
`runner.rs` runs the attempt list, and `mod.rs` wires them together.

Releases are cut by pushing a `v*` tag; `.github/workflows/launcher.yml` builds both binaries on Windows and Linux.
