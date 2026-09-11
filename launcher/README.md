# Launcher

Desktop app (Tauri 2 + Preact) and `s2pipe` CLI. Both wrap the same core: fetch FFmpeg, MediaMTX and Deno, then run the
whole stack detached.

## Install

Download from [Releases](https://github.com/8borane8/s2pipe/releases):

| File                        | What it is                         |
| --------------------------- | ---------------------------------- |
| `s2pipe-<version>.exe`      | Portable GUI (Windows, no install) |
| `s2pipe-<version>.AppImage` | Portable GUI (Linux, no install)   |
| `s2pipe-<version>.msi`      | GUI installer (Windows)            |
| `s2pipe-<version>.deb`      | GUI installer (Debian / Ubuntu)    |
| `s2pipe-cli-<version>.*`    | CLI, single binary, no install     |

Nothing else is required. The Deno apps (`apps/`, `shared/`, `deno.json`) are baked into the binary at compile time with
`include_dir`, so a bare `.exe` carries the full stack.

## Run

Pick a capture card and a Pico port in the GUI, then press **Start s2pipe**.

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
5. Copies this GUI or CLI onto `~/.s2pipe/launcher` and starts it as `--watchdog`.
6. Starts the Deno node and client, then waits for both ports to accept a connection.

PIDs land in `~/.s2pipe/stack.json` as each process starts, so a crash mid-launch does not leave orphans holding ports.
Every child is spawned detached in its own process group, so closing the launcher leaves the stack running and
`s2pipe stop` kills it from any process. If any step fails, everything already started is killed and the error is
surfaced. Logs go to `~/.s2pipe/logs` (`node.log`, `client.log`, `mediamtx.log`, `ffmpeg-watchdog.log`,
`ffmpeg-video.log`, `ffmpeg-audio.log`). When a process dies at start, the last log lines are included in the error.

FFmpeg is the fragile part, so every launch is a list of attempts: the first process whose `out_time_us` goes above zero
wins, since a missing GPU runtime can keep the process alive for a couple of seconds without muxing anything. Video walks
the encoder backends, then retries them with size, framerate and pixel format dropped. Audio asks for a short capture
buffer first and falls back to the device default. FFmpeg warnings land in `~/.s2pipe/logs`; the last 30 lines are
included in the error message.

The watchdog is the same GUI or CLI binary, copied to `~/.s2pipe/launcher` on launch. It runs `--watchdog`, starts video
and audio, reads `-progress pipe:2` in memory (stderr, not a file), and every second checks that `out_time_us` still
grows. Ten seconds without growth, kill and restart. Autostart always points at that same file: the Windows Run key, or
`~/.config/autostart/s2pipe.desktop` on Linux.

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

| Path           | Contents                                              |
| -------------- | ----------------------------------------------------- |
| `launcher`     | Last GUI or CLI used (watchdog + autostart)           |
| `config.json`  | Saved GUI settings                                    |
| `stack.json`   | PIDs of the running processes                         |
| `mediamtx.yml` | Generated on every start, do not edit                 |
| `bins/`        | Downloaded FFmpeg, MediaMTX, Deno                     |
| `app/`         | Deno workspace extracted from the binary              |
| `logs/`        | `node.log`, `client.log`, `mediamtx.log`, FFmpeg logs |

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
| `s2pipe-gui`  | Tauri shell, commands                                                    |
| `s2pipe`      | CLI                                                                      |

`core` has no Tauri dependency, which is what lets the CLI exist. Device enumeration is per-OS: nokhwa and WASAPI on
Windows, `/dev/video*` and `/proc/asound/pcm` on Linux (no `alsa-utils` needed). Capture itself always goes through
DirectShow on Windows; FFmpeg has no WASAPI demuxer.

`runtime/ffmpeg` is split by concern: `input.rs` builds the capture arguments, `encoder.rs` the codec arguments,
`mod.rs` runs the attempt list and spawns FFmpeg, and `watchdog.rs` supervises `out_time_us` and restarts on freeze.

Releases are cut by pushing a `v*` tag; `.github/workflows/launcher.yml` builds both binaries on Windows and Linux.
