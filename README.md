# s2pipe

Self-hosted cloud gaming for a Switch 2 sitting at home.

The console stays on the node, plugged into a capture card. Up to four players join from a browser, see the picture over
WebRTC, and play with a controller (PS5, Xbox, Switch) or keyboard and mouse. Inputs go back to the node, which forwards
them to a Raspberry Pico that emulates USB controllers on the console.

Everything runs on **your** machine and your network. No cloud service, no subscription.

The API has **no authentication**. It is meant for a trusted local or LAN setup. Do not expose it to the Internet.

The **node** (HTTP, sockets, Pico, WHEP proxy), **media** pipeline (FFmpeg + MediaMTX), **client** (Slick + Preact),
and **Pico firmware** are in place.

## Why s2pipe

Play Switch 2 on another screen, in another room, or from a PC in the living room, without recabling HDMI or passing the
controller around. A node at home captures the video output and injects up to four controllers. Players install nothing:
a browser is enough.

## Hardware

- A Switch 2, an HDMI capture card, a Raspberry Pico, a USB-UART adapter (Pico UART to the node).
- A PC (Linux preferred) for the node: capture, encode, USB to the Pico.
- Optional NVIDIA GPU for hardware encoding (`nvenc`).

## Architecture

| Role                       | Where                      | What it does                                       |
| -------------------------- | -------------------------- | -------------------------------------------------- |
| **Media**                  | Capture machine            | FFmpeg encodes, MediaMTX serves WebRTC             |
| **Node** (`apps/node`)     | Same machine (Pico on USB) | HTTP, 4 sockets, serial to the Pico, WHEP proxy    |
| **Client** (`apps/client`) | Browser                    | Connects to the node, shows the feed, sends inputs |

```
Switch 2 --HDMI--> capture card --USB--> media (FFmpeg + MediaMTX)
                                              |-- ICE (UDP/TCP) --> browsers
Browsers --WHEP/inputs--> node --USB serial--> Pico --USB--> Switch 2
```

Video signalling (WHEP) goes through the node. The actual WebRTC media goes to `MEDIA_ICE_IP:MEDIA_ICE_PORT`. Any number
of browsers can watch. They all open the same WebSocket. Up to four can claim a pad.

## Run

Copy `.env.example` to `.env`, then:

```sh
docker compose --profile all up --build
```

Node and media only:

```sh
docker compose --profile node up --build
```

NVIDIA GPU:

```sh
docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile all up --build
```

Uncomment `devices` in `docker-compose.yml` for `/dev/video0` (media) and `/dev/ttyUSB0` (node, Pico UART).

Open `http://localhost:5000`. With `--profile all`, the client uses `NODE_BASE_URL` from `.env` (default
`http://localhost:5050`) and skips the connect page. On the LAN set both `NODE_BASE_URL` and `MEDIA_ICE_IP` to the host
IP. Do not use the Docker hostname `node` — the browser must reach that URL.

If you run the client alone (`deno task dev` or `--profile client`) without `NODE_BASE_URL`, you get a connect page.

Node in Docker talks to MediaMTX on the Compose network (`media:8889`). That port is not published on the host.

## Ports

| Port                            | Where  | What                              |
| ------------------------------- | ------ | --------------------------------- |
| `CLIENT_PORT` (5000)            | Client | Web UI (Slick)                    |
| `NODE_PORT` (5050)              | Node   | HTTP: health, sockets, WHEP proxy |
| `MEDIA_ICE_PORT` (8189) UDP+TCP | Media  | WebRTC ICE / RTP                  |

WHEP (`8889`) and RTSP (`8554`) stay inside the media container.

## Environment

Defaults live in `.env.example`.

| Variable                           | Role                                                   |
| ---------------------------------- | ------------------------------------------------------ |
| `NODE_PORT` / `NODE_BASE_URL`      | Node listen port and public URL (client uses this too) |
| `MEDIA_ICE_IP` / `MEDIA_ICE_PORT`  | Public ICE address the browser must reach              |
| `CAPTURE_SOURCE`                   | `test`, `v4l2`, or `custom`                            |
| `CAPTURE_DEVICE` / `CAPTURE_AUDIO` | V4L2 (and optional ALSA) device                        |
| `FFMPEG_ENCODER`                   | `libx264` or `h264_nvenc` (GPU overlay forces nvenc)   |
| `PICO_SERIAL`                      | UART adapter path (`/dev/ttyUSB0`, `COM3`); empty = no Pico |
| `CLIENT_PORT`                      | Client listen port (5000)                              |

On the LAN set `NODE_BASE_URL=http://192.168.1.20:5050` and `MEDIA_ICE_IP=192.168.1.20`, and forward `NODE_PORT` plus
`MEDIA_ICE_PORT` (UDP and TCP). `NODE_BASE_URL` must be browser-reachable, never `http://node:5050`.

## Node API

| Route               | What                                                   |
| ------------------- | ------------------------------------------------------ |
| `GET /health`       | Connect-page check: capture, Pico, sockets             |
| `GET /socket`       | WebSocket: status, ping, claim or watch a pad          |
| `POST /switch/whep` | WHEP offer; `PATCH` / `DELETE` `/switch/whep/:session` |

Video is public. Everyone on the play page stays on the WebSocket. A claimed pad is held until Watch or disconnect.

## Layout

```
s2pipe/
├── apps/node/          # Deno: HTTP, sockets, Pico, WHEP proxy
├── apps/client/        # Slick + Preact: connect the node, play HUD, inputs
├── firmware/           # Pico: UART from the node, 4 USB pads to the Switch
├── shared/             # Pad and node types
├── docker/             # Node, media, and client images
├── docker-compose.yml
└── docker-compose.gpu.yml
```

## License

[MIT](LICENCE) Copyright (c) 2026-present, Borane
